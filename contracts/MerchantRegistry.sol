// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MerchantRegistry {
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

    struct Merchant {
        bool registered;
        address payable payout;
        string name;
        string metadataURI;
    }

    mapping(address => Merchant) private _merchants;

    event MerchantRegistered(address indexed merchant, address payout, string name, string metadataURI);
    event MerchantUpdated(address indexed merchant, address payout, string name, string metadataURI);
    event MerchantUnregistered(address indexed merchant);

    function initialize(address owner_) external initializer {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
    }

    function register(
        address merchant,
        address payable payout,
        string calldata name,
        string calldata metadataURI
    ) external onlyOwner {
        require(merchant != address(0), "merchant=0");
        require(payout != address(0), "payout=0");
        Merchant storage m = _merchants[merchant];
        require(!m.registered, "already registered");
        m.registered = true;
        m.payout = payout;
        m.name = name;
        m.metadataURI = metadataURI;
        emit MerchantRegistered(merchant, payout, name, metadataURI);
    }

    function updatePayout(address merchant, address payable newPayout) external onlyOwner {
        require(newPayout != address(0), "payout=0");
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        m.payout = newPayout;
        emit MerchantUpdated(merchant, m.payout, m.name, m.metadataURI);
    }

    function updateMetadata(address merchant, string calldata name, string calldata metadataURI) external onlyOwner {
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        m.name = name;
        m.metadataURI = metadataURI;
        emit MerchantUpdated(merchant, m.payout, name, metadataURI);
    }

    function unregister(address merchant) external onlyOwner {
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        delete _merchants[merchant];
        emit MerchantUnregistered(merchant);
    }

    function isRegistered(address merchant) external view returns (bool) {
        return _merchants[merchant].registered;
    }

    function payoutOf(address merchant) external view returns (address payable) {
        return _merchants[merchant].payout;
    }

    function getMerchant(address merchant)
        external
        view
        returns (bool registered, address payout, string memory name, string memory metadataURI)
    {
        Merchant storage m = _merchants[merchant];
        return (m.registered, m.payout, m.name, m.metadataURI);
    }
}


