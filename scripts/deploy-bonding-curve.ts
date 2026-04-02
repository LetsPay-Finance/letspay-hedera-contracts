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

function loadArtifact() {
  const artifactPath = join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "LetsPayBondingCurve.sol",
    "LetsPayBondingCurve.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!artifact.abi || !artifact.bytecode) {
    throw new Error("Artifact missing abi or bytecode.");
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
  const artifact = loadArtifact();

  console.log("\nDeploying LetsPayBondingCurve");
  console.log("-----------------------------");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Deployer:          ${account.address}`);
  console.log(`Balance:           ${formatEther(balance)} HBAR`);
  console.log(`LTP token:         ${ltpToken}`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [ltpToken],
    account,
  });

  console.log("\nAwaiting deployment receipt...");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const deployedAddress = receipt.contractAddress;

  console.log("\nDeployment complete ✅");
  console.log(`Contract address:   ${deployedAddress}`);
  console.log(`Deploy tx hash:     ${hash}`);
  console.log(`Constructor args:   [${ltpToken}]`);
  console.log(
    "Reminder: associate the contract with LTP and fund it before enabling buys."
  );
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
