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
                    return [x + 0.5, 1, z + 0.5]; // Center of the block, 1 unit above ground
                }
            }
        }
    }
    
    // Fallback to center if no open space found
    return [centerX + 0.5, 1, centerZ + 0.5];
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
    const result = rng() < 0.6; // 60% chance
    return result;
}

function northExitExists(x, z, seed) {
    // Use a more unique seed to avoid patterns
    const rng = seededRandom(seed + '_exit_north_' + (x * 1000) + '_' + (z * 1000));
    const result = rng() < 0.6; // 60% chance
    return result;
}

function westExitExists(x, z, seed) {
    // Use a more unique seed to avoid patterns
    const rng = seededRandom(seed + '_exit_west_' + (x * 1000) + '_' + (z * 1000));
    const result = rng() < 0.6; // 60% chance
    return result;
}

// Ensure at least one exit exists
function getRoomExits(x, z, seed) {
    const east = eastExitExists(x, z, seed);
    const north = northExitExists(x, z, seed);
    const west = westExitExists(x, z, seed);
    
    // Debug logging for first few chunks
    if (Math.abs(x) <= 2 && Math.abs(z) <= 2) {
        console.log(`Room exits for chunk (${x}, ${z}): East=${east}, North=${north}, West=${west}`);
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

// Generate level structure for a chunk (rooms and corridors)
function generateLevelForChunk(chunkX, chunkZ, seed) {
    const chunkSize = 32; // Match noa chunk size
    const tiles = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill('wall'));
    
    // Check if this chunk should have a room
    const hasRoom = roomExists(chunkX, chunkZ, seed);
    
    // Debug logging for first few chunks
    if (Math.abs(chunkX) <= 2 && Math.abs(chunkZ) <= 2) {
        console.log(`Chunk (${chunkX}, ${chunkZ}): hasRoom=${hasRoom}`);
    }
    
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
            // East exit at latitude 13
            const exitZ = 13;
            for (let x = roomX + width; x < chunkSize; x++) {
                tiles[x][exitZ] = 'corridor_east';
            }
        }
        
        if (exits.north) {
            // North exit at center (longitude 15)
            const exitX = 15;
            for (let z = 0; z < roomZ; z++) {
                tiles[exitX][z] = 'corridor_north';
            }
        }
        
        if (exits.west) {
            // West exit at latitude 17
            const exitZ = 17;
            for (let x = 0; x < roomX; x++) {
                tiles[x][exitZ] = 'corridor_west';
            }
        }
        
        // Check for incoming corridors from the closest room in each direction
        // Check East (from the closest room to the west)
        for (let checkX = chunkX - 1; checkX >= chunkX - 20; checkX--) {
            if (roomExists(checkX, chunkZ, seed)) {
                const neighborExits = getRoomExits(checkX, chunkZ, seed);
                if (neighborExits.east) {
                    // Generate east-bound corridor entering our room
                    for (let x = 0; x < roomX; x++) {
                        tiles[x][13] = 'corridor_east';
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check South (from the closest room to the north)  
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 20; checkZ--) {
            if (roomExists(chunkX, checkZ, seed)) {
                const neighborExits = getRoomExits(chunkX, checkZ, seed);
                if (neighborExits.north) {
                    // Generate north-bound corridor entering our room
                    for (let z = roomZ + length; z < chunkSize; z++) {
                        tiles[15][z] = 'corridor_north';
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
                    // Generate west-bound corridor entering our room
                    for (let x = roomX + width; x < chunkSize; x++) {
                        tiles[x][17] = 'corridor_west';
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
                    // Generate east-bound corridor through entire chunk
                    for (let x = 0; x < chunkSize; x++) {
                        tiles[x][13] = 'corridor_east';
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check South (from the closest room to the north)
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 20; checkZ--) {
            if (roomExists(chunkX, checkZ, seed)) {
                const exits = getRoomExits(chunkX, checkZ, seed);
                if (exits.north) {
                    // Generate north-bound corridor through entire chunk
                    for (let z = 0; z < chunkSize; z++) {
                        tiles[15][z] = 'corridor_north';
                    }
                }
                break; // Stop at first room found
            }
        }
        
        // Check West (from the closest room to the east)
        for (let checkX = chunkX + 1; checkX <= chunkX + 20; checkX++) {
            if (roomExists(checkX, chunkZ, seed)) {
                const exits = getRoomExits(checkX, chunkZ, seed);
                if (exits.west) {
                    // Generate west-bound corridor through entire chunk
                    for (let x = 0; x < chunkSize; x++) {
                        tiles[x][17] = 'corridor_west';
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
        chunkAddDistance: 10,
        chunkRemoveDistance: 14,
    };
    
    // Create engine
    noa = new Engine(opts);
    
    // Register materials - using simple colors
    var brownish = [0.45, 0.36, 0.22];
    var grayish = [0.6, 0.6, 0.6];
    var roomFloorColor = [0.4, 0.5, 0.4]; // Greenish for rooms
    var corridorEastColor = [0.8, 0.3, 0.3]; // Reddish for east corridors
    var corridorNorthColor = [0.3, 0.3, 0.8]; // Bluish for north corridors
    var corridorWestColor = [0.8, 0.8, 0.3]; // Yellowish for west corridors
    
    noa.registry.registerMaterial('dirt', { color: brownish });
    noa.registry.registerMaterial('stone', { color: grayish });
    noa.registry.registerMaterial('roomFloor', { color: roomFloorColor });
    noa.registry.registerMaterial('corridorEast', { color: corridorEastColor });
    noa.registry.registerMaterial('corridorNorth', { color: corridorNorthColor });
    noa.registry.registerMaterial('corridorWest', { color: corridorWestColor });
    
    // Register blocks
    var dirtID = noa.registry.registerBlock(1, { material: 'dirt' });
    var stoneID = noa.registry.registerBlock(2, { material: 'stone' });
    var roomFloorID = noa.registry.registerBlock(3, { material: 'roomFloor' });
    var corridorEastID = noa.registry.registerBlock(4, { material: 'corridorEast' });
    var corridorNorthID = noa.registry.registerBlock(5, { material: 'corridorNorth' });
    var corridorWestID = noa.registry.registerBlock(6, { material: 'corridorWest' });
    
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
    
    // Set up world generation with rooms and corridors
    noa.world.on('worldDataNeeded', function (id, data, x, y, z) {
        const chunkSize = data.shape[0];
        
        // Calculate which chunk we're in
        const chunkX = Math.floor(x / chunkSize);
        const chunkZ = Math.floor(z / chunkSize);
        
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
                        // Check if this is floor or wall
                        if (level[i][k] === 'room') {
                            voxelID = roomFloorID; // Room floor
                        } else if (level[i][k] === 'corridor_east') {
                            voxelID = corridorEastID; // East corridor floor
                        } else if (level[i][k] === 'corridor_north') {
                            voxelID = corridorNorthID; // North corridor floor
                        } else if (level[i][k] === 'corridor_west') {
                            voxelID = corridorWestID; // West corridor floor
                        } else {
                            voxelID = dirtID; // Solid ground under walls
                        }
                    }
                    // Walls at y=1 and y=2
                    else if ((worldY === 1 || worldY === 2) && level[i][k] === 'wall') {
                        voxelID = dirtID; // Wall
                    }
                    
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
        console.log('Registered blocks:', { dirtID, stoneID, roomFloorID, corridorEastID, corridorNorthID, corridorWestID });
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