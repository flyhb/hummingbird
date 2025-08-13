import { task } from "hardhat/config";

task("claim-balance", "Claim all pending HBToken rewards for the sender")
  .setAction(async (_, hre) => {
    const hummingbirdAddr = process.env.HUMMINGBIRD;
    if (!hummingbirdAddr) throw new Error("HUMMINGBIRD env var not set");

    const [signer] = await hre.ethers.getSigners();
    console.log(`Claiming rewards for ${signer.address}...`);

    const hb = await hre.ethers.getContractAt("Hummingbird", hummingbirdAddr, signer);
    const tx = await hb.claimRewards();
    await tx.wait();

    console.log(`Rewards claimed for ${signer.address}`);
  });