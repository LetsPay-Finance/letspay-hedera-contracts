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
    address public pendingOwner;
    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    bool public paused;
    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    bool private _entered;
    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    struct Merchant {
        bool registered;
        address payable payout;
        string name;
        string metadataURI;
        uint256 registeredAt;
    }

    mapping(address => Merchant) private _merchants;
    address[] private _merchantList;
    uint256 public merchantCount;

    event MerchantRegistered(address indexed merchant, address payout, string name, string metadataURI);
    event MerchantUpdated(address indexed merchant, address payout, string name, string metadataURI);
    event MerchantUnregistered(address indexed merchant);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);

    function initialize(address owner_) external initializer {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function register(
        address merchant,
        address payable payout,
        string calldata name,
        string calldata metadataURI
    ) external onlyOwner whenNotPaused nonReentrant {
        require(merchant != address(0), "merchant=0");
        require(payout != address(0), "payout=0");
        require(bytes(name).length > 0, "name empty");
        Merchant storage m = _merchants[merchant];
        require(!m.registered, "already registered");
        m.registered = true;
        m.payout = payout;
        m.name = name;
        m.metadataURI = metadataURI;
        m.registeredAt = block.timestamp;
        _merchantList.push(merchant);
        merchantCount++;
        emit MerchantRegistered(merchant, payout, name, metadataURI);
    }

    function batchRegister(
        address[] calldata merchants,
        address payable[] calldata payouts,
        string[] calldata names,
        string[] calldata metadataURIs
    ) external onlyOwner whenNotPaused nonReentrant {
        require(
            merchants.length == payouts.length &&
            merchants.length == names.length &&
            merchants.length == metadataURIs.length,
            "length mismatch"
        );
        for (uint256 i = 0; i < merchants.length; i++) {
            require(merchants[i] != address(0), "merchant=0");
            require(payouts[i] != address(0), "payout=0");
            require(bytes(names[i]).length > 0, "name empty");
            Merchant storage m = _merchants[merchants[i]];
            require(!m.registered, "already registered");
            m.registered = true;
            m.payout = payouts[i];
            m.name = names[i];
            m.metadataURI = metadataURIs[i];
            m.registeredAt = block.timestamp;
            _merchantList.push(merchants[i]);
            merchantCount++;
            emit MerchantRegistered(merchants[i], payouts[i], names[i], metadataURIs[i]);
        }
    }

    function updatePayout(address merchant, address payable newPayout) external onlyOwner whenNotPaused {
        require(newPayout != address(0), "payout=0");
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        m.payout = newPayout;
        emit MerchantUpdated(merchant, m.payout, m.name, m.metadataURI);
    }

    function updateMetadata(address merchant, string calldata name, string calldata metadataURI) external onlyOwner whenNotPaused {
        require(bytes(name).length > 0, "name empty");
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        m.name = name;
        m.metadataURI = metadataURI;
        emit MerchantUpdated(merchant, m.payout, name, metadataURI);
    }

    function updatePayoutSelf(address payable newPayout) external whenNotPaused {
        require(newPayout != address(0), "payout=0");
        Merchant storage m = _merchants[msg.sender];
        require(m.registered, "not registered");
        m.payout = newPayout;
        emit MerchantUpdated(msg.sender, m.payout, m.name, m.metadataURI);
    }

    function updateMetadataSelf(string calldata name, string calldata metadataURI) external whenNotPaused {
        require(bytes(name).length > 0, "name empty");
        Merchant storage m = _merchants[msg.sender];
        require(m.registered, "not registered");
        m.name = name;
        m.metadataURI = metadataURI;
        emit MerchantUpdated(msg.sender, m.payout, name, metadataURI);
    }

    function _removeFromList(address merchant) private {
        for (uint256 i = 0; i < _merchantList.length; i++) {
            if (_merchantList[i] == merchant) {
                _merchantList[i] = _merchantList[_merchantList.length - 1];
                _merchantList.pop();
                break;
            }
        }
    }

    function unregister(address merchant) external onlyOwner whenNotPaused nonReentrant {
        Merchant storage m = _merchants[merchant];
        require(m.registered, "not registered");
        delete _merchants[merchant];
        _removeFromList(merchant);
        merchantCount--;
        emit MerchantUnregistered(merchant);
    }

    function batchUnregister(address[] calldata merchants) external onlyOwner whenNotPaused nonReentrant {
        for (uint256 i = 0; i < merchants.length; i++) {
            Merchant storage m = _merchants[merchants[i]];
            if (m.registered) {
                delete _merchants[merchants[i]];
                _removeFromList(merchants[i]);
                merchantCount--;
                emit MerchantUnregistered(merchants[i]);
            }
        }
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
        returns (bool registered, address payout, string memory name, string memory metadataURI, uint256 registeredAt)
    {
        Merchant storage m = _merchants[merchant];
        return (m.registered, m.payout, m.name, m.metadataURI, m.registeredAt);
    }

    function getMerchants(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory merchants, uint256 total)
    {
        total = _merchantList.length;
        if (offset >= total) {
            return (new address[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 length = end - offset;
        merchants = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            merchants[i] = _merchantList[offset + i];
        }
    }

    function getRegisteredMerchants(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory merchants, uint256 total)
    {
        uint256 registeredCount = 0;
        for (uint256 i = 0; i < _merchantList.length; i++) {
            if (_merchants[_merchantList[i]].registered) {
                registeredCount++;
            }
        }
        total = registeredCount;
        
        if (offset >= total || total == 0) {
            return (new address[](0), total);
        }
        
        uint256 collected = 0;
        uint256 needed = limit;
        if (offset + limit > total) {
            needed = total - offset;
        }
        merchants = new address[](needed);
        
        for (uint256 i = 0; i < _merchantList.length && collected < needed; i++) {
            if (_merchants[_merchantList[i]].registered) {
                if (collected >= offset) {
                    merchants[collected - offset] = _merchantList[i];
                }
                collected++;
            }
        }
    }

    function getAllMerchants() external view returns (address[] memory) {
        return _merchantList;
    }

    function getMerchantCount() external view returns (uint256) {
        return merchantCount;
    }

    function pause() external onlyOwner {
        require(!paused, "already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        require(newOwner != owner, "same owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    function renounceOwnership() external onlyOwner {
        address oldOwner = owner;
        owner = address(0);
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, address(0));
    }
}


