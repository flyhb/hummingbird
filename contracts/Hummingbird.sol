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
    ///
    /// If latitude, longitude or ready status are unchanged from a previous
    /// submission, they can be omitted from the next call by passing
    /// the appropriate sentinel values (see `reportLiveness`).  The
    /// `hasLat`, `hasLong` and `hasReady` flags track whether an
    /// initial value has been provided, allowing the contract to
    /// revert if an update attempts to omit a value that has never
    /// been set.
    struct LivenessData {
        uint256 timestamp; // Timestamp supplied by the device
        int256 latitude;   // Latitude ×1e7
        int256 longitude;  // Longitude ×1e7
        bool ready;        // Ready status
        bool hasLat;
        bool hasLong;
        bool hasReady;
    }

    /// Mapping from device address to its most recently submitted liveness.
    mapping(address => LivenessData) private _lastLiveness;

    /// Emitted whenever a device successfully submits liveness information.
    /// Includes all resolved fields: timestamp, latitude, longitude and ready.
    event LivenessReported(
        address indexed device,
        uint256 timestamp,
        int256 latitude,
        int256 longitude,
        bool ready
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
    /// their own private keys.  The contract verifies that the caller is
    /// registered via the ioID registry and that the device belongs to the
    /// Hummingbird project.
    ///
    /// Fields may be omitted by passing sentinel values.  If omitted,
    /// the previously recorded value will be reused.  Omitting a
    /// value when none has been recorded will cause the call to
    /// revert.
    ///
    /// Latitude and longitude must be provided as signed integers
    /// scaled by 1e7.  To omit an unchanged value, pass
    /// `type(int256).min`.
    ///
    /// Ready status is encoded as an integer: 1 for ready, 0 for
    /// not ready and -1 to indicate no change.  Any other value will
    /// cause the call to revert.
    ///
    /// A timestamp must always be provided by the device.
    ///
    /// @param latitude Latitude ×1e7, or `type(int256).min` to reuse the previous value.
    /// @param longitude Longitude ×1e7, or `type(int256).min` to reuse the previous value.
    /// @param readyVal Ready status encoded as 1=true, 0=false, -1=unchanged.
    /// @param timestamp Timestamp supplied by the device.
    function reportLiveness(
        int256 latitude,
        int256 longitude,
        int256 readyVal,
        uint256 timestamp
    ) external {
        address device = msg.sender;
        // Is it a registered device?
        require(registry.exists(device), "device not registered");
        // Is it a Hummingbird drone?
        require(
            ioID.deviceProject(device) == projectId,
            "not a hummingbird device"
        );
        // Timestamp must be non-zero to prevent confusion
        require(timestamp != 0, "timestamp required");
        // Load existing data
        LivenessData storage current = _lastLiveness[device];
        // Resolve latitude
        int256 lat;
        if (latitude != type(int256).min) {
            lat = latitude;
            current.latitude = latitude;
            current.hasLat = true;
        } else {
            // Unchanged latitude requires previous value
            require(current.hasLat, "No previous latitude");
            lat = current.latitude;
        }
        // Resolve longitude
        int256 lon;
        if (longitude != type(int256).min) {
            lon = longitude;
            current.longitude = longitude;
            current.hasLong = true;
        } else {
            require(current.hasLong, "No previous longitude");
            lon = current.longitude;
        }
        // Resolve ready status
        bool ready;
        if (readyVal == -1) {
            require(current.hasReady, "No previous ready status");
            ready = current.ready;
        } else if (readyVal == 0 || readyVal == 1) {
            ready = (readyVal == 1);
            current.ready = ready;
            current.hasReady = true;
        } else {
            revert("ready must be 0, 1, or -1");
        }
        // Update timestamp
        current.timestamp = timestamp;
        // Emit full liveness
        emit LivenessReported(device, timestamp, lat, lon, ready);
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
    /// been recorded yet, all returned values will be their zero value.
    ///
    /// @param device Address of the drone device.
    /// @return timestamp UNIX time of last liveness, zero if none.
    /// @return latitude Latitude ×1e7.
    /// @return longitude Longitude ×1e7.
    /// @return ready Ready status of the last liveness record.
    function lastLiveness(
        address device
    )
        external
        view
        returns (
            uint256 timestamp,
            int256 latitude,
            int256 longitude,
            bool ready
        )
    {
        LivenessData memory data = _lastLiveness[device];
        timestamp = data.timestamp;
        latitude = data.latitude;
        longitude = data.longitude;
        ready = data.ready;
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