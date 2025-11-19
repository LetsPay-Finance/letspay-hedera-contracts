import { createPublicClient, formatEther, http } from 'viem';
import { defineChain } from 'viem';

const CHAINS = {
  testnet: {
    id: 296,
    name: 'Hedera Testnet',
    network: 'hedera-testnet',
  },
  mainnet: {
    id: 295,
    name: 'Hedera Mainnet',
    network: 'hedera-mainnet',
  },
} as const;

type SupportedChain = keyof typeof CHAINS;

function resolveChain(): { chain: SupportedChain; rpcUrl: string } {
  const chainEnvRaw = (process.env.HEDERA_NETWORK ?? 'testnet').toLowerCase();
  const isSupportedChain = (value: string): value is SupportedChain => value in CHAINS;

  if (!isSupportedChain(chainEnvRaw)) {
    throw new Error(`Unsupported Hedera network "${chainEnvRaw}". Use "testnet" or "mainnet".`);
  }
  const chainEnv = chainEnvRaw;

  const rpcEnvKey = chainEnv === 'mainnet' ? 'HEDERA_MAINNET_RPC_URL' : 'HEDERA_RPC_URL';
  const rpcUrl = process.env[rpcEnvKey] ?? process.env.HEDERA_RPC_URL;

  if (!rpcUrl) {
    throw new Error(`Set ${rpcEnvKey} (or HEDERA_RPC_URL) to point at the desired Hedera RPC endpoint.`);
  }

  return {
    chain: chainEnv,
    rpcUrl,
  };
}

async function main() {
  const { chain, rpcUrl } = resolveChain();
  const proxyAddress = process.env.LETSPAY_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error('LETSPAY_PROXY_ADDRESS must be set to the ERC1967 proxy you want to inspect.');
  }

  const hederaChain = defineChain({
    ...CHAINS[chain],
    nativeCurrency: {
      decimals: 18,
      name: 'HBAR',
      symbol: 'HBAR',
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
      public: {
        http: [rpcUrl],
      },
    },
  });

  // Create public client for reading blockchain data
  const publicClient = createPublicClient({
    chain: hederaChain,
    transport: http(rpcUrl),
  });

  console.log(`Checking balance for proxy contract: ${proxyAddress} on Hedera ${chain}\n`);

  // Check the EVM balance
  const evmBalance = await publicClient.getBalance({ address: proxyAddress as `0x${string}` });
  console.log("EVM Balance (HBAR):", formatEther(evmBalance));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });





