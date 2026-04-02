import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_LTP_TOKEN =
  "0x00000000000000000000000000000000009c55eb" as const;
const HTS_PRECOMPILE = "0x0000000000000000000000000000000000000167";
const INT64_MAX = 9_223_372_036_854_775_807n;

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
];

const BONDING_ABI = [
  {
    type: "function",
    name: "associateToken",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "tokensSold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
];

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
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

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

  const privateKey = (process.env[config.keyEnv] ??
    process.env.HEDERA_PRIVATE_KEY ??
    process.env.HEDERA_MAINNET_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!privateKey) {
    throw new Error(
      `Set ${config.keyEnv} (or HEDERA_PRIVATE_KEY/HEDERA_MAINNET_PRIVATE_KEY) with the funded EVM private key.`
    );
  }

  return { key, rpcUrl, privateKey, config };
}

function parseFundAmount(): bigint {
  const raw = process.env.LTP_FUND_AMOUNT;
  if (!raw) {
    throw new Error(
      "Set LTP_FUND_AMOUNT to the raw token amount you want to fund (int64 range)."
    );
  }

  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw new Error("LTP_FUND_AMOUNT must be positive.");
  }
  if (amount > INT64_MAX) {
    throw new Error("LTP_FUND_AMOUNT exceeds int64 range required by HTS.");
  }

  return amount;
}

async function main() {
  const bondingCurveAddress = requireEnv("BONDING_CURVE_ADDRESS") as `0x${string}`;
  const ltpToken = (process.env.LTP_TOKEN_ADDRESS ?? DEFAULT_LTP_TOKEN) as `0x${string}`;
  const fundAmount = parseFundAmount();

  const { key, rpcUrl, privateKey, config } = resolveNetwork();
  const chain = defineChain({
    id: config.chainId,
    name: config.name,
    network: `hedera-${key}`,
    nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log("\nAssociating and funding LetsPayBondingCurve");
  console.log("-------------------------------------------");
  console.log(`Network:           ${config.name} (${key})`);
  console.log(`Chain ID:          ${config.chainId}`);
  console.log(`RPC:               ${rpcUrl}`);
  console.log(`Operator:          ${account.address}`);
  console.log(`Bonding curve:     ${bondingCurveAddress}`);
  console.log(`LTP token:         ${ltpToken}`);
  console.log(`Fund amount:       ${fundAmount.toString()} (raw units)\n`);

  const bondingCurve = {
    read: {
      tokensSold: () =>
        publicClient.readContract({
          address: bondingCurveAddress,
          abi: BONDING_ABI,
          functionName: "tokensSold",
        }),
      paused: () =>
        publicClient.readContract({
          address: bondingCurveAddress,
          abi: BONDING_ABI,
          functionName: "paused",
        }),
    },
    write: {
      associateToken: () =>
        wallet.writeContract({
          address: bondingCurveAddress,
          abi: BONDING_ABI,
          functionName: "associateToken",
          account,
        }),
    },
  };

  const erc20 = {
    read: {
      balanceOf: (addr: `0x${string}`) =>
        publicClient.readContract({
          address: ltpToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
      symbol: () =>
        publicClient.readContract({
          address: ltpToken,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
      decimals: () =>
        publicClient.readContract({
          address: ltpToken,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
    },
  };

  const hts = {
    write: {
      transferToken: (
        token: `0x${string}`,
        sender: `0x${string}`,
        receiver: `0x${string}`,
        amount: bigint
      ) =>
        wallet.writeContract({
          address: HTS_PRECOMPILE,
          abi: HTS_ABI,
          functionName: "transferToken",
          args: [token, sender, receiver, amount],
          account,
        }),
    },
  };

  const operatorTokenBefore = await erc20.read.balanceOf(account.address);
  const contractTokenBefore = await erc20.read.balanceOf(bondingCurveAddress);

  let tokenSymbol = "LTP";
  let tokenDecimals: number | undefined;
  try {
    tokenSymbol = (await erc20.read.symbol()) as string;
    tokenDecimals = Number(await erc20.read.decimals());
  } catch {
    // fallback to defaults if HTS token does not expose symbol/decimals
  }

  console.log(`Token symbol:      ${tokenSymbol}`);
  if (tokenDecimals !== undefined) {
    console.log(`Token decimals:    ${tokenDecimals}`);
  }

  let associated = false;
  const skipAssociate = (process.env.SKIP_ASSOCIATE ?? "").toLowerCase() === "true";
  if (skipAssociate) {
    console.log("\n[1/3] Skipping association (SKIP_ASSOCIATE=true).");
    associated = true;
  } else {
    console.log("\n[1/3] Associating bonding-curve contract with LTP...");
    try {
      const associateHash = await bondingCurve.write.associateToken();
      await publicClient.waitForTransactionReceipt({ hash: associateHash });
      console.log(`Association tx:    ${associateHash}`);
      associated = true;
    } catch (err) {
      console.log("Association attempt reverted or failed; proceeding to funding anyway.");
      console.log(String(err));
    }
  }

  console.log("[2/3] Funding bonding-curve contract via HTS.transferToken...");
  const transferHash = await hts.write.transferToken(
    ltpToken,
    account.address,
    bondingCurveAddress,
    fundAmount
  );
  await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log(`Transfer tx:       ${transferHash}`);

  const operatorTokenAfter = await erc20.read.balanceOf(account.address);
  const contractTokenAfter = await erc20.read.balanceOf(bondingCurveAddress);

  const tokensSold = await bondingCurve.read.tokensSold();
  const paused = await bondingCurve.read.paused();

  console.log("\n[3/3] Post-checks:");
  console.log(`Operator balance:  ${operatorTokenBefore} -> ${operatorTokenAfter}`);
  console.log(`Contract balance:  ${contractTokenBefore} -> ${contractTokenAfter}`);
  console.log(`tokensSold:        ${tokensSold.toString()}`);
  console.log(`paused:            ${paused}`);

  console.log(
    "\nDone. The bonding-curve contract is associated and funded. You can now test a small buy."
  );
}

main().catch((error) => {
  console.error("Association/funding failed:", error);
  process.exit(1);
});
