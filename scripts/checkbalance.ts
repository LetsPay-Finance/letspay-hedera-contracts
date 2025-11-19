import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem';

// Define Hedera Testnet chain
const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  network: 'hedera-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'HBAR',
    symbol: 'HBAR',
  },
  rpcUrls: {
    default: {
      http: [process.env.HEDERA_RPC_URL || ''],
    },
    public: {
      http: [process.env.HEDERA_RPC_URL || ''],
    },
  },
});

async function main() {
  // Get environment variables
  const rpcUrl = process.env.HEDERA_RPC_URL;

  if (!rpcUrl) {
    throw new Error('HEDERA_RPC_URL must be set in environment variables');
  }

  // Proxy contract address
  const proxyAddress = '0xea700d3e8b8A076a390FBB8155B4834d1e3d6895';

  // Create public client for reading blockchain data
  const publicClient = createPublicClient({
    chain: hederaTestnet,
    transport: http(rpcUrl),
  });

  console.log(`Checking balance for proxy contract: ${proxyAddress}\n`);

  // Check the EVM balance
  const evmBalance = await publicClient.getBalance({ address: proxyAddress as `0x${string}` });
  console.log("EVM Balance (HBAR):", Number(evmBalance) / 1e18);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });





