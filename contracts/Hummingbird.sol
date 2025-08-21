// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/*
 * Hummingbird: liveness + delivery
 */

interface IioID {
    function deviceProject(address device) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IioIDRegistry {
    function exists(address device) external view returns (bool);
    function deviceTokenId(address device) external view returns (uint256);
}

interface IHBToken {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract Hummingbird {
    // ─── Core (unchanged) ─────────────────────────────────────────────────────
    IioID public immutable ioID;
    IioIDRegistry public immutable registry;
    uint256 public immutable projectId;
    IHBToken public immutable hbToken;

    uint256 public rewardPerPing;
    mapping(address => uint256) private _pendingRewards;
    address public owner;

    // ─── Delivery ─────────────────────────────────────────────────────────────
    uint256 private _nextRequestId;

    enum Status { Open, Proposed, Accepted, Started, PickedUp, Dropped, Completed, Cancelled }

    struct DeliveryRequest {
        uint256 id;
        address requester;
        int32 pickupLatE7;
        int32 pickupLonE7;
        int32 dropLatE7;
        int32 dropLonE7;
        uint256 price;           // final agreed price
        uint256 proposedPrice;   // proposed by drone
        address drone;
        Status  status;
        uint64  requestedAt;
        uint64  proposedAt;
        address targetedDevice;
        uint64  expiresAt;
        uint256 maxPrice;
        // NEW: timestamp of acceptance (used for 2-minute cancel window)
        uint64  acceptedAt;
    }

    mapping(uint256 => DeliveryRequest) public requests;

    uint256[] private _openIds;
    mapping(uint256 => uint256) private _openIndex;

    mapping(address => uint256[]) private _deviceOpenIds;
    mapping(address => mapping(uint256 => uint256)) private _deviceOpenIndex;

    mapping(address => uint256[]) private _myRequestIds;

    // ─── Ongoing Request Tracking ──────────────────────────────────────────
    // Maintain a dense list of all ongoing requests (any status except
    // Completed or Cancelled).  We store the IDs in a vector and track
    // each ID's position (plus one) in a mapping for O(1) add/remove.
    uint256[] private _ongoingList;
    mapping(uint256 => uint256) private _ongoingIndexPlus1;

    uint256 public constant FEE_BPS = 300;     // 3%
    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant CANCEL_WINDOW = 120; // 120 seconds after acceptance

    event DeliveryRequested(
        uint256 indexed id,
        address indexed requester,
        int32 pickupLatE7,
        int32 pickupLonE7,
        int32 dropLatE7,
        int32 dropLonE7,
        uint64 requestedAt,
        address targetedDevice,
        uint64 expiresAt,
        uint256 maxPrice
    );
    event DeliveryProposed(uint256 indexed id, address indexed drone, uint256 price, uint64 proposedAt);
    event DeliveryAccepted(uint256 indexed id, address indexed drone, uint256 price);
    event DeliveryStarted(uint256 indexed id, address indexed drone);
    event PackagePicked(uint256 indexed id, address indexed drone);
    event PackageDropped(uint256 indexed id, address indexed drone);
    event DeliveryCompleted(uint256 indexed id, address indexed drone, uint256 payout);
    event DeliveryCancelled(uint256 indexed id);

    // ─── Ongoing list helpers ─────────────────────────────────────────────
    /// @dev Add a request ID to the ongoing list if not already present.
    function _ongoingAdd(uint256 id) internal {
        // If id is already in the set (indexPlus1 != 0), do nothing.
        if (_ongoingIndexPlus1[id] != 0) return;
        _ongoingList.push(id);
        _ongoingIndexPlus1[id] = _ongoingList.length;
    }

    /// @dev Remove a request ID from the ongoing list if present.
    function _ongoingRemove(uint256 id) internal {
        uint256 idxPlus1 = _ongoingIndexPlus1[id];
        if (idxPlus1 == 0) return;
        uint256 i = idxPlus1 - 1;
        uint256 lastIndex = _ongoingList.length - 1;
        if (i != lastIndex) {
            uint256 movedId = _ongoingList[lastIndex];
            _ongoingList[i] = movedId;
            _ongoingIndexPlus1[movedId] = idxPlus1;
        }
        _ongoingList.pop();
        _ongoingIndexPlus1[id] = 0;
    }

    /// @dev Internal hook to update the ongoing list whenever a status changes.
    /// Adds the request to the list for non-terminal statuses and removes it
    /// when it transitions to Completed or Cancelled.
    function _onStatusChange(uint256 id, Status newStatus) internal {
        if (newStatus == Status.Completed || newStatus == Status.Cancelled) {
            _ongoingRemove(id);
        } else {
            _ongoingAdd(id);
        }
    }

