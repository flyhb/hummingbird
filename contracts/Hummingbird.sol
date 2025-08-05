// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
 * @title Hummingbird
 * @notice This contract records on‑chain liveness proofs for autonomous drones.
 * Each drone has a unique identity (a wallet address) managed by the ioID
 * ecosystem. The drone signs and submits transactions directly to this
 * contract, providing its current GPS location. The contract verifies
 * registration of the device via the ioID registry and associates the
 * liveness information with the appropriate project.  Only registered
 * devices belonging to the specified project may call the liveness function.
 */

/// @dev Minimal subset of the ioID ERC721 interface.  The Hummingbird
/// contract uses this to check that a given device address is bound to
/// the correct project.
interface IioID {
    /// Returns the project ID associated with a device address.  A value of
    /// zero indicates that the device is not registered to any project.
    function deviceProject(address device) external view returns (uint256);
}

/// @dev Minimal subset of the ioID registry interface.  Used to verify
/// whether a device address has been registered.
interface IioIDRegistry {
    /// Returns true if a record exists for the given device address.
    function exists(address device) external view returns (bool);
}

contract Hummingbird {
    /// Address of the ioID ERC721 implementation.  Exposed publicly so that
    /// off‑chain services can introspect project/device relationships.
    IioID public immutable ioID;

    /// Address of the ioID registry used to validate device registration.
    IioIDRegistry public immutable registry;

    /// The project identifier this Hummingbird contract is scoped to.  Only
    /// devices registered under this project may report liveness.
    uint256 public immutable projectId;

    /// Struct capturing the last known liveness data for a device.  GPS
    /// coordinates are stored as signed integers to allow negative values.
    struct LivenessData {
        uint256 timestamp; // UNIX time when the liveness was recorded
        int256 latitude;   // latitude multiplied by 1e7 to retain precision
        int256 longitude;  // longitude multiplied by 1e7 to retain precision
    }

    /// Mapping from device address to its most recently submitted liveness.
    mapping(address => LivenessData) private _lastLiveness;

    /// Emitted whenever a device successfully submits liveness information.
    event LivenessReported(
        address indexed device,
        uint256 timestamp,
        int256 latitude,
        int256 longitude
    );

    /// Constructs the Hummingbird contract.
    ///
    /// @param _ioID Address of the deployed ioID ERC721 contract.
    /// @param _registry Address of the ioID registry contract.
    /// @param _projectId Identifier of the project this contract will accept
    /// liveness updates for.
    constructor(IioID _ioID, IioIDRegistry _registry, uint256 _projectId) {
        require(address(_ioID) != address(0), "ioID address zero");
        require(address(_registry) != address(0), "registry address zero");
        require(_projectId != 0, "projectId zero");
        ioID = _ioID;
        registry = _registry;
        projectId = _projectId;
    }

    /// Submit a liveness proof for the calling device.
    ///
    /// Drones call this function directly, signing the transaction with
    /// their own private keys.  The contract verifies that the caller is
    /// registered via the ioID registry and that the device belongs to the
    /// correct project.  GPS coordinates should be provided as signed
    /// integers scaled by 1e7 (e.g. 37.7749° latitude becomes 377749000).
    ///
    /// @param latitude Latitude in degrees ×1e7.
    /// @param longitude Longitude in degrees ×1e7.
    function reportLiveness(int256 latitude, int256 longitude) external {
        address device = msg.sender;
        // Ensure the caller is a registered device
        require(registry.exists(device), "device not registered");
        // Ensure the device belongs to the expected project
        require(
            ioID.deviceProject(device) == projectId,
            "invalid project"
        );
        // Record liveness data
        LivenessData memory data = LivenessData({
            timestamp: block.timestamp,
            latitude: latitude,
            longitude: longitude
        });
        _lastLiveness[device] = data;
        emit LivenessReported(device, data.timestamp, latitude, longitude);
    }

    /// Retrieve the last recorded liveness data for a given device.
    ///
    /// Anyone can query the last liveness of a device.  If no liveness has
    /// been recorded yet, the returned timestamp will be zero.
    ///
    /// @param device Address of the drone device.
    /// @return timestamp UNIX time of last liveness, zero if none.
    /// @return latitude Latitude scaled by 1e7.
    /// @return longitude Longitude scaled by 1e7.
    function lastLiveness(
        address device
    ) external view returns (uint256 timestamp, int256 latitude, int256 longitude) {
        LivenessData memory data = _lastLiveness[device];
        timestamp = data.timestamp;
        latitude = data.latitude;
        longitude = data.longitude;
    }
}