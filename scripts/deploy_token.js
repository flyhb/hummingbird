const hre = require("hardhat");

/*
 * Deployment script for the HBToken contract.  This script deploys a
 * mintable ERC-20 token used by the Hummingbird contract.  It prints
 * the deployed token's address.
 */

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying HBToken with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  const name = "Hummingbird Token";
  const symbol = "HB";

  const HBToken = await hre.ethers.getContractFactory("HBToken");
  const hbToken = await HBToken.deploy(name, symbol);
  await hbToken.waitForDeployment?.(); // ethers v6
  const tokenAddress = hbToken.target ?? hbToken.address; // v6 vs v5 compat
  console.log("HBToken deployed to:", tokenAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
