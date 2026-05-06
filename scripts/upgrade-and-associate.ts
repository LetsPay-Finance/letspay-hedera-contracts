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
  const implementationArtifact = loadArtifact("LetsPayBondingCurve");

  console.log("\nUpgrading Contract and Calling associate()");
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
    console.warn("The upgrade will fail if TREASURY is required for upgradeTo()");
  } else {
    console.log("\n✅ Operator is TREASURY - can perform upgrade");
  }

  // Step 1: Check current implementation
  console.log("\n[1/4] Checking current implementation...");
  const currentImpl = await getImplementationAddress(publicClient, PROXY_ADDRESS);
  console.log(`Current Implementation: ${currentImpl}`);

  // Step 2: Deploy new implementation
  console.log("\n[2/4] Deploying new implementation with associate() function...");
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

  // Step 4: Call associate() function
  console.log("\n[4/4] Calling associate() function on proxy...");
  const associateHash = await walletClient.writeContract({
    address: PROXY_ADDRESS,
    abi: implementationArtifact.abi,
    functionName: "associate",
    args: [],
    account,
  });

  console.log("   Awaiting associate transaction receipt...");
  const associateReceipt = await publicClient.waitForTransactionReceipt({
    hash: associateHash,
  });
  console.log(`   ✅ Associate transaction confirmed: ${associateHash}`);

  // Check if there are any events
  if (associateReceipt.logs.length > 0) {
    console.log(`   📋 Transaction emitted ${associateReceipt.logs.length} event(s)`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Upgrade and Association Complete ✅");
  console.log("=".repeat(50));
  console.log(`Proxy Address:        ${PROXY_ADDRESS}`);
  console.log(`Old Implementation:  ${currentImpl}`);
  console.log(`New Implementation:   ${newImplAddress}`);
  console.log(`Implementation tx:    ${implHash}`);
  console.log(`Upgrade tx:           ${upgradeHash}`);
  console.log(`Associate tx:         ${associateHash}`);
  console.log(
    "\nThe contract has been upgraded and the associate() function has been called."
  );
  console.log("The proxy contract should now be associated with the LTP token.");
}

main().catch((error) => {
  console.error("Upgrade/Association failed:", error);
  process.exit(1);
});
