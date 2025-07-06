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
                if (x >= 0 && x < chunkSize && z >= 0 && z < chunkSize && level[x][z] === 'floor') {
                    return [x + 0.5, 1, z + 0.5]; // Center of the block, 1 unit above ground
                }
            }
        }
    }
    
    // Fallback to center if no open space found
    return [centerX + 0.5, 1, centerZ + 0.5];
}

// Generate level structure for a chunk (rooms and corridors)
function generateLevelForChunk(chunkX, chunkZ, seed) {
    const chunkSize = 32; // Match noa chunk size
    const tiles = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill('wall'));
    const rng = seededRandom(seed + '_chunk_' + chunkX + '_' + chunkZ);
    
    // Determine if this chunk contains a room or corridors
    const hasRoom = rng() < 0.3; // 30% chance of room
    
    if (hasRoom) {
        // Generate a room in this chunk
        generateRoom(tiles, rng, chunkSize);
    } else {
        // Generate corridors
        generateCorridors(tiles, rng, chunkSize, chunkX, chunkZ, seed);
    }
    
    // Ensure chunk edges connect properly
    ensureChunkConnections(tiles, chunkX, chunkZ, seed);
    
    return tiles;
}

// Generate a room in the chunk
function generateRoom(tiles, rng, chunkSize) {
    // Room must be at least 4x4, leave space for walls
    const minSize = 6;
    const maxSize = chunkSize - 6;
    
    const roomWidth = Math.floor(rng() * (maxSize - minSize) + minSize);
    const roomHeight = Math.floor(rng() * (maxSize - minSize) + minSize);
    
    const roomX = Math.floor((chunkSize - roomWidth) / 2);
    const roomZ = Math.floor((chunkSize - roomHeight) / 2);
    
    // Clear room interior
    for (let x = roomX; x < roomX + roomWidth; x++) {
        for (let z = roomZ; z < roomZ + roomHeight; z++) {
            tiles[x][z] = 'floor';
        }
    }
    
    // Add exits (1-4 exits per room)
    const numExits = Math.floor(rng() * 3) + 2;
    const sides = ['north', 'south', 'east', 'west'];
    
    for (let i = 0; i < numExits && sides.length > 0; i++) {
        const sideIndex = Math.floor(rng() * sides.length);
        const side = sides.splice(sideIndex, 1)[0];
        
        // Create 3-tile wide corridor exit
        if (side === 'north') {
            const exitX = roomX + Math.floor(roomWidth / 2);
            for (let dx = -1; dx <= 1; dx++) {
                for (let z = 0; z < roomZ; z++) {
                    if (exitX + dx >= 0 && exitX + dx < chunkSize) {
                        tiles[exitX + dx][z] = 'floor';
                    }
                }
            }
        } else if (side === 'south') {
            const exitX = roomX + Math.floor(roomWidth / 2);
            for (let dx = -1; dx <= 1; dx++) {
                for (let z = roomZ + roomHeight; z < chunkSize; z++) {
                    if (exitX + dx >= 0 && exitX + dx < chunkSize) {
                        tiles[exitX + dx][z] = 'floor';
                    }
                }
            }
        } else if (side === 'east') {
            const exitZ = roomZ + Math.floor(roomHeight / 2);
            for (let dz = -1; dz <= 1; dz++) {
                for (let x = roomX + roomWidth; x < chunkSize; x++) {
                    if (exitZ + dz >= 0 && exitZ + dz < chunkSize) {
                        tiles[x][exitZ + dz] = 'floor';
                    }
                }
            }
        } else if (side === 'west') {
            const exitZ = roomZ + Math.floor(roomHeight / 2);
            for (let dz = -1; dz <= 1; dz++) {
                for (let x = 0; x < roomX; x++) {
                    if (exitZ + dz >= 0 && exitZ + dz < chunkSize) {
                        tiles[x][exitZ + dz] = 'floor';
                    }
                }
            }
        }
    }
}

