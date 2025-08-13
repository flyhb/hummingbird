// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
  const [
    IOID,
    IOID_REGISTRY,
    HB_TOKEN,
    PROJECT_ID,
    REWARD_PER_PING, // decimal string in 18 decimals, e.g. "1" or "0.5"
  ] = [
    process.env.IOID,
    process.env.IOID_REGISTRY,
    process.env.HB_TOKEN,
    process.env.PROJECT_ID,
    process.env.REWARD_PER_PING ?? "1",
  ];

  if (!IOID || !IOID_REGISTRY || !HB_TOKEN || !PROJECT_ID) {
    throw new Error(
      "Missing env. Required: IOID, IOID_REGISTRY, HB_TOKEN, PROJECT_ID, (REWARD_PER_PING optional)"
    );
  }

  const rewardPerPing = ethers.parseUnits(REWARD_PER_PING, 18);

  console.log("Deploying Hummingbird with:");
  console.log({ IOID, IOID_REGISTRY, HB_TOKEN, PROJECT_ID, REWARD_PER_PING, rewardPerPing: rewardPerPing.toString() });

  const Hummingbird = await ethers.getContractFactory("Hummingbird");
  const hummingbird = await Hummingbird.deploy(
    IOID,
    IOID_REGISTRY,
    HB_TOKEN,
    BigInt(PROJECT_ID),
    rewardPerPing
  );
  await hummingbird.waitForDeployment();

  const hummingbirdAddr = await hummingbird.getAddress();
  console.log("Hummingbird deployed at:", hummingbirdAddr);

  // (Optional) set minter on HB token to Hummingbird, if your HB token supports it.
  try {
    const hbToken = await ethers.getContractAt("HBToken", HB_TOKEN);
    const tx = await hbToken.setMinter(hummingbirdAddr);
    await tx.wait();
    console.log("HBToken minter set to:", hummingbirdAddr);
  } catch (e) {
    console.warn("Skipping setMinter on HBToken (not supported or already set):", (e as Error).message);
  }

  console.log("\nSet this in the simulator .env:");
  console.log(`HUMMINGBIRD=${hummingbirdAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});