import {
  createPublicClient,
  defineChain,
  http,
} from "viem";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROXY_ADDRESS = "0x2250a1851a0829f4a16921f975c1da931a3d47fa" as const;

const rpcUrl = process.env.HEDERA_MAINNET_RPC_URL ?? "https://mainnet.hashio.io/api";
const chain = defineChain({
  id: 295,
  name: "Hedera Mainnet",
  network: "hedera-mainnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
});

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

async function main() {
  console.log("Checking Contract Token Configuration");
  console.log("=====================================");
  console.log(`Proxy Address: ${PROXY_ADDRESS}\n`);

  // Load the contract ABI
  const artifactPath = join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "LetsPayBondingCurve.sol",
    "LetsPayBondingCurve.json"
  );
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;

  try {
    // Read LTP_TOKEN from the contract
    const ltpToken = await publicClient.readContract({
      address: PROXY_ADDRESS,
      abi: abi,
      functionName: "LTP_TOKEN",
    });

    console.log(`Current LTP_TOKEN in contract: ${ltpToken}`);
    console.log(`Expected token address:        0x00000000000000000000000000000000009c5aaf`);
    
    if (ltpToken.toLowerCase() === "0x00000000000000000000000000000000009c5aaf") {
      console.log("\n✅ Contract is configured with the correct token address!");
    } else {
      console.log("\n❌ Contract is configured with a DIFFERENT token address!");
      console.log(`   Expected: 0x00000000000000000000000000000000009c5aaf`);
      console.log(`   Got:      ${ltpToken}`);
    }

    // Also check other important values
    console.log("\nOther Contract Values:");
    try {
      const tokensSold = await publicClient.readContract({
        address: PROXY_ADDRESS,
        abi: abi,
        functionName: "tokensSold",
      });
      console.log(`  tokensSold: ${tokensSold.toString()}`);
    } catch (e) {
      console.log(`  tokensSold: Error reading`);
    }

    try {
      const paused = await publicClient.readContract({
        address: PROXY_ADDRESS,
        abi: abi,
        functionName: "paused",
      });
      console.log(`  paused: ${paused}`);
    } catch (e) {
      console.log(`  paused: Error reading`);
    }

    try {
      const treasury = await publicClient.readContract({
        address: PROXY_ADDRESS,
        abi: abi,
        functionName: "TREASURY",
      });
      console.log(`  TREASURY: ${treasury}`);
    } catch (e) {
      console.log(`  TREASURY: Error reading`);
    }

  } catch (error: any) {
    console.error("Error reading contract:", error.message);
  }
}

main().catch(console.error);
