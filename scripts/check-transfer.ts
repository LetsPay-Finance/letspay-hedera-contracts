import {
  createPublicClient,
  defineChain,
  http,
} from "viem";

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

const txHash = "0x820dd99483bb6748d45cbeda9660dddabaea0644b768b2af0458f95589556c58";

async function main() {
  console.log("Checking transaction:", txHash);
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  console.log("\nTransaction Receipt:");
  console.log("Status:", receipt.status);
  console.log("Block Number:", receipt.blockNumber);
  console.log("Gas Used:", receipt.gasUsed?.toString());
  console.log("Logs:", receipt.logs.length);
  
  if (receipt.logs.length > 0) {
    console.log("\nLogs:");
    receipt.logs.forEach((log, i) => {
      console.log(`  [${i}] Address: ${log.address}`);
      console.log(`      Topics: ${log.topics.length}`);
      console.log(`      Data: ${log.data}`);
    });
  }
}

main().catch(console.error);
