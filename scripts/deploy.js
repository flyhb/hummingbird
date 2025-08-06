const hre = require("hardhat");

/*
 * Deployment script for the Hummingbird contract.  This script assumes
 * you already have the ioID ERC721 contract and the ioID registry
 * deployed.  Replace the placeholder addresses and projectId below
 * accordingly before running.
 */

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // TODO: Replace these with the actual deployed contract addresses and project ID
  const ioIDAddress = "0x0000000000000000000000000000000000000000";
  const registryAddress = "0x0000000000000000000000000000000000000000";
  const hbTokenAddress = "0x0000000000000000000000000000000000000000";
  const projectId = 1;
  // Number of HB tokens accrued per liveness report (18 decimals)
  const rewardPerPing = hre.ethers.parseUnits("1", 18);

  const Hummingbird = await hre.ethers.getContractFactory("Hummingbird");
  const hummingbird = await Hummingbird.deploy(
    ioIDAddress,
    registryAddress,
    hbTokenAddress,
    projectId,
    rewardPerPing
  );
  await hummingbird.waitForDeployment?.();
  console.log("Hummingbird deployed to:", hummingbird.target ?? hummingbird.address);

  // Optional: update the HB token minter to the newly deployed Hummingbird
  // Uncomment the following lines if HBToken is deployed and you want to
  // authorize this Hummingbird contract to mint rewards.
  /*
  const HBToken = await hre.ethers.getContractAt("HBToken", hbTokenAddress);
  const tx = await HBToken.setMinter(hummingbird.target ?? hummingbird.address);
  await tx.wait();
  console.log("HBToken minter set to Hummingbird contract");
  */
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});