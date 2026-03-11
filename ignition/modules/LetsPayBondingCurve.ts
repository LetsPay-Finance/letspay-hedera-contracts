import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LetsPayBondingCurveModule", (m) => {
  // Deploy implementation
  const implementation = m.contract("LetsPayBondingCurve");

  // Get LTP token address from environment or use default
  const ltpToken = m.getParameter("ltpToken", "0x00000000000000000000000000000000009c55eb");

  // Encode initializer for initialize(address)
  const initData = m.encodeFunctionCall(implementation, "initialize", [ltpToken]);

  // Deploy proxy pointing to implementation with init data
  const proxy = m.contract("BondingCurveProxy", [implementation, initData]);

  // Attach LetsPayBondingCurve ABI to proxy address
  const bondingCurve = m.contractAt("LetsPayBondingCurve", proxy, { 
    id: "LetsPayBondingCurve_AttachedToProxy" 
  });

  return { implementation, proxy, bondingCurve };
});
