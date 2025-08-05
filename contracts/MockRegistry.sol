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

    /// @inheritdoc IioIDRegistry
    function exists(address device) external view override returns (bool) {
        return _registered[device];
    }

    /// Set whether a given device address is considered registered.
    function setExists(address device, bool value) external {
        _registered[device] = value;
    }
}