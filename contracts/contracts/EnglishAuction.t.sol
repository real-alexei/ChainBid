// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { ChainBidNFT } from "./ChainBidNFT.sol";
import { EnglishAuction } from "./EnglishAuction.sol";

contract EnglishAuctionTest is Test {
    ChainBidNFT internal nft;
    EnglishAuction internal house;

    address internal seller = makeAddr("seller");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal tokenId;

    uint256 internal constant RESERVE = 1 ether;
    uint64 internal constant DURATION = 1 hours;

    function setUp() public {
        nft = new ChainBidNFT();
        house = new EnglishAuction();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        vm.startPrank(seller);
        tokenId = nft.safeMint(seller, "ipfs://chainbid/1");
        nft.approve(address(house), tokenId);
        vm.stopPrank();
    }

    function _open() internal returns (uint256 auctionId) {
        vm.prank(seller);
        auctionId = house.createAuction(address(nft), tokenId, RESERVE, DURATION);
    }

    // --- creation ---

    function test_CreateEscrowsTheToken() public {
        uint256 auctionId = _open();
        assertEq(nft.ownerOf(tokenId), address(house));

        EnglishAuction.Auction memory a = house.getAuction(auctionId);
        assertEq(a.seller, seller);
        assertEq(a.reservePrice, RESERVE);
        assertEq(a.highestBid, 0);
        assertEq(a.highestBidder, address(0));
        assertFalse(a.settled);
    }

    function test_CreateRejectsOutOfRangeDuration() public {
        vm.startPrank(seller);
        vm.expectRevert(abi.encodeWithSelector(EnglishAuction.InvalidDuration.selector, uint64(1)));
        house.createAuction(address(nft), tokenId, RESERVE, 1);
        vm.stopPrank();
    }

    // --- bidding ---

    function test_FirstBidBelowReserveReverts() public {
        uint256 auctionId = _open();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.BidBelowReserve.selector, 0.5 ether, RESERVE)
        );
        house.bid{ value: 0.5 ether }(auctionId);
    }

    function test_BidMustBeatCurrentHighByTheIncrement() public {
        uint256 auctionId = _open();

        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);

        // Matching the standing bid is not enough, and neither is edging past it:
        // the floor is +5%.
        assertEq(house.minimumBid(auctionId), 2.1 ether);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.BidNotHighEnough.selector, 2 ether, 2.1 ether)
        );
        house.bid{ value: 2 ether }(auctionId);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                EnglishAuction.BidNotHighEnough.selector,
                2 ether + 1,
                2.1 ether
            )
        );
        house.bid{ value: 2 ether + 1 }(auctionId);

        vm.prank(bob);
        house.bid{ value: 2.1 ether }(auctionId);
        assertEq(house.getAuction(auctionId).highestBidder, bob);
    }

    function test_BidAfterEndReverts() public {
        uint256 auctionId = _open();
        uint64 endTime = house.getAuction(auctionId).endTime;

        vm.warp(endTime);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.AuctionEnded.selector, auctionId, endTime)
        );
        house.bid{ value: 2 ether }(auctionId);
    }

    function test_SellerCannotBid() public {
        uint256 auctionId = _open();
        vm.deal(seller, 10 ether);
        vm.prank(seller);
        vm.expectRevert(EnglishAuction.SellerCannotBid.selector);
        house.bid{ value: 2 ether }(auctionId);
    }

    function test_OutbidCreditsPreviousBidderRatherThanPaying() public {
        uint256 auctionId = _open();
        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);
        vm.prank(bob);
        house.bid{ value: 3 ether }(auctionId);

        // Refund is owed, not delivered.
        assertEq(house.pendingReturns(alice), 2 ether);
        assertEq(alice.balance, aliceBalanceBefore - 2 ether);

        vm.prank(alice);
        house.withdraw();
        assertEq(house.pendingReturns(alice), 0);
        assertEq(alice.balance, aliceBalanceBefore);
    }

    function test_WithdrawWithNothingOwedReverts() public {
        vm.prank(alice);
        vm.expectRevert(EnglishAuction.NothingToWithdraw.selector);
        house.withdraw();
    }

    // --- anti-sniping ---

    function test_LateBidExtendsTheEndTime() public {
        uint256 auctionId = _open();
        uint64 originalEnd = house.getAuction(auctionId).endTime;

        // One minute before close: inside the 5-minute extension window.
        vm.warp(originalEnd - 1 minutes);
        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);

        uint64 extendedEnd = house.getAuction(auctionId).endTime;
        assertEq(extendedEnd, uint64(block.timestamp) + house.EXTENSION_DURATION());
        assertGt(extendedEnd, originalEnd);
    }

    function test_EarlyBidDoesNotExtendTheEndTime() public {
        uint256 auctionId = _open();
        uint64 originalEnd = house.getAuction(auctionId).endTime;

        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);

        assertEq(house.getAuction(auctionId).endTime, originalEnd);
    }

    // --- settlement ---

    function test_SettleBeforeEndReverts() public {
        uint256 auctionId = _open();
        uint64 endTime = house.getAuction(auctionId).endTime;

        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.AuctionStillLive.selector, auctionId, endTime)
        );
        house.settle(auctionId);
    }

    function test_SettleTransfersTokenAndCreditsSeller() public {
        uint256 auctionId = _open();

        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);
        vm.prank(bob);
        house.bid{ value: 3 ether }(auctionId);

        vm.warp(house.getAuction(auctionId).endTime);
        house.settle(auctionId);

        assertEq(nft.ownerOf(tokenId), bob);
        assertEq(house.pendingReturns(seller), 3 ether);
        assertEq(house.pendingReturns(alice), 2 ether);
        assertTrue(house.getAuction(auctionId).settled);
    }

    function test_SettleTwiceReverts() public {
        uint256 auctionId = _open();
        vm.warp(house.getAuction(auctionId).endTime);
        house.settle(auctionId);

        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.AuctionAlreadySettled.selector, auctionId)
        );
        house.settle(auctionId);
    }

    function test_SettleWithNoBidsReturnsTokenToSeller() public {
        uint256 auctionId = _open();
        vm.warp(house.getAuction(auctionId).endTime);
        house.settle(auctionId);

        assertEq(nft.ownerOf(tokenId), seller);
        assertEq(house.pendingReturns(seller), 0);
    }

    // --- cancellation ---

    function test_CancelReturnsTokenWhenNoBids() public {
        uint256 auctionId = _open();
        vm.prank(seller);
        house.cancel(auctionId);

        assertEq(nft.ownerOf(tokenId), seller);
        assertTrue(house.getAuction(auctionId).settled);
    }

    function test_CancelWithBidsReverts() public {
        uint256 auctionId = _open();
        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.CannotCancelWithBids.selector, auctionId)
        );
        house.cancel(auctionId);
    }

    function test_CancelBySomeoneElseReverts() public {
        uint256 auctionId = _open();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.NotSeller.selector, alice, seller)
        );
        house.cancel(auctionId);
    }

    // --- invariants ---

    /// @dev Every wei the contract holds must be spoken for — not merely covered.
    ///      The weaker `>=` form passes even when ETH has been orphaned, which is
    ///      exactly the shape of the cancelled-auction bug.
    function testFuzz_EveryWeiHeldIsClaimableBySomeone(uint96 first, uint96 second) public {
        vm.assume(first >= RESERVE);
        // The second bid has to clear the 5% increment to be accepted at all.
        uint256 floorBid = uint256(first) + (uint256(first) * 500) / 10_000;
        vm.assume(second >= floorBid);

        vm.deal(alice, uint256(first) + 1 ether);
        vm.deal(bob, uint256(second) + 1 ether);

        uint256 auctionId = _open();

        vm.prank(alice);
        house.bid{ value: first }(auctionId);
        vm.prank(bob);
        house.bid{ value: second }(auctionId);

        assertEq(
            address(house).balance,
            house.pendingReturns(alice) + house.getAuction(auctionId).highestBid,
            "contract holds ETH nobody can claim"
        );
    }

    // --- regressions from the security audit ---

    /// @dev `cancel()` leaves `endTime` in the future, so without an explicit
    ///      `settled` check `bid()` would accept ETH that no path could return.
    function test_CancelledAuctionRejectsFurtherBids() public {
        uint256 auctionId = _open();

        vm.prank(seller);
        house.cancel(auctionId);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.AuctionAlreadySettled.selector, auctionId)
        );
        house.bid{ value: 5 ether }(auctionId);

        assertEq(address(house).balance, 0);
    }

    /// @dev A winner that cannot accept a safe transfer must not be able to wedge
    ///      settlement: the money settles and the token becomes claimable.
    function test_SettlementSurvivesAWinnerThatCannotReceiveTheToken() public {
        uint256 auctionId = _open();

        NonReceiver winner = new NonReceiver();
        vm.deal(address(winner), 10 ether);
        winner.placeBid{ value: 2 ether }(house, auctionId);

        vm.warp(house.getAuction(auctionId).endTime);

        vm.expectEmit(true, true, false, false);
        emit EnglishAuction.NftDeliveryFailed(auctionId, address(winner));
        house.settle(auctionId);

        // The seller is paid even though delivery failed.
        assertEq(house.pendingReturns(seller), 2 ether);
        assertTrue(house.getAuction(auctionId).settled);
        assertEq(house.nftClaimant(auctionId), address(winner));

        // And the winner pulls the token with a plain transfer.
        winner.claim(house, auctionId);
        assertEq(nft.ownerOf(tokenId), address(winner));
        assertEq(house.nftClaimant(auctionId), address(0));
    }

    function test_ClaimNftRejectsStrangers() public {
        uint256 auctionId = _open();
        NonReceiver winner = new NonReceiver();
        vm.deal(address(winner), 10 ether);
        winner.placeBid{ value: 2 ether }(house, auctionId);

        vm.warp(house.getAuction(auctionId).endTime);
        house.settle(auctionId);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                EnglishAuction.NotClaimant.selector,
                alice,
                address(winner)
            )
        );
        house.claimNft(auctionId);
    }

    function test_ClaimNftWithNothingOwedReverts() public {
        uint256 auctionId = _open();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.NothingToClaim.selector, auctionId)
        );
        house.claimNft(auctionId);
    }

    /// @dev With `highestBid` as the sentinel, zero-value bids overwrote each other
    ///      and the last one won the token for nothing.
    function test_ZeroValueBidsAreRejectedEvenWithoutAReserve() public {
        vm.startPrank(seller);
        uint256 secondToken = nft.safeMint(seller, "ipfs://chainbid/2");
        nft.approve(address(house), secondToken);
        uint256 auctionId = house.createAuction(address(nft), secondToken, 0, DURATION);
        vm.stopPrank();

        assertEq(house.minimumBid(auctionId), 1);

        vm.prank(alice);
        vm.expectRevert(EnglishAuction.ZeroBid.selector);
        house.bid{ value: 0 }(auctionId);

        // A one-wei bid is legitimate on a no-reserve auction, but it now sets a
        // real floor that the next bidder has to clear.
        vm.prank(alice);
        house.bid{ value: 1 }(auctionId);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EnglishAuction.BidNotHighEnough.selector, 1, 2));
        house.bid{ value: 1 }(auctionId);
    }

    /// @dev A token contract whose transfers are no-ops must not be auctionable.
    function test_CreateRejectsATokenThatDoesNotActuallyEscrow() public {
        FakeNFT fake = new FakeNFT();
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(EnglishAuction.EscrowFailed.selector, address(fake), 1));
        house.createAuction(address(fake), 1, 1 ether, DURATION);
    }

    function test_DurationShorterThanTheExtensionWindowIsRejected() public {
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.InvalidDuration.selector, uint64(4 minutes))
        );
        house.createAuction(address(nft), tokenId, RESERVE, 4 minutes);
    }
}

/// A contract bidder with no `onERC721Received`, so a safe transfer to it reverts.
contract NonReceiver {
    function placeBid(EnglishAuction house, uint256 auctionId) external payable {
        house.bid{ value: msg.value }(auctionId);
    }

    function claim(EnglishAuction house, uint256 auctionId) external {
        house.claimNft(auctionId);
    }
}

/// An "ERC-721" whose transfers are no-ops and which reports someone else as owner.
contract FakeNFT {
    function safeTransferFrom(address, address, uint256) external {}

    function ownerOf(uint256) external pure returns (address) {
        return address(0xBEEF);
    }
}
