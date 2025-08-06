// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Hummingbird.sol";

/**
 * @title MockIoID
 * @dev Simple mock of the ioID ERC721 contract used for testing the
 * Hummingbird contract.  It allows setting arbitrary project IDs for
 * specific device addresses.
 */
contract MockIoID is IioID {
    mapping(address => uint256) private _project;
    mapping(uint256 => address) private _ownerOf;

    /// @inheritdoc IioID
    function deviceProject(address device) external view override returns (uint256) {
        return _project[device];
    }

    /// @inheritdoc IioID
    function ownerOf(uint256 tokenId) external view override returns (address) {
        return _ownerOf[tokenId];
    }

    /// Set the project ID for a given device.
    function setProject(address device, uint256 projectId) external {
        _project[device] = projectId;
    }

    /// Set the owner for a given token ID.  Used in tests to simulate the
    /// ownership of ioID NFTs.
    function setTokenOwner(uint256 tokenId, address owner) external {
        _ownerOf[tokenId] = owner;
    }
}