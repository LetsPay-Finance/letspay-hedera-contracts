## LetsPay Hedera Contracts

UUPS-upgradeable LetsPay contracts for Hedera EVM with a minimal on-chain proxy (`ERC1967Proxy`) and the initial implementation `LetsPayHBAR_V1_UUPS`.

### Prerequisites

- Node.js 18+
- pnpm/npm installed
- Hedera JSON-RPC endpoint and funded EVM private key

### Install

```shell
npm install
```

### Configure environment

Set the following variables in your shell or a local `.env` you source before commands:

```shell
export HEDERA_RPC_URL=https://testnet.hashio.io/api
export HEDERA_PRIVATE_KEY=0xYOUR_EVM_PRIVATE_KEY
```

Alternatively, you can store them using Hardhat keystore:

```shell
npx hardhat keystore set HEDERA_RPC_URL
npx hardhat keystore set HEDERA_PRIVATE_KEY
```

### Build

```shell
npx hardhat compile
```

### Deploy to Hedera Testnet

This repo uses Ignition modules for deployments. The primary module deploys:
- `LetsPayHBAR_V1_UUPS` implementation
- `ERC1967Proxy` pointing at V1, calling `initialize(owner)` with the deployer’s address

Run:

```shell
npm run deploy:hedera:testnet
# or
npx hardhat ignition deploy --network hederaTestnet ignition/modules/LetsPayHBAR.ts
```

The output will include the proxy address. Save it for interactions.

### Interact

Fund the proxy with HBAR so the app can pay merchants:

```shell
npx tsx scripts/fundproxy.ts
```

Check balance of the proxy:

```shell
npx tsx scripts/checkbalance.ts
```

Both scripts use `HEDERA_RPC_URL` and `HEDERA_PRIVATE_KEY`. Update the hardcoded proxy address in the scripts as needed after your deployment.

### Contracts

- `contracts/LetsPayHBAR_V1_UUPS.sol`: UUPS implementation with escrow, credit assignment, and repayments. Uses an `initializer` and `onlyProxy` guard.
- `contracts/Proxy.sol`: Minimal `ERC1967Proxy` storing implementation at the EIP-1967 slot and delegating all calls.

#### New draft contracts

- `contracts/MerchantRegistry.sol`: Owner-managed registry for merchants with `register`, `updatePayout`, `updateMetadata`, and `unregister`. Stores payout address, name, and `metadataURI`. Stand-alone with simple `initialize(owner)`.
- `contracts/FeeManager.sol`: Owner-managed platform fee settings. Stores `feeRecipient` and `feeBps` (out of 10_000). Provides `computeFee(amount)` and `splitAmount(amount)` helpers. Stand-alone with `initialize(owner, recipient, bps)`.

Intended integration (future):
- Validate merchants in `LetsPayHBAR_V1_UUPS.createEscrow` via `MerchantRegistry.isRegistered(merchant)` and pay to `MerchantRegistry.payoutOf(merchant)`.
- If platform fees are desired, use `FeeManager.splitAmount(total)` to route `(fee -> feeRecipient)` and `(net -> merchant)`.

### Repository layout

- `ignition/modules/LetsPayHBAR.ts`: Deployment of V1 + proxy + ABI attachment
- `scripts/fundproxy.ts`, `scripts/checkbalance.ts`: Basic Hedera interactions via `viem`

Removed example content (OP sample, V2 upgrade scaffold, sample tests) to keep the repository focused on Hedera V1 deployment and use.
