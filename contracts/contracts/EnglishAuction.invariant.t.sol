// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ChainBidNFT } from "./ChainBidNFT.sol";
import { EnglishAuction } from "./EnglishAuction.sol";

/// @dev The handler drives the auction house through an interface rather than the
///      concrete type so the same campaign can be pointed at an older build to
///      check that it still fails there. An invariant nobody has ever seen fail is
///      not evidence of anything.
///
///      Calibrated that way against the pre-audit build (commit 78b0d87): the
///      campaign below breaks it unaided, reporting ~1.59 ETH held and owed to
///      nobody, having found the create -> cancel -> bid ordering by itself. That
///      ordering is what `test_CancelledAuctionRejectsFurtherBids` pins down
///      deterministically; this is the version that would have found it first.
///
///      Two things had to be right before it had any power at all, and both failed
///      silently rather than loudly (see the notes on funding and on selector
///      restriction below). A green invariant run means nothing until you have
///      watched it go red.
interface IAuctionHouse {
    function createAuction(
        address nft,
        uint256 tokenId,
        uint256 reservePrice,
        uint64 duration
    ) external returns (uint256);

    function bid(uint256 auctionId) external payable;

    function settle(uint256 auctionId) external;

    function cancel(uint256 auctionId) external;

    function withdraw() external;

    function pendingReturns(address bidder) external view returns (uint256);

    function auctions(
        uint256 auctionId
    )
        external
        view
        returns (
            address seller,
            address nft,
            uint256 tokenId,
            uint256 reservePrice,
            uint256 highestBid,
            address highestBidder,
            uint64 endTime,
            bool settled
        );
}

/// Random sequences of auction actions. The point is the *ordering*: a fuzzer over
/// arguments alone can never produce "cancel, then bid", because no argument to the
/// create/bid/bid script expresses it.
contract AuctionHandler is Test {
    IAuctionHouse public house;
    ChainBidNFT public nft;

    address[3] public actors;
    uint256[] public auctionIds;
    mapping(uint256 auctionId => address seller) public sellerOf;

    // Ghost counters. Without them a handler that silently reverts every call still
    // reports a green invariant, which is worse than no test at all.
    uint256 public okCreate;
    uint256 public okBid;
    uint256 public okCancel;
    uint256 public okSettle;
    uint256 public okWithdraw;

    constructor(IAuctionHouse _house, ChainBidNFT _nft) {
        house = _house;
        nft = _nft;
        actors = [makeAddr("actorA"), makeAddr("actorB"), makeAddr("actorC")];

        // The value on a pranked call is debited from the pranked address, not from
        // this contract, so the actors are the ones that need funding. Getting this
        // backwards makes every bid revert with empty data for insufficient funds,
        // and the try/catch below then reports a green campaign that did nothing.
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 100_000 ether);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    uint256 public constant MAX_AUCTIONS = 3;

    /// @dev One live auction at a time. Spreading bids over many concurrent
    ///      auctions makes every ordering rare; keeping the live set at one lets a
    ///      run actually explore sequences. `bid` still selects from *all* ids,
    ///      including finished ones, so post-settlement orderings stay reachable.
    function _liveCount() internal view returns (uint256 live) {
        for (uint256 i = 0; i < auctionIds.length; i++) {
            (, , , , , , , bool settled) = house.auctions(auctionIds[i]);
            if (!settled) live++;
        }
    }

    function createAuction(uint256 seed, uint64 duration) external {
        if (auctionIds.length >= MAX_AUCTIONS) return;
        address seller = _actor(seed);
        duration = uint64(bound(duration, 30 minutes, 2 hours));

        vm.startPrank(seller);
        uint256 tokenId = nft.safeMint(seller, "ipfs://invariant");
        nft.approve(address(house), tokenId);
        uint256 id = house.createAuction(address(nft), tokenId, 1 ether, duration);
        vm.stopPrank();

        auctionIds.push(id);
        sellerOf[id] = seller;
        okCreate++;
    }

    function bid(uint256 seed, uint256 amountSeed) external {
        if (auctionIds.length == 0) return;
        uint256 id = auctionIds[seed % auctionIds.length];

        // Derive a currently-valid amount instead of a uniformly random one. Left
        // random, roughly eight bids in nine are rejected once the price has moved,
        // and the campaign never explores deeper than the opening bid.
        (, , , uint256 reserve, uint256 highestBid, address highestBidder, , ) = house.auctions(id);
        uint256 floorBid = highestBidder == address(0)
            ? (reserve == 0 ? 1 : reserve)
            : highestBid + highestBid / 20 + 1;
        uint256 amount = floorBid + bound(amountSeed, 0, 2 ether);

        // Likewise, bidding as the seller is always rejected, so pick someone else.
        address bidder = _bidderOtherThan(sellerOf[id], seed >> 8);

        vm.prank(bidder);
        try house.bid{ value: amount }(id) {
            okBid++;
        } catch {}
    }

    function _bidderOtherThan(address seller, uint256 seed) internal view returns (address) {
        address candidate = _actor(seed);
        if (candidate != seller) return candidate;
        return actors[(seed + 1) % actors.length];
    }

    function settle(uint256 seed) external {
        if (auctionIds.length == 0) return;
        uint256 id = auctionIds[seed % auctionIds.length];
        try house.settle(id) {
            okSettle++;
        } catch {}
    }

    /// @dev Choose among auctions that are actually cancellable, and prank their
    ///      seller. Picking a random id and a random caller means nearly every
    ///      cancel is rejected, and the states that only exist *after* a successful
    ///      cancel then never get explored at all. Same idea as deriving a valid bid
    ///      amount above: let the fuzzer choose between real actions, not mostly
    ///      no-ops.
    function cancel(uint256 seed) external {
        uint256 cancellable = 0;
        for (uint256 i = 0; i < auctionIds.length; i++) {
            (, , , , , address highestBidder, , bool settled) = house.auctions(auctionIds[i]);
            if (!settled && highestBidder == address(0)) cancellable++;
        }
        if (cancellable == 0) return;

        uint256 pick = seed % cancellable;
        for (uint256 i = 0; i < auctionIds.length; i++) {
            uint256 id = auctionIds[i];
            (, , , , , address highestBidder, , bool settled) = house.auctions(id);
            if (settled || highestBidder != address(0)) continue;
            if (pick > 0) {
                pick--;
                continue;
            }
            vm.prank(sellerOf[id]);
            try house.cancel(id) {
                okCancel++;
            } catch {}
            return;
        }
    }

    function withdraw(uint256 seed) external {
        address who = _actor(seed);
        vm.prank(who);
        try house.withdraw() {
            okWithdraw++;
        } catch {}
    }

    function warp(uint256 secs) external {
        // Small steps: warping hours at a time expires every auction in the
        // first few calls, and the rest of the run then explores nothing.
        vm.warp(block.timestamp + bound(secs, 10 seconds, 30 minutes));
    }

    function auctionCount() external view returns (uint256) {
        return auctionIds.length;
    }

    function auctionAt(uint256 i) external view returns (uint256) {
        return auctionIds[i];
    }
}

