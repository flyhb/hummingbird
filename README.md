# Hummingbird Hardhat Project

This repository contains the main **Hummingbird** contract logic.  The Hummingbird contract records live telemetry for autonomous drones.  Each drone is represented by a unique identity (an Ethereum address) managed by the [`ioID`](https://github.com/flyhb/ioID-contracts) project.  Drones submit liveness updates directly to the contract, which verifies the device’s registration and project assignment via the ioID registry before recording the timestamped GPS coordinates on‑chain.

## Project Structure

- **contracts/** – Solidity contracts.
  - `Hummingbird.sol`: core contract
  - `HBToken.sol`: a minimal ERC20 implementation used as the reward
    token.
  - `MockIoID.sol` and `MockRegistry.sol`: minimal mock implementations used
    solely in the test suite.
- **scripts/deploy.js**: a deployment script  (rewuires to update the
  `ioIDAddress`, `registryAddress`, and `projectId` variables with the
  appropriate on‑chain values before deploying).
- **test/** – Mocha tests for the Hummingbird contract using Hardhat’s test
  environment.
- **hardhat.config.js** – Hardhat configuration.

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 16.x
- [npm](https://www.npmjs.com/) (comes with Node.js)

## Installation

Clone this repository and install the dependencies:

```bash
git clone <your-fork-or-repo-url>
cd hummingbird
npm install
```

## Compilation

To compile the contracts, run:

```bash
npx hardhat compile
```

## Running Tests

Unit tests use the mocks to simulate the ioID contracts:

```bash
npx hardhat test
```

## Deployment

Before deploying, replace the placeholder values in `scripts/deploy.js` with the actual deployed addresses of the ioID ERC‑721 contract, the ioID registry, the HB token contract and the project ID you want the Hummingbird contract to serve.
The `rewardPerPing` variable controls how many HB tokens are credited per liveness message (expressed in 18‑decimals).  After deploying Hummingbird, a call to `setMinter` is required on the HB token contract to authorize the Hummingbird contract to mint rewards:

```bash
// On the default Hardhat network
npx hardhat run scripts/deploy.js

// On a specific network defined in your Hardhat config
npx hardhat run --network <network-name> scripts/deploy.js
```

## Contributing

Pull requests and issues are welcome.  Feel free to open a discussion if
you have suggestions for features, improvements, or questions about the
implementation.