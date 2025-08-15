import "./tasks/check-balance";
import "./tasks/claim-balance";
// Register custom delivery tasks.  These tasks are defined in
// tasks/hummingbird.ts and extend the Hardhat CLI with additional
// commands for interacting with delivery requests (create, cancel,
// propose, accept, progress, etc.).  Without this import the tasks
// will not be loaded.
import "./tasks/hummingbird";

import '@nomicfoundation/hardhat-toolbox';
import { HardhatUserConfig } from 'hardhat/config';

import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_KEY;
const accounts = PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    dev: {
      url: 'http://127.0.0.1:8545',
    },
    berachain: {
      url: 'https://bepolia.rpc.berachain.com',
      accounts: accounts,
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.19',
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 10000,
          },
          metadata: {
            bytecodeHash: 'none',
          },
        },
      },
    ],
  },
  etherscan: {
    apiKey: 'YOUR_ETHER',
    customChains: [
      {
        network: 'mainnet',
        chainId: 80094,
        urls: {
          apiURL: 'https://berascan.com/api',
          browserURL: 'https://berascan.com',
        },
      },
      {
        network: 'testnet',
        chainId: 80069,
        urls: {
          apiURL: 'https://testnet.berascan.com/api',
          browserURL: 'https://testnet.berascan.com',
        },
      },
    ],
  },
};

export default config;