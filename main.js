// Unicity Runner Demo - Main Game Logic
import { Engine } from 'noa-engine'

// Global world seed for deterministic generation
const WORLD_SEED = 'UnicityRunnerDemo_v1_Seed_2025';

// Initialize globals
let noa;
let playerToken;
let signingService;

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
});

async function initializeGame() {
    console.log('Initializing Unicity Runner...');
    
    // Set up reset button
    const resetButton = document.getElementById('resetPlayer');
    resetButton.addEventListener('click', () => {
        localStorage.removeItem('unicityRunner_playerToken');
        localStorage.removeItem('unicityRunner_privateKey');
        location.reload();
    });
    
    // Initialize player token
    await initializePlayerToken();
    
    // Set up noa engine
    setupNoaEngine();
    
    // Start periodic state updates
    startPeriodicUpdates();
}

// Seeded random number generator
function seededRandom(seed) {
    let value = 0;
    for (let i = 0; i < seed.length; i++) {
        value = ((value << 5) - value) + seed.charCodeAt(i);
        value = value & value;
    }
    return function() {
        value = (value * 1103515245 + 12345) & 0x7fffffff;
        return value / 0x7fffffff;
    };
}

// Calculate initial spawn point deterministically
function calculateInitialSpawnPoint(seed) {
    const rng = seededRandom(seed + '_spawn');
    // Generate a simple maze pattern for chunk 0,0
    const chunkSize = 16;
    const maze = generateMazeForChunk(0, 0, seed);
    
    // Find the first open space near the center
    const centerX = Math.floor(chunkSize / 2);
    const centerZ = Math.floor(chunkSize / 2);
    
    // Spiral search from center to find open space
    for (let radius = 0; radius < chunkSize / 2; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const x = centerX + dx;
                const z = centerZ + dz;
                if (x >= 0 && x < chunkSize && z >= 0 && z < chunkSize && !maze[x][z]) {
                    return [x + 0.5, 1, z + 0.5]; // Center of the block, 1 unit above ground
                }
            }
        }
    }
    
    // Fallback to center if no open space found
    return [centerX + 0.5, 1, centerZ + 0.5];
}

// Generate maze for a specific chunk using recursive backtracker
function generateMazeForChunk(chunkX, chunkZ, seed) {
    const chunkSize = 16;
    const maze = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill(true));
    const rng = seededRandom(seed + '_chunk_' + chunkX + '_' + chunkZ);
    
    // Recursive backtracker algorithm
    const stack = [];
    const visited = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill(false));
    
    // Start from a random position
    let currentX = Math.floor(rng() * chunkSize);
    let currentZ = Math.floor(rng() * chunkSize);
    
    // Make sure starting position is odd for proper maze generation
    currentX = currentX % 2 === 0 ? currentX + 1 : currentX;
    currentZ = currentZ % 2 === 0 ? currentZ + 1 : currentZ;
    
    if (currentX >= chunkSize) currentX = chunkSize - 2;
    if (currentZ >= chunkSize) currentZ = chunkSize - 2;
    
    visited[currentX][currentZ] = true;
    maze[currentX][currentZ] = false; // Open space
    stack.push([currentX, currentZ]);
    
    const directions = [[0, 2], [2, 0], [0, -2], [-2, 0]];
    
    while (stack.length > 0) {
        // Get unvisited neighbors
        const neighbors = [];
        for (const [dx, dz] of directions) {
            const newX = currentX + dx;
            const newZ = currentZ + dz;
            if (newX > 0 && newX < chunkSize - 1 && newZ > 0 && newZ < chunkSize - 1 && !visited[newX][newZ]) {
                neighbors.push([newX, newZ, dx, dz]);
            }
        }
        
        if (neighbors.length > 0) {
            // Choose random neighbor
            const [nextX, nextZ, dx, dz] = neighbors[Math.floor(rng() * neighbors.length)];
            
            // Remove wall between current and next
            maze[currentX + dx/2][currentZ + dz/2] = false;
            maze[nextX][nextZ] = false;
            
            visited[nextX][nextZ] = true;
            stack.push([nextX, nextZ]);
            currentX = nextX;
            currentZ = nextZ;
        } else {
            // Backtrack
            const [prevX, prevZ] = stack.pop();
            currentX = prevX;
            currentZ = prevZ;
        }
    }
    
    // Open up the edges for continuous world
    for (let i = 0; i < chunkSize; i++) {
        if (i % 2 === 1) {
            if (chunkX !== 0 || chunkZ !== 0) { // Don't open edges of spawn chunk
                maze[0][i] = false;
                maze[chunkSize - 1][i] = false;
                maze[i][0] = false;
                maze[i][chunkSize - 1] = false;
            }
        }
    }
    
    return maze;
}

