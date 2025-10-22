import { createWalletClient, createPublicClient, http, parseEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const contractArtifact = JSON.parse(
  readFileSync(join(__dirname, '../artifacts/contracts/LetsPayHBAR_V1_UUPS.sol/LetsPayHBAR_V1_UUPS.json'), 'utf-8')
);

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
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  const rpcUrl = process.env.HEDERA_RPC_URL;

  if (!privateKey || !rpcUrl) {
    throw new Error('HEDERA_PRIVATE_KEY and HEDERA_RPC_URL must be set in environment variables');
  }

  // Proxy contract address to fund
  const proxyAddress = '0xea700d3e8b8A076a390FBB8155B4834d1e3d6895';
  
  // Amount to send: 10 HBAR
  const amount = parseEther('10');

  // Create account from private key
  const account = privateKeyToAccount(privateKey as `0x${string}`);

  // Create public client for reading blockchain data
  const publicClient = createPublicClient({
    chain: hederaTestnet,
    transport: http(rpcUrl),
  });

  // Create wallet client for sending transactions
  const walletClient = createWalletClient({
    account,
    chain: hederaTestnet,
    transport: http(rpcUrl),
  });

  console.log(`Funding proxy contract at ${proxyAddress} with 10 HBAR...`);
  console.log(`From account: ${account.address}`);

  // Check sender balance before transaction
  const balanceBefore = await publicClient.getBalance({ 
    address: account.address 
  });
  console.log(`Sender balance before: ${Number(balanceBefore) / 1e18} HBAR`);

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

  // Check balances after transaction
  const balanceAfter = await publicClient.getBalance({ 
    address: account.address 
  });
  const proxyBalance = await publicClient.getBalance({ 
    address: proxyAddress as `0x${string}`
  });

  console.log(`\nSender balance after: ${Number(balanceAfter) / 1e18} HBAR`);
  console.log(`Proxy balance: ${Number(proxyBalance) / 1e18} HBAR`);
  console.log(`Gas used: ${receipt.gasUsed} units`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