    /// @notice Return all ongoing request IDs.
    function getOngoingRequests() external view returns (uint256[] memory) {
        return _ongoingList;
    }

    /// @notice Return the number of ongoing requests.
    function getOngoingRequestCount() external view returns (uint256) {
        return _ongoingList.length;
    }

    /// @notice Return the ongoing request ID at a given index.
    function getOngoingRequestAt(uint256 index) external view returns (uint256) {
        require(index < _ongoingList.length, "index out of bounds");
        return _ongoingList[index];
    }

    

    // ─── Liveness (unchanged) ─────────────────────────────────────────────────
    struct LivenessData {
        uint256 timestamp;
        int256 latitude;
        int256 longitude;
        bool ready;
        bool hasLat;
        bool hasLong;
        bool hasReady;
    }
    mapping(address => LivenessData) private _lastLiveness;

    event LivenessReported(address indexed device, uint256 timestamp, int256 latitude, int256 longitude, bool ready);
    event RewardAccumulated(address indexed owner, uint256 amount);
    event RewardClaimed(address indexed owner, uint256 amount);

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

    function reportLiveness(int256 latitude, int256 longitude, int256 readyVal, uint256 timestamp) external {
        address device = msg.sender;
        require(registry.exists(device), "device not registered");
        require(ioID.deviceProject(device) == projectId, "not a hummingbird device");
        require(timestamp != 0, "timestamp required");

        LivenessData storage current = _lastLiveness[device];

        int256 lat;
        if (latitude != type(int256).min) {
            lat = latitude;
            current.latitude = latitude;
            current.hasLat = true;
        } else {
            require(current.hasLat, "No previous latitude");
            lat = current.latitude;
        }

        int256 lon;
        if (longitude != type(int256).min) {
            lon = longitude;
            current.longitude = longitude;
            current.hasLong = true;
        } else {
            require(current.hasLong, "No previous longitude");
            lon = current.longitude;
        }

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

        current.timestamp = timestamp;
        emit LivenessReported(device, timestamp, lat, lon, ready);

        uint256 tokenId = registry.deviceTokenId(device);
        address ownerOfDevice = ioID.ownerOf(tokenId);
        _pendingRewards[ownerOfDevice] += rewardPerPing;
        emit RewardAccumulated(ownerOfDevice, rewardPerPing);
    }

    function lastLiveness(address device) external view returns (uint256, int256, int256, bool) {
        LivenessData memory d = _lastLiveness[device];
        return (d.timestamp, d.latitude, d.longitude, d.ready);
    }

    function pendingReward(address account) external view returns (uint256) {
        return _pendingRewards[account];
    }

