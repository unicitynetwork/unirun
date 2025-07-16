// Unicity Runner Demo - Main Game Logic
import { Engine } from 'noa-engine'
import * as BABYLON from '@babylonjs/core'

// Global world seed for deterministic generation
const WORLD_SEED = 'UnicityRunnerDemo_v1_Seed_2025';
const GAMEDEV_VERSION = 'dev00029'; // Version for chunk token ID generation
const CHUNK_TOKEN_TYPE_BYTES = new Uint8Array([9]); // Token type for chunks

// Initialize globals
let noa;
let playerToken;
let signingService;

// Track chunks being tokenized to prevent concurrent processing
const chunksBeingTokenized = new Map(); // key: "x,z", value: Promise

// Block IDs (will be set during engine setup)
let roomFloorID;
let corridorEastID;
let corridorNorthID;
let corridorWestID;

// Game entities
let droneEntity = null;
let projectiles = [];
let currentPlayerHealth = 100; // Track current health during gameplay

// Token status tracking
let tokenStatus = {
    initialized: false,
    totalSubmissions: 0,
    successfulSubmissions: 0,
    pendingTransaction: false,
    lastUpdateTime: null,
    lastError: null
};

// No custom meshes needed - noa only supports full block collision

// Update token status display
function updateTokenStatusDisplay() {
    const statusContent = document.getElementById('tokenStatusContent');
    if (!statusContent) return;
    
    let html = '';
    
    if (!tokenStatus.initialized) {
        html = '<div class="status-line">Initializing...</div>';
    } else {
        html += `<div class="status-line">Submissions: <span class="success">${tokenStatus.successfulSubmissions}</span> / ${tokenStatus.totalSubmissions}</div>`;
        
        if (tokenStatus.pendingTransaction) {
            html += '<div class="status-line pending">⏳ Pending transaction...</div>';
        } else if (tokenStatus.lastUpdateTime) {
            const secondsAgo = Math.floor((Date.now() - tokenStatus.lastUpdateTime) / 1000);
            html += `<div class="status-line">Last update: ${secondsAgo}s ago</div>`;
        }
        
        if (tokenStatus.lastError) {
            html += `<div class="status-line error">⚠️ ${tokenStatus.lastError}</div>`;
        }
    }
    
    statusContent.innerHTML = html;
}

// Track all pending mint transactions
const pendingMintTransactions = new Map(); // key: "x,z", value: mint data

// Save pending transactions before page unload
window.addEventListener('beforeunload', () => {
    if (pendingMintTransactions.size > 0) {
        console.log(`Saving ${pendingMintTransactions.size} pending mint transactions before unload...`);
        
        // Force save all pending mint transactions
        pendingMintTransactions.forEach((mintData, chunkKey) => {
            const [x, z] = chunkKey.split(',').map(Number);
            const mintTxKey = getChunkStorageKey(x, z, 'mintTx');
            try {
                localStorage.setItem(mintTxKey, JSON.stringify(mintData));
                console.log(`Emergency save of mint transaction for chunk (${x}, ${z})`);
            } catch (e) {
                console.error(`Failed to save mint transaction for chunk (${x}, ${z}):`, e);
            }
        });
    }
});

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
});

async function initializeGame() {
    console.log('Initializing Unicity Runner...');
    
    // Check for gamedev version change and clear chunk tokens if needed
    checkGamedevVersionAndClearChunks();
    
    // Update status display periodically
    setInterval(updateTokenStatusDisplay, 1000);
    
    // Set up reset button
    const resetButton = document.getElementById('resetPlayer');
    resetButton.addEventListener('click', () => {
        localStorage.removeItem('unicityRunner_playerToken');
        localStorage.removeItem('unicityRunner_privateKey');
        localStorage.removeItem('unicityRunner_pendingTransaction');
        location.reload();
    });
    
    // Initialize player token
    await initializePlayerToken();
    
    // Set up noa engine
    setupNoaEngine();
    
    // Start periodic state updates
    startPeriodicUpdates();
}

// Seeded random number generator with better distribution
function seededRandom(seed) {
    // Convert string seed to a numeric hash
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Use a better PRNG algorithm (Mulberry32)
    return function() {
        let t = hash += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Calculate initial spawn point deterministically
function calculateInitialSpawnPoint(seed) {
    const rng = seededRandom(seed + '_spawn');
    // Generate level pattern for chunk 0,0
    const chunkSize = 32;
    const level = generateLevelForChunk(0, 0, seed);
    
    // Find the first open space near the center
    const centerX = Math.floor(chunkSize / 2);
    const centerZ = Math.floor(chunkSize / 2);
    
    // Spiral search from center to find open space
    for (let radius = 0; radius < chunkSize / 2; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;
                if (x >= 0 && x < chunkSize && z >= 0 && z < chunkSize && level[x][z] !== 'wall') {
                    return [x + 0.5, 6, z + 0.5]; // Center of the block, 6 blocks above ground
                }
            }
        }
    }
    
    // Fallback to center if no open space found
    return [centerX + 0.5, 6, centerZ + 0.5];
}

// RNG functions for room and exit determination
function roomExists(x, z, seed) {
    const rng = seededRandom(seed + '_room_' + x + '_' + z);
    const result = rng() < 0.4; // 40% chance of room
    return result;
}

function getRoomDimensions(x, z, seed) {
    const rng = seededRandom(seed + '_roomdim_' + x + '_' + z);
    const width = Math.floor(rng() * 9) + 7; // 7-15 blocks
    const length = Math.floor(rng() * 9) + 7; // 7-15 blocks
    return { width, length };
}

function eastExitExists(x, z, seed) {
    // Use a more unique seed to avoid patterns
    const rng = seededRandom(seed + '_exit_east_' + (x * 1000) + '_' + (z * 1000));
    const result = rng() < 0.8; // 80% chance - more frequent
    return result;
}

function northExitExists(x, z, seed) {
    // Use a more unique seed to avoid patterns
    const rng = seededRandom(seed + '_exit_north_' + (x * 1000) + '_' + (z * 1000));
    const result = rng() < 0.3; // 30% chance - more rare
    return result;
}

function westExitExists(x, z, seed) {
    // Use a more unique seed to avoid patterns
    const rng = seededRandom(seed + '_exit_west_' + (x * 1000) + '_' + (z * 1000));
    const result = rng() < 0.8; // 80% chance - more frequent
    return result;
}

// Get raw room exits without any redirection logic
function getRawRoomExits(x, z, seed) {
    const east = eastExitExists(x, z, seed);
    const north = northExitExists(x, z, seed);
    const west = westExitExists(x, z, seed);
    
    // If no exits, force at least one
    if (!east && !north && !west) {
        const rng = seededRandom(seed + '_forcedexit_' + (x * 1000) + '_' + (z * 1000));
        const choice = Math.floor(rng() * 3);
        return {
            east: choice === 0,
            north: choice === 1,
            west: choice === 2
        };
    }
    
    return { east, north, west };
}

// Ensure at least one exit exists
function getRoomExits(x, z, seed) {
    let east = eastExitExists(x, z, seed);
    let north = northExitExists(x, z, seed);
    const west = westExitExists(x, z, seed);
    
    // Check for loop prevention: if east exit exists
    if (east) {
        // Check if there's an incoming corridor from the east (entering the room)
        let hasIncomingEastCorridor = false;
        
        // Look for the closest room to the east
        for (let checkX = x + 1; checkX <= x + 20; checkX++) {
            if (roomExists(checkX, z, seed)) {
                // Use raw exits to avoid recursion
                const neighborExits = getRawRoomExits(checkX, z, seed);
                if (neighborExits.west) {
                    // There's an incoming corridor from the east
                    hasIncomingEastCorridor = true;
                }
                break; // Stop at first room found
            }
        }
        
        // If we have both incoming east and outgoing east, redirect to north
        if (hasIncomingEastCorridor && east && !north) {
            east = false;
            north = true; // Force north exit instead
        }
    }
    
    // If no exits, force at least one
    if (!east && !north && !west) {
        const rng = seededRandom(seed + '_forcedexit_' + (x * 1000) + '_' + (z * 1000));
        const choice = Math.floor(rng() * 3);
        return {
            east: choice === 0,
            north: choice === 1,
            west: choice === 2
        };
    }
    
    return { east, north, west };
}

// ============== CHUNK TOKENIZATION FUNCTIONS ==============

// Generate deterministic token ID for a chunk
async function generateChunkTokenId(chunkX, chunkZ, worldSeed, gamedevVersion) {
    // Create a deterministic string from chunk coordinates, world seed, and version
    const chunkIdentifier = `chunk_${worldSeed}_${chunkX}_${chunkZ}_${gamedevVersion}`;
    
    // Use Unicity SDK's DataHasher for proper hashing
    const encoder = new TextEncoder();
    const data = encoder.encode(chunkIdentifier);
    
    const dataHash = await new window.UnicitySDK.DataHasher(
        window.UnicitySDK.HashAlgorithm.SHA256
    ).update(data).digest();
    
    // Return the hash data as the token ID bytes
    return dataHash.data;
}

// Generate deterministic nonce for chunk signer service
async function generateChunkNonce(chunkX, chunkZ, worldSeed) {
    const nonceIdentifier = `chunk_nonce_${worldSeed}_${chunkX}_${chunkZ}`;
    
    // Use Unicity SDK's DataHasher for proper hashing
    const encoder = new TextEncoder();
    const data = encoder.encode(nonceIdentifier);
    
    const dataHash = await new window.UnicitySDK.DataHasher(
        window.UnicitySDK.HashAlgorithm.SHA256
    ).update(data).digest();
    
    // Return the hash data as the nonce
    return dataHash.data;
}

// Get localStorage key for chunk token data
function getChunkStorageKey(chunkX, chunkZ, dataType) {
    return `unicityRunner_chunk_${chunkX}_${chunkZ}_${dataType}`;
}

// Load chunk token data from localStorage
function loadChunkTokenData(chunkX, chunkZ) {
    const tokenKey = getChunkStorageKey(chunkX, chunkZ, 'token');
    const commitmentKey = getChunkStorageKey(chunkX, chunkZ, 'commitment');
    const stateKey = getChunkStorageKey(chunkX, chunkZ, 'state');
    
    const tokenString = localStorage.getItem(tokenKey);
    const commitmentString = localStorage.getItem(commitmentKey);
    const stateString = localStorage.getItem(stateKey);
    
    // Check if the state has the current gamedev version
    if (stateString) {
        const state = JSON.parse(stateString);
        if (state.gamedevVersion !== GAMEDEV_VERSION) {
            // This token is from a different version, ignore it completely
            return {
                token: null,
                commitment: null,
                state: null
            };
        }
    }
    
    return {
        token: tokenString ? JSON.parse(tokenString) : null,
        commitment: commitmentString ? JSON.parse(commitmentString) : null,
        state: stateString ? JSON.parse(stateString) : null
    };
}

// Save chunk token data to localStorage
function saveChunkTokenData(chunkX, chunkZ, data) {
    if (data.token) {
        const tokenKey = getChunkStorageKey(chunkX, chunkZ, 'token');
        localStorage.setItem(tokenKey, JSON.stringify(data.token));
    }
    
    if (data.commitment) {
        const commitmentKey = getChunkStorageKey(chunkX, chunkZ, 'commitment');
        localStorage.setItem(commitmentKey, JSON.stringify(data.commitment));
    }
    
    if (data.state) {
        const stateKey = getChunkStorageKey(chunkX, chunkZ, 'state');
        localStorage.setItem(stateKey, JSON.stringify(data.state));
    }
}

// Clear chunk token data from localStorage
function clearChunkTokenData(chunkX, chunkZ) {
    const tokenKey = getChunkStorageKey(chunkX, chunkZ, 'token');
    const commitmentKey = getChunkStorageKey(chunkX, chunkZ, 'commitment');
    const stateKey = getChunkStorageKey(chunkX, chunkZ, 'state');
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(commitmentKey);
    localStorage.removeItem(stateKey);
    localStorage.removeItem(pendingKey);
}

// Create or recover chunk token
async function ensureChunkToken(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    
    // Check if this chunk is already being tokenized (in-memory)
    if (chunksBeingTokenized.has(chunkKey)) {
        console.log(`Chunk (${chunkX}, ${chunkZ}) is already being tokenized, waiting...`);
        return await chunksBeingTokenized.get(chunkKey);
    }
    
    // SYNCHRONOUS CHECK AND SET - critical section
    // Check for pending state BEFORE creating the promise
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    const existingPending = localStorage.getItem(pendingKey);
    
    if (existingPending) {
        const pending = JSON.parse(existingPending);
        console.log(`Chunk (${chunkX}, ${chunkZ}) has a pending token (age: ${Math.floor((Date.now() - pending.timestamp) / 1000)}s)`);
        
        // Check if we have a mint transaction for this chunk
        const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
        const savedMintTx = localStorage.getItem(mintTxKey);
        
        if (savedMintTx) {
            const mintData = JSON.parse(savedMintTx);
            // Check gamedev version
            if (mintData.chunkState && mintData.chunkState.gamedevVersion !== GAMEDEV_VERSION) {
                console.log(`Pending token for chunk (${chunkX}, ${chunkZ}) is from old version, clearing...`);
                localStorage.removeItem(pendingKey);
                localStorage.removeItem(mintTxKey);
                // Continue with normal flow
            } else if (mintData.submitted) {
                console.log(`Chunk (${chunkX}, ${chunkZ}) already submitted, attempting recovery...`);
                // Create a promise that attempts to complete the minting
                const recoveryPromise = createNewChunkToken(chunkX, chunkZ).catch(error => {
                    console.error(`Recovery failed for chunk (${chunkX}, ${chunkZ}):`, error);
                    return null;
                });
                chunksBeingTokenized.set(chunkKey, recoveryPromise);
                return recoveryPromise;
            }
        }
        
        // If we have pending but no mint transaction, clear it and continue
        console.log(`Chunk (${chunkX}, ${chunkZ}) has stale pending state, clearing...`);
        localStorage.removeItem(pendingKey);
    }
    
    // Mark as pending IMMEDIATELY (synchronously) before any async work
    localStorage.setItem(pendingKey, JSON.stringify({
        timestamp: Date.now(),
        sessionId: Date.now() + Math.random() // Unique session identifier
    }));
    
    // Create a promise for this chunk tokenization
    const tokenizationPromise = (async () => {
        try {
            // Load existing data
            const existingData = loadChunkTokenData(chunkX, chunkZ);
            
            // If token exists, recreate it from saved data
            if (existingData.token) {
                try {
                    // Use TokenFactory to recreate the token from stored data
                    const predicateFactory = new window.UnicitySDK.PredicateJsonFactory();
                    const tokenJsonSerializer = new window.UnicitySDK.TokenJsonSerializer(predicateFactory);
                    const tokenFactory = new window.UnicitySDK.TokenFactory(tokenJsonSerializer);
                    const chunkToken = await tokenFactory.create(existingData.token);
                    
                    // Clear pending state since we have a token
                    localStorage.removeItem(pendingKey);
                    return chunkToken;
                } catch (error) {
                    console.error(`Failed to recreate chunk token for (${chunkX}, ${chunkZ}):`, error);
                    // Clear invalid token data
                    clearChunkTokenData(chunkX, chunkZ);
                    // Don't clear pending - let createNewChunkToken handle it
                }
            }
            
            // Check for saved mint transaction (unfinished minting)
            const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
            const savedMintTx = localStorage.getItem(mintTxKey);
            if (savedMintTx) {
                console.log(`Found unfinished mint transaction for chunk (${chunkX}, ${chunkZ}), attempting to complete...`);
            }
            
            // Create new token from scratch (or recover from saved mint tx)
            return await createNewChunkToken(chunkX, chunkZ);
        } catch (error) {
            // Clear pending state on error
            localStorage.removeItem(pendingKey);
            throw error;
        } finally {
            // Remove from tracking map when done
            chunksBeingTokenized.delete(chunkKey);
        }
    })();
    
    // Store the promise in the map
    chunksBeingTokenized.set(chunkKey, tokenizationPromise);
    
    return tokenizationPromise;
}