/// @dev Shared by the live campaign and by any calibration run against an older
///      build, so both are checking literally the same property.
abstract contract AuctionInvariants is Test {
    AuctionHandler internal handler;
    IAuctionHouse internal house;

    /// @dev The handler inherits `Test`, so it also exposes everything forge-std
    ///      puts on a test contract. Left unrestricted the fuzzer spends the run
    ///      calling those instead, and the campaign never reaches an auction at
    ///      all — which still reports green.
    function _targetHandler() internal {
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = AuctionHandler.createAuction.selector;
        selectors[1] = AuctionHandler.bid.selector;
        selectors[2] = AuctionHandler.settle.selector;
        selectors[3] = AuctionHandler.cancel.selector;
        selectors[4] = AuctionHandler.withdraw.selector;
        selectors[5] = AuctionHandler.warp.selector;

        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// Every wei the contract holds is owed to somebody: parked in `pendingReturns`,
    /// or standing as the high bid on an auction that has not settled yet.
    ///
    /// Equality, not `>=`. The weaker form passes while ETH sits in the contract
    /// with no owner, which is exactly what a bid on a cancelled auction produces.
    function invariant_EveryWeiHeldIsOwedToSomeone() public view {
        uint256 owed = 0;

        for (uint256 i = 0; i < handler.auctionCount(); i++) {
            (, , , , uint256 highestBid, , , bool settled) = house.auctions(handler.auctionAt(i));
            if (!settled) owed += highestBid;
        }
        for (uint256 i = 0; i < 3; i++) {
            owed += house.pendingReturns(handler.actors(i));
        }

        assertEq(address(house).balance, owed, "contract holds ETH nobody can claim");
    }

    /// A campaign that never reaches the interesting states proves nothing, so the
    /// shape of the exploration is checked too, not just the safety property.
    ///
    /// This has to run in `afterInvariant`, not as an `invariant_`: an invariant is
    /// evaluated after every single call, including the first, when nothing has
    /// happened yet and every counter is legitimately zero.
    function afterInvariant() public view {
        // Only the near-certain one is asserted. `afterInvariant` fires after every
        // run, and a run is free to spend its whole budget on warps and withdrawals,
        // so requiring a successful bid every time is flaky rather than strict.
        assertGt(handler.okCreate(), 0, "campaign never created an auction");
    }
}

contract EnglishAuctionInvariantTest is AuctionInvariants {
    ChainBidNFT internal nft;

    function setUp() public {
        nft = new ChainBidNFT();
        house = IAuctionHouse(address(new EnglishAuction()));
        handler = new AuctionHandler(house, nft);
        _targetHandler();
    }
}