// Generate corridors in the chunk
function generateCorridors(tiles, rng, chunkSize, chunkX, chunkZ, seed) {
    // Determine corridor pattern based on chunk position
    const pattern = Math.abs(chunkX + chunkZ * 7) % 4;
    
    // Make corridors slightly offset from center but consistent
    const offsetRange = 4;
    const baseOffset = Math.floor(rng() * offsetRange * 2 - offsetRange);
    
    switch (pattern) {
        case 0: // North-South corridor
            const nsX = Math.floor(chunkSize / 2) + baseOffset;
            // Ensure corridor extends all the way to edges
            for (let z = 0; z < chunkSize; z++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = nsX + dx;
                    if (x >= 0 && x < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            break;
            
        case 1: // East-West corridor
            const ewZ = Math.floor(chunkSize / 2) + baseOffset;
            // Ensure corridor extends all the way to edges
            for (let x = 0; x < chunkSize; x++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const z = ewZ + dz;
                    if (z >= 0 && z < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            break;
            
        case 2: // L-shaped corridor
            const cornerX = Math.floor(chunkSize / 2) + Math.floor(baseOffset / 2);
            const cornerZ = Math.floor(chunkSize / 2) + Math.floor(baseOffset / 2);
            // Vertical part - extend to north edge
            for (let z = 0; z <= cornerZ + 1; z++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = cornerX + dx;
                    if (x >= 0 && x < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            // Horizontal part - extend to east edge
            for (let x = cornerX - 1; x < chunkSize; x++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const z = cornerZ + dz;
                    if (z >= 0 && z < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            break;
            
        case 3: // Cross intersection
            const crossX = Math.floor(chunkSize / 2) + Math.floor(baseOffset / 2);
            const crossZ = Math.floor(chunkSize / 2) + Math.floor(baseOffset / 2);
            // Vertical corridor - extend to both north and south edges
            for (let z = 0; z < chunkSize; z++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = crossX + dx;
                    if (x >= 0 && x < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            // Horizontal corridor - extend to both east and west edges
            for (let x = 0; x < chunkSize; x++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const z = crossZ + dz;
                    if (z >= 0 && z < chunkSize) {
                        tiles[x][z] = 'floor';
                    }
                }
            }
            break;
    }
}

// Ensure chunks connect properly at edges
function ensureChunkConnections(tiles, chunkX, chunkZ, seed) {
    const chunkSize = tiles.length;
    const rng = seededRandom(seed + '_connections');
    
    // Check each neighboring chunk and align connections
    const neighbors = [
        { dx: 0, dz: -1, edge: 'north' }, // North neighbor
        { dx: 0, dz: 1, edge: 'south' },  // South neighbor
        { dx: -1, dz: 0, edge: 'west' },  // West neighbor
        { dx: 1, dz: 0, edge: 'east' }    // East neighbor
    ];
    
    neighbors.forEach(neighbor => {
        const neighborX = chunkX + neighbor.dx;
        const neighborZ = chunkZ + neighbor.dz;
        
        // Generate neighbor chunk pattern to check its edge
        const neighborTiles = generateChunkPattern(neighborX, neighborZ, seed, chunkSize);
        
        // Find connection points based on edge
        let connectionsMade = 0;
        
        switch (neighbor.edge) {
            case 'north': // Check our north edge with neighbor's south edge
                for (let x = 0; x < chunkSize; x++) {
                    if (neighborTiles && neighborTiles[x] && neighborTiles[x][chunkSize - 1] === 'floor') {
                        // Neighbor has floor at south edge, create connection
                        for (let dz = 0; dz < 3; dz++) {
                            if (dz < chunkSize) {
                                tiles[x][dz] = 'floor';
                            }
                        }
                        connectionsMade++;
                    }
                }
                break;
                
            case 'south': // Check our south edge with neighbor's north edge
                for (let x = 0; x < chunkSize; x++) {
                    if (neighborTiles && neighborTiles[x] && neighborTiles[x][0] === 'floor') {
                        // Neighbor has floor at north edge, create connection
                        for (let dz = 0; dz < 3; dz++) {
                            if (chunkSize - 1 - dz >= 0) {
                                tiles[x][chunkSize - 1 - dz] = 'floor';
                            }
                        }
                        connectionsMade++;
                    }
                }
                break;
                
            case 'west': // Check our west edge with neighbor's east edge
                for (let z = 0; z < chunkSize; z++) {
                    if (neighborTiles && neighborTiles[chunkSize - 1] && neighborTiles[chunkSize - 1][z] === 'floor') {
                        // Neighbor has floor at east edge, create connection
                        for (let dx = 0; dx < 3; dx++) {
                            if (dx < chunkSize) {
                                tiles[dx][z] = 'floor';
                            }
                        }
                        connectionsMade++;
                    }
                }
                break;
                
            case 'east': // Check our east edge with neighbor's west edge
                for (let z = 0; z < chunkSize; z++) {
                    if (neighborTiles && neighborTiles[0] && neighborTiles[0][z] === 'floor') {
                        // Neighbor has floor at west edge, create connection
                        for (let dx = 0; dx < 3; dx++) {
                            if (chunkSize - 1 - dx >= 0) {
                                tiles[chunkSize - 1 - dx][z] = 'floor';
                            }
                        }
                        connectionsMade++;
                    }
                }
                break;
        }
        
        // If no connections were made, ensure at least one connection at the center
        if (connectionsMade === 0) {
            const center = Math.floor(chunkSize / 2);
            switch (neighbor.edge) {
                case 'north':
                    for (let x = center - 1; x <= center + 1; x++) {
                        for (let z = 0; z < 3; z++) {
                            if (x >= 0 && x < chunkSize && z < chunkSize) {
                                tiles[x][z] = 'floor';
                            }
                        }
                    }
                    break;
                case 'south':
                    for (let x = center - 1; x <= center + 1; x++) {
                        for (let z = chunkSize - 3; z < chunkSize; z++) {
                            if (x >= 0 && x < chunkSize && z >= 0) {
                                tiles[x][z] = 'floor';
                            }
                        }
                    }
                    break;
                case 'west':
                    for (let z = center - 1; z <= center + 1; z++) {
                        for (let x = 0; x < 3; x++) {
                            if (x < chunkSize && z >= 0 && z < chunkSize) {
                                tiles[x][z] = 'floor';
                            }
                        }
                    }
                    break;
                case 'east':
                    for (let z = center - 1; z <= center + 1; z++) {
                        for (let x = chunkSize - 3; x < chunkSize; x++) {
                            if (x >= 0 && z >= 0 && z < chunkSize) {
                                tiles[x][z] = 'floor';
                            }
                        }
                    }
                    break;
            }
        }
    });
}

// Generate only the pattern of a chunk without full generation (for connection checking)
function generateChunkPattern(chunkX, chunkZ, seed, chunkSize) {
    const tiles = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill('wall'));
    const rng = seededRandom(seed + '_chunk_' + chunkX + '_' + chunkZ);
    
    // Determine if this chunk contains a room or corridors
    const hasRoom = rng() < 0.3; // 30% chance of room
    
    if (hasRoom) {
        // Generate a room in this chunk
        generateRoom(tiles, rng, chunkSize);
    } else {
        // Generate corridors
        generateCorridors(tiles, rng, chunkSize, chunkX, chunkZ, seed);
    }
    
    // Don't call ensureChunkConnections here to avoid recursion
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
                        if (level[i][k] === 'floor') {
                            voxelID = stoneID; // Floor
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