// Create a new chunk token
async function createNewChunkToken(chunkX, chunkZ) {
    console.log(`Starting chunk tokenization for (${chunkX}, ${chunkZ})...`);
    
    // Get pending key once at the beginning
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    
    try {
        // Check if we have a saved mint transaction to recover
        const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
        const savedMintTx = localStorage.getItem(mintTxKey);
        
        let tokenId, tokenType, predicate, mintData, chunkState, stateBytes, chunkNonce;
        let shouldCreateNew = true;
        
        if (savedMintTx) {
            const savedData = JSON.parse(savedMintTx);
            
            // Check if this mint transaction is for the current gamedev version
            if (savedData.chunkState && savedData.chunkState.gamedevVersion !== GAMEDEV_VERSION) {
                console.log(`Mint transaction for chunk (${chunkX}, ${chunkZ}) is from version ${savedData.chunkState.gamedevVersion}, ignoring...`);
                // Remove the old mint transaction
                localStorage.removeItem(mintTxKey);
                // Proceed to create new token
            } else {
                shouldCreateNew = false;
                // Recover from saved mint transaction
                console.log(`Recovering saved mint transaction for chunk (${chunkX}, ${chunkZ})...`);
                
                tokenId = window.UnicitySDK.TokenId.create(
                    window.UnicitySDK.HexConverter.decode(savedData.tokenId)
                );
                tokenType = window.UnicitySDK.TokenType.create(
                    window.UnicitySDK.HexConverter.decode(savedData.tokenType)
                );
                chunkState = savedData.chunkState;
                stateBytes = new TextEncoder().encode(JSON.stringify(chunkState));
                chunkNonce = window.UnicitySDK.HexConverter.decode(savedData.nonce);
                
                // Recreate signing service
                const privateKey = window.UnicitySDK.HexConverter.decode(
                    localStorage.getItem('unicityRunner_privateKey')
                );
                const chunkSigningService = await window.UnicitySDK.SigningService.createFromSecret(
                    privateKey,
                    chunkNonce
                );
                
                // Recreate predicate
                predicate = await window.UnicitySDK.MaskedPredicate.create(
                    tokenId,
                    tokenType,
                    chunkSigningService,
                    window.UnicitySDK.HashAlgorithm.SHA256,
                    chunkNonce
                );
                
                // Recreate mint data from saved values
                mintData = await window.UnicitySDK.MintTransactionData.create(
                    tokenId,
                    tokenType,
                    window.UnicitySDK.HexConverter.decode(savedData.tokenData),
                    null, // No coin data
                    savedData.recipient,
                    window.UnicitySDK.HexConverter.decode(savedData.salt),
                    null, // No data hash for chunk tokens
                    null // reason
                );
            }
        }
        
        if (shouldCreateNew) {
            // Generate new mint transaction
            const tokenIdBytes = await generateChunkTokenId(chunkX, chunkZ, WORLD_SEED, GAMEDEV_VERSION);
            tokenId = window.UnicitySDK.TokenId.create(tokenIdBytes);
            tokenType = window.UnicitySDK.TokenType.create(CHUNK_TOKEN_TYPE_BYTES);
            
            // Create chunk state data
            chunkState = {
                x: chunkX,
                z: chunkZ,
                worldSeed: WORLD_SEED,
                gamedevVersion: GAMEDEV_VERSION,
                createdAt: Date.now(),
                generatedAt: Date.now()
            };
            
            // Encode state data
            stateBytes = new TextEncoder().encode(JSON.stringify(chunkState));
            
            // Create signing service for this chunk with deterministic nonce
            chunkNonce = await generateChunkNonce(chunkX, chunkZ, WORLD_SEED);
            const privateKey = window.UnicitySDK.HexConverter.decode(
                localStorage.getItem('unicityRunner_privateKey')
            );
            const chunkSigningService = await window.UnicitySDK.SigningService.createFromSecret(
                privateKey,
                chunkNonce
            );
            
            // Create predicate for chunk ownership
            predicate = await window.UnicitySDK.MaskedPredicate.create(
                tokenId,
                tokenType,
                chunkSigningService,
                window.UnicitySDK.HashAlgorithm.SHA256,
                chunkNonce
            );
            
            // Create mint transaction data
            const recipient = await window.UnicitySDK.DirectAddress.create(predicate.reference);
            
            const salt = crypto.getRandomValues(new Uint8Array(32));
            mintData = await window.UnicitySDK.MintTransactionData.create(
                tokenId,
                tokenType,
                new Uint8Array(0), // No immutable data
                null, // No coin data
                recipient.toString(),
                salt,
                null, // No data hash for chunk tokens
                null // reason
            );
            
            // CRITICAL: Save mint transaction data BEFORE submitting
            const mintTxToSave = {
                tokenId: window.UnicitySDK.HexConverter.encode(tokenId.bytes),
                tokenType: window.UnicitySDK.HexConverter.encode(tokenType.bytes),
                tokenData: window.UnicitySDK.HexConverter.encode(new Uint8Array(0)),
                recipient: recipient.toString(),
                salt: window.UnicitySDK.HexConverter.encode(salt),
                nonce: window.UnicitySDK.HexConverter.encode(chunkNonce),
                chunkState: chunkState,
                timestamp: Date.now(),
                submitted: false,
                requestId: null
            };
            
            // Track in memory for emergency save
            const chunkKey = `${chunkX},${chunkZ}`;
            pendingMintTransactions.set(chunkKey, mintTxToSave);
            
            // Save to localStorage immediately
            localStorage.setItem(mintTxKey, JSON.stringify(mintTxToSave));
            console.log(`Saved mint transaction data for chunk (${chunkX}, ${chunkZ})`);
        }
        
        // Submit to Unicity network
        const aggregatorClient = new window.UnicitySDK.AggregatorClient(
            'https://gateway-test.unicity.network:443'
        );
        const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        let commitment;
        const savedData = JSON.parse(localStorage.getItem(mintTxKey));
        
        // Check if we already have a request ID (meaning it was already submitted)
        if (savedData.submitted && savedData.requestId) {
            console.log(`Chunk (${chunkX}, ${chunkZ}) was already submitted with request ID: ${savedData.requestId}`);
            // We need to recreate the commitment to poll for inclusion proof
            // Since we can't override the request ID, we'll create it normally
            const signingService = await window.UnicitySDK.SigningService.createFromSecret(
                window.UnicitySDK.MINTER_SECRET,
                tokenId.bytes
            );
            commitment = await window.UnicitySDK.Commitment.create(mintData, signingService);
            
            // Verify the request ID matches what we saved
            const actualRequestId = commitment.requestId.toString();
            if (actualRequestId !== savedData.requestId) {
                console.warn(`Request ID mismatch for chunk (${chunkX}, ${chunkZ}). Expected: ${savedData.requestId}, Got: ${actualRequestId}`);
                // Update with correct request ID
                savedData.requestId = actualRequestId;
                localStorage.setItem(mintTxKey, JSON.stringify(savedData));
            }
        } else {
            // First time submission
            console.log(`Submitting mint transaction for chunk (${chunkX}, ${chunkZ})...`);
            console.log('Chunk Token ID:', window.UnicitySDK.HexConverter.encode(tokenId.bytes));
            
            try {
                commitment = await client.submitMintTransaction(mintData);
                console.log(`Mint commitment received for chunk (${chunkX}, ${chunkZ}):`, commitment.requestId.toString());
                
                // Update saved data with submission info
                savedData.submitted = true;
                savedData.requestId = commitment.requestId.toString();
                localStorage.setItem(mintTxKey, JSON.stringify(savedData));
                
                // Update in-memory tracking
                const chunkKey = `${chunkX},${chunkZ}`;
                pendingMintTransactions.set(chunkKey, savedData);
            } catch (submitError) {
                console.error(`Error submitting mint transaction for chunk (${chunkX}, ${chunkZ}):`, submitError);
                
                // Check if it's a REQUEST_ID_EXISTS error
                if (submitError.message && submitError.message.includes('REQUEST_ID_EXISTS')) {
                    console.log(`Chunk (${chunkX}, ${chunkZ}) - Transaction already exists, will poll for inclusion proof`);
                    
                    // Check if another process already saved this token
                    const existingToken = loadChunkTokenData(chunkX, chunkZ);
                    if (existingToken.token && existingToken.state && existingToken.state.gamedevVersion === GAMEDEV_VERSION) {
                        console.log(`Chunk (${chunkX}, ${chunkZ}) - Token was already created by another process`);
                        // Clear pending state and mint transaction
                        localStorage.removeItem(pendingKey);
                        localStorage.removeItem(mintTxKey);
                        
                        // Clear from in-memory tracking
                        const chunkKey = `${chunkX},${chunkZ}`;
                        pendingMintTransactions.delete(chunkKey);
                        
                        // Recreate and return the token
                        const predicateFactory = new window.UnicitySDK.PredicateJsonFactory();
                        const tokenJsonSerializer = new window.UnicitySDK.TokenJsonSerializer(predicateFactory);
                        const tokenFactory = new window.UnicitySDK.TokenFactory(tokenJsonSerializer);
                        return await tokenFactory.create(existingToken.token);
                    }
                    
                    // Create commitment locally to get the request ID
                    const signingService = await window.UnicitySDK.SigningService.createFromSecret(
                        window.UnicitySDK.MINTER_SECRET,
                        tokenId.bytes
                    );
                    commitment = await window.UnicitySDK.Commitment.create(mintData, signingService);
                    
                    // Save the request ID
                    savedData.submitted = true;
                    savedData.requestId = commitment.requestId.toString();
                    localStorage.setItem(mintTxKey, JSON.stringify(savedData));
                    
                    // Update in-memory tracking
                    const chunkKey = `${chunkX},${chunkZ}`;
                    pendingMintTransactions.set(chunkKey, savedData);
                } else {
                    // Log the response if available
                    if (submitError.response) {
                        console.error('Response status:', submitError.response.status);
                        console.error('Response data:', submitError.response.data);
                    }
                    // Other error - re-throw
                    throw submitError;
                }
            }
        }
        
        // Wait for inclusion proof using SDK utility
        let inclusionProof = await window.UnicitySDK.waitInclusionProof(
            client,
            commitment,
            AbortSignal.timeout(30000), // 30 second timeout
            1000 // Check every second
        );
        
        // Create the transaction with inclusion proof, with retry for sporadic hash algorithm error
        let mintTransaction;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
            try {
                mintTransaction = await client.createTransaction(commitment, inclusionProof);
                break; // Success, exit loop
            } catch (error) {
                if (error.message && error.message.includes('Invalid inclusion proof hash algorithm') && retryCount < maxRetries - 1) {
                    retryCount++;
                    console.log(`Chunk (${chunkX}, ${chunkZ}) - Invalid hash algorithm error, retrying (${retryCount}/${maxRetries})...`);
                    
                    // Wait a bit before retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Refetch inclusion proof
                    inclusionProof = await window.UnicitySDK.waitInclusionProof(
                        client,
                        commitment,
                        AbortSignal.timeout(30000),
                        1000
                    );
                } else {
                    // Not the sporadic error or max retries reached
                    throw error;
                }
            }
        }
        
        // Create token state without data (since we use null data hash in mint transaction)
        const tokenState = await window.UnicitySDK.TokenState.create(predicate, null);
        
        // Create the complete token
        const chunkToken = new window.UnicitySDK.Token(
            tokenState,
            mintTransaction,
            [] // no additional transactions
        );
        
        // Save the complete token and chunk state separately
        const tokenJson = chunkToken.toJSON();
        saveChunkTokenData(chunkX, chunkZ, { 
            token: tokenJson,
            state: chunkState  // Save chunk state separately since it's not in the token
        });
        
        // Clear pending state and mint transaction
        localStorage.removeItem(pendingKey);
        localStorage.removeItem(mintTxKey);
        
        // Clear from in-memory tracking
        const chunkKey = `${chunkX},${chunkZ}`;
        pendingMintTransactions.delete(chunkKey);
        
        console.log(`Successfully created chunk token for (${chunkX}, ${chunkZ})`);
        return chunkToken;
        
    } catch (error) {
        // Clear pending state on error
        localStorage.removeItem(pendingKey);
        
        // Check for REQUEST_ID_EXISTS error
        if (error.message && error.message.includes('REQUEST_ID_EXISTS')) {
            console.log(`Chunk (${chunkX}, ${chunkZ}) - Transaction already submitted. Will check inclusion proof on next attempt.`);
            // Keep the mint transaction data for recovery
            // Don't throw the error since this is recoverable
            return null;
        } else {
            console.error(`Error creating chunk token for (${chunkX}, ${chunkZ}):`, error);
            // For other errors, clear the mint transaction too
            const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
            localStorage.removeItem(mintTxKey);
        }
        
        throw error;
    }
}

// Finish minting a chunk token that was partially created
async function finishChunkTokenMinting(chunkX, chunkZ, existingData) {
    // Since we're not saving intermediate states anymore, this shouldn't be called
    // but we'll handle it gracefully
    console.warn(`Unexpected call to finishChunkTokenMinting for chunk (${chunkX}, ${chunkZ})`);
    return existingData.token;
}

