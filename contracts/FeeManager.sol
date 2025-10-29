// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract FeeManager {
    bool private _initialized;
    modifier initializer() {
        require(!_initialized, "inited");
        _initialized = true;
        _;
    }

    address public owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    address payable public feeRecipient;
    uint16 public feeBps; // out of 10_000

    event FeeRecipientUpdated(address indexed recipient);
    event FeeBpsUpdated(uint16 bps);

    function initialize(address owner_, address payable recipient_, uint16 feeBps_) external initializer {
        require(owner_ != address(0), "owner=0");
        require(recipient_ != address(0), "recipient=0");
        require(feeBps_ <= 10_000, "bps>10000");
        owner = owner_;
        feeRecipient = recipient_;
        feeBps = feeBps_;
    }

    function setFeeRecipient(address payable recipient) external onlyOwner {
        require(recipient != address(0), "recipient=0");
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        require(bps <= 10_000, "bps>10000");
        feeBps = bps;
        emit FeeBpsUpdated(bps);
    }

    function computeFee(uint256 amount) public view returns (uint256) {
        if (feeBps == 0 || amount == 0) return 0;
        return (amount * feeBps) / 10_000;
    }

    function splitAmount(uint256 amount) external view returns (uint256 fee, uint256 net) {
        fee = computeFee(amount);
        net = amount - fee;
    }
}


