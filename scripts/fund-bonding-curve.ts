import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";

const NETWORKS = {
  testnet: {
    chainId: 296,
    name: "Hedera Testnet",
    rpcEnv: "HEDERA_RPC_URL",
    keyEnv: "HEDERA_PRIVATE_KEY",
  },
  mainnet: {
    chainId: 295,
    name: "Hedera Mainnet",
    rpcEnv: "HEDERA_MAINNET_RPC_URL",
    keyEnv: "HEDERA_MAINNET_PRIVATE_KEY",
  },
} as const;

type NetworkKey = keyof typeof NETWORKS;

const DEFAULT_BONDING_CURVE_PROXY_ADDRESS =
  "0x2250a1851a0829f4a16921f975c1da931a3d47fa" as const;
const DEFAULT_LTP_TOKEN_ADDRESS =
  "0x00000000000000000000000000000000009c5aaf" as const;
const TREASURY_ADDRESS = "0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F" as const;

// LTP has 2 decimals → 1 LTP = 100 base units
// 300K LTP = 300,000 * 100 = 30,000,000 base units
const TOKEN_DECIMALS = 100;
const AMOUNT_LTP = 300_000; // 300K LTP tokens
const AMOUNT_BASE_UNITS = BigInt(AMOUNT_LTP * TOKEN_DECIMALS); // 30,000,000 base units

// Use TEST_AMOUNT if set, otherwise use full amount
const TRANSFER_AMOUNT = process.env.TEST_AMOUNT ? BigInt(process.env.TEST_AMOUNT) : AMOUNT_BASE_UNITS;

