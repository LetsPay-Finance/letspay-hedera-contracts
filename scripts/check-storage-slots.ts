import {
  createPublicClient,
  defineChain,
  http,
} from "viem";

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

// Calculate storage slots for arrays
// In Solidity, arrays are stored starting at keccak256(slot)
// For uint256[5] at slot 2 (after tokensSold=0, paused=1), tierThresholds starts at keccak256(2)
// tierPrices would be at the next slot after tierThresholds

function keccak256Slot(slot: number): string {
  // This is a simplified version - actual calculation requires keccak256
  // For demonstration, we'll read the actual storage
  return `0x${slot.toString(16).padStart(64, '0')}`;
}

async function main() {
  console.log("Checking Storage Slots in Proxy");
  console.log("===============================");
  console.log(`Proxy Address: ${PROXY_ADDRESS}\n`);

  console.log("Storage Layout:");
  console.log("Slot 0: tokensSold (uint256)");
  console.log("Slot 1: paused (bool)");
  console.log("Slot 2: arraysInitialized (bool) - NEW");
  console.log("Slot 3-7: tierThresholds[5] (uint256[5])");
  console.log("Slot 8-12: tierPrices[5] (uint256[5])");
  console.log("\nNote: In proxy pattern, storage is in the PROXY contract, not implementation!\n");

  // Read some storage slots directly
  console.log("Reading storage slots directly:");
  
  try {
    // Slot 0: tokensSold
    const slot0 = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    });
    console.log(`Slot 0 (tokensSold): ${slot0}`);
    
    // Slot 1: paused
    const slot1 = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: "0x0000000000000000000000000000000000000000000000000000000000000001",
    });
    console.log(`Slot 1 (paused): ${slot1}`);
    
    // Slot 2: arraysInitialized (or tierThresholds[0] in old version)
    const slot2 = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: "0x0000000000000000000000000000000000000000000000000000000000000002",
    });
    console.log(`Slot 2: ${slot2}`);
    
    // Slot 3: tierThresholds[1] or tierPrices[0]
    const slot3 = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: "0x0000000000000000000000000000000000000000000000000000000000000003",
    });
    console.log(`Slot 3: ${slot3}`);
    
    // Slot 8: tierPrices[0] (if arrays are sequential)
    const slot8 = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: "0x0000000000000000000000000000000000000000000000000000000000000008",
    });
    console.log(`Slot 8: ${slot8}`);
    
    // Implementation slot
    const implSlot = await publicClient.getStorageAt({
      address: PROXY_ADDRESS,
      slot: IMPLEMENTATION_SLOT as `0x${string}`,
    });
    const implAddress = "0x" + implSlot.slice(-40);
    console.log(`\nImplementation slot: ${implAddress}`);
    
  } catch (error: any) {
    console.error("Error reading storage:", error.message);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Key Point:");
  console.log("==========");
  console.log("In a proxy pattern:");
  console.log("  - Storage variables are stored in the PROXY contract");
  console.log("  - The implementation contract's storage initialization");
  console.log("    (like uint256[5] public tierPrices = [...])");
  console.log("    ONLY applies when deployed directly, NOT through proxy");
  console.log("  - Proxy storage starts empty (all zeros)");
  console.log("  - Arrays need to be explicitly initialized via a function call");
  console.log("  - That's why tierPrices was all zeros - never initialized!");
}

main().catch(console.error);
