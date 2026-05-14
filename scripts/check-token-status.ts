import {
  createPublicClient,
  defineChain,
  http,
} from "viem";

const LTP_TOKEN_ADDRESS = "0x00000000000000000000000000000000009c5aaf" as const;
const TREASURY_ADDRESS = "0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F" as const;
const PROXY_ADDRESS = "0x2250a1851a0829f4a16921f975c1da931a3d47fa" as const;

// Extended ERC20 ABI with Hedera-specific functions
const TOKEN_ABI = [
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
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Hedera-specific functions (if available)
  {
    type: "function",
    name: "isFrozen",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isKycGranted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

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

async function checkFunction(
  name: string,
  args: any[] = [],
  optional: boolean = false
): Promise<any> {
  try {
    const result = await publicClient.readContract({
      address: LTP_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: name as any,
      args: args,
    });
    return { success: true, value: result };
  } catch (error: any) {
    if (optional) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}

async function main() {
  console.log("Checking LTP Token Status");
  console.log("==========================");
  console.log(`Token Address: ${LTP_TOKEN_ADDRESS}`);
  console.log(`Treasury:      ${TREASURY_ADDRESS}`);
  console.log(`Proxy:         ${PROXY_ADDRESS}\n`);

  // Basic token info
  console.log("[1/6] Basic Token Information:");
  try {
    const name = await checkFunction("name", [], true);
    const symbol = await checkFunction("symbol", [], true);
    const decimals = await checkFunction("decimals", [], true);
    const totalSupply = await checkFunction("totalSupply", [], true);

    if (name.success) console.log(`  Name:         ${name.value}`);
    if (symbol.success) console.log(`  Symbol:       ${symbol.value}`);
    if (decimals.success) console.log(`  Decimals:     ${decimals.value}`);
    if (totalSupply.success)
      console.log(`  Total Supply: ${totalSupply.value.toString()} base units`);
  } catch (error: any) {
    console.log(`  ⚠️  Error reading basic info: ${error.message}`);
  }

  // Balances
  console.log("\n[2/6] Account Balances:");
  try {
    const treasuryBalance = await checkFunction("balanceOf", [TREASURY_ADDRESS]);
    const proxyBalance = await checkFunction("balanceOf", [PROXY_ADDRESS]);

    if (treasuryBalance.success) {
      const ltp = Number(treasuryBalance.value) / 100;
      console.log(
        `  Treasury: ${treasuryBalance.value.toString()} base units (${ltp.toLocaleString()} LTP)`
      );
    }
    if (proxyBalance.success) {
      const ltp = Number(proxyBalance.value) / 100;
      console.log(
        `  Proxy:    ${proxyBalance.value.toString()} base units (${ltp.toLocaleString()} LTP)`
      );
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error reading balances: ${error.message}`);
  }

  // Check if token is frozen for treasury
  console.log("\n[3/6] Frozen Status:");
  try {
    const treasuryFrozen = await checkFunction("isFrozen", [TREASURY_ADDRESS], true);
    const proxyFrozen = await checkFunction("isFrozen", [PROXY_ADDRESS], true);

    if (treasuryFrozen.success) {
      console.log(`  Treasury Frozen: ${treasuryFrozen.value ? "❌ YES" : "✅ NO"}`);
      if (treasuryFrozen.value) {
        console.log(`  ⚠️  WARNING: Treasury account is frozen! Transfers will fail.`);
      }
    } else {
      console.log(`  Treasury Frozen: Function not available or failed`);
    }

    if (proxyFrozen.success) {
      console.log(`  Proxy Frozen:    ${proxyFrozen.value ? "❌ YES" : "✅ NO"}`);
      if (proxyFrozen.value) {
        console.log(`  ⚠️  WARNING: Proxy account is frozen! Cannot receive tokens.`);
      }
    } else {
      console.log(`  Proxy Frozen:    Function not available or failed`);
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error checking frozen status: ${error.message}`);
  }

  // Check KYC status
  console.log("\n[4/6] KYC Status:");
  try {
    const treasuryKyc = await checkFunction("isKycGranted", [TREASURY_ADDRESS], true);
    const proxyKyc = await checkFunction("isKycGranted", [PROXY_ADDRESS], true);

    if (treasuryKyc.success) {
      console.log(`  Treasury KYC: ${treasuryKyc.value ? "✅ Granted" : "❌ NOT Granted"}`);
      if (!treasuryKyc.value) {
        console.log(`  ⚠️  WARNING: Treasury KYC not granted! Transfers may fail.`);
      }
    } else {
      console.log(`  Treasury KYC: Function not available (token may not require KYC)`);
    }

    if (proxyKyc.success) {
      console.log(`  Proxy KYC:    ${proxyKyc.value ? "✅ Granted" : "❌ NOT Granted"}`);
      if (!proxyKyc.value) {
        console.log(`  ⚠️  WARNING: Proxy KYC not granted! Cannot receive tokens.`);
      }
    } else {
      console.log(`  Proxy KYC:    Function not available (token may not require KYC)`);
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error checking KYC status: ${error.message}`);
  }

  // Check if it's a valid Hedera token
  console.log("\n[5/6] Token Validation:");
  try {
    const isToken = await checkFunction("isToken", [], true);
    if (isToken.success) {
      console.log(`  Is Valid Token: ${isToken.value ? "✅ YES" : "❌ NO"}`);
    } else {
      console.log(`  Is Valid Token: Function not available`);
    }
  } catch (error: any) {
    console.log(`  ⚠️  Error validating token: ${error.message}`);
  }

  // Summary and recommendations
  console.log("\n[6/6] Summary & Recommendations:");
  console.log("===================================");
  console.log("Response Code 184 typically indicates:");
  console.log("  - Token is frozen for the account");
  console.log("  - KYC not granted for the account");
  console.log("  - Transfer restrictions are enabled");
  console.log("  - Account doesn't have transfer permissions");
  console.log("\nTo fix transfer issues:");
  console.log("  1. Unfreeze the token (if frozen)");
  console.log("  2. Grant KYC to both treasury and proxy (if required)");
  console.log("  3. Remove transfer restrictions (if enabled)");
  console.log("  4. Verify token configuration allows transfers");
  console.log("\nNote: These operations typically require admin/treasury privileges");
  console.log("      and may need to be done via Hedera SDK or CLI tools.");
}

main().catch((error) => {
  console.error("Error checking token status:", error);
  process.exit(1);
});
