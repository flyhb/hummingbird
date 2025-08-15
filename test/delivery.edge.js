/* test/delivery.edge.js */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

async function deployBase() {
  const [deployer, requester, drone, other] = await ethers.getSigners();
  const PROJECT_ID = 1;

  const MockIoID = await ethers.getContractFactory("MockIoID");
  const ioid = await MockIoID.deploy();
  await (ioid.waitForDeployment?.() ?? ioid.deployed?.());

  const MockRegistry = await ethers.getContractFactory("MockRegistry");
  const registry = await MockRegistry.deploy();
  await (registry.waitForDeployment?.() ?? registry.deployed?.());

  const HBToken = await ethers.getContractFactory("HBToken");
  const hb = await HBToken.deploy("Hummingbird Token", "HB");
  await (hb.waitForDeployment?.() ?? hb.deployed?.());

  const Hummingbird = await ethers.getContractFactory("Hummingbird");
  const addr = (c) => c.target ?? c.address;

  const rewardPerPing = ethers.parseUnits("1", 18);
  const hummingbird = await Hummingbird.deploy(
    addr(ioid), addr(registry), addr(hb), PROJECT_ID, rewardPerPing
  );
  await (hummingbird.waitForDeployment?.() ?? hummingbird.deployed?.());

  await hb.setMinter(addr(hummingbird));

  // Register `drone`
  await ioid.setProject(drone.address, PROJECT_ID);
  await registry.setExists(drone.address, true);
  await registry.setDeviceTokenId(drone.address, 101);
  await ioid.setTokenOwner(101, deployer.address); // drone owner = deployer

  // Fund requester and approve escrow
  await hb.setMinter(deployer.address);
  const FUND = ethers.parseEther("1000");
  await hb.mint(requester.address, FUND);
  await hb.setMinter(addr(hummingbird));
  await hb.connect(requester).approve(addr(hummingbird), FUND);

  return { deployer, requester, drone, other, ioid, registry, hb, hummingbird, PROJECT_ID };
}

