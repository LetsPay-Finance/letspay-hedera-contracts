import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  getContract,
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

const PROXY_ADDRESS = (process.env.LETSPAY_PROXY_ADDRESS ??
  "0xea700d3e8b8A076a390FBB8155B4834d1e3d6895") as `0x${string}`;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

function resolveNetwork(): {
  key: NetworkKey;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: (typeof NETWORKS)[NetworkKey];
} {
  const raw = (process.env.HEDERA_NETWORK ?? "testnet").toLowerCase();
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
    "LetsPayHBAR_V1_UUPS.sol",
    "LetsPayHBAR_V1_UUPS.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!artifact.abi || !artifact.bytecode) {
    throw new Error("Artifact missing abi or bytecode.");
  }
  return artifact as { abi: any; bytecode: `0x${string}` };
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

  console.log("Deploying updated V1 implementation and upgrading proxy");
  console.log("Network:", config.name);
  console.log("Account:", account.address);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Account balance:", formatEther(balance), "HBAR");

  console.log("\n📋 Current Setup:");
  console.log("Proxy Address:", PROXY_ADDRESS);

  const artifact = loadArtifact();

  console.log("\n🚀 Deploying updated V1 Implementation...");
  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    account,
  });

  console.log("Deployment transaction hash:", deployHash);
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const v1Address = deployReceipt.contractAddress;
  
  if (!v1Address) {
    throw new Error("Deployment failed - no contract address in receipt");
  }
  
  console.log("✅ Updated V1 Implementation deployed to:", v1Address);

  console.log("\n🔍 Verifying current proxy implementation...");
  const currentImpl = await publicClient.getStorageAt({
    address: PROXY_ADDRESS,
    slot: IMPLEMENTATION_SLOT,
  });
  const currentImplAddress = ("0x" + currentImpl.slice(-40)) as `0x${string}`;
  console.log("Current Implementation (from storage):", currentImplAddress);

  const proxyContract = getContract({
    address: PROXY_ADDRESS,
    abi: artifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const owner = await proxyContract.read.owner();
  console.log("Proxy Owner (from owner()):", owner);
  
  const OWNER_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const ownerStorage = await publicClient.getStorageAt({
    address: PROXY_ADDRESS,
    slot: OWNER_SLOT,
  });
  const ownerFromStorage = ("0x" + ownerStorage.slice(-40)) as `0x${string}`;
  console.log("Owner from storage slot 1:", ownerFromStorage);
  
  console.log("Deployer Address:", account.address);
  
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.warn("⚠️  WARNING: Deployer address doesn't match owner from owner() function.");
    console.warn("   Owner from function:", owner);
    console.warn("   Deployer address:", account.address);
    console.warn("   Attempting upgrade anyway...");
  }

  console.log("\n⬆️  Upgrading proxy to updated V1...");
  const upgradeData = encodeFunctionData({
    abi: artifact.abi,
    functionName: "upgradeTo",
    args: [v1Address],
  });

  try {
    const upgradeHash = await walletClient.sendTransaction({
      to: PROXY_ADDRESS,
      data: upgradeData,
      account,
    });
    
    console.log("Upgrade transaction hash:", upgradeHash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: upgradeHash });
    
    if (receipt.status === "success") {
      console.log("✅ Upgrade transaction confirmed!");
    } else {
      console.error("❌ Upgrade transaction failed!");
      return;
    }
  } catch (error: any) {
    console.error("❌ Upgrade failed with error:", error.message);
    if (error.message?.includes("owner only") || error.message?.includes("owner")) {
      console.error("\n💡 The deployer account is not the owner of the proxy.");
      console.error("   Owner from contract:", owner);
      console.error("   You need to call upgradeTo() from the owner account.");
    }
    throw error;
  }

  console.log("\n🔍 Verifying upgrade...");
  const newImpl = await publicClient.getStorageAt({
    address: PROXY_ADDRESS,
    slot: IMPLEMENTATION_SLOT,
  });
  const newImplAddress = ("0x" + newImpl.slice(-40)) as `0x${string}`;
  console.log("New Implementation (from storage):", newImplAddress);

  if (newImplAddress.toLowerCase() !== v1Address.toLowerCase()) {
    console.error("❌ ERROR: Implementation address mismatch!");
    return;
  }

  console.log("\n🧪 Testing updated contract...");
  const updatedProxy = getContract({
    address: PROXY_ADDRESS,
    abi: artifact.abi,
    client: { public: publicClient },
  });
  
  try {
    const credit = await updatedProxy.read.CREDIT();
    console.log("CREDIT constant:", credit.toString());
    
    const escrowCount = await updatedProxy.read.escrowCount();
    console.log("Escrow Count:", escrowCount.toString());
    
    console.log("✅ Updated V1 upgrade verified successfully!");
  } catch (error: any) {
    console.log("⚠️  Warning: Could not verify contract:", error.message);
  }

  console.log("\n🎉 Upgrade Complete!");
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("Updated V1 Implementation:", v1Address);
}

main().catch((error) => {
  console.error("Upgrade failed:", error);
  process.exit(1);
});
