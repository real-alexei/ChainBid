// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721URIStorage } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title ChainBidNFT
/// @notice Minimal ERC-721 with per-token metadata URIs. Minting is permissionless:
///         this is demo collateral for auctions, not a curated collection.
contract ChainBidNFT is ERC721URIStorage {
    uint256 private _nextTokenId = 1;

    constructor() ERC721("ChainBid", "CBID") {}

    /// @notice Mint a token to `to` with the given metadata URI.
    /// @return tokenId The id of the newly minted token.
    function safeMint(address to, string calldata uri) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    /// @notice Id that the next mint will receive. Useful for tests and scripts.
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }
}
