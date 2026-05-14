// BondingCurveProxy.sol — UUPS-compatible proxy for LetsPayBondingCurve
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BondingCurveProxy
 * @dev Stores implementation at EIP-1967 slot and delegates all calls. 
 *      Specifically designed for LetsPayBondingCurve contract.
 */
contract BondingCurveProxy {
    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation_, bytes memory data_) payable {
        require(implementation_ != address(0), "impl=0");
        assembly { sstore(_IMPLEMENTATION_SLOT, implementation_) }
        if (data_.length > 0) {
            (bool ok, bytes memory ret) = implementation_.delegatecall(data_);
            require(ok, string(ret));
        }
    }

    function _implementation() internal view returns (address impl) {
        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly { impl := sload(slot) }
    }

    fallback() external payable {
        address impl = _implementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(0, 0, size)
            switch result
            case 0 { revert(0, size) }
            default { return(0, size) }
        }
    }

    receive() external payable { }
}

