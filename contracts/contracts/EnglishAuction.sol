// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EnglishAuction
/// @notice Ascending-price auctions for ERC-721 tokens, settled on-chain.
///
/// The NFT is escrowed by this contract for the life of the auction and bids are
/// held as ETH, so a winning bid can never fail to pay. Outbid funds are *not*
/// pushed back to the previous bidder: they are credited to `pendingReturns` and
/// pulled via `withdraw()`. A push refund would hand control to an arbitrary
/// contract in the middle of `bid()`, and a bidder that reverts on receive could
/// otherwise wedge the auction permanently.
///
/// Every event below carries enough data to build a read model without any
/// follow-up RPC call — indexers should never have to ask the chain a question
/// the log could have answered.
contract EnglishAuction is IERC721Receiver, ReentrancyGuard {
    struct Auction {
        address seller;
        address nft;
        uint256 tokenId;
        uint256 reservePrice;
        uint256 highestBid;
        address highestBidder;
        uint64 endTime;
        bool settled;
    }

    /// @notice A bid landing within this window of the end pushes the end time out.
    /// @dev Without it the dominant strategy is to bid in the final second, which
    ///      suppresses price discovery and makes a live bid feed pointless.
    uint64 public constant EXTENSION_WINDOW = 5 minutes;

    /// @notice How far past `block.timestamp` a late bid moves the end time.
    uint64 public constant EXTENSION_DURATION = 5 minutes;

    uint64 public constant MIN_DURATION = 1 minutes;
    uint64 public constant MAX_DURATION = 30 days;

    uint256 public nextAuctionId = 1;

    mapping(uint256 auctionId => Auction) public auctions;
    mapping(address bidder => uint256 amount) public pendingReturns;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address indexed nft,
        uint256 tokenId,
        uint256 reservePrice,
        uint64 startTime,
        uint64 endTime
    );

    /// @param endTime Included because a late bid may have just extended it.
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        address previousBidder,
        uint256 previousBid,
        uint64 endTime
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 amount,
        address indexed seller
    );

    event AuctionCancelled(uint256 indexed auctionId, address indexed seller);

    event RefundWithdrawn(address indexed bidder, uint256 amount);

    error AuctionNotFound(uint256 auctionId);
    error AuctionEnded(uint256 auctionId, uint64 endTime);
    error AuctionStillLive(uint256 auctionId, uint64 endTime);
    error AuctionAlreadySettled(uint256 auctionId);
    error BidBelowReserve(uint256 sent, uint256 reservePrice);
    error BidNotHighEnough(uint256 sent, uint256 highestBid);
    error SellerCannotBid();
    error NotSeller(address caller, address seller);
    error CannotCancelWithBids(uint256 auctionId);
    error InvalidDuration(uint64 duration);
    error NothingToWithdraw();
    error RefundFailed(address to, uint256 amount);

    /// @notice Escrow `tokenId` and open an ascending auction on it.
    /// @dev The caller must have approved this contract for the token first.
    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 reservePrice,
        uint64 duration
    ) external returns (uint256 auctionId) {
        if (duration < MIN_DURATION || duration > MAX_DURATION) {
            revert InvalidDuration(duration);
        }

        auctionId = nextAuctionId++;
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + duration;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nft: nft,
            tokenId: tokenId,
            reservePrice: reservePrice,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            settled: false
        });

        // Escrow last: the transfer can re-enter, and state is already consistent.
        IERC721(nft).safeTransferFrom(msg.sender, address(this), tokenId);

        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, reservePrice, startTime, endTime);
    }

    /// @notice Place a bid. The previous high bid becomes withdrawable by its owner.
    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        if (block.timestamp >= auction.endTime) revert AuctionEnded(auctionId, auction.endTime);
        if (msg.sender == auction.seller) revert SellerCannotBid();

        if (auction.highestBid == 0) {
            if (msg.value < auction.reservePrice) {
                revert BidBelowReserve(msg.value, auction.reservePrice);
            }
        } else if (msg.value <= auction.highestBid) {
            revert BidNotHighEnough(msg.value, auction.highestBid);
        }

        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;
        if (previousBidder != address(0)) {
            pendingReturns[previousBidder] += previousBid;
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;

        // Anti-sniping: a bid near the close pushes the close out.
        if (auction.endTime - uint64(block.timestamp) < EXTENSION_WINDOW) {
            auction.endTime = uint64(block.timestamp) + EXTENSION_DURATION;
        }

        emit BidPlaced(auctionId, msg.sender, msg.value, previousBidder, previousBid, auction.endTime);
    }

    /// @notice Finalise a finished auction. Callable by anyone — the outcome is
    ///         already determined, so there is no reason to gate it on the parties.
    function settle(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);
        if (block.timestamp < auction.endTime) {
            revert AuctionStillLive(auctionId, auction.endTime);
        }

        auction.settled = true;

        address winner = auction.highestBidder;
        uint256 amount = auction.highestBid;
        address seller = auction.seller;

        if (winner == address(0)) {
            // Reserve never met: the NFT goes home.
            IERC721(auction.nft).safeTransferFrom(address(this), seller, auction.tokenId);
        } else {
            IERC721(auction.nft).safeTransferFrom(address(this), winner, auction.tokenId);
            // Credit rather than transfer, for the same reason refunds are pulled.
            pendingReturns[seller] += amount;
        }

        emit AuctionSettled(auctionId, winner, amount, seller);
    }

    /// @notice Cancel an auction that never received a bid and reclaim the NFT.
    function cancel(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);
        if (msg.sender != auction.seller) revert NotSeller(msg.sender, auction.seller);
        if (auction.highestBidder != address(0)) revert CannotCancelWithBids(auctionId);

        auction.settled = true;
        IERC721(auction.nft).safeTransferFrom(address(this), auction.seller, auction.tokenId);

        emit AuctionCancelled(auctionId, auction.seller);
    }

    /// @notice Withdraw refunded bids and, for sellers, settled proceeds.
    function withdraw() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingReturns[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{ value: amount }("");
        if (!ok) revert RefundFailed(msg.sender, amount);

        emit RefundWithdrawn(msg.sender, amount);
    }

    /// @notice Read an auction as a struct. The public mapping getter returns a
    ///         flattened tuple, which is awkward for callers.
    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        Auction memory auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        return auction;
    }

    /// @dev Accept escrowed tokens.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
