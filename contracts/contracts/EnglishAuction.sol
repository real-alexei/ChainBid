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
/// The same reasoning is applied to the token leg of settlement. `settle()` tries
/// to deliver the NFT, but a failure there must never block the money: the
/// recipient is recorded in `nftClaimant` and pulls the token with `claimNft()`.
/// Otherwise a winner that cannot accept a safe transfer would lock both the token
/// and its own bid forever.
///
/// Events carry enough data to drive a read model from the log stream alone: every
/// later event is keyed by `auctionId`, so an indexer joins it against the
/// `AuctionCreated` it already stored rather than asking the chain anything.
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

    /// @dev An auction shorter than the extension window would be extended by its
    ///      very first bid, which makes the stated duration a fiction.
    uint64 public constant MIN_DURATION = EXTENSION_WINDOW;
    uint64 public constant MAX_DURATION = 30 days;

    /// @notice A bid must beat the standing one by at least this much.
    /// @dev Extension is deliberately uncapped, so the increment is what stops a
    ///      griefer from ratcheting the close out forever on 1-wei raises: every
    ///      extension now costs them 5% more locked capital, and any raise they
    ///      make is one they can be held to.
    uint256 public constant MIN_BID_INCREMENT_BPS = 500;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint256 public nextAuctionId = 1;

    mapping(uint256 auctionId => Auction) public auctions;
    mapping(address bidder => uint256 amount) public pendingReturns;

    /// @notice Set when settlement could not hand the token over; the named address
    ///         pulls it with `claimNft()`.
    mapping(uint256 auctionId => address claimant) public nftClaimant;

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

    /// @notice The token could not be delivered; `claimant` must pull it.
    event NftDeliveryFailed(uint256 indexed auctionId, address indexed claimant);

    event NftClaimed(uint256 indexed auctionId, address indexed claimant);

    error AuctionNotFound(uint256 auctionId);
    error AuctionEnded(uint256 auctionId, uint64 endTime);
    error AuctionStillLive(uint256 auctionId, uint64 endTime);
    error AuctionAlreadySettled(uint256 auctionId);
    error BidBelowReserve(uint256 sent, uint256 reservePrice);
    error BidNotHighEnough(uint256 sent, uint256 minimumBid);
    error ZeroBid();
    error SellerCannotBid();
    error NotSeller(address caller, address seller);
    error CannotCancelWithBids(uint256 auctionId);
    error InvalidDuration(uint64 duration);
    error NothingToWithdraw();
    error RefundFailed(address to, uint256 amount);
    error EscrowFailed(address nft, uint256 tokenId);
    error NothingToClaim(uint256 auctionId);
    error NotClaimant(address caller, address claimant);

    /// @notice Escrow `tokenId` and open an ascending auction on it.
    /// @dev The caller must have approved this contract for the token first.
    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 reservePrice,
        uint64 duration
    ) external nonReentrant returns (uint256 auctionId) {
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

        // Escrow last, with the auction already written: `nonReentrant` keeps the
        // token contract from re-entering here, but it still sees a consistent
        // contract if it calls back in some other way.
        IERC721(nft).safeTransferFrom(msg.sender, address(this), tokenId);

        // A token contract is free to lie about having moved anything. Without this
        // an auction could be opened on a no-op "NFT", take real bids, and settle
        // by paying the seller for something that was never escrowed.
        if (IERC721(nft).ownerOf(tokenId) != address(this)) revert EscrowFailed(nft, tokenId);

        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, reservePrice, startTime, endTime);
    }

    /// @notice Place a bid. The previous high bid becomes withdrawable by its owner.
    function bid(uint256 auctionId) external payable nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        // A cancelled auction keeps a future `endTime`, so without this a bid can
        // still land on one whose token has already gone home — and that ETH has
        // no way back out.
        if (auction.settled) revert AuctionAlreadySettled(auctionId);
        if (block.timestamp >= auction.endTime) revert AuctionEnded(auctionId, auction.endTime);
        if (msg.sender == auction.seller) revert SellerCannotBid();
        if (msg.value == 0) revert ZeroBid();

        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;

        // `highestBidder` is the sentinel for "no bids yet" everywhere, including
        // `settle()` and `cancel()`. Keying off `highestBid` instead would treat a
        // zero-value bid as no bid at all.
        if (previousBidder == address(0)) {
            if (msg.value < auction.reservePrice) {
                revert BidBelowReserve(msg.value, auction.reservePrice);
            }
        } else {
            uint256 floorBid = _minimumBid(previousBidder, previousBid, auction.reservePrice);
            if (msg.value < floorBid) revert BidNotHighEnough(msg.value, floorBid);

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

        // Reserve never met: the NFT goes home. Otherwise it goes to the winner and
        // the seller is credited rather than paid, for the same reason refunds are.
        address recipient = seller;
        if (winner != address(0)) {
            recipient = winner;
            pendingReturns[seller] += amount;
        }

        _deliverNft(auctionId, auction.nft, auction.tokenId, recipient);

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
        _deliverNft(auctionId, auction.nft, auction.tokenId, auction.seller);

        emit AuctionCancelled(auctionId, auction.seller);
    }

    /// @notice Collect a token that settlement could not push. Uses `transferFrom`,
    ///         not `safeTransferFrom`: the caller asked for it, so there is nothing
    ///         to protect them from, and requiring the receiver hook here is exactly
    ///         what stopped delivery in the first place.
    function claimNft(uint256 auctionId) external nonReentrant {
        address claimant = nftClaimant[auctionId];
        if (claimant == address(0)) revert NothingToClaim(auctionId);
        if (msg.sender != claimant) revert NotClaimant(msg.sender, claimant);

        Auction storage auction = auctions[auctionId];
        delete nftClaimant[auctionId];

        IERC721(auction.nft).transferFrom(address(this), claimant, auction.tokenId);

        emit NftClaimed(auctionId, claimant);
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

    /// @notice The smallest bid `auctionId` will currently accept, so a UI does not
    ///         have to reimplement the increment rule and guess wrong.
    function minimumBid(uint256 auctionId) external view returns (uint256) {
        Auction memory auction = auctions[auctionId];
        if (auction.seller == address(0)) revert AuctionNotFound(auctionId);
        return _minimumBid(auction.highestBidder, auction.highestBid, auction.reservePrice);
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

    /// @dev The bid floor: the reserve until someone has bid, the standing bid plus
    ///      the increment after that. Zero is never a valid bid, so a reserve of zero
    ///      still means "one wei or more".
    function _minimumBid(
        address highestBidder,
        uint256 highestBid,
        uint256 reservePrice
    ) private pure returns (uint256) {
        if (highestBidder == address(0)) {
            return reservePrice == 0 ? 1 : reservePrice;
        }
        uint256 stepped = highestBid + (highestBid * MIN_BID_INCREMENT_BPS) / BPS_DENOMINATOR;
        return stepped > highestBid ? stepped : highestBid + 1;
    }

    /// @dev Push the token, but never let a failure there strand the ETH. A reverting
    ///      recipient (or token) downgrades delivery to a pull via `claimNft()`.
    function _deliverNft(uint256 auctionId, address nft, uint256 tokenId, address to) private {
        try IERC721(nft).safeTransferFrom(address(this), to, tokenId) {
            return;
        } catch {
            nftClaimant[auctionId] = to;
            emit NftDeliveryFailed(auctionId, to);
        }
    }
}
