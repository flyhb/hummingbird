const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Hummingbird", function () {
  let hummingbird;
  let mockIoID;
  let mockRegistry;
  let deployer;
  let device;
  let otherDevice;
  let unknownDevice;

  beforeEach(async function () {
    [deployer, device, otherDevice, unknownDevice] = await ethers.getSigners();

    // Deploy mocks
    const MockIoID = await ethers.getContractFactory("MockIoID");
    mockIoID = await MockIoID.deploy();
    await mockIoID.deployed();

    const MockRegistry = await ethers.getContractFactory("MockRegistry");
    mockRegistry = await MockRegistry.deploy();
    await mockRegistry.deployed();

    // Configure device and otherDevice
    const projectId = 1;
    await mockIoID.setProject(device.address, projectId);
    await mockRegistry.setExists(device.address, true);
    // otherDevice is registered to a different project
    await mockIoID.setProject(otherDevice.address, 2);
    await mockRegistry.setExists(otherDevice.address, true);

    // unknownDevice will not be registered (exists defaults to false)
    await mockIoID.setProject(unknownDevice.address, projectId);

    // Deploy Hummingbird
    const Hummingbird = await ethers.getContractFactory("Hummingbird");
    hummingbird = await Hummingbird.deploy(
      mockIoID.address,
      mockRegistry.address,
      projectId
    );
    await hummingbird.deployed();
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
  });

  it("reverts if the device is not registered", async function () {
    await expect(
      hummingbird.connect(unknownDevice).reportLiveness(0, 0)
    ).to.be.revertedWith("device not registered");
  });

  it("reverts if the device belongs to a different project", async function () {
    await expect(
      hummingbird.connect(otherDevice).reportLiveness(0, 0)
    ).to.be.revertedWith("invalid project");
  });
});