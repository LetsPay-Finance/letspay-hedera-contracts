import {
  createPublicClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PROXY_ADDRESS = (process.env.LETSPAY_PROXY_ADDRESS ??
  "0xD4444b42a77bE392B87c243A3e8e0AC37D356B6F") as `0x${string}`;

const NETWORKS = {
  testnet: {
    chainId: 296,
    name: "Hedera Testnet",
    rpcEnv: "HEDERA_RPC_URL",
  },
  mainnet: {
    chainId: 295,
    name: "Hedera Mainnet",
    rpcEnv: "HEDERA_MAINNET_RPC_URL",
  },
} as const;

async function main() {
  const networkKey = (process.env.HEDERA_NETWORK ?? "mainnet").toLowerCase() as keyof typeof NETWORKS;
  const config = NETWORKS[networkKey];
  const rpcUrl = process.env[config.rpcEnv] ?? process.env.HEDERA_RPC_URL ?? process.env.HEDERA_MAINNET_RPC_URL;
  
  if (!rpcUrl) {
    throw new Error(`Set ${config.rpcEnv} for RPC endpoint.`);
  }

  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: `hedera-${networkKey}`,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log("Checking owner storage for proxy:", PROXY_ADDRESS);
  console.log("Network:", config.name);
  
  const OWNER_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const ownerStorage = await publicClient.getStorageAt({
    address: PROXY_ADDRESS,
    slot: OWNER_SLOT,
  });
  
  const ownerFromStorage = ("0x" + ownerStorage.slice(-40)) as `0x${string}`;
  console.log("\nOwner from storage slot 1:", ownerFromStorage);
  
  const artifactPath = require("path").join(__dirname, "..", "artifacts", "contracts", "LetsPayHBAR_V1_UUPS.sol", "LetsPayHBAR_V1_UUPS.json");
  const artifact = JSON.parse(require("fs").readFileSync(artifactPath, "utf8"));
  
  const { getContract } = await import("viem");
  const proxyContract = getContract({
    address: PROXY_ADDRESS,
    abi: artifact.abi,
    client: { public: publicClient },
  });
  
  try {
    const ownerFromFunction = await proxyContract.read.owner();
    console.log("Owner from owner() function:", ownerFromFunction);
  } catch (error: any) {
    console.log("Error calling owner():", error.message);
  }
}

main().catch(console.error);