    function claimRewards() external {
        uint256 amount = _pendingRewards[msg.sender];
        require(amount > 0, "no rewards");
        _pendingRewards[msg.sender] = 0;
        hbToken.mint(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    function setRewardPerPing(uint256 newReward) external {
        require(msg.sender == owner, "only owner");
        rewardPerPing = newReward;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────
    function _requireAuthorized() internal view returns (address device) {
        device = msg.sender;
        require(registry.exists(device), "device not registered");
        require(ioID.deviceProject(device) == projectId, "not a hummingbird device");
    }

    function _ownerOfDevice(address device) internal view returns (address) {
        uint256 tokenId = registry.deviceTokenId(device);
        return ioID.ownerOf(tokenId);
    }

    function _openAdd(uint256 id) internal {
        _openIds.push(id);
        _openIndex[id] = _openIds.length;
    }

    function _openRemove(uint256 id) internal {
        uint256 i1 = _openIndex[id];
        if (i1 == 0) return;
        uint256 i = i1 - 1;
        uint256 last = _openIds[_openIds.length - 1];
        if (i != _openIds.length - 1) {
            _openIds[i] = last;
            _openIndex[last] = i1;
        }
        _openIds.pop();
        delete _openIndex[id];
    }

    function _deviceOpenAdd(address device, uint256 id) internal {
        _deviceOpenIds[device].push(id);
        _deviceOpenIndex[device][id] = _deviceOpenIds[device].length;
    }

    function _deviceOpenRemove(address device, uint256 id) internal {
        uint256 i1 = _deviceOpenIndex[device][id];
        if (i1 == 0) return;
        uint256 i = i1 - 1;
        uint256 last = _deviceOpenIds[device][_deviceOpenIds[device].length - 1];
        if (i != _deviceOpenIds[device].length - 1) {
            _deviceOpenIds[device][i] = last;
            _deviceOpenIndex[device][last] = i1;
        }
        _deviceOpenIds[device].pop();
        delete _deviceOpenIndex[device][id];
    }

    // ─── Delivery getters ─────────────────────────────────────────────────────
    function getOpenRequestCount() external view returns (uint256) { return _openIds.length; }
    function getOpenRequestAt(uint256 index) external view returns (uint256) { return _openIds[index]; }
    function getOpenRequests() external view returns (uint256[] memory) { return _openIds; }
    function getOpenRequestCountFor(address device) external view returns (uint256) { return _deviceOpenIds[device].length; }
    function getOpenRequestsFor(address device) external view returns (uint256[] memory) { return _deviceOpenIds[device]; }
    function getMyRequests(address requester) external view returns (uint256[] memory) { return _myRequestIds[requester]; }
    function getRequest(uint256 id) external view returns (DeliveryRequest memory) { return requests[id]; }

    // ─── Request creation ─────────────────────────────────────────────────────
    function requestDelivery(
        int32 pickupLatE7,
        int32 pickupLonE7,
        int32 dropLatE7,
        int32 dropLonE7,
        address device,
        uint64 expiresAt,
        uint256 maxPrice
    ) external returns (uint256) {
        require(maxPrice > 0, "maxPrice must be > 0");
        uint256 id = ++_nextRequestId;
        DeliveryRequest storage r = requests[id];
        r.id = id;
        r.requester = msg.sender;
        r.pickupLatE7 = pickupLatE7;
        r.pickupLonE7 = pickupLonE7;
        r.dropLatE7 = dropLatE7;
        r.dropLonE7 = dropLonE7;
        r.maxPrice = maxPrice;
        r.requestedAt = uint64(block.timestamp);
        r.status = Status.Open;
        // Add to ongoing list (non-terminal status)
        _onStatusChange(id, Status.Open);
        if (device != address(0)) {
            r.targetedDevice = device;
            r.expiresAt = expiresAt;
            _deviceOpenAdd(device, id);
        } else {
            _openAdd(id);
        }
        _myRequestIds[msg.sender].push(id);
        emit DeliveryRequested(id, msg.sender, pickupLatE7, pickupLonE7, dropLatE7, dropLonE7, uint64(block.timestamp), device, expiresAt, maxPrice);
        return id;
    }

    /* 
     * @notice Removes any ongoing request that was not completed after 1 hour.
     * This can be called by anyone, it will mint 0.1 HB token per request.
     * @dev This is a cleanup function to remove stale requests.
    */
    function cleanupStaleRequests() external {
        uint256 count = _ongoingList.length;
        require(count > 0, "no ongoing requests");
        uint256 reward = 0;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = _ongoingList[i];
            DeliveryRequest storage r = requests[id];
            if (r.status == Status.Open && block.timestamp >= r.requestedAt + 1 hours) {
                // Remove from ongoing list
                _ongoingRemove(id);
                // Remove from open lists
                if (r.targetedDevice != address(0)) {
                    _deviceOpenRemove(r.targetedDevice, id);
                } else {
                    _openRemove(id);
                }
                // Mark as cancelled
                r.status = Status.Cancelled;
                emit DeliveryCancelled(id);
                reward += 100 * 10**18; // 0.1 HB token per request
            }
        }
        if (reward > 0) {
            hbToken.mint(msg.sender, reward);
        }
    }



    /*     
     * @notice Open a request that was initially targeted to a specific device.
     * @dev This is used to target a request to a specific drone.
     * The request must be open and already targeted. Only the requester can open it.
     */
    function openTargetedRequest(uint256 id) external {
        DeliveryRequest storage r = requests[id];
        require(r.id != 0, "unknown request");
        require(r.status == Status.Open, "request not open");
        require(r.targetedDevice != address(0), "request already open");
        require(r.requester == msg.sender, "you are not the requester");
        _deviceOpenRemove(r.targetedDevice, id);
        r.targetedDevice = address(0);
        r.expiresAt = 0;
        _openAdd(id);
    }


    // ─── Propose / Accept / Progress ──────────────────────────────────────────
    function proposeDelivery(uint256 id, uint256 price) external {
        address device = _requireAuthorized();
        DeliveryRequest storage r = requests[id];
        require(r.id != 0, "unknown request");
        require(r.status == Status.Open, "request not in open state");
        if (r.targetedDevice != address(0)) {
        // If still in the exclusive window, only the targeted device may propose
        if (block.timestamp < r.expiresAt) {
            require(device == r.targetedDevice, "not targeted device");
        }
        _deviceOpenRemove(r.targetedDevice, id);   // ✅ always remove from device list
        // (optional) clear targeting metadata if expired:
        // if (block.timestamp >= r.expiresAt) { r.targetedDevice = address(0); r.expiresAt = 0; }
        } else {
            _openRemove(id);
        }
        require(price <= r.maxPrice, "price exceeds max");
        r.status = Status.Proposed;
        // Update ongoing list after status change
        _onStatusChange(id, Status.Proposed);
        r.proposedPrice = price;
        r.drone = device;
        r.proposedAt = uint64(block.timestamp);
        emit DeliveryProposed(id, device, price, r.proposedAt);
    }

    function acceptDelivery(uint256 id) external {
        DeliveryRequest storage r = requests[id];
        require(r.id != 0, "unknown request");
        require(r.status == Status.Proposed, "not proposed");
        require(r.requester == msg.sender, "not requester");
        uint256 price = r.proposedPrice;
        require(price > 0, "price not set");
        r.status = Status.Accepted;
        // Update ongoing list after status change
        _onStatusChange(id, Status.Accepted);
        r.price = price;
        r.acceptedAt = uint64(block.timestamp);
        require(hbToken.transferFrom(msg.sender, address(this), price), "escrow failed");
        emit DeliveryAccepted(id, r.drone, price);
    }

    function startDelivery(uint256 id) external {
        address device = _requireAuthorized();
        DeliveryRequest storage r = requests[id];
        require(r.status == Status.Accepted, "not accepted");
        require(device == r.drone, "not assigned drone");
        r.status = Status.Started;
        // Update ongoing list after status change
        _onStatusChange(id, Status.Started);
        emit DeliveryStarted(id, device);
    }

    function packagePicked(uint256 id) external {
        address device = _requireAuthorized();
        DeliveryRequest storage r = requests[id];
        require(r.status == Status.Started, "not started");
        require(device == r.drone, "not assigned drone");
        r.status = Status.PickedUp;
        // Update ongoing list after status change
        _onStatusChange(id, Status.PickedUp);
        emit PackagePicked(id, device);
    }

    function packageDropped(uint256 id) external {
        address device = _requireAuthorized();
        DeliveryRequest storage r = requests[id];
        require(r.status == Status.PickedUp, "not picked up");
        require(device == r.drone, "not assigned drone");
        r.status = Status.Dropped;
        // Update ongoing list after status change
        _onStatusChange(id, Status.Dropped);
        emit PackageDropped(id, device);
    }

    function completeDelivery(uint256 id) external {
        address device = _requireAuthorized();
        DeliveryRequest storage r = requests[id];
        require(r.status == Status.Dropped, "not dropped");
        require(device == r.drone, "not assigned drone");
        r.status = Status.Completed;
        // Update ongoing list after status change
        _onStatusChange(id, Status.Completed);
        uint256 price = r.price;
        uint256 fee = (price * FEE_BPS) / BPS_DENOM;
        uint256 payout = price - fee;
        address ownerOfDevice = _ownerOfDevice(device);
        require(hbToken.transfer(ownerOfDevice, payout), "payout failed");
        emit DeliveryCompleted(id, device, payout);
    }

    // ─── Cancel (with 2-min grace after acceptance) ───────────────────────────
    function cancelRequest(uint256 id) external {
        DeliveryRequest storage r = requests[id];
        require(r.id != 0, "unknown request");
        require(r.requester == msg.sender, "not requester");

        if (r.status == Status.Open) {
            if (r.targetedDevice != address(0)) {
                _deviceOpenRemove(r.targetedDevice, id);
            } else {
                _openRemove(id);
            }
            r.status = Status.Cancelled;
            // Update ongoing list after status change
            _onStatusChange(id, Status.Cancelled);
            emit DeliveryCancelled(id);
            return;
        }

        if (r.status == Status.Proposed) {
            // already removed from open lists when proposed
            r.status = Status.Cancelled;
            // Update ongoing list after status change
            _onStatusChange(id, Status.Cancelled);
            emit DeliveryCancelled(id);
            return;
        }

        if (r.status == Status.Accepted) {
            // NEW: allow cancellation within 2 minutes from acceptance,
            // refunding the escrow to requester.
            require(block.timestamp <= uint256(r.acceptedAt) + CANCEL_WINDOW, "cancel window passed");
            uint256 price = r.price;
            r.status = Status.Cancelled;
            // Update ongoing list after status change
            _onStatusChange(id, Status.Cancelled);
            // refund escrow
            require(hbToken.transfer(r.requester, price), "refund failed");
            emit DeliveryCancelled(id);
            return;
        }

        revert("cannot cancel");
    }
}