// Check gamedev version and clear chunk tokens if version changed
function checkGamedevVersionAndClearChunks() {
    const GAMEDEV_VERSION_KEY = 'unicityRunner_gamedevVersion';
    const savedVersion = localStorage.getItem(GAMEDEV_VERSION_KEY);
    
    if (savedVersion && savedVersion !== GAMEDEV_VERSION) {
        console.log(`Gamedev version changed from ${savedVersion} to ${GAMEDEV_VERSION}. Clearing all chunk tokens...`);
        
        // Clear all chunk tokens and mint transactions
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('unicityRunner_chunk_')) {
                keysToRemove.push(key);
            }
        }
        
        console.log(`Removing ${keysToRemove.length} chunk token entries...`);
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
        console.log('Chunk tokens cleared due to version change');
    }
    
    // Save current version
    localStorage.setItem(GAMEDEV_VERSION_KEY, GAMEDEV_VERSION);
}

// Function to manually clear stale pending chunk tokens
window.clearStalePendingChunks = function(maxAgeMinutes = 10) {
    console.log(`Clearing pending chunk tokens older than ${maxAgeMinutes} minutes...`);
    const maxAge = maxAgeMinutes * 60 * 1000;
    let clearedCount = 0;
    
    const keysToCheck = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('unicityRunner_chunk_') && key.endsWith('_pending')) {
            keysToCheck.push(key);
        }
    }
    
    keysToCheck.forEach(key => {
        try {
            const pendingData = localStorage.getItem(key);
            if (pendingData) {
                const pending = JSON.parse(pendingData);
                if (Date.now() - pending.timestamp > maxAge) {
                    localStorage.removeItem(key);
                    clearedCount++;
                    console.log(`Cleared stale pending token: ${key}`);
                }
            }
        } catch (e) {
            console.error(`Error processing ${key}:`, e);
        }
    });
    
    console.log(`Cleared ${clearedCount} stale pending chunk tokens`);
    return clearedCount;
};

// Function to manually clear saved mint transactions
window.clearSavedMintTransactions = function() {
    console.log('Clearing all saved mint transactions...');
    let clearedCount = 0;
    
    const keysToCheck = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('unicityRunner_chunk_') && key.endsWith('_mintTx')) {
            keysToCheck.push(key);
        }
    }
    
    keysToCheck.forEach(key => {
        localStorage.removeItem(key);
        clearedCount++;
        console.log(`Cleared mint transaction: ${key}`);
    });
    
    console.log(`Cleared ${clearedCount} saved mint transactions`);
    return clearedCount;
};

// Function to manually retry chunk tokenization
window.retryChunkTokenization = async function(chunkX, chunkZ) {
    console.log(`Manually retrying tokenization for chunk (${chunkX}, ${chunkZ})...`);
    
    // Clear any pending state
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    localStorage.removeItem(pendingKey);
    
    // Clear from in-memory tracking
    const chunkKey = `${chunkX},${chunkZ}`;
    chunksBeingTokenized.delete(chunkKey);
    
    try {
        const result = await ensureChunkToken(chunkX, chunkZ);
        console.log(`Retry completed for chunk (${chunkX}, ${chunkZ})`);
        return result;
    } catch (error) {
        console.error(`Retry failed for chunk (${chunkX}, ${chunkZ}):`, error);
        throw error;
    }
};

// Function to inspect saved mint transaction
window.inspectMintTransaction = function(chunkX, chunkZ) {
    const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
    const savedData = localStorage.getItem(mintTxKey);
    
    if (!savedData) {
        console.log(`No saved mint transaction for chunk (${chunkX}, ${chunkZ})`);
        return null;
    }
    
    const parsed = JSON.parse(savedData);
    console.log(`Mint transaction for chunk (${chunkX}, ${chunkZ}):`, parsed);
    
    // Decode hex values for inspection
    console.log('Decoded values:');
    console.log('- Token ID:', parsed.tokenId);
    console.log('- Token Type:', parsed.tokenType);
    console.log('- Recipient:', parsed.recipient);
    console.log('- Salt length:', parsed.salt ? parsed.salt.length / 2 : 0, 'bytes');
    console.log('- Nonce length:', parsed.nonce ? parsed.nonce.length / 2 : 0, 'bytes');
    console.log('- Submitted:', parsed.submitted);
    console.log('- Request ID:', parsed.requestId);
    console.log('- Timestamp:', new Date(parsed.timestamp).toLocaleString());
    console.log('- Age:', Math.floor((Date.now() - parsed.timestamp) / 1000), 'seconds');
    
    return parsed;
};

// Debug function to show chunk token statistics
window.debugChunkTokens = function() {
    const stats = {
        total: 0,
        minted: 0,
        pending: 0,
        inProgress: 0,
        notStarted: 0,
        failed: 0,
        chunks: {
            minted: [],
            pending: [],
            inProgress: [],
            failed: []
        }
    };
    
    // Collect all chunk-related keys
    const chunkPattern = /^unicityRunner_chunk_(-?\d+)_(-?\d+)_(.+)$/;
    const chunksData = new Map();
    
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('unicityRunner_chunk_')) {
            const match = key.match(chunkPattern);
            if (match) {
                const [, x, z, dataType] = match;
                const chunkKey = `${x},${z}`;
                
                if (!chunksData.has(chunkKey)) {
                    chunksData.set(chunkKey, {
                        x: parseInt(x),
                        z: parseInt(z),
                        hasToken: false,
                        hasCommitment: false,
                        hasState: false
                    });
                }
                
                const chunkInfo = chunksData.get(chunkKey);
                if (dataType === 'token') chunkInfo.hasToken = true;
                if (dataType === 'commitment') chunkInfo.hasCommitment = true;
                if (dataType === 'state') chunkInfo.hasState = true;
                if (dataType === 'pending') chunkInfo.hasPending = true;
                if (dataType === 'mintTx') chunkInfo.hasMintTx = true;
            }
        }
    }
    
    // Analyze each chunk
    chunksData.forEach((chunkInfo, chunkKey) => {
        stats.total++;
        
        // Load the actual data to check status
        const tokenData = loadChunkTokenData(chunkInfo.x, chunkInfo.z);
        
        if (tokenData.token && tokenData.token._mint) {
            // Fully minted
            stats.minted++;
            stats.chunks.minted.push(`(${chunkInfo.x}, ${chunkInfo.z})`);
        } else if (chunkInfo.hasPending || chunkInfo.hasMintTx) {
            // Pending (submitted but not completed)
            const pendingKey = getChunkStorageKey(chunkInfo.x, chunkInfo.z, 'pending');
            const pendingData = localStorage.getItem(pendingKey);
            if (pendingData) {
                const pending = JSON.parse(pendingData);
                const ageSeconds = Math.floor((Date.now() - pending.timestamp) / 1000);
                const hasMintTx = chunkInfo.hasMintTx ? ' (has mint tx)' : '';
                stats.pending++;
                stats.chunks.pending.push(`(${chunkInfo.x}, ${chunkInfo.z}) - age: ${ageSeconds}s${hasMintTx}`);
            }
        } else if (tokenData.commitment || (tokenData.token && !tokenData.token._mint)) {
            // In progress
            stats.inProgress++;
            const status = tokenData.commitment?.submitted ? 'submitted' : 'not submitted';
            stats.chunks.inProgress.push(`(${chunkInfo.x}, ${chunkInfo.z}) - ${status}`);
        } else {
            // This shouldn't happen for chunks in localStorage
            stats.failed++;
            stats.chunks.failed.push(`(${chunkInfo.x}, ${chunkInfo.z}) - unexpected state`);
        }
    });
    
    // Display results
    console.log('=== Chunk Token Statistics ===');
    console.log(`Total chunks tracked: ${stats.total}`);
    console.log(`Fully minted: ${stats.minted}`);
    console.log(`Pending (submitted): ${stats.pending}`);
    console.log(`In progress: ${stats.inProgress}`);
    console.log(`Failed/Unknown: ${stats.failed}`);
    
    if (stats.chunks.minted.length > 0) {
        console.log('\nMinted chunks:', stats.chunks.minted.join(', '));
    }
    
    if (stats.chunks.pending.length > 0) {
        console.log('\nPending chunks (submitted but not completed):');
        stats.chunks.pending.forEach(chunk => console.log(`  ${chunk}`));
    }
    
    if (stats.chunks.inProgress.length > 0) {
        console.log('\nIn-progress chunks:');
        stats.chunks.inProgress.forEach(chunk => console.log(`  ${chunk}`));
    }
    
    if (stats.chunks.failed.length > 0) {
        console.log('\nFailed chunks:', stats.chunks.failed.join(', '));
    }
    
    console.log('\nUse debugChunkTokens() to refresh this information');
    
    return stats;
};

