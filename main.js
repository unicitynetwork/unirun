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
    // Create engine options
    const opts = {
        domElement: document.getElementById('app'),
        debug: true,
        showFPS: true,
        chunkSize: 32,
        chunkAddDistance: 2.5,
        chunkRemoveDistance: 3.5,
    };
    
    // Create engine
    noa = new Engine(opts);
    
    // Register materials - using simple colors
    var brownish = [0.45, 0.36, 0.22];
    var grayish = [0.6, 0.6, 0.6];
    noa.registry.registerMaterial('dirt', { color: brownish });
    noa.registry.registerMaterial('stone', { color: grayish });
    
    // Register blocks
    var dirtID = noa.registry.registerBlock(1, { material: 'dirt' });
    var stoneID = noa.registry.registerBlock(2, { material: 'stone' });
    
    console.log('Registered blocks - dirtID:', dirtID, 'stoneID:', stoneID);
    
    // Set player position from token
    const playerState = getPlayerState();
    let position = playerState?.position || [8, 5, 8]; // Start at y=5, well above ground
    
    // Sanity check - if player is way below the world, reset them
    if (position[1] < -10) {
        console.log('Player position was invalid, resetting to spawn point');
        position = [8, 5, 8];
    }
    
    console.log('Setting player position to:', position);
    noa.entities.setPosition(noa.playerEntity, position);
    
    // Make sure player has a mesh
    const playerMesh = noa.entities.getPositionData(noa.playerEntity);
    console.log('Player entity:', noa.playerEntity, 'mesh data:', playerMesh);
    
    // Log camera info
    console.log('Camera settings:', {
        zoom: noa.camera.zoomDistance,
        pitch: noa.camera.pitch,
        position: noa.camera.getPosition()
    });
    
    // Create flat terrain with maze walls
    function getVoxelID(x, y, z) {
        // Underground is all dirt
        if (y < 0) return dirtID;
        
        // Ground level (y=0) is stone floor
        if (y === 0) return stoneID;
        
        // Maze walls at y=1 and y=2
        if (y === 1 || y === 2) {
            // For now, create a simple grid pattern
            if (x % 8 === 0 || z % 8 === 0) {
                return dirtID; // Wall
            }
        }
        
        return 0; // Air
    }
    
    // Set up world generation
    noa.world.on('worldDataNeeded', function (id, data, x, y, z) {
        // `id` - a unique string id for the chunk
        // `data` - an `ndarray` of voxel ID data
        // `x, y, z` - world coords of the corner of the chunk
        for (var i = 0; i < data.shape[0]; i++) {
            for (var j = 0; j < data.shape[1]; j++) {
                for (var k = 0; k < data.shape[2]; k++) {
                    var voxelID = getVoxelID(x + i, y + j, z + k);
                    data.set(i, j, k, voxelID);
                }
            }
        }
        // tell noa the chunk's terrain data is now set
        noa.world.setChunkData(id, data);
    });
    
    // Log player position and surrounding blocks every second
    setInterval(() => {
        if (noa && noa.playerEntity) {
            const pos = noa.entities.getPosition(noa.playerEntity);
            console.log('Player position:', pos);
            
            // Check blocks around player
            const blockBelow = noa.world.getBlockID(
                Math.floor(pos[0]), 
                Math.floor(pos[1] - 1), 
                Math.floor(pos[2])
            );
            const blockAt = noa.world.getBlockID(
                Math.floor(pos[0]), 
                Math.floor(pos[1]), 
                Math.floor(pos[2])
            );
            console.log(`Block below: ${blockBelow}, Block at player: ${blockAt}`);
        }
    }, 1000);
    
    // Request pointer lock on click - get canvas from container
    const canvas = noa.container.canvas;
    if (canvas) {
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock();
            console.log('Pointer lock requested');
        });
        
        // Debug rendering
        console.log('Rendering canvas:', canvas);
        console.log('Scene:', noa.rendering.getScene());
        console.log('Registered blocks:', { wallID, floorID });
    } else {
        console.error('Canvas not found!');
    }
    
    // Force initial chunk generation after a delay
    console.log('Engine initialized!');
    setTimeout(() => {
        noa.world.tick();
    }, 100);
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