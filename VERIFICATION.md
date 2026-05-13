# Contract Verification on HashScan (Sourcify)

This document explains how to verify the LetsPayBondingCurve contract on HashScan using Sourcify.

## Overview

HashScan uses Sourcify for contract verification. Sourcify requires:
1. The source code file(s)
2. The metadata JSON file that matches the exact compilation settings used

## Step-by-Step Process

### 1. Extract the Actual Metadata JSON

The metadata JSON must match exactly what was used during compilation. Extract it from the build artifacts:

```bash
# Find the build-info file for your contract
find artifacts/build-info -name "*.json" | grep LetsPayBondingCurve

# Extract the metadata JSON (it's stored as a string in the output)
cat artifacts/build-info/solc-0_8_28-<hash>.output.json | \
  jq -r '.output.contracts."project/contracts/LetsPayBondingCurve.sol".LetsPayBondingCurve.metadata' > \
  LetsPayBondingCurve.metadata.json
```

**Important**: The metadata is stored as a JSON string inside the build output, so use `jq -r` to extract it as raw text.

### 2. Prepare Source Files with Correct Path Structure

Sourcify matches files by the paths specified in the metadata. The metadata references:
- `project/contracts/LetsPayBondingCurve.sol`

So you need to create this directory structure:

```bash
mkdir -p project/contracts
cp contracts/LetsPayBondingCurve.sol project/contracts/LetsPayBondingCurve.sol
```

### 3. Upload to HashScan

1. Go to https://verify.hashscan.io/
2. Enter the contract address: `0x2b818e944ca8ed05e3a3ae6e420966ee7d7bd410`
3. Select network: **Hedera Mainnet**
4. Upload files:
   - `project/contracts/LetsPayBondingCurve.sol`
   - `LetsPayBondingCurve.metadata.json`
5. Click Submit/Verify

## Why This Works

The key issue was that manually created metadata JSON files don't match the actual compilation settings. The metadata JSON contains:
- Exact compiler version string
- Source file keccak256 hash
- Compiler settings (optimizer, EVM version, etc.)
- File paths that must match uploaded files

Sourcify uses this metadata to:
1. Verify the source file hash matches
2. Recompile with the exact same settings
3. Compare the bytecode with the deployed contract

## Important Notes

- **File paths matter**: The paths in the metadata must exactly match the uploaded file paths
- **Source hash must match**: The keccak256 hash in metadata must match the actual source file
- **Compiler settings must match**: Any difference in optimizer settings, EVM version, etc. will cause verification to fail
- **Use actual metadata**: Always extract metadata from build artifacts, don't create it manually

## Troubleshooting

If verification fails:

1. **Check file paths**: Ensure uploaded file paths match those in `metadata.sources`
2. **Verify source hash**: The source file's keccak256 hash should match the hash in metadata
3. **Check compiler settings**: Ensure optimizer, EVM version, etc. match what was used during deployment
4. **Try without metadata**: Sometimes Sourcify can auto-detect settings if you only upload the source file

## Current Contract Details

- **Contract Address**: `0x2b818e944ca8ed05e3a3ae6e420966ee7d7bd410`
- **Network**: Hedera Mainnet (Chain ID: 295)
- **Compiler**: `0.8.28+commit.7893614a`
- **Optimizer**: Disabled (but runs: 200)
- **EVM Version**: Cancun
- **Source Path**: `project/contracts/LetsPayBondingCurve.sol`

## Files Created

- `LetsPayBondingCurve.metadata.json` - Extracted metadata from build artifacts
- `project/contracts/LetsPayBondingCurve.sol` - Source file with correct path structure

---

# BondingCurveProxy Verification on HashScan (Sourcify)

This section explains how to verify the `BondingCurveProxy` contract on HashScan using Sourcify.

## Step-by-Step Process

### 1. Extract the Actual Metadata JSON

Extract the proxy metadata JSON from the Hardhat build output (same `build-info` file as other contracts):

```bash
cat artifacts/build-info/solc-0_8_28-<hash>.output.json | \
  jq -r '.output.contracts."project/contracts/BondingCurveProxy.sol".BondingCurveProxy.metadata' > \
  BondingCurveProxy.metadata.json
```

### 2. Prepare Source Files with Correct Path Structure

The metadata references:
- `project/contracts/BondingCurveProxy.sol`

Create the required path and copy the file:

```bash
mkdir -p project/contracts
cp contracts/BondingCurveProxy.sol project/contracts/BondingCurveProxy.sol
```

### 3. Upload to HashScan

1. Go to https://verify.hashscan.io/
2. Enter the **BondingCurveProxy** contract address (the deployed proxy address)
3. Select network: **Hedera Testnet** or **Hedera Mainnet** (whichever you deployed to)
4. Upload files:
   - `project/contracts/BondingCurveProxy.sol`
   - `BondingCurveProxy.metadata.json`
5. Click Submit/Verify

## Notes specific to the proxy

- **Constructor args are not required for Sourcify**: Sourcify matches the deployed bytecode via metadata + compilation settings.
- **Verify the proxy address**: For upgradeable setups, verify both:
  - the proxy (`BondingCurveProxy` address)
  - the implementation (`LetsPayBondingCurve` implementation address)
