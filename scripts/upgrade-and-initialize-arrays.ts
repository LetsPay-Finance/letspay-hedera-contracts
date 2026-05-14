import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
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

const PROXY_ADDRESS = "0x2250a1851a0829f4a16921f975c1da931a3d47fa" as const;
const TREASURY_ADDRESS = "0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F" as const;

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

  // Use TREASURY key for upgrades (required by contract)
  const treasuryKey = process.env.HEDERA_TREASURY_KEY;
  let privateKey: `0x${string}` | undefined;

  if (treasuryKey) {
    privateKey = (treasuryKey.startsWith("0x")
      ? treasuryKey
      : `0x${treasuryKey}`) as `0x${string}`;
  } else {
    privateKey = (process.env[config.keyEnv] ??
      process.env.HEDERA_PRIVATE_KEY ??
      process.env.HEDERA_MAINNET_PRIVATE_KEY) as `0x${string}` | undefined;
  }

  if (!privateKey) {
    throw new Error(
      `Set HEDERA_TREASURY_KEY (or ${config.keyEnv}) with the funded EVM private key.`
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
  const address = ("0x" + storage.slice(-40)) as `0x${string}`;
  return address;
}

async function main() {
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
  // Contract name is LetsPayBondingCurveV2 but artifact might be LetsPayBondingCurve
  let implementationArtifact;
  try {
    implementationArtifact = loadArtifact("LetsPayBondingCurve");
  } catch {
    implementationArtifact = loadArtifact("LetsPayBondingCurveV2");
  }

  console.log("\nUpgrading Contract and Initializing Arrays");
  console.log("===========================================");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Operator:          ${account.address}`);
  console.log(`Balance:           ${formatEther(balance)} HBAR`);
  console.log(`Proxy Address:     ${PROXY_ADDRESS}`);
  console.log(`Treasury Address:  ${TREASURY_ADDRESS}`);

  // Verify operator is TREASURY
  if (account.address.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    console.warn(
      `\n⚠️  WARNING: Operator (${account.address}) is not TREASURY (${TREASURY_ADDRESS})`
    );
    console.warn("The upgrade will fail if TREASURY is required");
  } else {
    console.log("\n✅ Operator is TREASURY - can perform upgrade");
  }

  // Expected values
  const TOKEN_DECIMALS = 100;
  const expectedThresholds = [
    50_000 * TOKEN_DECIMALS,
    100_000 * TOKEN_DECIMALS,
    175_000 * TOKEN_DECIMALS,
    250_000 * TOKEN_DECIMALS,
    300_000 * TOKEN_DECIMALS
  ];
  const expectedPrices = [
    1_000_000,   // 0.01 HBAR
    2_000_000,   // 0.02 HBAR
    4_000_000,   // 0.04 HBAR
    7_000_000,   // 0.07 HBAR
    10_000_000   // 0.10 HBAR
  ];

  console.log("\nExpected Array Values:");
  console.log("tierThresholds:", expectedThresholds.map(t => t.toLocaleString()).join(", "));
  console.log("tierPrices:", expectedPrices.map(p => p.toLocaleString()).join(", "));

  // Step 1: Check current implementation
  console.log("\n[1/4] Checking current implementation...");
  const currentImpl = await getImplementationAddress(publicClient, PROXY_ADDRESS);
  console.log(`Current Implementation: ${currentImpl}`);

  // Step 2: Deploy new implementation
  console.log("\n[2/4] Deploying new implementation with initializeArrays() function...");
  const implHash = await walletClient.deployContract({
    abi: implementationArtifact.abi,
    bytecode: implementationArtifact.bytecode,
    args: [], // Constructor takes no args in current version
    account,
  });

  console.log("   Awaiting implementation deployment receipt...");
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
  const newImplAddress = implReceipt.contractAddress;
  if (!newImplAddress) {
    throw new Error("Implementation deployment failed - no contract address");
  }
  console.log(`   ✅ New Implementation deployed at: ${newImplAddress}`);

  // Step 3: Upgrade proxy
  console.log("\n[3/4] Upgrading proxy to new implementation...");
  const upgradeHash = await walletClient.writeContract({
    address: PROXY_ADDRESS,
    abi: implementationArtifact.abi,
    functionName: "upgradeTo",
    args: [newImplAddress],
    account,
  });

  console.log("   Awaiting upgrade transaction receipt...");
  const upgradeReceipt = await publicClient.waitForTransactionReceipt({ hash: upgradeHash });
  console.log(`   ✅ Upgrade transaction confirmed: ${upgradeHash}`);

  // Verify upgrade
  const verifiedImpl = await getImplementationAddress(publicClient, PROXY_ADDRESS);
  if (verifiedImpl.toLowerCase() !== newImplAddress.toLowerCase()) {
    throw new Error(
      `Upgrade verification failed! Expected ${newImplAddress}, got ${verifiedImpl}`
    );
  }
  console.log(`   ✅ Verified: Proxy now points to ${verifiedImpl}`);

  // Step 4: Call initializeArrays() function
  console.log("\n[4/4] Calling initializeArrays() function on proxy...");
  const initHash = await walletClient.writeContract({
    address: PROXY_ADDRESS,
    abi: implementationArtifact.abi,
    functionName: "initializeArrays",
    args: [],
    account,
  });

  console.log("   Awaiting initializeArrays transaction receipt...");
  const initReceipt = await publicClient.waitForTransactionReceipt({
    hash: initHash,
  });
  console.log(`   ✅ InitializeArrays transaction confirmed: ${initHash}`);

  // Verify arrays are initialized
  console.log("\n[5/5] Verifying arrays are initialized...");
  for (let i = 0; i < 5; i++) {
    const threshold = await publicClient.readContract({
      address: PROXY_ADDRESS,
      abi: implementationArtifact.abi,
      functionName: "tierThresholds",
      args: [BigInt(i)],
    });
    const price = await publicClient.readContract({
      address: PROXY_ADDRESS,
      abi: implementationArtifact.abi,
      functionName: "tierPrices",
      args: [BigInt(i)],
    });
    
    const thresholdMatch = threshold === BigInt(expectedThresholds[i]) ? "✅" : "❌";
    const priceMatch = price === BigInt(expectedPrices[i]) ? "✅" : "❌";
    
    console.log(`  Tier ${i}:`);
    console.log(`    tierThresholds[${i}]: ${threshold.toString().padStart(10)} ${thresholdMatch} (expected: ${expectedThresholds[i].toLocaleString()})`);
    console.log(`    tierPrices[${i}]:    ${price.toString().padStart(10)} ${priceMatch} (expected: ${expectedPrices[i].toLocaleString()})`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Upgrade and Initialization Complete ✅");
  console.log("=".repeat(50));
  console.log(`Proxy Address:        ${PROXY_ADDRESS}`);
  console.log(`Old Implementation:  ${currentImpl}`);
  console.log(`New Implementation:   ${newImplAddress}`);
  console.log(`Implementation tx:    ${implHash}`);
  console.log(`Upgrade tx:           ${upgradeHash}`);
  console.log(`InitializeArrays tx:  ${initHash}`);
  console.log(
    "\nThe contract has been upgraded and arrays have been initialized with the correct values."
  );
}

main().catch((error) => {
  console.error("Upgrade/Initialization failed:", error);
  process.exit(1);
});
