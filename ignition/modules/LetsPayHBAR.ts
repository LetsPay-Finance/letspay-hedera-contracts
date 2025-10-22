import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LetsPayHBARModule", (m) => {
  // Deploy implementation (V1)
  const implementation = m.contract("LetsPayHBAR_V1_UUPS");

  // Use deployer's first account as the owner
  const owner = m.getAccount(0);

  // Encode initializer for initialize(address)
  const initData = m.encodeFunctionCall(implementation, "initialize", [owner]);

  // Deploy proxy pointing to implementation with init data
  const proxy = m.contract("ERC1967Proxy", [implementation, initData]);

  // Attach LetsPay ABI to proxy address
  const letsPay = m.contractAt("LetsPayHBAR_V1_UUPS", proxy, { id: "LetsPayHBAR_V1_UUPS_AttachedToProxy" });

  return { implementation, proxy, letsPay };
});
