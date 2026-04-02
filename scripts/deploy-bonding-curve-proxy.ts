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

const DEFAULT_LTP_TOKEN =
  "0x00000000000000000000000000000000009c55eb" as const;

function getLtpTokenAddress(): `0x${string}` {
  return (process.env.LTP_TOKEN_ADDRESS ?? DEFAULT_LTP_TOKEN) as `0x${string}`;
}

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

  const privateKey = (process.env[config.keyEnv] ??
    process.env.HEDERA_PRIVATE_KEY ??
    process.env.HEDERA_MAINNET_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!privateKey) {
    throw new Error(
      `Set ${config.keyEnv} (or HEDERA_PRIVATE_KEY/HEDERA_MAINNET_PRIVATE_KEY) with the funded EVM private key.`
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

async function main() {
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
  const proxyArtifact = loadArtifact("BondingCurveProxy");

  console.log("\nDeploying LetsPayBondingCurve (UUPS Upgradable)");
  console.log("================================================");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Deployer:          ${account.address}`);
  console.log(`Balance:           ${formatEther(balance)} HBAR`);
  console.log(`LTP token:         ${ltpToken}`);

  // Step 1: Deploy implementation
  console.log("\n1. Deploying implementation contract...");
  const implHash = await walletClient.deployContract({
    abi: implementationArtifact.abi,
    bytecode: implementationArtifact.bytecode,
    args: [],
    account,
  });

  console.log("   Awaiting implementation deployment receipt...");
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash });
  const implAddress = implReceipt.contractAddress;
  if (!implAddress) {
    throw new Error("Implementation deployment failed - no contract address");
  }
  console.log(`   ✅ Implementation deployed at: ${implAddress}`);

  // Step 2: Encode initialize function call
  console.log("\n2. Encoding initialize function call...");
  const initData = encodeFunctionData({
    abi: implementationArtifact.abi,
    functionName: "initialize",
    args: [ltpToken],
  });
  console.log(`   ✅ Init data encoded (${initData.length} bytes)`);

  // Step 3: Deploy proxy
  console.log("\n3. Deploying proxy contract...");
  const proxyHash = await walletClient.deployContract({
    abi: proxyArtifact.abi,
    bytecode: proxyArtifact.bytecode,
    args: [implAddress, initData],
    account,
  });

  console.log("   Awaiting proxy deployment receipt...");
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash });
  const proxyAddress = proxyReceipt.contractAddress;
  if (!proxyAddress) {
    throw new Error("Proxy deployment failed - no contract address");
  }
  console.log(`   ✅ Proxy deployed at: ${proxyAddress}`);

  console.log("\n" + "=".repeat(50));
  console.log("Deployment complete ✅");
  console.log("=".repeat(50));
  console.log(`Implementation:     ${implAddress}`);
  console.log(`Proxy:              ${proxyAddress}`);
  console.log(`Use proxy address:  ${proxyAddress}`);
  console.log(`Implementation tx: ${implHash}`);
  console.log(`Proxy tx:           ${proxyHash}`);
  console.log(`Initialized with:   LTP_TOKEN = ${ltpToken}`);
  console.log(
    "\nReminder: associate the proxy contract with LTP and fund it before enabling buys."
  );
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
