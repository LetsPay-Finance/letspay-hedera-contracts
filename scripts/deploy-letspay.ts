import {
  createPublicClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  formatEther,
  getContractAddress,
  http,
} from 'viem';
import type { Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type NetworkKey = 'testnet' | 'mainnet';

const NETWORKS: Record<
  NetworkKey,
  {
    chainId: number;
    name: string;
    networkSlug: string;
    rpcEnv: string;
    keyEnv: string;
    hardhatNetwork: string;
  }
> = {
  testnet: {
    chainId: 296,
    name: 'Hedera Testnet',
    networkSlug: 'hedera-testnet',
    rpcEnv: 'HEDERA_RPC_URL',
    keyEnv: 'HEDERA_PRIVATE_KEY',
    hardhatNetwork: 'hederaTestnet',
  },
  mainnet: {
    chainId: 295,
    name: 'Hedera Mainnet',
    networkSlug: 'hedera-mainnet',
    rpcEnv: 'HEDERA_MAINNET_RPC_URL',
    keyEnv: 'HEDERA_MAINNET_PRIVATE_KEY',
    hardhatNetwork: 'hederaMainnet',
  },
};

type Artifact = {
  abi: Abi;
  bytecode: `0x${string}`;
};

const ARTIFACT_PATHS = {
  letsPay: '../artifacts/contracts/LetsPayHBAR_V1_UUPS.sol/LetsPayHBAR_V1_UUPS.json',
  proxy: '../artifacts/contracts/Proxy.sol/ERC1967Proxy.json',
} as const;

function loadArtifact(relativePath: string): Artifact {
  const artifact = JSON.parse(readFileSync(join(__dirname, relativePath), 'utf-8'));
  if (!artifact.abi || !artifact.bytecode) {
    throw new Error(`Artifact at ${relativePath} is missing abi or bytecode.`);
  }
  return artifact;
}

function resolveNetwork(): {
  key: NetworkKey;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: (typeof NETWORKS)[NetworkKey];
} {
  const raw = (process.env.HEDERA_NETWORK ?? 'testnet').toLowerCase();
  if (raw !== 'testnet' && raw !== 'mainnet') {
    throw new Error(`Unsupported HEDERA_NETWORK "${raw}". Use "testnet" or "mainnet".`);
  }
  const key: NetworkKey = raw;
  const config = NETWORKS[key];

  const rpcUrl = process.env[config.rpcEnv] ?? process.env.HEDERA_RPC_URL;
  if (!rpcUrl) {
    throw new Error(`Set ${config.rpcEnv} (or HEDERA_RPC_URL) to point at the desired Hedera RPC endpoint.`);
  }

  const privateKey = (process.env[config.keyEnv] ?? process.env.HEDERA_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!privateKey) {
    throw new Error(`Set ${config.keyEnv} (or HEDERA_PRIVATE_KEY) with the funded EVM private key.`);
  }

  return { key, rpcUrl, privateKey, config };
}

async function promptYesNo(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  const answer = (await rl.question(`${message} (y/N): `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

function formatHbar(amount: bigint): string {
  return `${formatEther(amount)} HBAR`;
}

async function runHardhatDeploy(network: string): Promise<void> {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['hardhat', 'ignition', 'deploy', '--network', network, 'ignition/modules/LetsPayHBAR.ts'];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Hardhat exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function estimateDeploymentCosts(
  publicClient: ReturnType<typeof createPublicClient>,
  operatorAddress: `0x${string}`,
  letsPayArtifact: Artifact,
  proxyArtifact: Artifact,
  initData: `0x${string}`,
  predictedImplementation: `0x${string}`
) {
  const implementationDeployData = encodeDeployData({
    abi: letsPayArtifact.abi,
    bytecode: letsPayArtifact.bytecode,
    args: [],
  });

  const proxyDeployData = encodeDeployData({
    abi: proxyArtifact.abi,
    bytecode: proxyArtifact.bytecode,
    args: [predictedImplementation, initData],
  });

  const [implementationGas, proxyGas, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: operatorAddress, data: implementationDeployData }),
    publicClient.estimateGas({ account: operatorAddress, data: proxyDeployData }),
    publicClient.getGasPrice(),
  ]);

  const totalGas = implementationGas + proxyGas;
  const estimatedCostWei = totalGas * gasPrice;
  const bufferWei = estimatedCostWei / 5n; // 20% headroom
  const requiredWei = estimatedCostWei + bufferWei;

  return {
    implementationGas,
    proxyGas,
    totalGas,
    gasPrice,
    estimatedCostWei,
    bufferWei,
    requiredWei,
  };
}

async function main() {
  const { key: networkKey, rpcUrl, privateKey, config } = resolveNetwork();
  const letsPayArtifact = loadArtifact(ARTIFACT_PATHS.letsPay);
  const proxyArtifact = loadArtifact(ARTIFACT_PATHS.proxy);

  const account = privateKeyToAccount(privateKey);
  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: config.networkSlug,
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log(`\n[1/7] Checking balance for deployer ${account.address} on Hedera ${networkKey}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`[2/7] Operator balance: ${formatHbar(balance)}\n`);

  const proceedAfterBalance = await promptYesNo('[3/7] Continue with deployment preparation?');
  if (!proceedAfterBalance) {
    console.log('Aborting before deployment preparation.');
    process.exit(0);
  }

  console.log('\n[4/7] Estimating required balance for deployment transactions...');
  const nonce = await publicClient.getTransactionCount({ address: account.address });
  const predictedImplementation = getContractAddress({
    from: account.address,
    nonce: BigInt(nonce),
  });
  const initData = encodeFunctionData({
    abi: letsPayArtifact.abi,
    functionName: 'initialize',
    args: [account.address],
  });

  const costs = await estimateDeploymentCosts(
    publicClient,
    account.address,
    letsPayArtifact,
    proxyArtifact,
    initData,
    predictedImplementation
  );

  console.log(`   Implementation deploy gas: ${costs.implementationGas.toString()} units`);
  console.log(`   Proxy deploy gas:          ${costs.proxyGas.toString()} units`);
  console.log(`   Total estimated gas:       ${costs.totalGas.toString()} units`);
  console.log(`   Current gas price:         ${formatHbar(costs.gasPrice)} (in wei equivalent)`);
  console.log(`   Estimated cost:            ${formatHbar(costs.estimatedCostWei)}`);
  console.log(`   20% safety buffer:         ${formatHbar(costs.bufferWei)}`);
  console.log(`   Required balance:          ${formatHbar(costs.requiredWei)}\n`);

  const hasBalance = balance >= costs.requiredWei;
  if (hasBalance) {
    console.log('[6/7] ✅ Operator balance meets the required threshold.');
  } else {
    const deficit = costs.requiredWei - balance;
    console.log(
      `[6/7] ❌ Operator balance is short by ${formatHbar(deficit)}. Top up before deploying for a smoother experience.`
    );
  }

  const proceedToDeploy = await promptYesNo('[7/7] Proceed with Hardhat Ignition deployment now?');
  if (!proceedToDeploy) {
    console.log('Deployment cancelled by user.');
    process.exit(0);
  }

  console.log(`\nLaunching Hardhat Ignition on ${config.hardhatNetwork}...\n`);
  await runHardhatDeploy(config.hardhatNetwork);
}

main().catch((error) => {
  console.error('\nDeployment helper failed:', error);
  process.exit(1);
});

