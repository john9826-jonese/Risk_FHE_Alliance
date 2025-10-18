pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract RiskFHEAllianceFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error InvalidBatch();
    error InvalidCooldown();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Alliance {
        euint32 player1Id;
        euint32 player2Id;
        euint32 allianceType; // 0: NonAggression, 1: MutualDefense
        euint32 creationBatchId;
    }
    mapping(uint256 => Alliance) public alliances; // allianceId => Alliance
    uint256 public nextAllianceId;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public currentBatchId;
    bool public batchOpen;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused();
    event ContractUnpaused();
    event CooldownSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event AllianceSubmitted(uint256 indexed allianceId, uint256 batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 batchId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown(address submitter) {
        if (block.timestamp < lastSubmissionTime[submitter] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionRequestCooldown(address requester) {
        if (block.timestamp < lastDecryptionRequestTime[requester] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        providers[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        cooldownSeconds = 30; // Default cooldown
        currentBatchId = 1; // Start with batch 1
        batchOpen = false; // Batch closed by default
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused == paused) return;
        if (_paused) {
            paused = true;
            emit ContractPaused();
        } else {
            paused = false;
            emit ContractUnpaused();
        }
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        if (newCooldown == 0) revert InvalidCooldown();
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSet(oldCooldown, newCooldown);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) return; // Or revert if you prefer
        batchOpen = true;
        currentBatchId++; // Increment for the new batch
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) return; // Or revert
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitAlliance(
        euint32 player1Id,
        euint32 player2Id,
        euint32 allianceType,
        euint32 creationBatchId
    ) external onlyProvider whenNotPaused submissionCooldown(msg.sender) {
        if (!batchOpen) revert InvalidBatch();
        if (creationBatchId.ciphertext[0] != FHE.asEuint32(currentBatchId).ciphertext[0]) {
             // Basic check, actual equality check is FHE.eq
            revert InvalidBatch();
        }

        _initIfNeeded(player1Id);
        _initIfNeeded(player2Id);
        _initIfNeeded(allianceType);
        _initIfNeeded(creationBatchId);

        uint256 allianceId = nextAllianceId++;
        alliances[allianceId] = Alliance(player1Id, player2Id, allianceType, creationBatchId);

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit AllianceSubmitted(allianceId, currentBatchId, msg.sender);
    }

    function _initIfNeeded(euint32 x) internal {
        if (!FHE.isInitialized(x)) revert NotInitialized();
    }

    function _initIfNeeded(ebool x) internal {
        if (!FHE.isInitialized(x)) revert NotInitialized();
    }

    function requestBatchDecryption(uint256 batchIdToDecrypt) external whenNotPaused decryptionRequestCooldown(msg.sender) {
        if (batchOpen && batchIdToDecrypt == currentBatchId) revert InvalidBatch(); // Cannot decrypt open batch
        if (batchIdToDecrypt >= currentBatchId) revert InvalidBatch(); // Cannot decrypt future or current batch

        uint256 numAlliancesInBatch = 0;
        // This part is simplified: in a real scenario, you'd iterate through alliances
        // and count those belonging to batchIdToDecrypt.
        // For this example, we assume we know how many alliances are in the batch.
        // A more robust way would be to store alliances per batch or iterate.
        // For now, let's assume we are decrypting a fixed number of alliances for simplicity,
        // or we'd need a way to iterate alliances for a given batchId.
        // This example will decrypt one pre-defined alliance for simplicity.
        // In a real game, you'd iterate through alliances created in `batchIdToDecrypt`.
        // For this example, let's assume `alliances[0]` is the one we want to decrypt.
        // A real implementation would need to find alliances by batchId.
        // This is a placeholder for that logic.
        // For this example, we'll assume we are decrypting alliance 0.
        Alliance storage alliance = alliances[0]; // Example: decrypting the first alliance

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(alliance.player1Id);
        cts[1] = FHE.toBytes32(alliance.player2Id);
        cts[2] = FHE.toBytes32(alliance.allianceType);
        cts[3] = FHE.toBytes32(alliance.creationBatchId);

        bytes32 stateHash = _hashCiphertexts(cts);

        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext(batchIdToDecrypt, stateHash, false);
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchIdToDecrypt);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        if (cleartexts.length != 4 * 32) revert InvalidProof(); // Expecting 4 uint32s

        // Rebuild cts array from current contract storage in the *exact same order*
        // This is crucial for state verification.
        // We need to know which alliance this requestId corresponds to.
        // This simplified example assumes it's always alliance 0 for requestId 0.
        // A real system would need to store which allianceId(s) a requestId refers to.
        // For this example, we'll assume `alliances[0]` is the one being decrypted.
        Alliance storage alliance = alliances[0]; // Simplified example

        bytes32[] memory currentCts = new bytes32[](4);
        currentCts[0] = FHE.toBytes32(alliance.player1Id);
        currentCts[1] = FHE.toBytes32(alliance.player2Id);
        currentCts[2] = FHE.toBytes32(alliance.allianceType);
        currentCts[3] = FHE.toBytes32(alliance.creationBatchId);

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        FHE.checkSignatures(requestId, cleartexts, proof); // Will revert on failure

        // If successful, decode cleartexts
        // cleartexts is abi.encodePacked(uint32, uint32, uint32, uint32)
        uint32 player1IdCleartext = uint32(uint256(bytes32(cleartexts[0x00:0x20])));
        uint32 player2IdCleartext = uint32(uint256(bytes32(cleartexts[0x20:0x40])));
        uint32 allianceTypeCleartext = uint32(uint256(bytes32(cleartexts[0x40:0x60])));
        uint32 creationBatchIdCleartext = uint32(uint256(bytes32(cleartexts[0x60:0x80])));

        // Here you would use these cleartext values.
        // For example, emit them or store them in a separate mapping for decrypted results.
        // This contract focuses on the FHE interaction, so we just mark as processed.
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId);
    }
}