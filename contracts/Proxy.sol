// ERC1967Proxy.sol — minimal UUPS-compatible proxy (no admin)
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ERC1967 Proxy (minimal)
 * @dev Stores implementation at EIP-1967 slot and delegates all calls. No admin functions.
 */
contract ERC1967Proxy {
    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 private constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address _implementation, bytes memory _data) payable {
        require(_implementation != address(0), "impl=0");
        assembly { sstore(_IMPLEMENTATION_SLOT, _implementation) }
        if (_data.length > 0) {
            (bool ok, bytes memory ret) = _implementation.delegatecall(_data);
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