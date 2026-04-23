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
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

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
  console.log("Checking Current Implementation");
  console.log("===============================");
  console.log(`Proxy Address: ${PROXY_ADDRESS}\n`);

  // Get current implementation
  const implStorage = await publicClient.getStorageAt({
    address: PROXY_ADDRESS,
    slot: IMPLEMENTATION_SLOT as `0x${string}`,
  });
  const implAddress = ("0x" + implStorage.slice(-40)) as `0x${string}`;
  console.log(`Current Implementation: ${implAddress}`);

  // Try to read code from implementation
  const code = await publicClient.getBytecode({ address: implAddress });
  console.log(`Implementation has code: ${code ? "Yes" : "No"}`);
  if (code) {
    console.log(`Code length: ${code.length} bytes`);
  }

  // Try to check if it has upgradeTo function by checking if we can call it
  // Load any LetsPayBondingCurve artifact to get ABI
  try {
    const artifactPath = join(
      __dirname,
      "..",
      "artifacts",
      "contracts",
      "LetsPayBondingCurve.sol",
      "LetsPayBondingCurveV2.json"
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const abi = artifact.abi;

    // Check if current implementation has upgradeTo
    try {
      // Try to read a simple function first
      const ltpToken = await publicClient.readContract({
        address: PROXY_ADDRESS, // Read through proxy
        abi: abi,
        functionName: "LTP_TOKEN",
      });
      console.log(`\nLTP_TOKEN (via proxy): ${ltpToken}`);
    } catch (e: any) {
      console.log(`\nError reading LTP_TOKEN: ${e.message}`);
    }

    // Check if upgradeTo exists in ABI
    const hasUpgradeTo = abi.some((item: any) => item.name === "upgradeTo");
    console.log(`\nCurrent contract ABI has upgradeTo: ${hasUpgradeTo}`);
    
    if (hasUpgradeTo) {
      console.log("✅ Contract has upgrade capability");
    } else {
      console.log("❌ Contract does NOT have upgrade capability");
      console.log("   We can still upgrade TO this contract using the old implementation's upgradeTo");
    }

  } catch (e: any) {
    console.log(`\nCould not load artifact: ${e.message}`);
  }
}

main().catch(console.error);
