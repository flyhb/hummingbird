// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
 * @title Hummingbird
 * @notice This contract records on‑chain liveness proofs for autonomous drones.
 * Each drone has a unique identity (a wallet address) managed by the ioID
 * ecosystem. The drone signs and submits transactions directly to this
 * contract, providing its current status including GPS location. 
 * The contract verifies registration of the device via the ioID registry and 
 * associates the liveness information with the appropriate project.  
 * Currently, only registered devices belonging to the Hummingbird project 
 * may call the liveness submission function.
 */

/// @dev Minimal subset of the ioID ERC721 interface.  The Hummingbird
/// contract uses this to check that a given device address is bound to
/// the correct project.
interface IioID {
    /// Returns the project ID associated with a device address.  A value of
    /// zero indicates that the device is not registered to any project.
    function deviceProject(address device) external view returns (uint256);

    /// Returns the owner (i.e. controller) of the given token ID.  This
    /// mirrors the ERC721 `ownerOf` function in the ioID NFT.
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @dev Minimal subset of the ioID registry interface.  Used to verify
/// whether a device address has been registered.
interface IioIDRegistry {
    /// Returns true if a record exists for the given device address.
    function exists(address device) external view returns (bool);

    /// Returns the token ID associated with a device address.  Used by
    /// Hummingbird to locate the NFT and determine its owner.
    function deviceTokenId(address device) external view returns (uint256);
}

/// @dev Minimal interface for the reward token.  
interface IHBToken {
    function mint(address to, uint256 amount) external;
}

contract Hummingbird {

    /// Address of the ioID ERC721 implementation. 
    IioID public immutable ioID;

    /// Address of the ioID registry.
    IioIDRegistry public immutable registry;

    /// The project id of the Hummingbird project in the context of ioID
    uint256 public immutable projectId;

    /// Reward token used to compensate drone owners.
    IHBToken public immutable hbToken;

    /// Amount of HB tokens awarded per liveness message.
    uint256 public rewardPerPing;

    /// Accumulated, unclaimed rewards for each owner. 
    mapping(address => uint256) private _pendingRewards;

    /// Owner of the contract.
    address public owner;

    /// Struct capturing the last known liveness data for a device. 
    /// More status info to be added later.
    struct LivenessData {
        uint256 timestamp; // UNIX time when the liveness was recorded
        int256 latitude;   // latitude multiplied by 1e7 to retain precision
        int256 longitude;  // longitude multiplied by 1e7 to retain precision
    }

    /// Mapping from device address to its most recently submitted liveness.
    mapping(address => LivenessData) private _lastLiveness;

    /// Emitted whenever a device successfully submits liveness information.
    /// TODO: Consider if we should remove this log as it's too dense.
    event LivenessReported(
        address indexed device,
        uint256 timestamp,
        int256 latitude,
        int256 longitude
    );

    /// Emitted when rewards are added to a drone owner's pending balance.
    /// TODO: Consider if we should remove this log as it's too dense.
    event RewardAccumulated(address indexed owner, uint256 amount);

    /// Emitted when a user successfully claims their accumulated rewards.
    event RewardClaimed(address indexed owner, uint256 amount);

    /// Constructs the Hummingbird contract.
    ///
    /// @param _ioID Address of the deployed ioID ERC721 contract.
    /// @param _registry Address of the ioID registry contract.
    /// @param _hbToken Address of the HB token contract used for rewards.
    /// @param _projectId Identifier of the Hummingbird project id.
    /// @param _rewardPerPing The number of HB tokens accumulated per liveness report.
    constructor(
        IioID _ioID,
        IioIDRegistry _registry,
        IHBToken _hbToken,
        uint256 _projectId,
        uint256 _rewardPerPing
    ) {
        require(address(_ioID) != address(0), "ioID address zero");
        require(address(_registry) != address(0), "registry address zero");
        require(address(_hbToken) != address(0), "hbToken address zero");
        require(_projectId != 0, "projectId zero");
        ioID = _ioID;
        registry = _registry;
        hbToken = _hbToken;
        projectId = _projectId;
        rewardPerPing = _rewardPerPing;
        owner = msg.sender;
    }

    /// Submit a liveness proof for the calling device.
    ///
    /// Drones call this function directly, signing the transaction with
    /// their own private keys.  The contract only verifies that the caller is
    /// registered via the ioID registry and that the device belongs to the
    /// Hummingbird project.  GPS coordinates should be provided as signed
    /// integers scaled by 1e7
    ///
    /// @param latitude Latitude in degrees ×1e7.
    /// @param longitude Longitude in degrees ×1e7.
    function reportLiveness(int256 latitude, int256 longitude) external {
        address device = msg.sender;
        // Is it a registered device?
        require(registry.exists(device), "device not registered");
        // Is it a Hummingbird drone?
        require(
            ioID.deviceProject(device) == projectId,
            "not a hummingbird device"
        );
        // Record liveness data
        LivenessData memory data = LivenessData({
            timestamp: block.timestamp,
            latitude: latitude,
            longitude: longitude
        });
        _lastLiveness[device] = data;
        emit LivenessReported(device, data.timestamp, latitude, longitude);

        // Look up the owner of this device in the ioID ecosystem. 
        uint256 tokenId = registry.deviceTokenId(device);
        address ownerOfDevice = ioID.ownerOf(tokenId);
        // Accumulate rewards for the owner. 
        _pendingRewards[ownerOfDevice] += rewardPerPing;
        emit RewardAccumulated(ownerOfDevice, rewardPerPing);
    }

    /// Retrieve the last recorded liveness data for a given device.
    ///
    /// Anyone can query the last liveness of a device.  If no liveness has
    /// been recorded yet, the returned timestamp will be zero.
    ///
    /// @param device Address of the drone device.
    /// @return timestamp UNIX time of last liveness, zero if none.
    /// @return latitude Latitude x1e7.
    /// @return longitude Longitude x1e7.
    function lastLiveness(
        address device
    ) external view returns (uint256 timestamp, int256 latitude, int256 longitude) {
        LivenessData memory data = _lastLiveness[device];
        timestamp = data.timestamp;
        latitude = data.latitude;
        longitude = data.longitude;
    }

    /// Return the pending HB reward balance for a device owner.
    function pendingReward(address account) external view returns (uint256) {
        return _pendingRewards[account];
    }

    /// Claim accumulated HB rewards for the caller.  This mints new HB
    /// tokens.
    function claimRewards() external {
        uint256 amount = _pendingRewards[msg.sender];
        require(amount > 0, "no rewards");
        _pendingRewards[msg.sender] = 0;
        hbToken.mint(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    /// Update the reward per liveness report. 
    function setRewardPerPing(uint256 newReward) external {
        require(msg.sender == owner, "only owner");
        rewardPerPing = newReward;
    }
}