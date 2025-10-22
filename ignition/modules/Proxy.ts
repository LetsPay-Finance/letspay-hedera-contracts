import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LetsPayProxyModule", (m) => {
  // 🧩 Replace with your deployed implementation (V1) address
  const implAddress = "0xYourV1ImplementationAddressHere";

  // 🧩 Owner of the contract (the one who can upgrade later)
  const owner = "0xYourOwnerAddressHere";
  // Get a future for the already deployed implementation contract
  const letsPayHBAR_V1_UUPS = m.contractAt("LetsPayHBAR_V1_UUPS", implAddress);

  // Encode the initializer data for `initialize(address)`
  const initData = m.encodeFunctionCall(letsPayHBAR_V1_UUPS, "initialize", [owner]);

  // Deploy the ERC1967Proxy with implementation + initData
  const proxy = m.contract("ERC1967Proxy", [implAddress, initData]);

  return { proxy };
});
