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

    function test_BidMustBeatCurrentHigh() public {
        uint256 auctionId = _open();

        vm.prank(alice);
        house.bid{ value: 2 ether }(auctionId);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(EnglishAuction.BidNotHighEnough.selector, 2 ether, 2 ether)
        );
        house.bid{ value: 2 ether }(auctionId);
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

    /// @dev Escrowed ETH must always cover everything the contract owes.
    function testFuzz_ContractHoldsEnoughToCoverWhatItOwes(uint96 first, uint96 second) public {
        vm.assume(first >= RESERVE);
        vm.assume(second > first);
        vm.deal(alice, uint256(first) + 1 ether);
        vm.deal(bob, uint256(second) + 1 ether);

        uint256 auctionId = _open();

        vm.prank(alice);
        house.bid{ value: first }(auctionId);
        vm.prank(bob);
        house.bid{ value: second }(auctionId);

        assertGe(address(house).balance, house.pendingReturns(alice) + house.getAuction(auctionId).highestBid);
    }
}
