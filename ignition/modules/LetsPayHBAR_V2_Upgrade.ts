import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LetsPayHBAR_V2_UpgradeModule", (m) => {
  // Address of the existing proxy (from deployed_addresses.json)
  const proxyAddress = "0xea700d3e8b8A076a390FBB8155B4834d1e3d6895";

  // Deploy new V2 implementation
  const v2Implementation = m.contract("LetsPayHBAR_V2_UUPS");

  // Attach V1 ABI to proxy to call upgrade function
  const proxyAsV1 = m.contractAt("LetsPayHBAR_V1_UUPS", proxyAddress);

  // Call upgradeTo on the proxy to point to V2
  m.call(proxyAsV1, "upgradeTo", [v2Implementation]);

  // Attach V2 ABI to proxy address for future interactions
  const proxyAsV2 = m.contractAt("LetsPayHBAR_V2_UUPS", proxyAddress, { 
    id: "LetsPayHBAR_V2_UUPS_AttachedToProxy" 
  });

  return { v2Implementation, proxyAsV2 };
});

