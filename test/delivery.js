/* test/delivery.js */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

async function deployFixture() {
  const [deployer, requester, drone, other] = await ethers.getSigners();
  const PROJECT_ID = 1;

  // ---- Mocks
  const MockIoID = await ethers.getContractFactory("MockIoID");
  const ioid = await MockIoID.deploy();
  await (ioid.waitForDeployment?.() ?? ioid.deployed?.());

  const MockRegistry = await ethers.getContractFactory("MockRegistry");
  const registry = await MockRegistry.deploy();
  await (registry.waitForDeployment?.() ?? registry.deployed?.());

  // ---- Token
  const HBToken = await ethers.getContractFactory("HBToken");
  // Your HBToken(name, symbol) per hummingbird.js
  const hb = await HBToken.deploy("Hummingbird Token", "HB");
  await (hb.waitForDeployment?.() ?? hb.deployed?.());

  // ---- Contract under test
  const Hummingbird = await ethers.getContractFactory("Hummingbird");
  const addr = (c) => c.target ?? c.address; // ethers v5/v6 compat

  const rewardPerPing = ethers.parseUnits("1", 18); // not used by these tests
  const hummingbird = await Hummingbird.deploy(
    addr(ioid),
    addr(registry),
    addr(hb),
    PROJECT_ID,
    rewardPerPing
  );
  await (hummingbird.waitForDeployment?.() ?? hummingbird.deployed?.());

  // Set minter back to hummingbird (as your other test does)
  await hb.setMinter(addr(hummingbird));

  // ---- Device registration for the drone we’ll use in delivery tests
  // Device must exist and be in the same project; it must also map to a tokenId with an owner
  await ioid.setProject(drone.address, PROJECT_ID);
  await registry.setExists(drone.address, true);
  await registry.setDeviceTokenId(drone.address, 101);
  // Set the owner for that token id (who will receive payout)
  // We'll use `deployer` as the drone owner for simplicity
  await ioid.setTokenOwner(101, deployer.address);

  // Fund requester with HB so acceptDelivery can escrow
  // (Temporarily switch minter to deployer to mint to requester, then restore)
  await hb.setMinter(deployer.address);
  const FUND = ethers.parseEther("1000");
  await hb.mint(requester.address, FUND);
  await hb.setMinter(addr(hummingbird));

  // Approve escrow to the contract
  await hb.connect(requester).approve(addr(hummingbird), FUND);

  return { deployer, requester, drone, other, ioid, registry, hb, hummingbird, PROJECT_ID };
}

describe("Hummingbird Delivery", function () {
  it("handles a targeted delivery from request through completion", async function () {
    const { requester, drone, deployer, hb, hummingbird } = await loadFixture(deployFixture);

    // Targeted request to `drone` that expires in the future
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const expiresAt = now + 3600;
    const maxPrice  = ethers.parseEther("10");

    await expect(
      hummingbird.connect(requester).requestDelivery(
        423601000, -710588900,  // pickup
        423602000, -710589000,  // drop
        drone.address,          // targetedDevice
        expiresAt,              // expiresAt
        maxPrice                // maxPrice
      )
    ).to.emit(hummingbird, "DeliveryRequested")
     .withArgs(
       1, requester.address,
       423601000, -710588900, 423602000, -710589000,
       anyValue, drone.address, expiresAt, maxPrice
     );

    // Only targeted drone may propose before expiry
    const proposed = ethers.parseEther("5");
    await expect(hummingbird.connect(drone).proposeDelivery(1, proposed))
      .to.emit(hummingbird, "DeliveryProposed")
      .withArgs(1, drone.address, proposed, anyValue);

    // Requester accepts (escrow moves from requester -> contract)
    const balBefore = await hb.balanceOf(requester.address);
    await expect(hummingbird.connect(requester).acceptDelivery(1))
      .to.emit(hummingbird, "DeliveryAccepted")
      .withArgs(1, drone.address, proposed);
    const balAfter = await hb.balanceOf(requester.address);
    expect(balBefore - balAfter).to.equal(proposed);

    // Full lifecycle
    await expect(hummingbird.connect(drone).startDelivery(1))
      .to.emit(hummingbird, "DeliveryStarted").withArgs(1, drone.address);
    await expect(hummingbird.connect(drone).packagePicked(1))
      .to.emit(hummingbird, "PackagePicked").withArgs(1, drone.address);
    await expect(hummingbird.connect(drone).packageDropped(1))
      .to.emit(hummingbird, "PackageDropped").withArgs(1, drone.address);

    // Complete & payout 97% to token owner (we set token owner = deployer)
    const ownerBefore = await hb.balanceOf(deployer.address);
    await expect(hummingbird.connect(drone).completeDelivery(1))
      .to.emit(hummingbird, "DeliveryCompleted")
      .withArgs(1, drone.address, anyValue);
    const ownerAfter = await hb.balanceOf(deployer.address);

    const expectedPayout = proposed - (proposed * 300n / 10000n); // 97%
    expect(ownerAfter - ownerBefore).to.equal(expectedPayout);
  });

  it("handles a non-targeted (open) request and supports multiple proposals", async function () {
    const { requester, drone, hb, hummingbird } = await loadFixture(deployFixture);

    const maxPrice = ethers.parseEther("10");
    await expect(
      hummingbird.connect(requester).requestDelivery(
        423601000, -710588900,
        423602000, -710589000,
        ethers.ZeroAddress,   // open
        0,                    // no expiry
        maxPrice
      )
    ).to.emit(hummingbird, "DeliveryRequested")
     .withArgs(
       1, requester.address,
       423601000, -710588900, 423602000, -710589000,
       anyValue, ethers.ZeroAddress, 0, maxPrice
     );

    // Any authorized device may propose (we configured `drone` as authorized)
    const offer = ethers.parseEther("4");
    await expect(hummingbird.connect(drone).proposeDelivery(1, offer))
      .to.emit(hummingbird, "DeliveryProposed")
      .withArgs(1, drone.address, offer, anyValue);

    await expect(hummingbird.connect(requester).acceptDelivery(1))
      .to.emit(hummingbird, "DeliveryAccepted")
      .withArgs(1, drone.address, offer);

    await expect(hummingbird.connect(drone).startDelivery(1)).to.emit(hummingbird, "DeliveryStarted");
    await expect(hummingbird.connect(drone).packagePicked(1)).to.emit(hummingbird, "PackagePicked");
    await expect(hummingbird.connect(drone).packageDropped(1)).to.emit(hummingbird, "PackageDropped");
    await expect(hummingbird.connect(drone).completeDelivery(1)).to.emit(hummingbird, "DeliveryCompleted");
  });
});
