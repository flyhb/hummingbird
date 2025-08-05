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
  const projectId = 1;

  const Hummingbird = await hre.ethers.getContractFactory("Hummingbird");
  const hummingbird = await Hummingbird.deploy(
    ioIDAddress,
    registryAddress,
    projectId
  );
  await hummingbird.deployed();

  console.log("Hummingbird deployed to:", hummingbird.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});