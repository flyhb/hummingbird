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

    /// @inheritdoc IioID
    function deviceProject(address device) external view override returns (uint256) {
        return _project[device];
    }

    /// Set the project ID for a given device.
    function setProject(address device, uint256 projectId) external {
        _project[device] = projectId;
    }
}