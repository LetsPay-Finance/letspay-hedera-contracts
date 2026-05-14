import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORKS = {
  testnet: {
    chainId: 296,
    name: "Hedera Testnet",
    rpcEnv: "HEDERA_RPC_URL",
    keyEnv: "HEDERA_PRIVATE_KEY",
  },
  mainnet: {
    chainId: 295,
    name: "Hedera Mainnet",
    rpcEnv: "HEDERA_MAINNET_RPC_URL",
    keyEnv: "HEDERA_MAINNET_PRIVATE_KEY",
  },
} as const;

type NetworkKey = keyof typeof NETWORKS;

// Bonding-curve has its own proxy (BondingCurveProxy.sol).
// Do NOT confuse this with LETSPAY_PROXY_ADDRESS (used for LetsPayHBAR).
const DEFAULT_BONDING_CURVE_PROXY_ADDRESS =
  "0x2250a1851a0829f4a16921f975c1da931a3d47fa" as const;
const DEFAULT_NEW_TOKEN_ADDRESS = "0x00000000000000000000000000000000009c5aaf" as const;
const TREASURY_ADDRESS = "0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F" as const;

function getProxyAddress(): `0x${string}` {
  return (process.env.BONDING_CURVE_PROXY_ADDRESS ??
    DEFAULT_BONDING_CURVE_PROXY_ADDRESS) as `0x${string}`;
}

function getLtpTokenAddress(): `0x${string}` {
  return (process.env.LTP_TOKEN_ADDRESS ?? DEFAULT_NEW_TOKEN_ADDRESS) as `0x${string}`;
}

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function resolveNetwork(): {
  key: NetworkKey;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: (typeof NETWORKS)[NetworkKey];
} {
  const raw = (process.env.HEDERA_NETWORK ?? "mainnet").toLowerCase();
  if (raw !== "testnet" && raw !== "mainnet") {
    throw new Error('HEDERA_NETWORK must be "testnet" or "mainnet".');
  }
  const key: NetworkKey = raw;
  const config = NETWORKS[key];

  const rpcUrl =
    process.env[config.rpcEnv] ??
    process.env.HEDERA_RPC_URL ??
    process.env.HEDERA_MAINNET_RPC_URL;
  if (!rpcUrl) {
    throw new Error(`Set ${config.rpcEnv} (or HEDERA_RPC_URL) for RPC endpoint.`);
  }

  // For upgrades: use MAINNET_PRIVATE_KEY (owner) for old implementations with owner-based access,
  // or TREASURY_KEY for new implementations with TREASURY-based access
  // Try MAINNET_PRIVATE_KEY first (owner), then fallback to TREASURY_KEY
  let privateKey: `0x${string}` | undefined;
  
  // First try MAINNET_PRIVATE_KEY (owner for old implementations)
  const mainnetKey = process.env.HEDERA_MAINNET_PRIVATE_KEY;
  if (mainnetKey) {
    privateKey = (mainnetKey.startsWith("0x") 
      ? mainnetKey 
      : `0x${mainnetKey}`) as `0x${string}`;
  }
  
  // Fallback to TREASURY_KEY (for new implementations)
  if (!privateKey) {
    const treasuryKey = process.env.HEDERA_TREASURY_KEY;
    if (treasuryKey) {
      privateKey = (treasuryKey.startsWith("0x") 
        ? treasuryKey 
        : `0x${treasuryKey}`) as `0x${string}`;
    }
  }
  
  // Final fallback to deployer key
  if (!privateKey) {
    privateKey = (process.env[config.keyEnv] ??
      process.env.HEDERA_PRIVATE_KEY) as `0x${string}` | undefined;
  }
  
  if (!privateKey) {
    throw new Error(
      `Set HEDERA_MAINNET_PRIVATE_KEY (owner) or HEDERA_TREASURY_KEY (treasury) with the funded EVM private key.`
    );
  }

  return { key, rpcUrl, privateKey, config };
}

