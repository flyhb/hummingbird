// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Hummingbird.sol";

/**
 * @title MockRegistry
 * @dev Simple mock of the ioIDRegistry contract used for testing.  Allows
 * setting devices as registered or unregistered.
 */
contract MockRegistry is IioIDRegistry {
    mapping(address => bool) private _registered;
    mapping(address => uint256) private _deviceTokenId;

    /// @inheritdoc IioIDRegistry
    function exists(address device) external view override returns (bool) {
        return _registered[device];
    }

    /// @inheritdoc IioIDRegistry
    function deviceTokenId(address device) external view override returns (uint256) {
        return _deviceTokenId[device];
    }

    /// Set whether a given device address is considered registered.
    function setExists(address device, bool value) external {
        _registered[device] = value;
    }

    /// Set the token ID associated with a device.  Used in tests to link
    /// device addresses to NFT IDs.
    function setDeviceTokenId(address device, uint256 tokenId) external {
        _deviceTokenId[device] = tokenId;
    }
}