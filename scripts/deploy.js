const hre = require("hardhat");

/*
 * Deployment script for the Hummingbird contract.
 * Assumes ioID, ioIDRegistry, and HBToken are already deployed.
 */

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers.length) throw new Error("No deployer account found (check network.accounts in hardhat.config.js)");
  const deployer = signers[0];

  console.log("Deploying contracts with account:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // TODO: replace with your actual deployed addresses and project ID
  const ioIDAddress     = "0x04DCCaA87fef0DB7dbc86f074Ba6b4051A1837CF";
  const registryAddress = "0xf29EFbA688b77Ea29C8152488De557A2efff5c7d";
  const hbTokenAddress  = "0x49cc6E12d483f4672B19fe703966D6E96A2A887F";
  const projectId       = 1;

  // Number of HB tokens credited per liveness report (18 decimals)
  const rewardPerPing = hre.ethers.parseUnits("1", 18);

  const Hummingbird = await hre.ethers.getContractFactory("Hummingbird");
  const hummingbird = await Hummingbird.deploy(
    ioIDAddress,
    registryAddress,
    hbTokenAddress,
    projectId,
    rewardPerPing
  );
  await (hummingbird.waitForDeployment?.() ?? Promise.resolve());
  const hummingbirdAddress = hummingbird.target ?? hummingbird.address;
  console.log("Hummingbird deployed to:", hummingbirdAddress);

  // Set HBToken minter to the newly deployed Hummingbird
  const HBToken = await hre.ethers.getContractAt("HBToken", hbTokenAddress, deployer);
  const tx = await HBToken.setMinter(hummingbirdAddress);
  await tx.wait();
  console.log("HBToken minter set to Hummingbird contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
