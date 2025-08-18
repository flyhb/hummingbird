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

### Berachain Testnet
**HB Token**: 0x49cc6E12d483f4672B19fe703966D6E96A2A887F

**Hummingbird Logic**: 0xD431bCC02F01176FF3CA567b1c333a6Dcac1E97B
**HBToken minter set to**: 0xD431bCC02F01176FF3CA567b1c333a6Dcac1E97B

### Instructions
Before deploying, replace the placeholder values in `scripts/deploy.js` with the actual deployed addresses of the ioID ERC‑721 contract, the ioID registry, the HB token contract and the project ID you want the Hummingbird contract to serve.
The `rewardPerPing` variable controls how many HB tokens are credited per liveness message (expressed in 18‑decimals).  After deploying Hummingbird, a call to `setMinter` is required on the HB token contract to authorize the Hummingbird contract to mint rewards:

```bash
# Deploy the HB token
npx hardhat run  --network <network-name> scripts/deploy_token
# Deploy the Hummingbird contract (and set it as a minter in the token contract)
npx hardhat run  --network <network-name> scripts/deploy.js
```

## Hardhat Tasks

Alongside the standard Hardhat commands (compile, test, deploy) this
project exposes a suite of convenience tasks to interact with the
Hummingbird contract from the command line.  These tasks are loaded
automatically from the `tasks/` directory when Hardhat starts.  See
below for a brief overview of each command and usage examples.

### Reward Tasks

These tasks operate on the liveness reward system:

- **check-balance** – Check the pending HBToken reward balance for a
  particular account.

  ```bash
  npx hardhat check-balance --owner 0xYourAddress
  ```

- **claim-balance** – Claim all pending HBToken rewards for the calling
  account.

  ```bash
  npx hardhat claim-balance
  ```

### Delivery Tasks

The following commands wrap the delivery functionality exposed by
`Hummingbird.sol`.  By default they use the `HUMMINGBIRD` address from
your `.env` file, but you can override this with the `--contract` flag.
Many tasks also accept a `--signer` flag to choose which Hardhat
account submits the transaction.



- **hb:request** – Create a new delivery request.  You must provide
  pickup and drop‑off coordinates in decimal degrees, a maximum price
  in HB tokens, and optionally a target device address and expiry:

  ```bash
  # Open request (any drone may propose)
  npx hardhat hb:request --pickup "42.3601,-71.0589" --drop "42.3456,-71.1000" --maxhb 1.0

  # Targeted request with 10‑minute expiry
  npx hardhat hb:request --pickup "42.3601,-71.0589" --drop "42.3456,-71.1000" \
    --device 0xDroneDeviceAddr --expires 600 --maxhb 2.5
  ```

- **hb:cancel** – Cancel a request.  May be called by the requester
  before the request is accepted or within two minutes after
  acceptance.

  ```bash
  npx hardhat hb:cancel --id 3
  ```

- **hb:open-target** – Convert a targeted request into an open one.

  ```bash
  npx hardhat hb:open-target --id 3
  ```

- **hb:status** – Show the full on‑chain record for a request.

  ```bash
  npx hardhat hb:status --id 3
  ```

- **hb:list-open** – List all open delivery requests along with their
  status and assigned drone (if proposed).

- **hb:list-open-for** – List open requests targeted at a specific
  device address.

- **hb:my-requests** – List requests created by a requester (defaults
  to the current signer).

- **hb:propose** – As a drone, propose a price for an open request.

  ```bash
  npx hardhat hb:propose --id 3 --pricehb 0.75 --signer drone
  ```

- **hb:accept** – As the requester, accept a proposed delivery and
  escrow the agreed price.

- **hb:start**, **hb:picked**, **hb:dropped**, **hb:complete** – Drone
  actions to progress the delivery lifecycle step by step.

- **hb:progress** – A composite helper that will sequentially call
  startDelivery, packagePicked, packageDropped, and completeDelivery on
  an accepted request.  You can specify a delay (in milliseconds) between
  each step via `--delay`; the default is 5000ms (5 seconds).  This
  command is useful when manually simulating the drone flow:

  ```bash
  # Progress request 3 through all stages with a 2‑second pause between
  npx hardhat hb:progress --id 3 --delay 2000
  ```

### Notes

* All HB token amounts are specified in whole tokens (decimals) and
  internally converted to 18‑decimals when sent to the contract.
* Coordinates must be provided in degrees; they are converted to
  signed 32‑bit integers scaled by 1e7 as required by the contract.
* The requester creates requests and pays for delivery; drones
  propose and complete deliveries.  Make sure to use the appropriate
  signer for each role.
* The `HUMMINGBIRD` contract address can also be passed via
  `--contract` if you are working with multiple deployments.


## Contributing

Pull requests and issues are welcome.  Feel free to open a discussion if
you have suggestions for features, improvements, or questions about the
implementation.