// Initialize player token management
async function initializePlayerToken() {
    const savedTokenString = localStorage.getItem('unicityRunner_playerToken');
    const savedPrivateKey = localStorage.getItem('unicityRunner_privateKey');
    
    if (savedTokenString && savedPrivateKey) {
        // Load existing token
        const tokenData = JSON.parse(savedTokenString);
        
        // Recreate signing service
        const privateKeyBytes = window.UnicitySDK.HexConverter.decode(savedPrivateKey);
        signingService = new window.UnicitySDK.SigningService(privateKeyBytes);
        
        // Recreate token components
        const tokenId = window.UnicitySDK.TokenId.create(window.UnicitySDK.HexConverter.decode(tokenData.id));
        const tokenType = window.UnicitySDK.TokenType.create(window.UnicitySDK.HexConverter.decode(tokenData.type));
        
        // Recreate predicate based on type
        console.log('Loading predicate from:', tokenData.state.predicate);
        let predicate;
        if (tokenData.state.predicate.type === 'UNMASKED') {
            predicate = await window.UnicitySDK.UnmaskedPredicate.fromJSON(tokenId, tokenType, tokenData.state.predicate);
        } else if (tokenData.state.predicate.type === 'MASKED') {
            predicate = await window.UnicitySDK.MaskedPredicate.fromJSON(tokenId, tokenType, tokenData.state.predicate);
        } else {
            throw new Error('Unknown predicate type: ' + tokenData.state.predicate.type);
        }
        console.log('Recreated predicate:', predicate);
        
        // Recreate token state
        const stateData = tokenData.state.data ? window.UnicitySDK.HexConverter.decode(tokenData.state.data) : null;
        const stateHash = window.UnicitySDK.DataHash.fromJSON(tokenData.state.hash);
        const tokenState = new window.UnicitySDK.TokenState(predicate, stateData, stateHash);
        
        // Recreate the token
        playerToken = new window.UnicitySDK.Token(
            tokenId,
            tokenType,
            null, // token data
            new window.UnicitySDK.TokenCoinData([]), // empty coins
            tokenState,
            [], // transactions
            [], // nametag tokens
            tokenData.version || window.UnicitySDK.TOKEN_VERSION
        );
        
        console.log("Existing player token imported.", playerToken);
        console.log("Token state:", playerToken.state);
        console.log("Unlock predicate:", playerToken.state?.unlockPredicate);
    } else {
        // New player flow
        await createNewPlayerToken();
    }
}

