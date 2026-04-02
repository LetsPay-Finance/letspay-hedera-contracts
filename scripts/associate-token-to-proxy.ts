import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";

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

const HTS_ABI = [
  {
    type: "function",
    name: "associateToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "responseCode", type: "int64" }],
  },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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

async function main() {
  const proxyAddress = requireEnv("BONDING_CURVE_PROXY_ADDRESS") as `0x${string}`;
  const tokenAddress = (process.env.TOKEN_ADDRESS ?? requireEnv("TOKEN_ADDRESS")) as `0x${string}`;

  const { key, rpcUrl, privateKey, config } = resolveNetwork();
  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: `hedera-${key}`,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log("\nAssociating Token to BondingCurveProxy");
  console.log("======================================");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Operator:          ${account.address}`);
  console.log(`Proxy Address:     ${proxyAddress}`);
  console.log(`Token Address:     ${tokenAddress}\n`);

  console.log("[1/1] Associating token to proxy contract via HTS precompile...");
  
  try {
    const hash = await wallet.writeContract({
      address: HTS_PRECOMPILE,
      abi: HTS_ABI,
      functionName: "associateToken",
      args: [proxyAddress, tokenAddress],
      account,
    });

    console.log(`Transaction hash:  ${hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    console.log("\n✅ Association successful!");
    console.log(`Transaction hash:  ${hash}`);
    console.log(`Block number:      ${receipt.blockNumber}`);
    console.log(`Gas used:          ${receipt.gasUsed?.toString() ?? "N/A"}`);
    console.log(
      `\nToken ${tokenAddress} is now associated with proxy ${proxyAddress}`
    );
  } catch (error: any) {
    console.error("\n❌ Association failed:");
    if (error.message) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(error);
    }
    
    // Check if it's already associated
    if (error.message?.includes("TOKEN_ALREADY_ASSOCIATED") || 
        error.message?.includes("already associated")) {
      console.log("\nNote: Token may already be associated with the proxy.");
    }
    
    throw error;
  }
}

main().catch((error) => {
  console.error("Association failed:", error);
  process.exit(1);
});
