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
  console.log("Checking tierPrices Array");
  console.log("=========================");
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
    // Read tierPrices array (public array, can read individual elements)
    console.log("Reading tierPrices array:");
    const expectedPrices = [
      1_000_000,   // 0.01 HBAR
      2_000_000,   // 0.02 HBAR
      4_000_000,   // 0.04 HBAR
      7_000_000,   // 0.07 HBAR
      10_000_000   // 0.10 HBAR
    ];

    const actualPrices: bigint[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        const price = await publicClient.readContract({
          address: PROXY_ADDRESS,
          abi: abi,
          functionName: "tierPrices",
          args: [BigInt(i)],
        });
        actualPrices.push(price as bigint);
        const expected = expectedPrices[i];
        const match = price === BigInt(expected) ? "✅" : "❌";
        console.log(`  Tier ${i}: ${price.toString().padStart(10)} tinybar (expected: ${expected.toLocaleString()}) ${match}`);
      } catch (error: any) {
        console.log(`  Tier ${i}: Error reading - ${error.message}`);
        actualPrices.push(0n);
      }
    }

    // Check if all prices match
    const allMatch = actualPrices.every((price, i) => price === BigInt(expectedPrices[i]));
    
    if (allMatch) {
      console.log("\n✅ All tierPrices are correctly initialized!");
    } else {
      console.log("\n❌ tierPrices array is NOT correctly initialized!");
      console.log("   The array needs to be initialized in the proxy storage.");
    }

    // Also check tierThresholds
    console.log("\nReading tierThresholds array:");
    const expectedThresholds = [
      50_000 * 100,   // 50K LTP
      100_000 * 100,  // 100K LTP
      175_000 * 100,  // 175K LTP
      250_000 * 100,  // 250K LTP
      300_000 * 100   // 300K LTP
    ];

    for (let i = 0; i < 5; i++) {
      try {
        const threshold = await publicClient.readContract({
          address: PROXY_ADDRESS,
          abi: abi,
          functionName: "tierThresholds",
          args: [BigInt(i)],
        });
        const expected = expectedThresholds[i];
        const match = threshold === BigInt(expected) ? "✅" : "❌";
        console.log(`  Tier ${i}: ${threshold.toString().padStart(10)} base units (expected: ${expected.toLocaleString()}) ${match}`);
      } catch (error: any) {
        console.log(`  Tier ${i}: Error reading - ${error.message}`);
      }
    }

  } catch (error: any) {
    console.error("Error reading contract:", error.message);
  }
}

main().catch(console.error);
