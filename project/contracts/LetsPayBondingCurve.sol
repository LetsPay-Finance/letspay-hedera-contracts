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
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    address public constant TREASURY =
        0x001c8DCF4F09d719F62d73B9b0Aa0afF2a05EF4F;

    address public immutable LTP_TOKEN;

    uint256 public constant MAX_CURVE_SUPPLY = 300_000;

    // Hedera Token Service precompile
    IHederaTokenService private constant HTS =
        IHederaTokenService(address(0x167));

    int64 private constant HTS_SUCCESS = 22;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public tokensSold;
    bool public paused;

    uint256[5] public tierThresholds = [
        50_000,
        100_000,
        175_000,
        250_000,
        300_000
    ];

    uint256[5] public tierPrices = [
        0.01 ether,
        0.02 ether,
        0.04 ether,
        0.07 ether,
        0.10 ether
    ];

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

    event TokenAssociated(address indexed token);
    event Paused();
    event Unpaused();

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error SalePaused();
    error SoldOut();
    error ZeroPayment();
    error HTSTransferFailed();
    error HTSAssociateFailed();

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _ltpToken) {
        LTP_TOKEN = _ltpToken;
    }

    /*//////////////////////////////////////////////////////////////
                                BUY LOGIC
    //////////////////////////////////////////////////////////////*/

    receive() external payable {
        buy();
    }

    function buy() public payable {
        if (paused) revert SalePaused();
        if (msg.value == 0) revert ZeroPayment();
        if (tokensSold >= MAX_CURVE_SUPPLY) revert SoldOut();

        uint256 tierIndex = _currentTier();
        uint256 price = tierPrices[tierIndex];

        uint256 remainingInTier =
            tierThresholds[tierIndex] - tokensSold;

        uint256 tokensToBuy = msg.value / price;

        if (tokensToBuy > remainingInTier) {
            tokensToBuy = remainingInTier;
        }

        uint256 hbarRequired = tokensToBuy * price;
        uint256 refund = msg.value - hbarRequired;

        tokensSold += tokensToBuy;

        int64 response = HTS.transferToken(
            LTP_TOKEN,
            address(this),
            msg.sender,
            int64(int256(tokensToBuy))
        );

        if (response != HTS_SUCCESS) revert HTSTransferFailed();

        (bool sentTreasury, ) =
            TREASURY.call{value: hbarRequired}("");
        require(sentTreasury, "HBAR transfer failed");

        if (refund > 0) {
            (bool refunded, ) =
                msg.sender.call{value: refund}("");
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
                                VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function currentPrice() external view returns (uint256) {
        return tierPrices[_currentTier()];
    }

    function _currentTier() internal view returns (uint256) {
        for (uint256 i = 0; i < tierThresholds.length; i++) {
            if (tokensSold < tierThresholds[i]) {
                return i;
            }
        }
        revert SoldOut();
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/

    function associateToken() external {
        require(msg.sender == TREASURY, "Not treasury");

        int64 response = HTS.associateToken(address(this), LTP_TOKEN);
        if (response != HTS_SUCCESS) revert HTSAssociateFailed();

        emit TokenAssociated(LTP_TOKEN);
    }

    function pause() external {
        require(msg.sender == TREASURY, "Not treasury");
        paused = true;
        emit Paused();
    }

    function unpause() external {
        require(msg.sender == TREASURY, "Not treasury");
        paused = false;
        emit Unpaused();
    }
}
