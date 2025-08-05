# Hummingbird Hardhat Project

This repository contains a simple Hardhat project implementing the
**Hummingbird** smart contract.  The Hummingbird contract records live
telemetry for autonomous drones.  Each drone is represented by a unique
identity (an Ethereum address) managed by the [`ioID`](https://github.com/iotexproject/ioID-contracts) project.  Drones submit
liveness updates directly to the contract, which verifies the device’s
registration and project assignment via the ioID registry before
recording the timestamped GPS coordinates on‑chain.

## Project Structure

- **contracts/** – Solidity contracts.
  - `Hummingbird.sol` – core contract that verifies device registration and
    project membership before recording liveness data.
  - `MockIoID.sol` and `MockRegistry.sol` – minimal mock implementations used
    solely in the test suite.  They are not part of the production
    deployment.
- **scripts/deploy.js** – example deployment script.  You must update the
  `ioIDAddress`, `registryAddress`, and `projectId` variables with the
  appropriate on‑chain values before deploying.
- **test/** – Mocha tests for the Hummingbird contract using Hardhat’s test
  environment.
- **hardhat.config.js** – Hardhat configuration specifying the Solidity
  compiler version and network settings.

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) ≥ 16.x
- [npm](https://www.npmjs.com/) (comes with Node.js)

## Installation

Clone this repository and install the dependencies:

```bash
git clone <your-fork-or-repo-url>
cd hummingbird
npm install
```

> **Note**: If you are behind a corporate proxy or have network restrictions,
> you may need to configure npm to access the package registry.

## Compilation

To compile the contracts, run:

```bash
npx hardhat compile
```

This command generates artifacts in the `artifacts/` directory and caches
build information in `cache/`.

## Running Tests

Unit tests are provided to verify the basic functionality of the
Hummingbird contract.  They use the mocks to simulate the ioID and
registry contracts:

```bash
npx hardhat test
```

All tests should pass if the contract behaves as expected.

## Deployment

An example deployment script is provided in `scripts/deploy.js`.  Before
deploying, replace the placeholder values with the actual deployed
addresses of the ioID ERC‑721 contract, the ioID registry, and the
project ID you want the Hummingbird contract to serve.  Then run:

```bash
// On the default Hardhat network
npx hardhat run scripts/deploy.js

// On a specific network defined in your config
npx hardhat run --network <network-name> scripts/deploy.js
```

Refer to the [Hardhat documentation](https://hardhat.org/) for details on
network configuration, deploying to testnets or mainnet, and verifying
contracts on block explorers.

## Contributing

Pull requests and issues are welcome.  Feel free to open a discussion if
you have suggestions for features, improvements, or questions about the
implementation.