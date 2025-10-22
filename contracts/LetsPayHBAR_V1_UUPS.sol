// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract LetsPayHBAR_V1_UUPS {
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

    bool private _entered;
    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
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

    function proxiableUUID() external view returns (bytes32) {
        return _IMPLEMENTATION_SLOT;
    }

    function upgradeTo(address newImplementation) external onlyOwner onlyProxy {
        _upgradeToAndCallUUPS(newImplementation, "", false);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyOwner onlyProxy {
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

    uint256 public escrowCount;
    // Changed from 1e18 to 1e8 to match HBAR's 8 decimal places (tinybars)
    uint256 public constant CREDIT = 200 * 1e8;

    mapping(address => uint256) public credit;
    mapping(address => bool) public signedUp;

    enum EscrowStatus { CREATED, PAID, SETTLED, CANCELLED }

    struct Escrow {
        address host;
        address payable merchant;
        uint256 total;
        EscrowStatus status;
        address[] participants;
        uint256[] shares;
    }

    mapping(uint256 => Escrow) public escrows;
    mapping(uint256 => mapping(address => bool)) public accepted;

    event SignedUp(address indexed user, uint256 amount);
    event EscrowCreated(uint256 indexed id, address indexed host, address indexed merchant, uint256 total);
    event MerchantPaid(uint256 indexed id, address merchant, uint256 total);
    event ParticipantAccepted(uint256 indexed id, address participant, uint256 amount);
    event EscrowSettled(uint256 indexed id);
    event ContractFunded(address indexed from, uint256 amount);
    event CreditRepaid(address indexed user, uint256 amount);

    function initialize(address owner_) external initializer onlyProxy {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
    }

    function fundContract() external payable {
        require(msg.value > 0, "no value");
        emit ContractFunded(msg.sender, msg.value);
    }

    function signup() external {
        require(!signedUp[msg.sender], "already signed up");
        signedUp[msg.sender] = true;
        credit[msg.sender] = CREDIT;
        emit SignedUp(msg.sender, CREDIT);
    }

    function createEscrow(
        address payable merchant,
        address[] calldata otherParticipants,
        uint256[] calldata otherShares,
        uint256 total
    ) external nonReentrant returns (uint256) {
        require(otherParticipants.length == otherShares.length, "len mismatch");

        uint256 sum = 0; for (uint i = 0; i < otherShares.length; i++) { sum += otherShares[i]; }
        require(sum <= total, "shares too big");
        uint256 hostShare = total - sum;
        require(credit[msg.sender] >= hostShare, "insufficient host credit");
        require(address(this).balance >= total, "contract lacks funds");

        credit[msg.sender] -= total;
        (bool ok, ) = merchant.call{value: total}("");
        require(ok, "merchant payment failed");
        escrowCount++;
        Escrow storage e = escrows[escrowCount];
        e.host = msg.sender; e.merchant = merchant; e.total = total; e.status = EscrowStatus.PAID;
        e.participants.push(msg.sender); e.shares.push(hostShare);
        for (uint i = 0; i < otherParticipants.length; i++) { e.participants.push(otherParticipants[i]); e.shares.push(otherShares[i]); }

        emit EscrowCreated(escrowCount, msg.sender, merchant, total);
        emit MerchantPaid(escrowCount, merchant, total);
        return escrowCount;
    }

    function accept(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        require(e.status == EscrowStatus.PAID, "not payable");
        require(msg.sender != e.host, "host auto-paid");
        uint idx = type(uint).max; for (uint i = 0; i < e.participants.length; i++) { if (e.participants[i] == msg.sender) { idx = i; break; } }
        require(idx != type(uint).max, "not participant");
        require(!accepted[escrowId][msg.sender], "already accepted");
        uint256 amount = e.shares[idx];
        require(credit[msg.sender] >= amount, "insufficient credit");
        credit[msg.sender] -= amount; credit[e.host] += amount; accepted[escrowId][msg.sender] = true;
        emit ParticipantAccepted(escrowId, msg.sender, amount);
        bool all = true; for (uint i = 0; i < e.participants.length; i++) { if (e.participants[i] != e.host && !accepted[escrowId][e.participants[i]]) { all = false; break; } }
        if (all) { e.status = EscrowStatus.SETTLED; emit EscrowSettled(escrowId); }
    }

    function cancelEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        require(msg.sender == e.host || msg.sender == owner, "not allowed");
        require(e.status == EscrowStatus.PAID, "wrong state");
        e.status = EscrowStatus.CANCELLED; credit[e.host] += e.total;
    }

    function getPendingEscrowsFor(address user) external view returns (uint256[] memory) {
        uint256 cnt = 0;
        for (uint i = 1; i <= escrowCount; i++) {
            Escrow storage e = escrows[i];
            if (e.status == EscrowStatus.PAID) {
                for (uint j = 0; j < e.participants.length; j++) {
                    if (e.participants[j] == user && e.participants[j] != e.host && !accepted[i][user]) { cnt++; break; }
                }
            }
        }
        uint256[] memory ids = new uint256[](cnt); uint k = 0;
        for (uint i = 1; i <= escrowCount; i++) {
            Escrow storage e = escrows[i];
            if (e.status == EscrowStatus.PAID) {
                for (uint j = 0; j < e.participants.length; j++) {
                    if (e.participants[j] == user && e.participants[j] != e.host && !accepted[i][user]) { ids[k++] = i; break; }
                }
            }
        }
        return ids;
    }

    function escrowDetails(uint256 escrowId)
        external view
        returns (address host, address merchant, uint256 total, EscrowStatus status, address[] memory participants, uint256[] memory shares)
    {
        Escrow storage e = escrows[escrowId];
        return (e.host, e.merchant, e.total, e.status, e.participants, e.shares);
    }

    function getUserHistory(address user)
        external view
        returns (
            uint256[] memory ids,
            address[] memory hosts,
            address[] memory merchants,
            uint256[] memory totals,
            EscrowStatus[] memory statuses,
            address[][] memory participantsList,
            uint256[][] memory sharesList
        )
    {
        uint256 cnt = 0;
        for (uint i = 1; i <= escrowCount; i++) {
            Escrow storage e = escrows[i];
            if (e.host == user) { cnt++; }
            else { for (uint j = 0; j < e.participants.length; j++) { if (e.participants[j] == user) { cnt++; break; } } }
        }
        ids = new uint256[](cnt); hosts = new address[](cnt); merchants = new address[](cnt); totals = new uint256[](cnt);
        statuses = new EscrowStatus[](cnt); participantsList = new address[][](cnt); sharesList = new uint256[][](cnt);
        uint k = 0;
        for (uint i = 1; i <= escrowCount; i++) {
            Escrow storage e = escrows[i]; bool involved = false;
            if (e.host == user) { involved = true; }
            else { for (uint j = 0; j < e.participants.length; j++) { if (e.participants[j] == user) { involved = true; break; } } }
            if (involved) {
                ids[k] = i; hosts[k] = e.host; merchants[k] = e.merchant; totals[k] = e.total; statuses[k] = e.status; participantsList[k] = e.participants; sharesList[k] = e.shares; k++;
            }
        }
    }

    function repayCredit() external payable nonReentrant {
        require(msg.value > 0, "no value");
        credit[msg.sender] += msg.value;
        emit CreditRepaid(msg.sender, msg.value);
    }

    receive() external payable {}
}