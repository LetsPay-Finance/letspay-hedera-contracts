import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Upgrading proxy to V2 with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Addresses from deployed_addresses.json
  const PROXY_ADDRESS = "0xea700d3e8b8A076a390FBB8155B4834d1e3d6895";
  const V1_IMPL_ADDRESS = "0x91Fa37060C459994729B29726dCEd8Ce2ffa8981";

  console.log("\n📋 Current Setup:");
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("V1 Implementation:", V1_IMPL_ADDRESS);

  // Step 1: Deploy V2 Implementation
  console.log("\n🚀 Deploying V2 Implementation...");
  const LetsPayV2 = await ethers.getContractFactory("LetsPayHBAR_V2_UUPS");
  const v2Implementation = await LetsPayV2.deploy();
  await v2Implementation.waitForDeployment();
  const v2Address = await v2Implementation.getAddress();
  
  console.log("✅ V2 Implementation deployed to:", v2Address);

  // Step 2: Verify current implementation
  console.log("\n🔍 Verifying current proxy implementation...");
  const proxyAsV1 = await ethers.getContractAt("LetsPayHBAR_V1_UUPS", PROXY_ADDRESS);
  
  // Read implementation slot directly
  const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const currentImpl = await ethers.provider.getStorage(PROXY_ADDRESS, IMPLEMENTATION_SLOT);
  const currentImplAddress = "0x" + currentImpl.slice(-40);
  console.log("Current Implementation (from storage):", currentImplAddress);

  // Step 3: Check owner
  const owner = await proxyAsV1.owner();
  console.log("Proxy Owner:", owner);
  console.log("Deployer Address:", deployer.address);
  
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("❌ ERROR: Deployer is not the owner! Cannot upgrade.");
    return;
  }

  // Step 4: Upgrade proxy to V2
  console.log("\n⬆️  Upgrading proxy to V2...");
  const upgradeTx = await proxyAsV1.upgradeTo(v2Address);
  console.log("Upgrade transaction hash:", upgradeTx.hash);
  
  await upgradeTx.wait();
  console.log("✅ Upgrade transaction confirmed!");

  // Step 5: Verify upgrade
  console.log("\n🔍 Verifying upgrade...");
  const newImpl = await ethers.provider.getStorage(PROXY_ADDRESS, IMPLEMENTATION_SLOT);
  const newImplAddress = "0x" + newImpl.slice(-40);
  console.log("New Implementation (from storage):", newImplAddress);

  // Step 6: Test V2 functionality
  console.log("\n🧪 Testing V2 contract...");
  const proxyAsV2 = await ethers.getContractAt("LetsPayHBAR_V2_UUPS", PROXY_ADDRESS);
  const credit = await proxyAsV2.CREDIT();
  console.log("CREDIT constant:", credit.toString());
  console.log("Expected (200 * 1e8):", (200n * 10n**8n).toString());
  
  if (credit === 200n * 10n**8n) {
    console.log("✅ V2 upgrade verified successfully!");
  } else {
    console.log("⚠️  Warning: CREDIT value doesn't match expected V2 value");
  }

  console.log("\n🎉 Upgrade Complete!");
  console.log("Proxy Address:", PROXY_ADDRESS);
  console.log("V2 Implementation:", v2Address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