function loadArtifact(name: string) {
  const artifactPath = join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    `${name}.sol`,
    `${name}.json`
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!artifact.abi || !artifact.bytecode) {
    throw new Error(`Artifact ${name} missing abi or bytecode.`);
  }
  return artifact as { abi: any; bytecode: `0x${string}` };
}

async function getImplementationAddress(
  publicClient: any,
  proxyAddress: `0x${string}`
): Promise<`0x${string}`> {
  const storage = await publicClient.getStorageAt({
    address: proxyAddress,
    slot: IMPLEMENTATION_SLOT as `0x${string}`,
  });
  // Storage is 32 bytes, address is last 20 bytes (40 hex chars)
  const address = ("0x" + storage.slice(-40)) as `0x${string}`;
  return address;
}

async function main() {
  const proxyAddress = getProxyAddress();
  const ltpToken = getLtpTokenAddress();
  const { key, rpcUrl, privateKey, config } = resolveNetwork();
  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: `hedera-${key}`,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  const implementationArtifact = loadArtifact("LetsPayBondingCurve");

  console.log("\nUpgrading LetsPayBondingCurve Proxy");
  console.log("====================================");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Operator:          ${account.address}`);
  console.log(`Balance:           ${formatEther(balance)} HBAR`);
  console.log(`Proxy Address:     ${proxyAddress}`);
  console.log(`Treasury Address:  ${TREASURY_ADDRESS}`);
  console.log(`LTP Token Address: ${ltpToken}`);

  // Step 1: Check current implementation
  console.log("\n[1/4] Checking current implementation...");
  const currentImpl = await getImplementationAddress(publicClient, proxyAddress);
  console.log(`Current Implementation: ${currentImpl}`);

  // Step 2: Verify operator is TREASURY
  console.log("\n[2/4] Verifying operator permissions...");
  if (account.address.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    console.warn(
      `⚠️  WARNING: Operator (${account.address}) is not TREASURY (${TREASURY_ADDRESS})`
    );
    console.warn("The upgrade will fail if TREASURY is required for upgradeTo()");
  } else {
    console.log("✅ Operator is TREASURY - can perform upgrade");
  }

  // Step 3: Deploy new implementation
  console.log("\n[3/4] Deploying new implementation...");
  const implHash = await walletClient.deployContract({
    abi: implementationArtifact.abi,
    bytecode: implementationArtifact.bytecode,
    args: [],
    account,
  });

  console.log("   Awaiting implementation deployment receipt...");
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
  const newImplAddress = implReceipt.contractAddress;
  if (!newImplAddress) {
    throw new Error("Implementation deployment failed - no contract address");
  }
  console.log(`   ✅ New Implementation deployed at: ${newImplAddress}`);

  // Step 4: Upgrade proxy
  // Check if current implementation requires TREASURY (new) or owner (old)
  // If current impl is the new one (requires TREASURY), use TREASURY key
  console.log("\n[4/4] Upgrading proxy to new implementation...");
  
  // Try to determine if we need TREASURY or owner
  // Since we're upgrading from a new implementation, it likely requires TREASURY
  let upgradeAccount = account;
  let upgradeWalletClient = walletClient;
  
  // If operator is not TREASURY, try to use TREASURY key for upgrade
  if (account.address.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    const treasuryKey = process.env.HEDERA_TREASURY_KEY;
    if (treasuryKey) {
      const treasuryKeyFormatted = (treasuryKey.startsWith("0x") 
        ? treasuryKey 
        : `0x${treasuryKey}`) as `0x${string}`;
      upgradeAccount = privateKeyToAccount(treasuryKeyFormatted);
      upgradeWalletClient = createWalletClient({
        account: upgradeAccount,
        chain,
        transport: http(rpcUrl),
      });
      console.log(`   Using TREASURY account for upgrade: ${upgradeAccount.address}`);
    }
  }
  
  const upgradeHash = await upgradeWalletClient.writeContract({
    address: proxyAddress,
    abi: implementationArtifact.abi,
    functionName: "upgradeTo",
    args: [newImplAddress],
    account: upgradeAccount,
  });

  console.log("   Awaiting upgrade transaction receipt...");
  const upgradeReceipt = await publicClient.waitForTransactionReceipt({ hash: upgradeHash });
  console.log(`   ✅ Upgrade transaction confirmed: ${upgradeHash}`);

  // Verify upgrade
  const verifiedImpl = await getImplementationAddress(publicClient, proxyAddress);
  if (verifiedImpl.toLowerCase() !== newImplAddress.toLowerCase()) {
    throw new Error(
      `Upgrade verification failed! Expected ${newImplAddress}, got ${verifiedImpl}`
    );
  }
  console.log(`   ✅ Verified: Proxy now points to ${verifiedImpl}`);

  // Step 5: Update LTP token address (optional - only if different)
  // Note: After upgrade, admin functions require TREASURY, not owner
  console.log("\n[5/5] Checking if LTP token update is needed...");
  const currentToken = await publicClient.readContract({
    address: proxyAddress,
    abi: implementationArtifact.abi,
    functionName: "LTP_TOKEN",
  });

  if (currentToken.toLowerCase() !== ltpToken.toLowerCase()) {
    console.log(`   Current token: ${currentToken}`);
    console.log(`   New token:     ${ltpToken}`);
    console.log("   Updating LTP token address...");
    console.log("   Note: Using TREASURY key for admin functions (new implementation requirement)");
    
    // Switch to TREASURY key for admin functions after upgrade
    const treasuryKey = process.env.HEDERA_TREASURY_KEY;
    let treasuryAccount = account;
    let treasuryWalletClient = walletClient;
    
    if (treasuryKey) {
      const treasuryKeyFormatted = (treasuryKey.startsWith("0x") 
        ? treasuryKey 
        : `0x${treasuryKey}`) as `0x${string}`;
      treasuryAccount = privateKeyToAccount(treasuryKeyFormatted);
      treasuryWalletClient = createWalletClient({
        account: treasuryAccount,
        chain,
        transport: http(rpcUrl),
      });
      console.log(`   Using TREASURY account: ${treasuryAccount.address}`);
    } else {
      console.warn("   ⚠️  HEDERA_TREASURY_KEY not set - admin function will fail");
    }
    
    const updateTokenHash = await treasuryWalletClient.writeContract({
      address: proxyAddress,
      abi: implementationArtifact.abi,
      functionName: "updateLTPToken",
      args: [ltpToken],
      account: treasuryAccount,
    });

    console.log("   Awaiting update token transaction receipt...");
    const updateTokenReceipt = await publicClient.waitForTransactionReceipt({
      hash: updateTokenHash,
    });
    console.log(`   ✅ Token update transaction confirmed: ${updateTokenHash}`);

    // Verify token update
    const updatedToken = await publicClient.readContract({
      address: proxyAddress,
      abi: implementationArtifact.abi,
      functionName: "LTP_TOKEN",
    });

    if (updatedToken.toLowerCase() !== ltpToken.toLowerCase()) {
      throw new Error(
        `Token update verification failed! Expected ${ltpToken}, got ${updatedToken}`
      );
    }
    console.log(`   ✅ Verified: LTP_TOKEN is now ${updatedToken}`);
  } else {
    console.log(`   ✅ LTP token already set to ${currentToken} - no update needed`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Upgrade Complete ✅");
  console.log("=".repeat(50));
  console.log(`Proxy Address:        ${proxyAddress}`);
  console.log(`Old Implementation:   ${currentImpl}`);
  console.log(`New Implementation:   ${newImplAddress}`);
  console.log(`LTP Token Address:    ${ltpToken}`);
  console.log(`Implementation tx:    ${implHash}`);
  console.log(`Upgrade tx:           ${upgradeHash}`);
  console.log(
    "\nThe bonding curve proxy has been upgraded with the new implementation."
  );
}

main().catch((error) => {
  console.error("Upgrade failed:", error);
  process.exit(1);
});
