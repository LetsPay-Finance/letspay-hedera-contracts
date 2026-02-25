// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IHederaTokenService {
    function transferToken(
        address token,
        address sender,
        address receiver,
        int64 amount
    ) external returns (int64);

    function associateToken(
        address account,
        address token
    ) external returns (int64);
}

contract LetsPayBondingCurve {
    /*//////////////////////////////////////////////////////////////
                            UUPS UPGRADE LOGIC
    //////////////////////////////////////////////////////////////*/

    bool private _initialized;
    modifier initializer() {
        require(!_initialized, "inited");
        _initialized = true;
        _;
    }

    bytes32 private constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address private immutable __self = address(this);

    modifier onlyProxy() {
        require(address(this) != __self, "UUPS: delegatecall only");
        require(_getImplementation() == __self, "UUPS: not active impl");
        _;
    }

    constructor() {
        _initialized = true;
    }

    function _getImplementation() internal view returns (address impl) {
        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly { impl := sload(slot) }
    }

    function proxiableUUID() external pure returns (bytes32) {
        return _IMPLEMENTATION_SLOT;
    }

    function upgradeTo(address newImplementation) external onlyProxy {
        if (msg.sender != TREASURY) revert NotTreasury();
        _upgradeToAndCallUUPS(newImplementation, "", false);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyProxy {
        if (msg.sender != TREASURY) revert NotTreasury();
        _upgradeToAndCallUUPS(newImplementation, data, true);
    }

    function _upgradeToAndCallUUPS(address newImplementation, bytes memory data, bool forceCall) internal {
        require(newImplementation.code.length > 0, "UUPS: impl !contract");
        (bool ok, bytes memory ret) = newImplementation.staticcall(abi.encodeWithSignature("proxiableUUID()"));
        require(ok && ret.length == 32 && abi.decode(ret, (bytes32)) == _IMPLEMENTATION_SLOT, "UUPS: invalid UUID");
        _setImplementation(newImplementation);
        if (data.length > 0 || forceCall) {
            (bool s, bytes memory r) = newImplementation.delegatecall(data);
            require(s, string(r));
        }
    }

    function _setImplementation(address newImplementation) private {
        bytes32 slot = _IMPLEMENTATION_SLOT;
        assembly { sstore(slot, newImplementation) }
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    address public constant TREASURY =
        0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F;

    address public LTP_TOKEN;

    // LTP has 2 decimals → 1 LTP = 100 base units
    uint256 public constant TOKEN_DECIMALS = 100;

    uint256 public constant MAX_CURVE_SUPPLY =
        300_000 * TOKEN_DECIMALS;

    IHederaTokenService private constant HTS =
        IHederaTokenService(address(0x167));

    int64 private constant HTS_SUCCESS = 22;

    // ✅ GAS OPTIMIZED: Use immutable byte variables for tier thresholds to satisfy Solidity restrictions.
    // Constants must be value types or bytes; workaround with bytes encoding.
    bytes public constant TIER_THRESHOLDS = abi.encodePacked(
        uint40(50_000  * TOKEN_DECIMALS),    // 5,000,000 base units
        uint40(100_000 * TOKEN_DECIMALS),    // 10,000,000 base units
        uint40(175_000 * TOKEN_DECIMALS),    // 17,500,000 base units
        uint40(250_000 * TOKEN_DECIMALS),    // 25,000,000 base units
        uint40(300_000 * TOKEN_DECIMALS)     // 30,000,000 base units
    );

    // Helper to fetch a threshold (decodes 5 x uint40 from bytes)
    function getTierThreshold(uint256 i) public pure returns (uint256) {
        require(i < 5, "tier index out of range");
        bytes memory thresholds = TIER_THRESHOLDS;
        uint256 offset = i * 5;
        uint256 value;
        assembly {
            // Load 32 bytes starting at offset (skips 0x20 length prefix)
            let word := mload(add(add(thresholds, 0x20), offset))
            // Extract uint40 (5 bytes) from leftmost: shift right by 216 bits, mask to 40 bits
            value := and(shr(216, word), 0xffffffffff)
        }
        return value;
    }

    // ✅ GAS OPTIMIZED: Price per 1 LTP in TINYBAR (1e8 = 1 HBAR)
    // Constants must be value types or bytes; workaround with bytes encoding.
    bytes public constant TIER_PRICES = abi.encodePacked(
        uint32(1_000_000),   // 0.01 HBAR
        uint32(2_000_000),   // 0.02 HBAR
        uint32(4_000_000),   // 0.04 HBAR
        uint32(7_000_000),   // 0.07 HBAR
        uint32(10_000_000)   // 0.10 HBAR
    );

    // Helper to fetch a price (decodes 5 x uint32 from bytes)
    function getTierPrice(uint256 i) public pure returns (uint256) {
        require(i < 5, "tier index out of range");
        bytes memory prices = TIER_PRICES;
        uint256 offset = i * 4;
        uint256 value;
        assembly {
            // Load 32 bytes starting at offset (skips 0x20 length prefix)
            let word := mload(add(add(prices, 0x20), offset))
            // Extract uint32 (4 bytes) from leftmost: shift right by 224 bits, mask to 32 bits
            value := and(shr(224, word), 0xffffffff)
        }
        return value;
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public tokensSold; // base units
    bool public paused;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event TokensPurchased(
        address indexed buyer,
        uint256 hbarSpent,
        uint256 tokensReceived,
        uint256 pricePerToken,
        uint256 totalSold
    );

    event Paused();
    event Unpaused();
    event LTPTokenUpdated(address indexed oldToken, address indexed newToken);
    event TokenAssociated(address indexed token);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error SalePaused();
    error SoldOut();
    error ZeroPayment();
    error NotTreasury();
    error HTSTransferFailed();

    /*//////////////////////////////////////////////////////////////
                            INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    function initialize(address _ltpToken) external initializer onlyProxy {
        require(_ltpToken != address(0), "LTP token=0");
        LTP_TOKEN = _ltpToken;
    }

    receive() external payable {
        buy();
    }

    /*//////////////////////////////////////////////////////////////
                                BUY LOGIC
    //////////////////////////////////////////////////////////////*/

    function buy() public payable {
        if (paused) revert SalePaused();
        if (msg.value == 0) revert ZeroPayment();
        if (tokensSold >= MAX_CURVE_SUPPLY) revert SoldOut();

        uint256 tier = _currentTier();
        uint256 price = getTierPrice(tier);

        uint256 remainingInTier =
            getTierThreshold(tier) - tokensSold;

        // msg.value and price are both in tinybar
        uint256 tokensToBuy =
            (msg.value * TOKEN_DECIMALS) / price;

        if (tokensToBuy > remainingInTier) {
            tokensToBuy = remainingInTier;
        }

        uint256 hbarRequired =
            (tokensToBuy * price) / TOKEN_DECIMALS;

        uint256 refund = msg.value - hbarRequired;

        tokensSold += tokensToBuy;

        int64 response = HTS.transferToken(
            LTP_TOKEN,
            address(this),
            msg.sender,
            int64(int256(tokensToBuy))
        );

        if (response != HTS_SUCCESS) revert HTSTransferFailed();

        (bool sent, ) = TREASURY.call{value: hbarRequired}("");
        require(sent, "HBAR transfer failed");

        if (refund > 0) {
            (bool refunded, ) = msg.sender.call{value: refund}("");
            require(refunded, "Refund failed");
        }

        emit TokensPurchased(
            msg.sender,
            hbarRequired,
            tokensToBuy,
            price,
            tokensSold
        );
    }

    /*//////////////////////////////////////////////////////////////
                                VIEW
    //////////////////////////////////////////////////////////////*/

    function currentPrice() external view returns (uint256) {
        return getTierPrice(_currentTier());
    }

    function _currentTier() internal view returns (uint256) {
        for (uint256 i = 0; i < 5; i++) {
            if (tokensSold < getTierThreshold(i)) {
                return i;
            }
        }
        revert SoldOut();
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/

    function withdrawTokens(uint256 amount) external {
        if (msg.sender != TREASURY) revert NotTreasury();

        int64 response = HTS.transferToken(
            LTP_TOKEN,
            address(this),
            TREASURY,
            int64(int256(amount))
        );

        if (response != HTS_SUCCESS) revert HTSTransferFailed();
    }

    function pause() external {
        if (msg.sender != TREASURY) revert NotTreasury();
        paused = true;
        emit Paused();
    }

    function unpause() external {
        if (msg.sender != TREASURY) revert NotTreasury();
        paused = false;
        emit Unpaused();
    }

    function updateLTPToken(address _newLTPToken) external {
        if (msg.sender != TREASURY) revert NotTreasury();
        require(_newLTPToken != address(0), "LTP token=0");
        address oldToken = LTP_TOKEN;
        LTP_TOKEN = _newLTPToken;
        emit LTPTokenUpdated(oldToken, _newLTPToken);
    }

    function associate() external {
        if (msg.sender != TREASURY) revert NotTreasury();
        
        int64 response = HTS.associateToken(address(this), LTP_TOKEN);
        if (response != HTS_SUCCESS) revert HTSTransferFailed();
        
        emit TokenAssociated(LTP_TOKEN);
    }
}