// Create a new player token
async function createNewPlayerToken() {
    const spawnPosition = calculateInitialSpawnPoint(WORLD_SEED);
    
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
    
    // Create signing service with private key
    signingService = new window.UnicitySDK.SigningService(privateKeyBytes);
    
    // Get public key from signing service
    const publicKey = signingService.publicKey;
    
    // Create token ID and type
    const tokenId = window.UnicitySDK.TokenId.create(crypto.getRandomValues(new Uint8Array(32)));
    const tokenType = window.UnicitySDK.TokenType.create(new Uint8Array([1])); // Simple type ID
    
    // Create predicate (unmasked for simplicity)
    const predicate = await window.UnicitySDK.UnmaskedPredicate.create(
        tokenId,
        tokenType,
        signingService, // pass the signing service instead of individual params
        window.UnicitySDK.HashAlgorithm.SHA256,
        crypto.getRandomValues(new Uint8Array(16)) // nonce
    );
    
    // Create token state
    const stateData = new TextEncoder().encode(JSON.stringify(initialState));
    const tokenState = await window.UnicitySDK.TokenState.create(predicate, stateData);
    
    // Create the token
    playerToken = new window.UnicitySDK.Token(
        tokenId,
        tokenType,
        null, // token data
        new window.UnicitySDK.TokenCoinData([]), // empty coins
        tokenState,
        [], // transactions
        [], // nametag tokens
        window.UnicitySDK.TOKEN_VERSION
    );
    
    // Store private key (hex encoded)
    localStorage.setItem('unicityRunner_privateKey', window.UnicitySDK.HexConverter.encode(privateKeyBytes));
    
    // Serialize and save token
    const tokenData = {
        id: tokenId.toJSON(),
        type: tokenType.toJSON(),
        state: {
            predicate: predicate.toJSON(),
            data: window.UnicitySDK.HexConverter.encode(stateData),
            hash: tokenState.hash.toJSON()
        },
        version: playerToken.version
    };
    localStorage.setItem('unicityRunner_playerToken', JSON.stringify(tokenData));
    
    console.log("New player token created.", playerToken);
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

// Set up noa engine
function setupNoaEngine() {
    const opts = {
        domElement: document.getElementById('app'),
        debug: false,
        showFPS: true,
        inverseY: false,
        inverseX: false,
        sensitivity: 0.01,
        gravity: [0, -10, 0],
        bindings: {
            forward: ['W', '<up>'],
            backward: ['S', '<down>'],
            left: ['A', '<left>'],
            right: ['D', '<right>'],
            jump: ['<space>'],
        }
    };
    
    // Create engine
    noa = new Engine(opts);
    
    // Configure 3rd person camera
    noa.camera.zoomDistance = 5;
    noa.camera.pitch = -0.5;
    
    // Register materials
    const wallTexture = 'https://cdn3.struffelproductions.com/file/ambientcg/media/images/Rock030_1K_Color.jpg';
    const floorTexture = 'https://cdn3.struffelproductions.com/file/ambientcg/media/images/Ground037_1K_Color.jpg';
    
    noa.registry.registerMaterial('wall', { texture: wallTexture });
    noa.registry.registerMaterial('floor', { texture: floorTexture });
    
    // Register blocks
    const wallID = noa.registry.registerBlock(1, { material: 'wall' });
    const floorID = noa.registry.registerBlock(2, { material: 'floor' });
    
    // Set player position from token
    const playerState = getPlayerState();
    const position = playerState?.position || [0, 1, 0];
    noa.entities.setPosition(noa.playerEntity, position);
    
    // Set up world generation
    noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
        // Generate chunk data
        for (let i = 0; i < data.shape[0]; i++) {
            for (let j = 0; j < data.shape[1]; j++) {
                for (let k = 0; k < data.shape[2]; k++) {
                    const worldX = x + i;
                    const worldY = y + j;
                    const worldZ = z + k;
                    
                    // Floor at y=0
                    if (worldY === 0) {
                        data.set(i, j, k, floorID);
                    }
                    
                    // Generate maze walls
                    if (worldY === 1 || worldY === 2) {
                        const chunkX = Math.floor(worldX / 16);
                        const chunkZ = Math.floor(worldZ / 16);
                        const localX = ((worldX % 16) + 16) % 16;
                        const localZ = ((worldZ % 16) + 16) % 16;
                        
                        const maze = generateMazeForChunk(chunkX, chunkZ, WORLD_SEED);
                        
                        if (maze[localX][localZ]) {
                            data.set(i, j, k, wallID);
                        }
                    }
                }
            }
        }
    });
}

// Start periodic state updates
function startPeriodicUpdates() {
    setInterval(async () => {
        if (!noa || !playerToken || !signingService) return;
        
        // Get current position
        const position = noa.entities.getPosition(noa.playerEntity);
        
        // Get current state
        const currentState = getPlayerState() || {};
        
        // Create new state
        const newState = {
            ...currentState,
            position: [position[0], position[1], position[2]],
            lastUpdate: Date.now()
        };
        
        // Create new token state
        const stateData = new TextEncoder().encode(JSON.stringify(newState));
        const newTokenState = await window.UnicitySDK.TokenState.create(
            playerToken.state.unlockPredicate,
            stateData
        );
        
        // Update token with new state
        playerToken = new window.UnicitySDK.Token(
            playerToken.id,
            playerToken.type,
            playerToken.data,
            playerToken.coins,
            newTokenState,
            playerToken._transactions,
            playerToken._nametagTokens,
            playerToken.version
        );
        
        // Serialize and save
        const tokenData = {
            id: playerToken.id.toJSON(),
            type: playerToken.type.toJSON(),
            state: {
                predicate: playerToken.state.unlockPredicate.toJSON(),
                data: window.UnicitySDK.HexConverter.encode(stateData),
                hash: newTokenState.hash.toJSON()
            },
            version: playerToken.version
        };
        localStorage.setItem('unicityRunner_playerToken', JSON.stringify(tokenData));
        
        console.log('State updated and saved');
    }, 10000); // Every 10 seconds
}