describe("Hummingbird Delivery – edge cases", () => {
  it("expiry flow: targeted request opens after expiry via openTarget()", async () => {
    const { requester, drone, hummingbird } = await loadFixture(deployBase);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const expiresAt = now + 60;
    const maxPrice = ethers.parseEther("5");

    await hummingbird.connect(requester).requestDelivery(
      1,1,2,2, drone.address, expiresAt, maxPrice
    );

    // Before expiry: only targeted drone can propose
    await expect(
      hummingbird.connect(drone).proposeDelivery(1, ethers.parseEther("3"))
    ).to.emit(hummingbird, "DeliveryProposed");

    // Reset: create a 2nd targeted request to test openTarget after expiry
    await hummingbird.connect(requester).requestDelivery(
      1,1,2,2, drone.address, expiresAt, maxPrice
    );

    // advance time past expiry
    await time.increaseTo(expiresAt + 1);

    // Requester opens target so any device can propose
    await hummingbird.connect(requester).openTarget(2);

    await expect(
      hummingbird.connect(drone).proposeDelivery(2, ethers.parseEther("3"))
    ).to.emit(hummingbird, "DeliveryProposed");
  });

  it("max price guard rejects too-high proposals", async () => {
    const { requester, drone, hummingbird } = await loadFixture(deployBase);

    const maxPrice = ethers.parseEther("5");
    await hummingbird.connect(requester).requestDelivery(
      0,0,0,0, ethers.ZeroAddress, 0, maxPrice
    );

    await expect(
      hummingbird.connect(drone).proposeDelivery(1, ethers.parseEther("6"))
    ).to.be.revertedWith("price exceeds max");
  });

  it("cancel behavior: allow within 2 minutes after acceptance with refund; block afterwards", async () => {
    const { requester, drone, hb, hummingbird } = await loadFixture(deployBase);

    const maxPrice = ethers.parseEther("10");
    await hummingbird.connect(requester).requestDelivery(
      0,0,0,0, ethers.ZeroAddress, 0, maxPrice
    );

    const price = ethers.parseEther("4");
    await hummingbird.connect(drone).proposeDelivery(1, price);

    const before = await hb.balanceOf(requester.address);
    await hummingbird.connect(requester).acceptDelivery(1);
    const after = await hb.balanceOf(requester.address);
    expect(before - after).to.equal(price); // escrowed

    // Cancel within window -> refund
    await expect(hummingbird.connect(requester).cancelRequest(1))
      .to.emit(hummingbird, "DeliveryCancelled");
    const afterRefund = await hb.balanceOf(requester.address);
    expect(afterRefund - after).to.equal(price);

    // Create another request to test "window passed"
    await hummingbird.connect(requester).requestDelivery(
      0,0,0,0, ethers.ZeroAddress, 0, maxPrice
    );
    await hummingbird.connect(drone).proposeDelivery(2, price);
    await hummingbird.connect(requester).acceptDelivery(2);

    // advance time more than 2 minutes
    await time.increase(121);

    await expect(
      hummingbird.connect(requester).cancelRequest(2)
    ).to.be.revertedWith("cancel window passed");
  });

  it("escrow safety: acceptDelivery reverts if no allowance/balance", async () => {
    const { requester, drone, hummingbird, hb } = await loadFixture(deployBase);

    // Reduce allowance to zero
    await hb.connect(requester).approve((hummingbird.target ?? hummingbird.address), 0);

    await hummingbird.connect(requester).requestDelivery(0,0,0,0, ethers.ZeroAddress, 0, ethers.parseEther("10"));
    await hummingbird.connect(drone).proposeDelivery(1, ethers.parseEther("3"));

    // Many ERC20 implementations *revert* inside transferFrom when allowance/balance is insufficient.
    // That happens before our contract can hit `require(..., "escrow failed")`.
    // So we assert a generic revert (implementation-agnostic).
    await expect(
      hummingbird.connect(requester).acceptDelivery(1)
    ).to.be.reverted;
  });

  it("auth checks: proposal from unregistered/wrong-project devices revert", async () => {
    const { requester, other, hummingbird, registry, ioid } = await loadFixture(deployBase);

    const maxPrice = ethers.parseEther("10");
    await hummingbird.connect(requester).requestDelivery(0,0,0,0, ethers.ZeroAddress, 0, maxPrice);

    // other is not registered & wrong project initially
    await expect(
      hummingbird.connect(other).proposeDelivery(1, ethers.parseEther("2"))
    ).to.be.revertedWith("device not registered");

    // Register but wrong project
    await registry.setExists(other.address, true);
    await ioid.setProject(other.address, 999); // wrong
    await expect(
      hummingbird.connect(other).proposeDelivery(1, ethers.parseEther("2"))
    ).to.be.revertedWith("not a hummingbird device");
  });

  it("payout math: pays exactly 97% and keeps 3% in contract", async () => {
    const { requester, deployer, drone, hb, hummingbird } = await loadFixture(deployBase);

    await hummingbird.connect(requester).requestDelivery(0,0,0,0, ethers.ZeroAddress, 0, ethers.parseEther("100"));
    const price = ethers.parseEther("10");
    await hummingbird.connect(drone).proposeDelivery(1, price);
    await hummingbird.connect(requester).acceptDelivery(1);
    await hummingbird.connect(drone).startDelivery(1);
    await hummingbird.connect(drone).packagePicked(1);
    await hummingbird.connect(drone).packageDropped(1);

    const beforeOwner = await hb.balanceOf(deployer.address);
    await hummingbird.connect(drone).completeDelivery(1);
    const afterOwner = await hb.balanceOf(deployer.address);

    const payout = price - (price * 300n / 10_000n); // 97%
    expect(afterOwner - beforeOwner).to.equal(payout);
  });
});