// Generate level structure for a chunk (rooms and corridors)
function generateLevelForChunk(chunkX, chunkZ, seed) {
    const chunkSize = 32; // Match noa chunk size
    const tiles = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill('wall'));
    
    // Check if this chunk should have a room
    const hasRoom = roomExists(chunkX, chunkZ, seed);
    
    if (hasRoom) {
        // Generate room
        const { width, length } = getRoomDimensions(chunkX, chunkZ, seed);
        const roomX = Math.floor((chunkSize - width) / 2);
        const roomZ = Math.floor((chunkSize - length) / 2);
        
        // Clear room interior
        for (let x = roomX; x < roomX + width; x++) {
            for (let z = roomZ; z < roomZ + length; z++) {
                tiles[x][z] = 'room';
            }
        }
        
        // Get exits for this room
        const exits = getRoomExits(chunkX, chunkZ, seed);
        
        // Add exits
        if (exits.east) {
            // East exit at latitude 12-14 (3 blocks wide)
            for (let x = roomX + width; x < chunkSize; x++) {
                for (let z = 12; z <= 14; z++) {
                    tiles[x][z] = 'corridor_east';
                }
            }
        }
        
        if (exits.north) {
            // North exit at longitude 14-16 (3 blocks wide)
            // North exit goes from the north edge of the room to the north edge of the chunk
            for (let z = roomZ + length; z < chunkSize; z++) {
                for (let x = 14; x <= 16; x++) {
                    tiles[x][z] = 'corridor_north';
                }
            }
        }
        
        if (exits.west) {
            // West exit at latitude 16-18 (3 blocks wide)
            for (let x = 0; x < roomX; x++) {
                for (let z = 16; z <= 18; z++) {
                    tiles[x][z] = 'corridor_west';
                }
            }
        }
        
        // Check for incoming corridors from the closest room in each direction
        // Check East (from the closest room to the west)
        for (let checkX = chunkX - 1; checkX >= chunkX - 20; checkX--) {
            if (roomExists(checkX, chunkZ, seed)) {
                const neighborExits = getRoomExits(checkX, chunkZ, seed);
                if (neighborExits.east) {
                    // Generate east-bound corridor entering our room (3 blocks wide)
                    for (let x = 0; x < roomX; x++) {
                        for (let z = 12; z <= 14; z++) {
                            tiles[x][z] = 'corridor_east';
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check South (from the closest room to the south that's sending a corridor north)
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 20; checkZ--) {
            if (roomExists(chunkX, checkZ, seed)) {
                const neighborExits = getRoomExits(chunkX, checkZ, seed);
                if (neighborExits.north) {
                    // Generate north-bound corridor entering our room from the south (3 blocks wide)
                    // Corridor comes from the south edge of chunk to the south edge of room
                    for (let z = 0; z < roomZ; z++) {
                        for (let x = 14; x <= 16; x++) {
                            tiles[x][z] = 'corridor_north';
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check West (from the closest room to the east)
        for (let checkX = chunkX + 1; checkX <= chunkX + 20; checkX++) {
            if (roomExists(checkX, chunkZ, seed)) {
                const neighborExits = getRoomExits(checkX, chunkZ, seed);
                if (neighborExits.west) {
                    // Generate west-bound corridor entering our room (3 blocks wide)
                    for (let x = roomX + width; x < chunkSize; x++) {
                        for (let z = 16; z <= 18; z++) {
                            tiles[x][z] = 'corridor_west';
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
        
    } else {
        // No room in this chunk - check for corridors from the closest room in each direction
        // Check East (from the closest room to the west)
        for (let checkX = chunkX - 1; checkX >= chunkX - 20; checkX--) {
            if (roomExists(checkX, chunkZ, seed)) {
                const exits = getRoomExits(checkX, chunkZ, seed);
                if (exits.east) {
                    // Generate east-bound corridor through entire chunk (3 blocks wide)
                    for (let x = 0; x < chunkSize; x++) {
                        for (let z = 12; z <= 14; z++) {
                            // Don't overwrite existing corridors at intersections
                            if (tiles[x][z] === 'wall') {
                                tiles[x][z] = 'corridor_east';
                            }
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check South (from the closest room to the north)
        let foundSouthRoom = false;
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 20; checkZ--) {
            if (roomExists(chunkX, checkZ, seed)) {
                const exits = getRoomExits(chunkX, checkZ, seed);
                foundSouthRoom = true;
                if (exits.north) {
                    // Generate north-bound corridor through entire chunk (3 blocks wide)
                    for (let z = 0; z < chunkSize; z++) {
                        for (let x = 14; x <= 16; x++) {
                            tiles[x][z] = 'corridor_north';
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // NEW: Check if we need a north corridor passing through this chunk
        // Look for a room to the south that has a north exit pointing towards a room to the north
        let needsNorthCorridor = false;
        let sourceRoomZ = null;
        
        // Find the closest room to the south with a north exit
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 20; checkZ--) {
            if (roomExists(chunkX, checkZ, seed)) {
                const exits = getRoomExits(chunkX, checkZ, seed);
                if (exits.north) {
                    sourceRoomZ = checkZ;
                    needsNorthCorridor = true;
                }
                break;
            }
        }
        
        // If there's a room to the south with a north exit, check if there's a destination room to the north
        if (needsNorthCorridor) {
            let foundDestination = false;
            for (let checkZ = chunkZ; checkZ <= chunkZ + 20; checkZ++) {
                if (roomExists(chunkX, checkZ, seed)) {
                    foundDestination = true;
                    break;
                }
            }
            
            // Only add the corridor if we're between the source and a destination
            if (foundDestination) {
                // Generate north-bound corridor through entire chunk (3 blocks wide)
                for (let z = 0; z < chunkSize; z++) {
                    for (let x = 14; x <= 16; x++) {
                        if (tiles[x][z] === 'wall') {
                            tiles[x][z] = 'corridor_north';
                        }
                    }
                }
            }
        }
        
        // Check West (from the closest room to the east)
        for (let checkX = chunkX + 1; checkX <= chunkX + 20; checkX++) {
            if (roomExists(checkX, chunkZ, seed)) {
                const exits = getRoomExits(checkX, chunkZ, seed);
                if (exits.west) {
                    // Generate west-bound corridor through entire chunk (3 blocks wide)
                    for (let x = 0; x < chunkSize; x++) {
                        for (let z = 16; z <= 18; z++) {
                            // Don't overwrite existing corridors at intersections
                            if (tiles[x][z] === 'wall') {
                                tiles[x][z] = 'corridor_west';
                            }
                        }
                    }
                }
                break; // Stop at first room found
            }
        }
    }
    
    
    return tiles;
}


// Initialize player token management
async function initializePlayerToken() {
    const savedTokenString = localStorage.getItem('unicityRunner_playerToken');
    const savedPrivateKey = localStorage.getItem('unicityRunner_privateKey');
    
    // Check if saved token has invalid position and clear it
    if (savedTokenString) {
        try {
            const tokenData = JSON.parse(savedTokenString);
            if (tokenData.state && tokenData.state.data) {
                const stateBytes = window.UnicitySDK.HexConverter.decode(tokenData.state.data);
                const stateData = JSON.parse(new TextDecoder().decode(stateBytes));
                if (stateData.position && stateData.position[1] < -100) {
                    console.log('Clearing saved token with invalid position');
                    localStorage.removeItem('unicityRunner_playerToken');
                    localStorage.removeItem('unicityRunner_privateKey');
                    await createNewPlayerToken();
                    return;
                }
            }
        } catch (e) {
            console.error('Error checking saved token:', e);
        }
    }
    
    if (savedTokenString && savedPrivateKey) {
        // Load existing token
        const tokenData = JSON.parse(savedTokenString);
        
        // Use TokenFactory to recreate the token from stored data
        try {
            const predicateFactory = new window.UnicitySDK.PredicateJsonFactory();
            const tokenJsonSerializer = new window.UnicitySDK.TokenJsonSerializer(predicateFactory);
            const tokenFactory = new window.UnicitySDK.TokenFactory(tokenJsonSerializer);
            playerToken = await tokenFactory.create(tokenData);
        } catch (error) {
            console.error('Failed to recreate player token:', error);
            console.error('Token data:', tokenData);
            // Clear invalid token and create new one
            localStorage.removeItem('unicityRunner_playerToken');
            localStorage.removeItem('unicityRunner_privateKey');
            await createNewPlayerToken();
            return;
        }
        
        // Recreate signing service with the nonce from the token's predicate
        const privateKeyBytes = window.UnicitySDK.HexConverter.decode(savedPrivateKey);
        
        // Check if nonce exists in the unlock predicate
        if (!playerToken.state || !playerToken.state.unlockPredicate || !playerToken.state.unlockPredicate.nonce) {
            console.error('Token is missing unlock predicate or nonce:', {
                hasState: !!playerToken.state,
                hasUnlockPredicate: !!(playerToken.state && playerToken.state.unlockPredicate),
                unlockPredicate: playerToken.state?.unlockPredicate
            });
            throw new Error('Token missing required unlock predicate data');
        }
        
        const nonce = playerToken.state.unlockPredicate.nonce;
        signingService = await window.UnicitySDK.SigningService.createFromSecret(privateKeyBytes, nonce);
        
        console.log("Existing player token imported.", playerToken);
        console.log("Token state:", playerToken.state);
        console.log("Unlock predicate:", playerToken.state?.unlockPredicate);
        
        // Initialize status counters from token history
        tokenStatus.initialized = true;
        // Count transactions: 1 for mint + number of state updates
        const transactionCount = (playerToken._transactions?.length || 0) + 1; // +1 for the initial mint
        tokenStatus.totalSubmissions = transactionCount;
        tokenStatus.successfulSubmissions = transactionCount;
        tokenStatus.lastUpdateTime = Date.now(); // Approximate, since we don't store exact times
        updateTokenStatusDisplay();
    } else {
        // New player flow
        await createNewPlayerToken();
    }
}

// Create a new player token
async function createNewPlayerToken() {
    // Don't set a position in the initial state - let the spawn logic handle it
    const spawnPosition = null;
    
    const initialState = {
        name: "Runner-" + Math.floor(Math.random() * 1000),
        position: spawnPosition,
        health: 100,
        score: 0,
        createdAt: Date.now()
    };
    
    // Generate random bytes for private key
    const privateKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(privateKeyBytes);
    
    // Generate nonce for signing service
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    
    // Create signing service with private key and nonce
    signingService = await window.UnicitySDK.SigningService.createFromSecret(privateKeyBytes, nonce);
    
    // Get public key from signing service
    const publicKey = signingService.publicKey;
    
    // Create token ID and type
    const tokenId = window.UnicitySDK.TokenId.create(crypto.getRandomValues(new Uint8Array(32)));
    const tokenType = window.UnicitySDK.TokenType.create(new Uint8Array([1])); // Simple type ID
    
    // Create predicate (use MaskedPredicate as shown in README examples)
    // The signingService was already created with this nonce, so we can use it directly
    const predicate = await window.UnicitySDK.MaskedPredicate.create(
        tokenId,
        tokenType,
        signingService,
        window.UnicitySDK.HashAlgorithm.SHA256,
        nonce // MaskedPredicate uses nonce, not salt
    );
    
    // Create token state data (this will be stored in the token state)
    const stateData = new TextEncoder().encode(JSON.stringify(initialState));
    
    // Create the data hash of the state data
    const dataHash = await new window.UnicitySDK.DataHasher(window.UnicitySDK.HashAlgorithm.SHA256).update(stateData).digest();
    
    // Create aggregator client for Unicity network
    const aggregatorClient = new window.UnicitySDK.AggregatorClient('https://gateway-test.unicity.network:443');
    const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
    
    // Create mint transaction data
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const recipient = await window.UnicitySDK.DirectAddress.create(predicate.reference);
    
    const mintTransactionData = await window.UnicitySDK.MintTransactionData.create(
        tokenId,
        tokenType,
        new Uint8Array(0), // tokenData (immutable data, not the state data)
        null, // no coins (use null instead of empty TokenCoinData)
        recipient.toString(),
        salt,
        dataHash, // hash of the state data
        null // reason
    );
    
    try {
        // Submit mint transaction to Unicity network
        console.log('Submitting mint transaction to Unicity network...');
        console.log('Token ID:', window.UnicitySDK.HexConverter.encode(tokenId.bytes));
        console.log('Token Type:', Array.from(tokenType.bytes));
        console.log('Recipient:', recipient.toString());
        console.log('Data Hash:', dataHash.toString());
        
        const mintCommitment = await client.submitMintTransaction(mintTransactionData);
        console.log('Mint commitment received:', mintCommitment);
        console.log('Request ID:', mintCommitment.requestId.toString());
        
        // Wait for inclusion proof using SDK utility
        console.log('Waiting for inclusion proof...');
        const inclusionProof = await window.UnicitySDK.waitInclusionProof(
            client,
            mintCommitment,
            AbortSignal.timeout(30000), // 30 second timeout
            1000 // Check every second
        );
        console.log('Inclusion proof received and verified');
        
        // Create the transaction with inclusion proof
        const mintTransaction = await client.createTransaction(mintCommitment, inclusionProof);
        
        // Create token state
        const tokenState = await window.UnicitySDK.TokenState.create(predicate, stateData);
        
        // Create the token with proper mint transaction
        playerToken = new window.UnicitySDK.Token(
            tokenState,
            mintTransaction,
            [] // additional transactions
        );
        
        // Store private key (hex encoded)
        localStorage.setItem('unicityRunner_privateKey', window.UnicitySDK.HexConverter.encode(privateKeyBytes));
        
        // Serialize and save token using the SDK's built-in serialization
        const tokenJson = playerToken.toJSON();
        localStorage.setItem('unicityRunner_playerToken', JSON.stringify(tokenJson));
        
        console.log('Player token minted successfully on Unicity network!', playerToken);
        
        tokenStatus.initialized = true;
        tokenStatus.totalSubmissions = 1;
        tokenStatus.successfulSubmissions = 1;
        tokenStatus.lastUpdateTime = Date.now();
        updateTokenStatusDisplay();
    } catch (error) {
        console.error('Failed to mint token on Unicity network:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            response: error.response,
            status: error.status,
            data: error.data
        });
        
        // Check for specific error types
        if (error.message && error.message.includes('REQUEST_ID_EXISTS')) {
            console.error('REQUEST_ID_EXISTS error - this token ID may already exist');
            console.error('Token ID that failed:', window.UnicitySDK.HexConverter.encode(tokenId.bytes));
        }
        
        tokenStatus.initialized = true;
        tokenStatus.totalSubmissions = 1;
        tokenStatus.lastError = error.message || 'Mint failed';
        updateTokenStatusDisplay();
        throw error;
    }
}

// Get player state from token
function getPlayerState() {
    if (!playerToken || !playerToken.state || !playerToken.state.data) {
        return null;
    }
    
    try {
        const stateString = new TextDecoder().decode(playerToken.state.data);
        return JSON.parse(stateString);
    } catch (error) {
        console.error('Failed to parse player state:', error);
        return null;
    }
}

// Update health display
function updateHealthDisplay(health, maxHealth = 100) {
    const healthText = document.getElementById('healthText');
    const healthBarFill = document.getElementById('healthBarFill');
    
    if (healthText) {
        healthText.textContent = `Health: ${health}/${maxHealth}`;
    }
    
    if (healthBarFill) {
        const percentage = Math.max(0, Math.min(100, (health / maxHealth) * 100));
        healthBarFill.style.width = percentage + '%';
        
        // Change color based on health percentage
        if (percentage > 50) {
            healthBarFill.style.background = 'linear-gradient(to right, #33ff33, #66ff66)';
        } else if (percentage > 25) {
            healthBarFill.style.background = 'linear-gradient(to right, #ffaa33, #ffcc66)';
        } else {
            healthBarFill.style.background = 'linear-gradient(to right, #ff3333, #ff6666)';
        }
    }
}

// Damage player (for testing or future gameplay)
function damagePlayer(amount) {
    // Don't damage if already dead
    if (currentPlayerHealth <= 0) {
        console.log('Player already dead, health:', currentPlayerHealth);
        return;
    }
    
    currentPlayerHealth = Math.max(0, currentPlayerHealth - amount);
    updateHealthDisplay(currentPlayerHealth);
    
    console.log('Player damaged:', amount, 'New health:', currentPlayerHealth);
    
    // Check for death
    if (currentPlayerHealth <= 0) {
        console.log('Player health reached 0, calling handlePlayerDeath()');
        handlePlayerDeath();
    }
}

// Heal player
function healPlayer(amount) {
    currentPlayerHealth = Math.min(100, currentPlayerHealth + amount);
    updateHealthDisplay(currentPlayerHealth);
    
    console.log('Player healed:', amount, 'New health:', currentPlayerHealth);
}


// Set up noa engine
function setupNoaEngine() {
    // Create engine options
    const opts = {
        domElement: document.getElementById('app'),
        debug: true,
        showFPS: true,
        chunkSize: 32,
        chunkAddDistance: 10,
        chunkRemoveDistance: 14,
        // Add more aggressive chunk loading
        worldGenWhilePaused: true,
        manuallyControlChunkLoading: false,
        // Enable auto-step for climbing stairs
        playerAutoStep: true,
    };
    
    // Create engine
    noa = new Engine(opts);
    
    // Log default camera parameters
    console.log('Default camera parameters:', {
        zoomDistance: noa.camera.zoomDistance,
        pitch: noa.camera.pitch,
        heading: noa.camera.heading,
        currentZoom: noa.camera.currentZoom,
        cameraTarget: noa.camera.cameraTarget
    });
    
    // Set up 3rd person camera - looking from behind and above
    noa.camera.zoomDistance = 20;  // Doubled distance for better view
    noa.camera.pitch = 0.333;      // Positive pitch looks up (about 19 degrees)
    
    // Disable camera collision avoidance - always stay at fixed distance
    noa.camera.updateAfterEntityRenderSystems = function() {
        // Override the default behavior - no obstruction checking
        // Camera will always stay at zoomDistance behind player
        this.currentZoom = this.zoomDistance;
    };
    
    // Also ensure immediate zoom updates (no smoothing)
    noa.camera.zoomSpeed = 1.0;  // Instant zoom changes
    
    console.log('Updated camera parameters:', {
        zoomDistance: noa.camera.zoomDistance,
        pitch: noa.camera.pitch
    });
    
    // Register materials - using simple colors
    var brownish = [0.45, 0.36, 0.22];
    var grayish = [0.6, 0.6, 0.6];
    var roomFloorColor = [0.4, 0.5, 0.4]; // Greenish for rooms
    var corridorEastColor = [0.8, 0.3, 0.3]; // Reddish for east corridors
    var corridorNorthColor = [0.3, 0.3, 0.8]; // Bluish for north corridors
    var corridorWestColor = [0.8, 0.8, 0.3]; // Yellowish for west corridors
    var stairColor = [0.5, 0.5, 0.7]; // Light blue for stairs
    
    noa.registry.registerMaterial('dirt', { color: brownish });
    noa.registry.registerMaterial('stone', { color: grayish });
    noa.registry.registerMaterial('roomFloor', { color: roomFloorColor });
    noa.registry.registerMaterial('corridorEast', { color: corridorEastColor });
    noa.registry.registerMaterial('corridorNorth', { color: corridorNorthColor });
    noa.registry.registerMaterial('corridorWest', { color: corridorWestColor });
    noa.registry.registerMaterial('stair', { color: stairColor });
    
    // Register blocks
    var dirtID = noa.registry.registerBlock(1, { material: 'dirt' });
    var stoneID = noa.registry.registerBlock(2, { material: 'stone' });
    roomFloorID = noa.registry.registerBlock(3, { material: 'roomFloor' });
    corridorEastID = noa.registry.registerBlock(4, { material: 'corridorEast' });
    corridorNorthID = noa.registry.registerBlock(5, { material: 'corridorNorth' });
    corridorWestID = noa.registry.registerBlock(6, { material: 'corridorWest' });
    // Simple stair block - full cube collision
    var stairID = noa.registry.registerBlock(7, { 
        material: 'stair',
        solid: true,
        opaque: false
    });
    
    
    // Function to find a valid spawn position in a room
    function findSpawnRoom(seed) {
        console.log('findSpawnRoom called with seed:', seed);
        
        // First check if chunk 0,0 has a room
        console.log(`Chunk 0,0 has room: ${roomExists(0, 0, seed)}`);
        
        // Search in a spiral pattern from origin
        for (let radius = 0; radius < 10; radius++) {
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    // Check if we're on the edge of the search square
                    if (Math.abs(x) === radius || Math.abs(z) === radius) {
                        const hasRoom = roomExists(x, z, seed);
                        if (hasRoom) {
                            console.log(`Checking chunk (${x}, ${z}): has room = ${hasRoom}`);
                            // Get room center in local chunk coordinates
                            const localPos = getRoomCenter(x, z, seed);
                            // Convert to world coordinates
                            const worldX = x * 32 + localPos[0];
                            const worldZ = z * 32 + localPos[2];
                            console.log(`Found spawn room at chunk (${x}, ${z})`);
                            console.log(`  Local pos: ${localPos}`);
                            console.log(`  World pos: [${worldX}, 1, ${worldZ}]`);
                            return [worldX, 1, worldZ];
                        }
                    }
                }
            }
        }
        // Fallback to origin
        console.log('No room found in 10 chunk radius! Using fallback position');
        return [8, 1, 8];
    }
    
    // Set player position from token
    const playerState = getPlayerState();
    console.log('Player state from token:', playerState);
    let position = playerState?.position || null;
    console.log('Position from state:', position);
    
    // Initialize health display
    if (playerState && playerState.health !== undefined) {
        currentPlayerHealth = playerState.health;
        updateHealthDisplay(currentPlayerHealth);
        console.log('Loaded player health from state:', currentPlayerHealth);
        
        // If player died in previous session, respawn them
        if (currentPlayerHealth <= 0) {
            console.log('Player loaded with 0 health, triggering respawn');
            currentPlayerHealth = 100; // Reset health temporarily so handlePlayerDeath works
            setTimeout(() => handlePlayerDeath(), 100); // Delay to ensure engine is ready
        }
    } else {
        currentPlayerHealth = 100; // Default to full health
        updateHealthDisplay(currentPlayerHealth);
    }
    
    // If no saved position or invalid position, we need to find a spawn room
    // But we'll do this after chunks are generated
    if (!position || position[1] < -10) {
        console.log('Need to find spawn room, using temporary position...');
        console.log('Current position:', position);
        position = [16, 50, 16]; // High up to prevent getting stuck
        
        // After chunks generate, find proper spawn
        setTimeout(() => {
            console.log('Timeout triggered - starting spawn search...');
            // Force chunk generation around origin first
            forceChunkGeneration();
            
            setTimeout(() => {
                console.log('Finding spawn room...');
                const spawnPos = calculateInitialSpawnPoint(WORLD_SEED);
                noa.entities.setPosition(noa.playerEntity, spawnPos);
                
                // Verify spawn
                setTimeout(() => {
                    const blockBelow = noa.world.getBlockID(
                        Math.floor(spawnPos[0]), 
                        Math.floor(spawnPos[1] - 1), 
                        Math.floor(spawnPos[2])
                    );
                    console.log(`Spawn position: ${spawnPos}`);
                    console.log(`Block below spawn: ${blockBelow} (roomFloorID=${roomFloorID})`);
                    console.log(`Chunk: ${Math.floor(spawnPos[0]/32)}, ${Math.floor(spawnPos[2]/32)}`);
                    
                    // If still not in a room, try to find the actual room center
                    if (blockBelow !== roomFloorID) {
                        console.log('Not in room! Checking actual generation...');
                        const chunkX = Math.floor(spawnPos[0] / 32);
                        const chunkZ = Math.floor(spawnPos[2] / 32);
                        console.log(`Room should exist at chunk ${chunkX},${chunkZ}: ${roomExists(chunkX, chunkZ, WORLD_SEED)}`);
                    }
                    
                    // Create hostile drone entity near player after spawn is finalized
                    createDrone(true);
                }, 500);
            }, 1000); // Wait for forced chunk generation
        }, 1000); // Initial wait
    } else {
        // Player already has a valid position, create drone immediately
        setTimeout(() => {
            createDrone(true);
        }, 1000); // Small delay to ensure world is ready
    }
    
    noa.entities.setPosition(noa.playerEntity, position);
    
    // Add a red cylinder mesh to the player
    const scene = noa.rendering.getScene();
    
    // Create a red cylinder using Babylon.js (should be available globally)
    const cylinder = BABYLON.MeshBuilder.CreateCylinder('playerCylinder', {
        height: 1.8,  // Player height
        diameter: 0.8, // Player width
        tessellation: 16
    }, scene);
    
    // Create red material
    const mat = noa.rendering.makeStandardMaterial('playerMat');
    mat.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red color
    mat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular
    cylinder.material = mat;
    
    // Add mesh component to player entity
    noa.entities.addComponent(noa.playerEntity, noa.entities.names.mesh, {
        mesh: cylinder,
        offset: [0, 0.9, 0] // Offset to center the cylinder on the player
    });
    
    console.log('Added red cylinder mesh to player');
    
    // Increase the player's movement speed 2x
    const playerMovement = noa.entities.getMovement(noa.playerEntity);
    if (playerMovement) {
        playerMovement.maxSpeed *= 2; // 2x the max speed
        playerMovement.moveSpeed *= 2; // 2x the move speed
        console.log('Player movement speed increased 2x');
    }
    
    // Drone will be created after player spawn is finalized
    
    
    // Set up world generation with rooms and corridors
    noa.world.on('worldDataNeeded', async function (id, data, x, y, z) {
        const chunkSize = data.shape[0];
        
        // Calculate which chunk we're in
        const chunkX = Math.floor(x / chunkSize);
        const chunkZ = Math.floor(z / chunkSize);
        
        // Ensure chunk token exists (create or recover)
        try {
            // Only tokenize chunks if we have a player's private key
            if (localStorage.getItem('unicityRunner_privateKey')) {
                await ensureChunkToken(chunkX, chunkZ);
            } else {
                // Skip chunk tokenization - no private key yet
            }
        } catch (error) {
            console.error(`Failed to ensure chunk token for (${chunkX}, ${chunkZ}):`, error);
            // Continue with chunk generation even if tokenization fails
        }
        
        // Generate level structure for this chunk
        const level = generateLevelForChunk(chunkX, chunkZ, WORLD_SEED);
        
        // Fill the chunk
        for (var i = 0; i < chunkSize; i++) {
            for (var j = 0; j < chunkSize; j++) {
                for (var k = 0; k < chunkSize; k++) {
                    const worldX = x + i;
                    const worldY = y + j;
                    const worldZ = z + k;
                    
                    let voxelID = 0;
                    
                    // Underground is all dirt
                    if (worldY < 0) {
                        voxelID = dirtID;
                    }
                    // Ground level (y=0)
                    else if (worldY === 0) {
                        // Check if this is floor or ground
                        if (level[i][k] === 'room') {
                            voxelID = roomFloorID; // Room floor
                        } else if (level[i][k] === 'corridor_east') {
                            voxelID = corridorEastID; // East corridor floor
                        } else if (level[i][k] === 'corridor_west') {
                            voxelID = corridorWestID; // West corridor floor
                        } else if (level[i][k] === 'corridor_north') {
                            // North corridor exists at y=3
                            // Check if there's an east/west corridor at this position
                            if ((k >= 12 && k <= 14) || (k >= 16 && k <= 18)) {
                                // This might be a corridor intersection - check for actual corridors
                                let foundCorridor = false;
                                
                                // Check for east corridor at z=12-14
                                if (k >= 12 && k <= 14) {
                                    for (let checkX = 0; checkX < 32; checkX++) {
                                        if (level[checkX][k] === 'corridor_east') {
                                            voxelID = corridorEastID;
                                            foundCorridor = true;
                                            break;
                                        }
                                    }
                                }
                                
                                // Check for west corridor at z=16-18
                                if (!foundCorridor && k >= 16 && k <= 18) {
                                    for (let checkX = 0; checkX < 32; checkX++) {
                                        if (level[checkX][k] === 'corridor_west') {
                                            voxelID = corridorWestID;
                                            foundCorridor = true;
                                            break;
                                        }
                                    }
                                }
                                
                                // If no corridor found, leave empty
                                if (!foundCorridor) {
                                    voxelID = 0;
                                }
                            } else {
                                // Not at intersection - empty space under north corridor
                                voxelID = 0;
                            }
                        } else if (level[i][k] === 'wall') {
                            // Only place ground under walls that are next to rooms/corridors
                            const north = (k > 0) ? level[i][k-1] : 'wall';
                            const south = (k < 31) ? level[i][k+1] : 'wall';
                            const east = (i < 31) ? level[i+1][k] : 'wall';
                            const west = (i > 0) ? level[i-1][k] : 'wall';
                            
                            // Place ground if adjacent to room or ground-level corridor
                            // Don't check for corridor_north since it's at y=3
                            if (north === 'room' || south === 'room' ||
                                north === 'corridor_east' || south === 'corridor_east' ||
                                north === 'corridor_west' || south === 'corridor_west' ||
                                east === 'room' || west === 'room' ||
                                east === 'corridor_east' || west === 'corridor_east' ||
                                east === 'corridor_west' || west === 'corridor_west') {
                                voxelID = dirtID; // Ground under walls
                            } else {
                                voxelID = 0; // Empty space
                            }
                        } else {
                            voxelID = 0; // Empty space
                        }
                    }
                    // Place stairs for north corridor at y=1 and y=2 (check this BEFORE walls)
                    else if ((worldY === 1 || worldY === 2) && i >= 14 && i <= 16 && level[i][k] === 'corridor_north') {
                        // Skip placing stairs at corridor intersections
                        // East corridor is at z=12-14, West corridor is at z=16-18
                        if (!((k >= 12 && k <= 14) || (k >= 16 && k <= 18))) {
                            // Check distance from adjacent room
                            let distanceFromRoom = 999;
                            
                            // Check south for room
                            for (let checkK = k - 1; checkK >= 0; checkK--) {
                                if (level[i][checkK] === 'room') {
                                    distanceFromRoom = k - checkK - 1;
                                    break;
                                }
                                if (level[i][checkK] === 'wall') break; // Stop at wall
                            }
                            
                            // Check north for room  
                            for (let checkK = k + 1; checkK < 32; checkK++) {
                                if (level[i][checkK] === 'room') {
                                    const dist = checkK - k - 1;
                                    if (dist < distanceFromRoom) distanceFromRoom = dist;
                                    break;
                                }
                                if (level[i][checkK] === 'wall') break; // Stop at wall
                            }
                            
                            // Place stairs in first two blocks of corridor
                            if (distanceFromRoom === 0 && worldY === 1) {
                                // First block of corridor - place stair at y=1
                                voxelID = stairID;
                            } else if (distanceFromRoom === 1 && worldY === 2) {
                                // Second block of corridor - place stair at y=2
                                voxelID = stairID;
                            }
                        }
                    }
                    // Walls at y=1 and y=2 - only place walls around rooms and corridors
                    else if ((worldY === 1 || worldY === 2)) {
                        // Check if we need a wall here by looking at adjacent tiles
                        let needsWall = false;
                        
                        // Check all 4 directions for room/corridor edges
                        const currentTile = level[i][k];
                        
                        // Special case: if we're in a north corridor area, check for east/west corridor walls
                        if (currentTile === 'corridor_north') {
                            // Skip if this is where stairs will be placed (x=14-16)
                            if (i >= 14 && i <= 16) {
                                // Don't place walls where stairs should be
                                needsWall = false;
                            } else {
                                // Check if this is where east/west corridor walls should be
                                // East corridor walls at z=11 and z=15
                                if (k === 11 || k === 15) {
                                    // Check if there's an east corridor nearby
                                    for (let checkX = 0; checkX < 32; checkX++) {
                                        if ((k === 11 && level[checkX][12] === 'corridor_east') ||
                                            (k === 15 && level[checkX][14] === 'corridor_east')) {
                                            needsWall = true;
                                            break;
                                        }
                                    }
                                }
                                // West corridor walls at z=15 and z=19
                                else if (k === 15 || k === 19) {
                                    // Check if there's a west corridor nearby
                                    for (let checkX = 0; checkX < 32; checkX++) {
                                        if ((k === 15 && level[checkX][16] === 'corridor_west') ||
                                            (k === 19 && level[checkX][18] === 'corridor_west')) {
                                            needsWall = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        else if (currentTile === 'wall') {
                            // Check if this wall is adjacent to a room or corridor
                            const north = (k > 0) ? level[i][k-1] : 'wall';
                            const south = (k < 31) ? level[i][k+1] : 'wall';
                            const east = (i < 31) ? level[i+1][k] : 'wall';
                            const west = (i > 0) ? level[i-1][k] : 'wall';
                            
                            // Place wall if adjacent to room or ground-level corridor
                            // Don't check for corridor_north since it's at y=3
                            if (north === 'room' || south === 'room' ||
                                north === 'corridor_east' || south === 'corridor_east' ||
                                north === 'corridor_west' || south === 'corridor_west' ||
                                east === 'room' || west === 'room' ||
                                east === 'corridor_east' || west === 'corridor_east' ||
                                east === 'corridor_west' || west === 'corridor_west') {
                                needsWall = true;
                            }
                        }
                        
                        if (needsWall) {
                            voxelID = dirtID; // Place wall
                        } else {
                            voxelID = 0; // Empty space
                        }
                    }
                    // North corridors at y=3 (raised)
                    else if (worldY === 3 && level[i][k] === 'corridor_north') {
                        // Skip floor blocks where stairs are placed
                        if (i >= 14 && i <= 16) {
                            // Check if this is where stairs should be (first two blocks from room)
                            let distanceFromRoom = 999;
                            
                            // Check south for room
                            for (let checkK = k - 1; checkK >= 0; checkK--) {
                                if (level[i][checkK] === 'room') {
                                    distanceFromRoom = k - checkK - 1;
                                    break;
                                }
                                if (level[i][checkK] === 'wall') break;
                            }
                            
                            // Check north for room  
                            for (let checkK = k + 1; checkK < 32; checkK++) {
                                if (level[i][checkK] === 'room') {
                                    const dist = checkK - k - 1;
                                    if (dist < distanceFromRoom) distanceFromRoom = dist;
                                    break;
                                }
                                if (level[i][checkK] === 'wall') break;
                            }
                            
                            // Don't place floor where stairs are
                            if (distanceFromRoom === 0 || distanceFromRoom === 1) {
                                voxelID = 0; // No floor where stairs are
                            } else {
                                voxelID = corridorNorthID; // Normal corridor floor
                            }
                        } else {
                            voxelID = corridorNorthID; // Normal corridor floor
                        }
                    }
                    // Walls alongside raised north corridors at y=4 and y=5
                    else if ((worldY === 4 || worldY === 5)) {
                        // Check if we're next to a north corridor
                        if (i === 13 && level[14][k] === 'corridor_north') {
                            voxelID = dirtID; // West wall of north corridor
                        } else if (i === 17 && level[16][k] === 'corridor_north') {
                            voxelID = dirtID; // East wall of north corridor
                        }
                    }
                    
                    data.set(i, j, k, voxelID);
                }
            }
        }
        
        // Check for corridor intersections after chunk generation
        const intersections = [];
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                // Check if there's a blue (north) corridor at y=3
                const hasNorthCorridor = data.get(x, 3, z) === corridorNorthID;
                
                // Check if there's a red (east) corridor at y=0
                const hasEastCorridor = data.get(x, 0, z) === corridorEastID;
                
                // Check if there's a yellow (west) corridor at y=0
                const hasWestCorridor = data.get(x, 0, z) === corridorWestID;
                
                // If blue intersects with red, we have a red/blue intersection
                if (hasNorthCorridor && hasEastCorridor) {
                    intersections.push({
                        type: 'red-blue',
                        worldX: chunkX * chunkSize + x,
                        worldZ: chunkZ * chunkSize + z,
                        localX: x,
                        localZ: z
                    });
                }
                
                // If blue intersects with yellow, we have a yellow/blue intersection
                if (hasNorthCorridor && hasWestCorridor) {
                    intersections.push({
                        type: 'yellow-blue',
                        worldX: chunkX * chunkSize + x,
                        worldZ: chunkZ * chunkSize + z,
                        localX: x,
                        localZ: z
                    });
                }
            }
        }
        
        if (intersections.length > 0) {
            // Enforce walls for corridors at intersections
            // This happens after all other generation to ensure walls are placed correctly
            intersections.forEach(inter => {
                const x = inter.localX;
                const z = inter.localZ;
                
                if (inter.type === 'red-blue') {
                    // For red (east) corridors at intersections, place walls to the north and south
                    // Red corridors run east-west at z=12-14 (3 blocks wide)
                    
                    // Check if this position is part of an east corridor
                    if (z >= 12 && z <= 14) {
                        // Place wall to the north (at z-1 if z=12)
                        if (z === 12 && z > 0) {
                            // Wall at z=11 for y=1 and y=2
                            data.set(x, 1, z - 1, dirtID);
                            data.set(x, 2, z - 1, dirtID);
                        }
                        
                        // Place wall to the south (at z+1 if z=14)
                        if (z === 14 && z < chunkSize - 1) {
                            // Wall at z=15 for y=1 and y=2
                            data.set(x, 1, z + 1, dirtID);
                            data.set(x, 2, z + 1, dirtID);
                        }
                    }
                } else if (inter.type === 'yellow-blue') {
                    // For yellow (west) corridors at intersections, place walls to the north and south
                    // Yellow corridors run east-west at z=16-18 (3 blocks wide)
                    
                    // Check if this position is part of a west corridor
                    if (z >= 16 && z <= 18) {
                        // Place wall to the north (at z-1 if z=16)
                        if (z === 16 && z > 0) {
                            // Wall at z=15 for y=1 and y=2
                            data.set(x, 1, z - 1, dirtID);
                            data.set(x, 2, z - 1, dirtID);
                        }
                        
                        // Place wall to the south (at z+1 if z=18)
                        if (z === 18 && z < chunkSize - 1) {
                            // Wall at z=19 for y=1 and y=2
                            data.set(x, 1, z + 1, dirtID);
                            data.set(x, 2, z + 1, dirtID);
                        }
                    }
                }
            });
        }
        
        // tell noa the chunk's terrain data is now set
        noa.world.setChunkData(id, data);
    });
    
    
    // Force chunk generation periodically
    setInterval(() => {
        if (noa && noa.playerEntity) {
            forceChunkGeneration();
        }
    }, 5000); // Every 5 seconds
    
    // Check player position and rotate to face corridor direction
    setInterval(() => {
        if (!noa || !noa.playerEntity) return;
        
        const pos = noa.entities.getPosition(noa.playerEntity);
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        // Get movement component
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (!movement) return;
        
        // Determine direction based on block type
        // corridorEastID = 4, corridorNorthID = 5, corridorWestID = 6
        let targetHeading = null;
        let corridorType = null;
        
        if (blockBelow === corridorEastID) {
            // East corridor - face east (+X)
            targetHeading = Math.PI / 2;
            corridorType = 'East';
        } else if (blockBelow === corridorNorthID) {
            // North corridor - always face north (+Z)
            targetHeading = 0;
            corridorType = 'North';
        } else if (blockBelow === corridorWestID) {
            // West corridor - face west (-X)
            targetHeading = -Math.PI / 2;
            corridorType = 'West';
        } else if (blockBelow === roomFloorID) {
            // In room - snap to nearest cardinal direction
            const currentHeading = movement.heading;
            let normalizedHeading = currentHeading % (2 * Math.PI);
            if (normalizedHeading < 0) normalizedHeading += 2 * Math.PI;
            
            // Snap to nearest cardinal direction
            if (normalizedHeading < Math.PI * 0.25 || normalizedHeading >= Math.PI * 1.75) {
                targetHeading = 0; // North
            } else if (normalizedHeading >= Math.PI * 0.25 && normalizedHeading < Math.PI * 0.75) {
                targetHeading = Math.PI / 2; // East
            } else if (normalizedHeading >= Math.PI * 0.75 && normalizedHeading < Math.PI * 1.25) {
                targetHeading = Math.PI; // South
            } else {
                targetHeading = -Math.PI / 2; // West
            }
            
            // Only snap if we're close enough (within 5 degrees)
            const diff = Math.abs(normalizedHeading - (targetHeading < 0 ? targetHeading + 2 * Math.PI : targetHeading));
            if (diff < Math.PI / 36 || diff > 2 * Math.PI - Math.PI / 36) {
                // Already close to cardinal, apply snap
            } else {
                targetHeading = null; // Don't snap if not close
            }
        }
        
        // Apply heading if we have a target
        if (targetHeading !== null) {
            movement.heading = targetHeading;
            noa.camera.heading = targetHeading;
        }
    }, 100); // Check every 100ms for faster correction
    
    // Handle downward movement slowdown on stairs and blue corridors
    setInterval(() => {
        if (!noa || !noa.playerEntity) return;
        
        const pos = noa.entities.getPosition(noa.playerEntity);
        const physics = noa.entities.getPhysics(noa.playerEntity);
        if (!physics || !physics.body) return;
        
        // Check block at player's feet
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        // Check if we're in a blue corridor (at y=3) or on stairs
        const inBlueCorridorHeight = Math.floor(pos[1]) >= 3 && Math.floor(pos[1]) <= 4;
        const onStairs = blockBelow === stairID;
        
        // Also check if we're above a blue corridor floor
        const blockTwoBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 2), 
            Math.floor(pos[2])
        );
        const aboveBlueCorridorFloor = blockTwoBelow === corridorNorthID;
        
        // If we're moving downward in a blue corridor area or on stairs
        if ((inBlueCorridorHeight && aboveBlueCorridorFloor) || onStairs) {
            const velocity = physics.body.velocity;
            
            // If moving downward, limit downward velocity
            if (velocity[1] < -2) {
                physics.body.velocity[1] = -2; // Cap downward speed
            }
            
            // Also reduce forward speed when descending
            if (velocity[1] < 0) {
                // Reduce horizontal velocity to 50% when going down
                physics.body.velocity[0] *= 0.5;
                physics.body.velocity[2] *= 0.5;
            }
        }
    }, 50); // Check frequently for smooth control
    
    // Handle continuous auto-strafing towards exit
    setInterval(() => {
        if (!noa || !noa.playerEntity) return;
        
        // Don't strafe while turning
        if (noa._isTurning) return;
        
        const pos = noa.entities.getPosition(noa.playerEntity);
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        // Only strafe in rooms
        if (blockBelow !== roomFloorID) {
            noa._targetExit = null;
            noa._targetDir = null;
            noa._isAutoStrafing = false; // Clear auto-strafing flag
            return;
        }
        
        // Always align to exit based on current facing direction
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (!movement) return;
        
        // Get current facing direction
        let normalizedHeading = movement.heading % (2 * Math.PI);
        if (normalizedHeading < 0) normalizedHeading += 2 * Math.PI;
        
        let facingDir = 'north';
        if (normalizedHeading >= Math.PI * 0.25 && normalizedHeading < Math.PI * 0.75) {
            facingDir = 'east';
        } else if (normalizedHeading >= Math.PI * 0.75 && normalizedHeading < Math.PI * 1.25) {
            facingDir = 'south';
        } else if (normalizedHeading >= Math.PI * 1.25 && normalizedHeading < Math.PI * 1.75) {
            facingDir = 'west';
        }
        
        // Skip if facing south
        if (facingDir === 'south') return;
        
        // Calculate target position for current direction
        const chunkX = Math.floor(pos[0] / 32);
        const chunkZ = Math.floor(pos[2] / 32);
        let targetExit = null;
        
        if (facingDir === 'north') {
            targetExit = { x: chunkX * 32 + 15 + 0.5, z: pos[2] };
        } else if (facingDir === 'east') {
            targetExit = { x: pos[0], z: chunkZ * 32 + 13 + 0.5 };
        } else if (facingDir === 'west') {
            targetExit = { x: pos[0], z: chunkZ * 32 + 17 + 0.5 };
        }
        
        if (!targetExit) return;
        
        let needsStrafe = false;
        let strafeDir = [0, 0, 0];
        
        // Calculate strafe direction based on facing direction
        if (facingDir === 'north') {
            // Need to align X position to x=15
            const xDiff = targetExit.x - pos[0];
            if (Math.abs(xDiff) > 0.1) {
                needsStrafe = true;
                strafeDir[0] = xDiff > 0 ? 1 : -1;
            }
        } else if (facingDir === 'east' || facingDir === 'west') {
            // Need to align Z position (z=13 for east, z=17 for west)
            const zDiff = targetExit.z - pos[2];
            if (Math.abs(zDiff) > 0.1) {
                needsStrafe = true;
                strafeDir[2] = zDiff > 0 ? 1 : -1;
            }
        }
        
        // Apply strafe movement if needed
        if (needsStrafe) {
            const physics = noa.entities.getPhysics(noa.playerEntity);
            if (physics && physics.body) {
                // Calculate distance to target for dampening
                let distance = 0;
                if (facingDir === 'north') {
                    distance = Math.abs(targetExit.x - pos[0]);
                } else if (facingDir === 'east' || facingDir === 'west') {
                    distance = Math.abs(targetExit.z - pos[2]);
                }
                
                // Apply dampening when close to target
                let forceMult = 1.0;
                if (distance < 0.5) {
                    forceMult = distance / 0.5; // Linear dampening from 0.5 blocks away
                }
                
                // Apply strong force for strafe movement
                const baseStrafeForce = 80; // Original speed
                const strafeForce = baseStrafeForce * forceMult;
                
                physics.body.applyForce([
                    strafeDir[0] * strafeForce,
                    0,
                    strafeDir[2] * strafeForce
                ]);
                
                // Slow down forward movement while strafing
                // Reduce forward/backward velocity to 25% (4x slower)
                if (facingDir === 'north' || facingDir === 'south') {
                    // Slow Z velocity when strafing in X direction
                    physics.body.velocity[2] *= 0.25;
                } else if (facingDir === 'east' || facingDir === 'west') {
                    // Slow X velocity when strafing in Z direction  
                    physics.body.velocity[0] *= 0.25;
                }
                
                // Mark that we're auto-strafing
                noa._isAutoStrafing = true;
                
                // Log strafe status occasionally
                if (Math.random() < 0.05) {  // 5% chance, about once per second
                    console.log('Auto-strafing:', facingDir, 'to', targetExit);
                }
            }
        } else {
            // Already aligned - apply stabilization
            noa._isAutoStrafing = false; // Clear auto-strafing flag
            
            const physics = noa.entities.getPhysics(noa.playerEntity);
            if (physics && physics.body) {
                const velocity = physics.body.velocity;
                
                // Cancel lateral velocity when aligned
                if (facingDir === 'north') {
                    // Cancel X velocity
                    if (Math.abs(velocity[0]) > 0.1) {
                        physics.body.velocity[0] *= 0.5; // Dampen velocity
                    }
                } else if (facingDir === 'east' || facingDir === 'west') {
                    // Cancel Z velocity
                    if (Math.abs(velocity[2]) > 0.1) {
                        physics.body.velocity[2] *= 0.5; // Dampen velocity
                    }
                }
            }
        }
    }, 50); // Run frequently for smooth movement
    
    // Handle smooth turning
    setInterval(() => {
        if (!noa || !noa.playerEntity || !noa._isTurning) return;
        
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (!movement) return;
        
        // Check if we've entered a corridor - if so, stop turning immediately
        const pos = noa.entities.getPosition(noa.playerEntity);
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        const inCorridor = blockBelow === corridorEastID || 
                          blockBelow === corridorNorthID || 
                          blockBelow === corridorWestID;
        
        if (inCorridor) {
            // Entered corridor - stop turning immediately
            noa._isTurning = false;
            noa._targetExit = null;
            noa._targetDir = null;
            console.log('Turn cancelled - entered corridor');
            return;
        }
        
        const currentHeading = movement.heading;
        const targetHeading = noa._targetHeading;
        
        // Calculate shortest rotation distance
        let diff = targetHeading - currentHeading;
        
        // Normalize to -PI to PI range
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        
        // Turn speed (radians per frame)
        const turnSpeed = 0.15; // About 8.6 degrees per frame, ~90 degrees in 0.5 seconds at 20fps
        
        // Apply rotation
        if (Math.abs(diff) < turnSpeed) {
            // Close enough, snap to target
            movement.heading = targetHeading;
            noa.camera.heading = targetHeading;
            noa._isTurning = false;
            console.log('Turn complete');
        } else {
            // Rotate towards target
            const rotationStep = diff > 0 ? turnSpeed : -turnSpeed;
            movement.heading += rotationStep;
            noa.camera.heading += rotationStep;
        }
    }, 50); // Run frequently for smooth rotation
    
    // Add render callback for continuous movement and chunk processing
    noa.on('beforeRender', () => {
        // Process world chunks on each frame for smoother loading
        noa.world.tick();
        
        // Get player movement component
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (!movement) return;
        
        
        // Always run forward at 2x speed
        movement.running = true;
        noa.inputs.state.forward = true;
        
        // Get current position
        const pos = noa.entities.getPosition(noa.playerEntity);
        
        // Check if in north corridor and prevent southward facing
        const blockBelowCheck = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        if (blockBelowCheck === corridorNorthID) {
            // In north corridor - check heading
            let currentHeading = movement.heading % (2 * Math.PI);
            if (currentHeading < 0) currentHeading += 2 * Math.PI;
            
            // If facing anywhere near south (between 90° and 270°), snap to north
            if (currentHeading > Math.PI * 0.5 && currentHeading < Math.PI * 1.5) {
                movement.heading = 0; // Force north
                noa.camera.heading = 0;
            }
        }
        
        // Context-sensitive A/D controls
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        // Check if we're in a corridor or room
        const inCorridor = blockBelow === corridorEastID || 
                          blockBelow === corridorNorthID || 
                          blockBelow === corridorWestID;
        const inRoom = blockBelow === roomFloorID;
        
        // Handle context-sensitive controls
        if (inRoom) {
            // In rooms: handle exit selection
            if (noa.inputs.state.left || noa.inputs.state.right) {
                const roomInfo = analyzeRoom(Math.floor(pos[0]), Math.floor(pos[2]));
                const currentHeading = movement.heading;
                
                // Debug log room info
                console.log('Room analysis:', {
                    playerPos: [Math.floor(pos[0]), Math.floor(pos[2])],
                    exits: Object.keys(roomInfo.exits).filter(dir => roomInfo.exits[dir] !== null),
                    currentHeading: currentHeading.toFixed(2),
                    input: noa.inputs.state.left ? 'left' : 'right'
                });
                
                // Determine which direction player is currently facing
                // Normalize heading to 0-2π range
                let normalizedHeading = currentHeading % (2 * Math.PI);
                if (normalizedHeading < 0) normalizedHeading += 2 * Math.PI;
                
                // Determine current facing direction (N/E/S/W)
                let currentDir = 'north';
                if (normalizedHeading >= Math.PI * 0.25 && normalizedHeading < Math.PI * 0.75) {
                    currentDir = 'east';
                } else if (normalizedHeading >= Math.PI * 0.75 && normalizedHeading < Math.PI * 1.25) {
                    currentDir = 'south';
                } else if (normalizedHeading >= Math.PI * 1.25 && normalizedHeading < Math.PI * 1.75) {
                    currentDir = 'west';
                }
                
                // First, snap current heading to nearest cardinal direction
                const cardinalDirections = [
                    { dir: 'north', heading: 0 },
                    { dir: 'east', heading: Math.PI / 2 },
                    { dir: 'south', heading: Math.PI },
                    { dir: 'west', heading: -Math.PI / 2 }
                ];
                
                // Find closest cardinal direction to current heading
                let closestCardinal = cardinalDirections[0];
                let minDiff = Math.PI * 2;
                
                for (const cardinal of cardinalDirections) {
                    let diff = Math.abs(normalizedHeading - (cardinal.heading < 0 ? cardinal.heading + 2 * Math.PI : cardinal.heading));
                    if (diff > Math.PI) diff = 2 * Math.PI - diff;
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestCardinal = cardinal;
                    }
                }
                
                currentDir = closestCardinal.dir;
                let snappedHeading = closestCardinal.heading;
                let targetDir = currentDir; // Initialize target direction
                
                // Simple turning logic - NEVER turn south
                if (noa.inputs.state.right) {
                    // Turn right (clockwise): N->E, E->nothing, S->W, W->N
                    if (currentDir === 'north') targetDir = 'east';
                    else if (currentDir === 'east') targetDir = currentDir; // Don't turn south!
                    else if (currentDir === 'south') targetDir = 'west';
                    else if (currentDir === 'west') targetDir = 'north';
                } else if (noa.inputs.state.left) {
                    // Turn left (counter-clockwise): N->W, W->nothing, S->E, E->N
                    if (currentDir === 'north') targetDir = 'west';
                    else if (currentDir === 'west') targetDir = currentDir; // Don't turn south!
                    else if (currentDir === 'south') targetDir = 'east';
                    else if (currentDir === 'east') targetDir = 'north';
                }
                
                // Get the heading for target direction
                let targetHeading = 0;
                if (targetDir === 'east') targetHeading = Math.PI / 2;
                else if (targetDir === 'south') targetHeading = Math.PI;
                else if (targetDir === 'west') targetHeading = -Math.PI / 2;
                
                // Always align to standard exit positions when turning
                // We know exits are at fixed positions relative to chunk
                // Corridors are 3 blocks wide, we want to align to the middle
                const chunkX = Math.floor(pos[0] / 32);
                const chunkZ = Math.floor(pos[2] / 32);
                let targetExit = null;
                
                if (targetDir === 'north') {
                    // North corridor is at x=14-16, middle is x=15
                    targetExit = { x: chunkX * 32 + 15 + 0.5, z: pos[2] };
                } else if (targetDir === 'east') {
                    // East corridor is at z=12-14, middle is z=13
                    targetExit = { x: pos[0], z: chunkZ * 32 + 13 + 0.5 };
                } else if (targetDir === 'west') {
                    // West corridor is at z=16-18, middle is z=17
                    targetExit = { x: pos[0], z: chunkZ * 32 + 17 + 0.5 };
                }
                // Never face south!
                
                console.log('Turning:', currentDir, '->', targetDir, 'heading:', targetHeading.toFixed(2));
                console.log('Available exits:', Object.keys(roomInfo.exits).filter(dir => roomInfo.exits[dir] !== null));
                
                // Store target heading for smooth turning
                noa._targetHeading = targetHeading;
                noa._isTurning = true;
                
                // Store the target exit info for continuous strafing
                noa._targetExit = targetExit;
                noa._targetDir = targetDir;
                console.log('Set target exit:', targetExit ? 'YES' : 'NO', 'direction:', targetDir);
                
                // Disable strafe
                noa.inputs.state.left = false;
                noa.inputs.state.right = false;
            }
        } else if (inCorridor) {
            // In corridors: strafe works normally, no turning needed
            // Clear any target exit and turning state when entering corridor
            noa._targetExit = null;
            noa._targetDir = null;
            noa._isTurning = false; // Stop any ongoing turning animation
        }
    });
    
    // Configure controls
    // Disable mouse control
    noa.camera.sensitivityX = 0;
    noa.camera.sensitivityY = 0;
    
    // Disable W/S keys (forward/backward)
    noa.inputs.bind('forward', '');
    noa.inputs.bind('backward', '');
    
    // Bind A/D for strafe (we'll handle turning manually in rooms)
    noa.inputs.bind('left', 'A', 'a');
    noa.inputs.bind('right', 'D', 'd');
    
    // Configure jump settings to prevent flying and limit jump height
    const movement = noa.entities.getMovement(noa.playerEntity);
    movement.airJumps = 0;  // No jumping while in air - prevents double jumping/flying
    
    // Configure jump height to 0.9 blocks
    // With gravity of ~10, we need initial velocity of ~4.2 for 0.9 block height
    movement.jumpImpulse = 4.2;  // Initial jump velocity (was probably ~10 by default)
    movement.jumpForce = 0;      // No sustained upward force during jump
    movement.jumpTime = 100;     // Short jump time since we're using impulse only
    
    console.log('Controls configured: Mouse disabled, W/S disabled, A/D for strafe/turn, Limited jump (0.9 blocks)');
    
    // Force immediate chunk generation
    forceChunkGeneration();
    
    // Force initial chunk generation after a delay
    console.log('Engine initialized!');
    setTimeout(() => {
        noa.world.tick();
    }, 100);
}

// Helper function to find room boundaries and exits
function analyzeRoom(playerX, playerZ) {
    // Find room boundaries by scanning outward from player position
    let minX = playerX, maxX = playerX;
    let minZ = playerZ, maxZ = playerZ;
    
    // Expand to find room boundaries
    while (noa.world.getBlockID(minX - 1, 0, playerZ) === roomFloorID) minX--;
    while (noa.world.getBlockID(maxX + 1, 0, playerZ) === roomFloorID) maxX++;
    while (noa.world.getBlockID(playerX, 0, minZ - 1) === roomFloorID) minZ--;
    while (noa.world.getBlockID(playerX, 0, maxZ + 1) === roomFloorID) maxZ++;
    
    // Find center of room
    const centerX = Math.floor((minX + maxX) / 2);
    const centerZ = Math.floor((minZ + maxZ) / 2);
    
    // Check for exits at standard positions
    const exits = {
        east: null,
        north: null,
        west: null,
        south: null
    };
    
    // Check east exit - scan for corridor along east wall
    for (let z = minZ; z <= maxZ; z++) {
        if (noa.world.getBlockID(maxX + 1, 0, z) === corridorEastID) {
            exits.east = { x: maxX, z: z, heading: Math.PI / 2 }; // Face east
            break;
        }
    }
    
    // Check north exit - scan for corridor along north wall (at y=3 for raised corridors)
    for (let x = minX; x <= maxX; x++) {
        // Check both y=0 and y=3 for north corridors
        if (noa.world.getBlockID(x, 0, maxZ + 1) === corridorNorthID ||
            noa.world.getBlockID(x, 3, maxZ + 1) === corridorNorthID) {
            exits.north = { x: x, z: maxZ, heading: 0 }; // Face north
            break;
        }
    }
    
    // Check west exit - scan for corridor along west wall
    for (let z = minZ; z <= maxZ; z++) {
        if (noa.world.getBlockID(minX - 1, 0, z) === corridorWestID) {
            exits.west = { x: minX, z: z, heading: -Math.PI / 2 }; // Face west
            break;
        }
    }
    
    // Check south exit - scan for corridor along south wall (at y=3 for raised corridors)
    for (let x = minX; x <= maxX; x++) {
        // Check both y=0 and y=3 for north corridors coming from south
        if (noa.world.getBlockID(x, 0, minZ - 1) === corridorNorthID ||
            noa.world.getBlockID(x, 3, minZ - 1) === corridorNorthID) {
            exits.south = { x: x, z: minZ, heading: Math.PI }; // Face south
            break;
        }
    }
    
    return { exits, center: { x: centerX, z: centerZ } };
}

// Force immediate chunk generation
function forceChunkGeneration() {
    // Trigger multiple world ticks to force chunk loading
    // noa-engine handles chunk loading based on player position automatically
    for (let i = 0; i < 10; i++) {
        noa.world.tick();
    }
    
}

// Start periodic state updates
function startPeriodicUpdates() {
    setInterval(async () => {
        if (!noa || !playerToken || !signingService) return;
        
        // Ensure signing service is in sync with current token's predicate nonce
        // This is crucial for creating valid commitments after token updates
        const privateKeyBytes = window.UnicitySDK.HexConverter.decode(localStorage.getItem('unicityRunner_privateKey'));
        const currentNonce = playerToken.state.unlockPredicate.nonce;
        signingService = await window.UnicitySDK.SigningService.createFromSecret(privateKeyBytes, currentNonce);
        
        // Get current position
        const position = noa.entities.getPosition(noa.playerEntity);
        
        // Get current state
        const currentState = getPlayerState() || {};
        
        // Create new state
        const newState = {
            ...currentState,
            position: [position[0], position[1], position[2]],
            health: currentPlayerHealth,
            lastUpdate: Date.now()
        };
        
        // Create new token state data
        let stateData = new TextEncoder().encode(JSON.stringify(newState));
        let dataHash = await new window.UnicitySDK.DataHasher(window.UnicitySDK.HashAlgorithm.SHA256).update(stateData).digest();
        
        // Create aggregator client for Unicity network
        const aggregatorClient = new window.UnicitySDK.AggregatorClient('https://gateway-test.unicity.network:443');
        const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        // Check if we have a pending transaction from a previous attempt
        const pendingTxKey = 'unicityRunner_pendingTransaction';
        let pendingTx = localStorage.getItem(pendingTxKey);
        
        let commitment, newPredicate, newNonce, transactionData, savedStateData;
        
        // Update pending status
        tokenStatus.pendingTransaction = !!pendingTx;
        updateTokenStatusDisplay();
        
        if (pendingTx) {
            // Recover from pending transaction
            const pending = JSON.parse(pendingTx);
            
            // Check if this is an old format without stateData
            if (!pending.stateData) {
                console.warn('Invalid pending transaction format (missing stateData), clearing...');
                localStorage.removeItem(pendingTxKey);
                pendingTx = null;
            } else {
                // Check if this pending transaction is too old or has failed too many times
                const maxRetries = 3;
                const maxAge = 5 * 60 * 1000; // 5 minutes
                
                if (!pending.retryCount) {
                    pending.retryCount = 0;
                }
                
                const age = Date.now() - pending.timestamp;
                if (age > maxAge || pending.retryCount >= maxRetries) {
                    console.warn(`Clearing stuck pending transaction (age: ${Math.floor(age/1000)}s, retries: ${pending.retryCount})`);
                    localStorage.removeItem(pendingTxKey);
                    pendingTx = null;
                    tokenStatus.pendingTransaction = false;
                    tokenStatus.lastError = 'Pending transaction expired';
                    updateTokenStatusDisplay();
                } else {
                    // Increment retry count
                    pending.retryCount++;
                    localStorage.setItem(pendingTxKey, JSON.stringify(pending));
                    
                    // Recreate objects from saved data
                const predicateFactory = new window.UnicitySDK.PredicateJsonFactory();
                newPredicate = await predicateFactory.create(
                    playerToken.id,
                    playerToken.type,
                    pending.newPredicate
                );
                newNonce = window.UnicitySDK.HexConverter.decode(pending.newNonce);
                
                // Restore the state data
                savedStateData = window.UnicitySDK.HexConverter.decode(pending.stateData);
                
                // IMPORTANT: We need to use the signing service with the CURRENT nonce,
                // not the new nonce. The current nonce matches the player token's current predicate.
                // The commitment proves ownership of the current token state.
                
                // Recreate transaction data from saved info
                const salt = window.UnicitySDK.HexConverter.decode(pending.commitment.transactionData.salt);
                const savedDataHash = window.UnicitySDK.DataHash.fromJSON(pending.commitment.transactionData.dataHash);
                const message = window.UnicitySDK.HexConverter.decode(pending.commitment.transactionData.message);
                
                transactionData = await window.UnicitySDK.TransactionData.create(
                    playerToken.state,
                    pending.commitment.transactionData.recipientAddress,
                    salt,
                    savedDataHash,
                    message,
                    [] // no nametag tokens
                );
                
                // Recreate commitment using the current signing service
                // (which has the nonce matching the current token's predicate)
                commitment = await window.UnicitySDK.Commitment.create(transactionData, signingService);
                
                // Override stateData with the saved one
                stateData = savedStateData;
                }
            }
        }
        
        if (!pendingTx) {
            // Generate new nonce for one-time address
            newNonce = crypto.getRandomValues(new Uint8Array(32));
            
            // Create a new signing service with the new nonce for the new predicate
            // This is required because MaskedPredicate needs a signing service created with the same nonce
            const privateKeyBytes = window.UnicitySDK.HexConverter.decode(localStorage.getItem('unicityRunner_privateKey'));
            const newSigningService = await window.UnicitySDK.SigningService.createFromSecret(privateKeyBytes, newNonce);
            
            // Create new masked predicate with new nonce (one-time address)
            newPredicate = await window.UnicitySDK.MaskedPredicate.create(
                playerToken.id,
                playerToken.type,
                newSigningService,  // Use the new signing service with matching nonce
                window.UnicitySDK.HashAlgorithm.SHA256,
                newNonce
            );
            
            // Create new recipient address from the new predicate
            const recipient = await window.UnicitySDK.DirectAddress.create(newPredicate.reference);
            
            // Create transaction data for state update
            
            transactionData = await window.UnicitySDK.TransactionData.create(
                playerToken.state,
                recipient.toString(),
                crypto.getRandomValues(new Uint8Array(32)), // salt
                dataHash,
                new TextEncoder().encode('State update'),
                [] // no nametag tokens
            );
            
            // Create commitment
            commitment = await window.UnicitySDK.Commitment.create(transactionData, signingService);
            
            // Save pending transaction BEFORE submitting
            // Use JSON serialization for commitment
            const pendingData = {
                commitment: {
                    requestId: commitment.requestId.toJSON(),
                    transactionData: {
                        // We'll reconstruct this from the token state
                        recipientAddress: recipient.toString(),
                        salt: window.UnicitySDK.HexConverter.encode(transactionData.salt),
                        dataHash: dataHash.toJSON(),
                        message: window.UnicitySDK.HexConverter.encode(new TextEncoder().encode('State update'))
                    }
                },
                newPredicate: newPredicate.toJSON(),
                newNonce: window.UnicitySDK.HexConverter.encode(newNonce),
                stateData: window.UnicitySDK.HexConverter.encode(stateData), // Save the actual state data
                timestamp: Date.now()
            };
            localStorage.setItem(pendingTxKey, JSON.stringify(pendingData));
            
            // Update status to show pending
            tokenStatus.pendingTransaction = true;
            updateTokenStatusDisplay();
        }
        
        try {
            // Submit commitment
            const response = await client.submitCommitment(commitment);
            
            if (response.status !== window.UnicitySDK.SubmitCommitmentStatus.SUCCESS) {
                throw new Error(`Failed to submit transaction commitment: ${response.status}`);
            }
            
            // Wait for inclusion proof using SDK utility
            const inclusionProof = await window.UnicitySDK.waitInclusionProof(
                client,
                commitment,
                AbortSignal.timeout(10000), // 10 second timeout for updates
                1000 // Check every second
            );
            const transaction = await client.createTransaction(commitment, inclusionProof);
            
            // Create new token state with new predicate
            const newTokenState = await window.UnicitySDK.TokenState.create(
                newPredicate,
                stateData
            );
            
            // Finish transaction to update token
            try {
                playerToken = await client.finishTransaction(
                    playerToken,
                    newTokenState,
                    transaction
                );
            } catch (finishError) {
                throw finishError;
            }
            
            // Note: We don't update the signing service here anymore.
            // Instead, we sync it at the beginning of each update cycle to ensure
            // it always matches the current token's predicate nonce.
            
            // Clear pending transaction on success
            localStorage.removeItem(pendingTxKey);
            
            console.log('State transition submitted to Unicity network successfully');
            
            // Update status
            tokenStatus.totalSubmissions++;
            tokenStatus.successfulSubmissions++;
            tokenStatus.pendingTransaction = false;
            tokenStatus.lastUpdateTime = Date.now();
            tokenStatus.lastError = null;
            updateTokenStatusDisplay();
            
            // Serialize and save the updated token locally (only on success)
            const tokenJson = playerToken.toJSON();
            localStorage.setItem('unicityRunner_playerToken', JSON.stringify(tokenJson));
            
            console.log('State updated and saved');
        } catch (error) {
            // Update status for failure
            tokenStatus.totalSubmissions++;
            tokenStatus.lastError = error.message || 'Transaction failed';
            updateTokenStatusDisplay();
            
            // Check for REQUEST_ID_EXISTS - this should never happen with our approach
            if (error.message && error.message.includes('REQUEST_ID_EXISTS')) {
                console.error('CRITICAL ERROR: REQUEST_ID_EXISTS - Transaction was lost!', error);
                // Clear the pending transaction as it's unrecoverable
                localStorage.removeItem(pendingTxKey);
                tokenStatus.pendingTransaction = false;
            } else {
                console.warn('Failed to submit to Unicity network, will retry next time:', error);
            }
            throw error;
        }
    }, 10000); // Every 10 seconds
}

// Create drone entity
function createDrone(spawnNearPlayer = true) {
    const scene = noa.rendering.getScene();
    
    // Determine spawn position
    let droneSpawnPos = [0, 10, 0]; // Default position
    
    if (spawnNearPlayer && noa.playerEntity) {
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        // Spawn drone 10 blocks away from player in a random direction, 5 blocks up
        const angle = Math.random() * Math.PI * 2;
        droneSpawnPos = [
            playerPos[0] + Math.cos(angle) * 10,
            playerPos[1] + 5,
            playerPos[2] + Math.sin(angle) * 10
        ];
    }
    
    // Create a rectangular box for the drone
    const droneBox = BABYLON.MeshBuilder.CreateBox('drone', {
        width: 1.2,
        height: 0.6,
        depth: 0.8
    }, scene);
    
    // Create dark gray material for drone
    const droneMat = noa.rendering.makeStandardMaterial('droneMat');
    droneMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3); // Dark gray
    droneMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    droneBox.material = droneMat;
    
    // Create drone entity
    // The last parameter (true) already adds physics component
    droneEntity = noa.entities.add(droneSpawnPos, 1, 1, droneBox, [0, 0, 0], true, false);
    
    // Modify existing physics component for flying drone
    const physics = noa.entities.getPhysics(droneEntity);
    if (physics && physics.body) {
        physics.body.gravityMultiplier = 0; // No gravity for flying drone
        physics.body.friction = 0;
        physics.body.airDrag = 0; // No air resistance
        physics.body.fluidDrag = 0; // No fluid drag
        physics.body.restitution = 0;
        // Set the body to be always active
        physics.body.sleepSpeedLimit = 0;
        physics.body.sleepTimeLimit = 0;
    }
    
    
    // Start drone AI
    startDroneAI();
}

// Drone AI behavior
function startDroneAI() {
    let lastFireTime = 0;
    const fireRate = 1000; // Fire every 1 second
    const shootingRange = 20; // Shooting range in blocks
    const pursuitAltitude = { min: 10, max: 15 }; // High altitude during pursuit
    const combatAltitude = 8; // Lower altitude during combat
    
    setInterval(() => {
        if (!droneEntity || !noa.entities.hasComponent(droneEntity, noa.entities.names.position)) return;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const dronePos = noa.entities.getPosition(droneEntity);
        
        // Calculate distance to player
        const dx = playerPos[0] - dronePos[0];
        const dy = playerPos[1] - dronePos[1];
        const dz = playerPos[2] - dronePos[2];
        const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
        const totalDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Get drone physics
        const physics = noa.entities.getPhysics(droneEntity);
        if (!physics) return;
        
        // Always pursue player regardless of distance
        if (horizontalDistance > shootingRange) {
            // PURSUIT MODE - fly high and approach player
            
            // Calculate target altitude (random between min and max for variety)
            const targetAltitude = playerPos[1] + pursuitAltitude.min + 
                                 Math.random() * (pursuitAltitude.max - pursuitAltitude.min);
            const altitudeDiff = targetAltitude - dronePos[1];
            
            // Calculate horizontal direction to player
            const horizDir = horizontalDistance > 0 ? 1 / horizontalDistance : 0;
            const dirX = dx * horizDir;
            const dirZ = dz * horizDir;
            
            // Set drone velocity with faster pursuit speed
            const pursuitSpeed = 15; // Much faster when pursuing
            
            // Apply forces instead of setting velocity directly
            const forceMult = 20; // Increased force multiplier
            physics.body.applyForce([dirX * pursuitSpeed * forceMult, 0, dirZ * pursuitSpeed * forceMult]);
            
            // Also set velocity directly as backup
            physics.body.velocity[0] = dirX * pursuitSpeed;
            physics.body.velocity[2] = dirZ * pursuitSpeed;
            
            // Altitude control - move up/down to maintain pursuit altitude
            if (Math.abs(altitudeDiff) > 1) {
                physics.body.velocity[1] = Math.sign(altitudeDiff) * 5; // Faster vertical movement
                physics.body.applyForce([0, Math.sign(altitudeDiff) * 50, 0]);
            } else {
                physics.body.velocity[1] = altitudeDiff * 2; // Fine adjustment
            }
            
            
        } else {
            // COMBAT MODE - hover around player at lower altitude and shoot
            
            // Calculate target position for hovering
            const hoverRadius = shootingRange * 0.7; // Stay within shooting range
            const angle = Date.now() * 0.001; // Slowly circle around player
            
            const targetX = playerPos[0] + Math.cos(angle) * hoverRadius;
            const targetZ = playerPos[2] + Math.sin(angle) * hoverRadius;
            const targetY = playerPos[1] + combatAltitude;
            
            // Calculate direction to hover position
            const hoverDx = targetX - dronePos[0];
            const hoverDy = targetY - dronePos[1];
            const hoverDz = targetZ - dronePos[2];
            
            // Set drone velocity for hovering
            const hoverSpeed = 6; // Faster combat movement
            
            // Apply forces for smoother movement
            physics.body.applyForce([hoverDx * 10, hoverDy * 15, hoverDz * 10]);
            
            // Also set velocity directly
            physics.body.velocity[0] = hoverDx * 1.0; // Faster hovering
            physics.body.velocity[1] = hoverDy * 1.5; // Quick altitude adjustment
            physics.body.velocity[2] = hoverDz * 1.0;
            
            // Fire projectile if cooldown passed
            const currentTime = Date.now();
            if (currentTime - lastFireTime > fireRate) {
                fireProjectile(dronePos, playerPos);
                lastFireTime = currentTime;
            }
        }
    }, 100); // Update 10 times per second
}

// Fire projectile from drone to player
function fireProjectile(fromPos, toPos) {
    const scene = noa.rendering.getScene();
    
    // Create tiny bullet-like projectile
    const projectile = BABYLON.MeshBuilder.CreateSphere('projectile', {
        diameter: 0.1 // Much smaller, like a bullet
    }, scene);
    
    // Create dark metallic material for bullet
    const projectileMat = noa.rendering.makeStandardMaterial('projectileMat');
    projectileMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Dark gray
    projectileMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Metallic shine
    projectileMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Slight glow for visibility
    projectile.material = projectileMat;
    
    // Create projectile entity with physics
    const projectileEntity = noa.entities.add(
        [fromPos[0], fromPos[1], fromPos[2]], 
        0.3, 0.3, projectile, [0, 0, 0], true, false
    );
    
    // Calculate direction
    const dx = toPos[0] - fromPos[0];
    const dy = toPos[1] - fromPos[1];
    const dz = toPos[2] - fromPos[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    const dirX = dx / distance;
    const dirY = dy / distance;
    const dirZ = dz / distance;
    
    // Set projectile physics properties - behave like bullets
    const bulletSpeed = 30; // Much faster for bullet-like behavior
    const physics = noa.entities.getPhysics(projectileEntity);
    if (physics && physics.body) {
        physics.body.mass = 0.01; // Very light
        physics.body.friction = 0;
        physics.body.airDrag = 0; // No air resistance
        physics.body.fluidDrag = 0; // No drag
        physics.body.restitution = 0;
        physics.body.gravityMultiplier = 0; // No gravity for bullets
        // Set velocity
        physics.body.velocity[0] = dirX * bulletSpeed;
        physics.body.velocity[1] = dirY * bulletSpeed;
        physics.body.velocity[2] = dirZ * bulletSpeed;
        // Prevent physics engine from slowing it down
        physics.body.sleepSpeedLimit = 0;
        physics.body.sleepTimeLimit = 0;
        
        // Add collision callback to detect impacts immediately
        physics.body.onCollide = function(contactInfo) {
            // Delete projectile on any collision
            setTimeout(() => {
                if (noa.entities.hasComponent(projectileEntity, noa.entities.names.position)) {
                    noa.entities.deleteEntity(projectileEntity);
                }
            }, 0);
        };
    }
    
    // Store projectile for collision checking
    projectiles.push({
        entity: projectileEntity,
        startTime: Date.now(),
        startPos: [...fromPos], // Store starting position for range check
        velocity: [dirX * bulletSpeed, dirY * bulletSpeed, dirZ * bulletSpeed] // Store velocity to ensure constant speed
    });
    
}

// Check projectile collisions and cleanup
setInterval(() => {
    // Skip if engine not initialized yet
    if (!noa || !noa.playerEntity) return;
    
    const currentTime = Date.now();
    const playerPos = noa.entities.getPosition(noa.playerEntity);
    
    projectiles = projectiles.filter(proj => {
        // Check if projectile still exists
        if (!noa.entities.hasComponent(proj.entity, noa.entities.names.position)) {
            return false;
        }
        
        const projPos = noa.entities.getPosition(proj.entity);
        
        // Check collision with player
        const dx = playerPos[0] - projPos[0];
        const dy = playerPos[1] - projPos[1];
        const dz = playerPos[2] - projPos[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < 1) { // Hit player
            damagePlayer(5);
            noa.entities.deleteEntity(proj.entity);
            return false;
        }
        
        // Check range - 64 blocks max
        const travelDx = projPos[0] - proj.startPos[0];
        const travelDy = projPos[1] - proj.startPos[1];
        const travelDz = projPos[2] - proj.startPos[2];
        const travelDistance = Math.sqrt(travelDx * travelDx + travelDy * travelDy + travelDz * travelDz);
        
        if (travelDistance > 64) { // Exceeded max range
            noa.entities.deleteEntity(proj.entity);
            return false;
        }
        
        // Ensure constant velocity (in case physics engine tries to slow it down)
        const physics = noa.entities.getPhysics(proj.entity);
        if (physics && physics.body) {
            physics.body.velocity[0] = proj.velocity[0];
            physics.body.velocity[1] = proj.velocity[1];
            physics.body.velocity[2] = proj.velocity[2];
        }
        
        // Check if hit ground or wall - use raycasting for better collision
        // Check current position
        const blockAt = noa.world.getBlockID(
            Math.floor(projPos[0]),
            Math.floor(projPos[1]),
            Math.floor(projPos[2])
        );
        
        if (blockAt !== 0) { // Hit something solid
            noa.entities.deleteEntity(proj.entity);
            return false;
        }
        
        // Also check if velocity is near zero (stuck on surface)
        if (physics && physics.body) {
            const vel = physics.body.velocity;
            const speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
            if (speed < 5) { // Moving too slowly, must have hit something
                noa.entities.deleteEntity(proj.entity);
                return false;
            }
        }
        
        return true; // Keep projectile
    });
}, 16); // Check 60 times per second for fast bullets

// Handle player death
function handlePlayerDeath() {
    console.log('Player died! Respawning...');
    
    // Reset health
    currentPlayerHealth = 100;
    updateHealthDisplay(currentPlayerHealth);
    
    // Find spawn position
    const spawnPos = calculateInitialSpawnPoint(WORLD_SEED);
    noa.entities.setPosition(noa.playerEntity, spawnPos);
    
    // Respawn drone at a distance
    if (droneEntity && noa.entities.hasComponent(droneEntity, noa.entities.names.position)) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 30; // Spawn far away
        noa.entities.setPosition(droneEntity, [
            spawnPos[0] + Math.cos(angle) * distance,
            spawnPos[1] + 15,
            spawnPos[2] + Math.sin(angle) * distance
        ]);
    }
    
    // Clear all projectiles
    projectiles.forEach(proj => {
        if (noa.entities.hasComponent(proj.entity, noa.entities.names.position)) {
            noa.entities.deleteEntity(proj.entity);
        }
    });
    projectiles = [];
    
    console.log('Player respawned with full health');
}