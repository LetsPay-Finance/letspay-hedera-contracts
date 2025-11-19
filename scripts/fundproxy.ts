import { createWalletClient, createPublicClient, http, parseEther, getContract, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractArtifact = JSON.parse(
  readFileSync(join(__dirname, '../artifacts/contracts/LetsPayHBAR_V1_UUPS.sol/LetsPayHBAR_V1_UUPS.json'), 'utf-8')
);

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

function resolveChain(): { chain: SupportedChain; rpcUrl: string; privateKey: `0x${string}` } {
  const chainEnvRaw = (process.env.HEDERA_NETWORK ?? 'testnet').toLowerCase();
  const isSupportedChain = (value: string): value is SupportedChain => value in CHAINS;

  if (!isSupportedChain(chainEnvRaw)) {
    throw new Error(`Unsupported Hedera network "${chainEnvRaw}". Use "testnet" or "mainnet".`);
  }
  const chainEnv = chainEnvRaw;

  const rpcEnvKey = chainEnv === 'mainnet' ? 'HEDERA_MAINNET_RPC_URL' : 'HEDERA_RPC_URL';
  const pkEnvKey = chainEnv === 'mainnet' ? 'HEDERA_MAINNET_PRIVATE_KEY' : 'HEDERA_PRIVATE_KEY';

  const rpcUrl = process.env[rpcEnvKey] ?? process.env.HEDERA_RPC_URL;
  const privateKey = process.env[pkEnvKey] ?? process.env.HEDERA_PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error(`Set ${rpcEnvKey} (or HEDERA_RPC_URL) to point at the desired Hedera RPC endpoint.`);
  }

  if (!privateKey) {
    throw new Error(`Set ${pkEnvKey} (or HEDERA_PRIVATE_KEY) with the funded EVM private key.`);
  }

  return {
    chain: chainEnv,
    rpcUrl,
    privateKey: privateKey as `0x${string}`,
  };
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  return rl.question(question).finally(() => rl.close());
}

async function promptYesNo(message: string): Promise<boolean> {
  const answer = (await prompt(`${message} (y/N): `)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
}

async function promptAmount(defaultAmount: string): Promise<string> {
  const answer = (await prompt(`Enter amount of HBAR to fund [default ${defaultAmount}]: `)).trim();
  return answer === '' ? defaultAmount : answer;
}

function buildExplorerLink(chain: SupportedChain, txHash: `0x${string}`): string {
  const base = chain === 'mainnet' ? 'https://hashscan.io/mainnet/transaction/' : 'https://hashscan.io/testnet/transaction/';
  return `${base}${txHash}`;
}

async function main() {
  const { chain, rpcUrl, privateKey } = resolveChain();

  const proxyAddress = process.env.LETSPAY_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error('LETSPAY_PROXY_ADDRESS must be set to the ERC1967 proxy you want to fund.');
  }
  
  const defaultAmount = process.env.LETSPAY_FUND_AMOUNT ?? '10';
  const amountInHbar = await promptAmount(defaultAmount);

  if (Number.isNaN(Number(amountInHbar)) || Number(amountInHbar) <= 0) {
    throw new Error(`Invalid funding amount "${amountInHbar}". Provide a positive numeric value.`);
  }

  const amount = parseEther(amountInHbar);

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

  // Create account from private key
  const account = privateKeyToAccount(privateKey);

  // Create public client for reading blockchain data
  const publicClient = createPublicClient({
    chain: hederaChain,
    transport: http(rpcUrl),
  });

  // Create wallet client for sending transactions
  const walletClient = createWalletClient({
    account,
    chain: hederaChain,
    transport: http(rpcUrl),
  });

  // Check balances before transaction
  const balanceBefore = await publicClient.getBalance({
    address: account.address,
  });
  const proxyBalanceBefore = await publicClient.getBalance({
    address: proxyAddress as `0x${string}`,
  });

  console.log(`\nNetwork: Hedera ${chain} (${CHAINS[chain].name})`);
  console.log(`[1/5] Proxy balance (before): ${formatEther(proxyBalanceBefore)} HBAR`);
  console.log(`[2/5] Operator balance (before): ${formatEther(balanceBefore)} HBAR`);
  console.log(`[3/5] Planned funding amount: ${amountInHbar} HBAR from ${account.address} to ${proxyAddress}\n`);

  const shouldProceed = await promptYesNo('[4/5] Proceed with funding transaction?');
  if (!shouldProceed) {
    console.log('Funding cancelled by user.');
    process.exit(0);
  }

  console.log(`\nSubmitting transaction on Hedera ${chain}...`);

  // Get contract instance
  const contract = getContract({
    address: proxyAddress as `0x${string}`,
    abi: contractArtifact.abi,
    client: { public: publicClient, wallet: walletClient },
  });

  // Call fundContract method with 10 HBAR
  const hash = await contract.write.fundContract([], {
    value: amount,
  });

  console.log(`Transaction submitted: ${hash}`);
  console.log('Waiting for confirmation...');

  // Wait for transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 'success' ? '✅ Success' : '❌ Failed'}`);
  console.log(`Explorer link: ${buildExplorerLink(chain, hash)}`);

  // Check balances after transaction
  const balanceAfter = await publicClient.getBalance({ 
    address: account.address 
  });
  const proxyBalance = await publicClient.getBalance({ 
    address: proxyAddress as `0x${string}`
  });

  console.log(`\n[5/5] Final balances:`);
  console.log(`   Operator: ${formatEther(balanceAfter)} HBAR`);
  console.log(`   Proxy:    ${formatEther(proxyBalance)} HBAR`);
  console.log(`Gas used: ${receipt.gasUsed} units`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