const HTS_ABI = [
  {
    type: "function",
    name: "transferToken",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "sender", type: "address" },
      { name: "receiver", type: "address" },
      { name: "amount", type: "int64" },
    ],
    outputs: [{ name: "responseCode", type: "int64" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

function resolveNetwork(): {
  key: NetworkKey;
  rpcUrl: string;
  privateKey: `0x${string}`;
  config: (typeof NETWORKS)[NetworkKey];
} {
  const raw = (process.env.HEDERA_NETWORK ?? "mainnet").toLowerCase();
  if (raw !== "testnet" && raw !== "mainnet") {
    throw new Error('HEDERA_NETWORK must be "testnet" or "mainnet".');
  }
  const key: NetworkKey = raw;
  const config = NETWORKS[key];

  const rpcUrl =
    process.env[config.rpcEnv] ??
    process.env.HEDERA_RPC_URL ??
    process.env.HEDERA_MAINNET_RPC_URL;
  if (!rpcUrl) {
    throw new Error(`Set ${config.rpcEnv} (or HEDERA_RPC_URL) for RPC endpoint.`);
  }

  // Use TREASURY key for transfers (required)
  const treasuryKey = process.env.HEDERA_TREASURY_KEY;
  let privateKey: `0x${string}` | undefined;

  if (treasuryKey) {
    // Ensure it starts with 0x
    privateKey = (treasuryKey.startsWith("0x")
      ? treasuryKey
      : `0x${treasuryKey}`) as `0x${string}`;
  } else {
    // Fallback to deployer key
    privateKey = (process.env[config.keyEnv] ??
      process.env.HEDERA_PRIVATE_KEY ??
      process.env.HEDERA_MAINNET_PRIVATE_KEY) as `0x${string}` | undefined;
  }

  if (!privateKey) {
    throw new Error(
      `Set HEDERA_TREASURY_KEY (or ${config.keyEnv}) with the funded EVM private key.`
    );
  }

  return { key, rpcUrl, privateKey, config };
}

async function main() {
  const PROXY_ADDRESS = (process.env.BONDING_CURVE_PROXY_ADDRESS ??
    DEFAULT_BONDING_CURVE_PROXY_ADDRESS) as `0x${string}`;
  const LTP_TOKEN_ADDRESS = (process.env.LTP_TOKEN_ADDRESS ??
    DEFAULT_LTP_TOKEN_ADDRESS) as `0x${string}`;

  const { key, rpcUrl, privateKey, config } = resolveNetwork();
  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: `hedera-${key}`,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });

  console.log("\nFunding BondingCurveProxy with LTP Tokens");
  console.log("==========================================");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Operator:          ${account.address}`);
  console.log(`Balance:           ${formatEther(balance)} HBAR`);
  console.log(`Treasury Address:  ${TREASURY_ADDRESS}`);
  console.log(`Proxy Address:     ${PROXY_ADDRESS}`);
  console.log(`LTP Token:         ${LTP_TOKEN_ADDRESS}`);
  const transferAmount = TRANSFER_AMOUNT;
  console.log(`Amount:            ${(Number(transferAmount) / TOKEN_DECIMALS).toLocaleString()} LTP (${transferAmount.toLocaleString()} base units)\n`);

  // Verify operator is TREASURY
  if (account.address.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    console.warn(
      `⚠️  WARNING: Operator (${account.address}) is not TREASURY (${TREASURY_ADDRESS})`
    );
    console.warn("The transfer may fail if TREASURY is required");
  } else {
    console.log("✅ Operator is TREASURY\n");
  }

  // Check token info
  let tokenSymbol = "LTP";
  let tokenDecimals: number | undefined;
  try {
    tokenSymbol = (await publicClient.readContract({
      address: LTP_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "symbol",
    })) as string;
    tokenDecimals = Number(
      await publicClient.readContract({
        address: LTP_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "decimals",
      })
    );
  } catch {
    console.log("⚠️  Could not read token symbol/decimals, using defaults");
  }

  console.log(`Token symbol:      ${tokenSymbol}`);
  if (tokenDecimals !== undefined) {
    console.log(`Token decimals:    ${tokenDecimals}`);
  }

  // Check balances before transfer
  console.log("\n[1/3] Checking balances...");
  const senderBalanceBefore = await publicClient.readContract({
    address: LTP_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  const proxyBalanceBefore = await publicClient.readContract({
    address: LTP_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [PROXY_ADDRESS],
  });

  console.log(`Sender balance:     ${senderBalanceBefore.toString()} base units (${account.address})`);
  console.log(`Proxy balance:      ${proxyBalanceBefore.toString()} base units`);

  if (senderBalanceBefore < transferAmount) {
    throw new Error(
      `Insufficient balance! Sender has ${senderBalanceBefore.toString()}, need ${transferAmount.toString()}`
    );
  }

  // Transfer tokens
  // Note: sender must be the account making the call (account.address)
  console.log("\n[2/3] Transferring tokens via HTS.transferToken...");
  console.log(`Transferring from ${account.address} to ${PROXY_ADDRESS}`);
  const transferHash = await walletClient.writeContract({
    address: HTS_PRECOMPILE,
    abi: HTS_ABI,
    functionName: "transferToken",
    args: [
      LTP_TOKEN_ADDRESS,
      account.address, // sender must be the account calling
      PROXY_ADDRESS,
      transferAmount,
    ],
    account,
  });

  console.log(`Transaction hash:   ${transferHash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log(`✅ Transfer confirmed! Block: ${receipt.blockNumber}`);

  // Check balances after transfer
  console.log("\n[3/3] Verifying transfer...");
  const senderBalanceAfter = await publicClient.readContract({
    address: LTP_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  const proxyBalanceAfter = await publicClient.readContract({
    address: LTP_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [PROXY_ADDRESS],
  });

  const senderDiff = senderBalanceBefore - senderBalanceAfter;
  const proxyDiff = proxyBalanceAfter - proxyBalanceBefore;

  console.log(`Sender balance:     ${senderBalanceBefore.toString()} -> ${senderBalanceAfter.toString()} (-${senderDiff.toString()})`);
  console.log(`Proxy balance:       ${proxyBalanceBefore.toString()} -> ${proxyBalanceAfter.toString()} (+${proxyDiff.toString()})`);

  if (proxyDiff === transferAmount && senderDiff === transferAmount) {
    console.log("\n✅ Transfer verified successfully!");
  } else {
    console.warn("\n⚠️  Warning: Balance changes don't match expected amounts");
    console.warn(`Expected: ${transferAmount.toString()}, Got: ${proxyDiff.toString()}`);
    console.warn(`Response code 184 indicates transfer failed. This might be due to:`);
    console.warn(`  - Token transfer restrictions`);
    console.warn(`  - KYC requirements`);
    console.warn(`  - Frozen token status`);
    console.warn(`  - Invalid token configuration`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("Funding Complete ✅");
  console.log("=".repeat(50));
  console.log(`Proxy Address:      ${PROXY_ADDRESS}`);
  console.log(`Tokens Transferred: ${(Number(transferAmount) / TOKEN_DECIMALS).toLocaleString()} LTP`);
  console.log(`Base Units:         ${transferAmount.toLocaleString()}`);
  console.log(`Transaction:        ${transferHash}`);
  console.log(
    `\nThe bonding curve proxy now has ${AMOUNT_LTP.toLocaleString()} LTP tokens and is ready for purchases.`
  );
}

main().catch((error) => {
  console.error("Funding failed:", error);
  process.exit(1);
});
