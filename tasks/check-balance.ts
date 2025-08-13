import { task } from "hardhat/config";

task("check-balance", "Check pending HBToken reward balance for an account")
  .addParam("owner", "The owner address to check")
  .setAction(async ({ owner }, hre) => {
    const hummingbirdAddr = process.env.HUMMINGBIRD;
    if (!hummingbirdAddr) throw new Error("HUMMINGBIRD env var not set");

    const hb = await hre.ethers.getContractAt("Hummingbird", hummingbirdAddr);
    const pending = await hb.pendingReward(owner);
    console.log(`Pending reward for ${owner}: ${hre.ethers.formatUnits(pending, 18)} HB`);
  });