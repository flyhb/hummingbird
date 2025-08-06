const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Hummingbird", function () {
  let hummingbird;
  let mockIoID;
  let mockRegistry;
  let hbToken;
  let deployer;
  let device;
  let otherDevice;
  let unknownDevice;

  beforeEach(async function () {
    [deployer, device, otherDevice, unknownDevice] = await ethers.getSigners();

    // Deploy mocks
    const MockIoID = await ethers.getContractFactory("MockIoID");
    mockIoID = await MockIoID.deploy();
    // Wait for the deployment to be mined (Hardhat >=2.17 uses waitForDeployment)
    if (typeof mockIoID.waitForDeployment === "function") {
      await mockIoID.waitForDeployment();
    } else {
      await mockIoID.deployed();
    }

    const MockRegistry = await ethers.getContractFactory("MockRegistry");
    mockRegistry = await MockRegistry.deploy();
    if (typeof mockRegistry.waitForDeployment === "function") {
      await mockRegistry.waitForDeployment();
    } else {
      await mockRegistry.deployed();
    }

    // Configure device and otherDevice
    const projectId = 1;
    await mockIoID.setProject(device.address, projectId);
    await mockRegistry.setExists(device.address, true);
    // otherDevice is registered to a different project
    await mockIoID.setProject(otherDevice.address, 2);
    await mockRegistry.setExists(otherDevice.address, true);

    // unknownDevice will not be registered (exists defaults to false)
    await mockIoID.setProject(unknownDevice.address, projectId);

    // Map devices to token IDs and set owners for those token IDs.  The
    // Hummingbird contract will use these to determine who receives rewards.
    await mockRegistry.setDeviceTokenId(device.address, 1);
    await mockIoID.setTokenOwner(1, deployer.address);
    await mockRegistry.setDeviceTokenId(otherDevice.address, 2);
    await mockIoID.setTokenOwner(2, deployer.address);
    await mockRegistry.setDeviceTokenId(unknownDevice.address, 3);
    await mockIoID.setTokenOwner(3, deployer.address);

    // Deploy the reward token and set Hummingbird as minter later
    const HBToken = await ethers.getContractFactory("HBToken");
    hbToken = await HBToken.deploy("Hummingbird Token", "HB");
    if (typeof hbToken.waitForDeployment === "function") {
      await hbToken.waitForDeployment();
    } else {
      await hbToken.deployed();
    }

    // Deploy Hummingbird with token and reward settings
    const Hummingbird = await ethers.getContractFactory("Hummingbird");
    // Helper to resolve the address property across ethers versions
    const getAddress = (c) => {
      return c.target ?? c.address;
    };
    const rewardPerPing = ethers.parseUnits("1", 18);
    hummingbird = await Hummingbird.deploy(
      getAddress(mockIoID),
      getAddress(mockRegistry),
      hbToken.target ?? hbToken.address,
      projectId,
      rewardPerPing
    );
    if (typeof hummingbird.waitForDeployment === "function") {
      await hummingbird.waitForDeployment();
    } else {
      await hummingbird.deployed();
    }
    // Set the Hummingbird contract as the minter on the HB token
    await hbToken.setMinter(hummingbird.target ?? hummingbird.address);
  });

  it("records liveness for a registered device belonging to the project", async function () {
    const latitude = 377749000; // 37.7749° × 1e7
    const longitude = -1224194000; // -122.4194° × 1e7
    await expect(
      hummingbird.connect(device).reportLiveness(latitude, longitude)
    )
      .to.emit(hummingbird, "LivenessReported")
      .withArgs(device.address, anyValue, latitude, longitude);

    const data = await hummingbird.lastLiveness(device.address);
    expect(data.timestamp).to.be.gt(0);
    expect(data.latitude).to.equal(latitude);
    expect(data.longitude).to.equal(longitude);

    // Rewards should accrue to the device owner (deployer) after one ping
    const rewardPerPing = ethers.parseUnits("1", 18);
    expect(await hummingbird.pendingReward(deployer.address)).to.equal(rewardPerPing);

    // Claim rewards and ensure HB tokens are minted
    await expect(hummingbird.connect(deployer).claimRewards())
      .to.emit(hummingbird, "RewardClaimed")
      .withArgs(deployer.address, rewardPerPing);
    expect(await hbToken.balanceOf(deployer.address)).to.equal(rewardPerPing);
    expect(await hummingbird.pendingReward(deployer.address)).to.equal(0);
  });

  it("reverts if the device is not registered", async function () {
    await expect(
      hummingbird.connect(unknownDevice).reportLiveness(0, 0)
    ).to.be.revertedWith("device not registered");
  });

  it("reverts if the device belongs to a different project", async function () {
    await expect(
      hummingbird.connect(otherDevice).reportLiveness(0, 0)
    ).to.be.revertedWith("not a hummingbird device");
  });
});