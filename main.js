// Unicity Runner Demo - Main Game Logic
import { Engine } from 'noa-engine'
import * as BABYLON from '@babylonjs/core'

// Global world seed for deterministic generation
const WORLD_SEED = 'UnicityRunnerDemo_v1_Seed_2025';
const GAMEDEV_VERSION = 'dev00135'; // Version for chunk token ID generation - Fixed chunk token conflicts
const CHUNK_TOKEN_TYPE_BYTES = new Uint8Array([9]); // Token type for chunks

// Initialize globals
let noa;
let playerToken;
let signingService;

// Track chunks being tokenized to prevent concurrent processing
const chunksBeingTokenized = new Map(); // key: "x,z", value: Promise
const generatedCoins = new Set(); // Track all coin positions ever generated: "worldX,worldZ"
const generatedTraps = new Set(); // Track all trap positions ever generated: "worldX,worldZ"
let traps = new Map(); // Track all traps in the world: key = "x,z", value = entity

// GLaDOS-style death messages - teasing but not insulting
const deathMessages = [
    "I'm making a note here: 'Needs improvement.'",
    "The good news is, you're very consistent at this.",
    "That was almost the right button. Almost.",
    "Physics seems to be working perfectly. For the environment.",
    "I've seen test subjects do better. They were robots, but still.",
    "Your enthusiasm is noted. Your execution, less so.",
    "The floor appreciates your frequent visits.",
    "Interesting strategy. Have you considered trying the opposite?",
    "I'm detecting a pattern in your performance. It's... consistent.",
    "Don't worry, that only looked painful.",
    "Your determination is admirable. Misguided, but admirable.",
    "I've updated your file: 'Shows promise. Eventually.'",
    "That was textbook. If the textbook was about what not to do.",
    "The good news is you can't get worse. Statistically speaking.",
    "I'm sure that looked easier in your head.",
    "Your reflexes are impressive. Impressively delayed.",
    "Achievement unlocked: 'Gravity's Best Friend'",
    "I've seen this before. Usually in training videos titled 'Common Mistakes'",
    "Your technique is unique. Uniquely unsuccessful.",
    "The obstacle course is winning. By a lot.",
    "That jump was calculated. But boy, are you bad at math.",
    "I'm beginning to think the floor is your favorite part.",
    "Your persistence is noted. So is your failure rate.",
    "The laws of physics apply to everyone. Even you.",
    "That was close! To being close.",
    "I've added this to your permanent record. In red.",
    "Your spatial awareness is... still loading, apparently.",
    "The tutorial makes it look so easy, doesn't it?",
    "I'm detecting high levels of optimism. And low levels of success.",
    "Your learning curve appears to be a circle.",
    "That's the spirit! The wrong spirit, but spirit nonetheless.",
    "I've seen better. I've also seen worse. But mostly better.",
    "Your timing was perfect. For a completely different game.",
    "The floor sends its regards. Again.",
    "I'm updating the difficulty. To 'easier than easy.'",
    "That was almost right. In a parallel universe.",
    "Your approach is creative. Creatively wrong.",
    "I'm sure you meant to do that. Sure.",
    "The obstacle apologizes for being in your way.",
    "Your style is... let's call it 'experimental.'",
    "That's one way to do it. The wrong way, but still.",
    "I've seen this level beaten by a cat walking on the keyboard.",
    "Your motor skills are developing. Slowly.",
    "The respawn button is getting quite the workout.",
    "I'm documenting this for science. Comedy science.",
    "Your hand-eye coordination exists. Technically.",
    "That was brave. Brave and completely ineffective.",
    "The laws of momentum don't make exceptions. Sorry.",
    "Your strategy needs work. And a strategy.",
    "I'm lowering my expectations. Again.",
    "That looked intentional. It wasn't, but it looked it.",
    "Your progress is steady. Steadily horizontal.",
    "The training wheels are in the mail.",
    "I've seen drunk robots perform better.",
    "Your technique defies explanation. And success.",
    "That's the most creative failure I've seen today.",
    "The pause button exists, you know.",
    "Your dedication to floor inspection is commendable.",
    "I'm revising the term 'user-friendly' because of you.",
    "That was special. Not in the good way.",
    "Your learning algorithm might need debugging.",
    "The good news: you're memorable. The bad news: see above.",
    "I'm adding a participation trophy to your file.",
    "Your inputs are fascinating. Fascinatingly wrong."
];

// Block IDs (will be set during engine setup)
let roomFloorID;
let corridorEastID;
let corridorNorthID;
let corridorWestID;
let slowingFloorID;
let stripeBlockID;
let pillarBlockID;

// Mesh references (will be set during engine setup)
let backpackMesh = null;

// Game entities
let droneEntity = null;
let projectiles = [];
let currentPlayerHealth = 100; // Track current health during gameplay
let coins = new Map(); // Track all coins in the world: key = "x,z", value = entity
let coinsByChunk = new Map(); // Track coins organized by chunk: key = "chunkX,chunkZ", value = Map of coins
let chunkNeighbors = new Map(); // Pre-computed neighbor chunks: key = "chunkX,chunkZ", value = Set of neighbor chunk keys
let playerCoins = 0; // Player's coin balance (temporary counter)
let isPlayerDead = false; // Track if player is dead
let deathReason = ''; // Track how the player died
let isCreatingNewToken = false; // Track if we're creating a new token
let backpacks = new Map(); // Track all backpacks in the world: key = "x,z", value = entity
let backpackData = new Map(); // Persistent backpack data: key = "x,z", value = {position, lostCoins, etc}
let totalDistanceTraveled = 0; // Track total distance traveled north
let playerStartZ = null; // Track initial Z position
let isPaused = false; // Track game pause state
let banners = new Map(); // Track all banners in the world: key = "startZ", value = entity

// Player statistics tracking
let playerStats = {
    playerName: localStorage.getItem('unicityRunner_playerName') || 'Anonymous Runner',
    runHistory: JSON.parse(localStorage.getItem('unicityRunner_runHistory') || '[]'),
    currentRunStartTime: null,
    currentRunDistance: 0,
    tokenHistory: JSON.parse(localStorage.getItem('unicityRunner_tokenHistory') || '[]')
};

// Coin inventory tracking
let confirmedURCBalance = 0; // Confirmed balance from minted tokens
let pendingURCBalance = 0; // Pending balance from unminted coins
const URC_COIN_ID_BYTES = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]); // URC coin type
const URC_TOKEN_TYPE_BYTES = new Uint8Array([10]); // Token type for URC tokens

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

// Update coin display
function updateCoinDisplay() {
    // Ensure balances are never negative
    if (pendingURCBalance < 0) {
        console.warn(`Correcting negative pending balance: ${pendingURCBalance}`);
        pendingURCBalance = 0;
    }
    if (confirmedURCBalance < 0) {
        console.warn(`Correcting negative confirmed balance: ${confirmedURCBalance}`);
        confirmedURCBalance = 0;
    }
    
    const coinDisplay = document.getElementById('coinDisplay');
    if (coinDisplay) {
        coinDisplay.innerHTML = `
            <div style="color: #33ff88;">Confirmed: ${confirmedURCBalance} URC</div>
            <div style="color: #ffcc00;">Pending: ${pendingURCBalance} URC</div>
        `;
    }
}

// Update token status display
function updateTokenStatusDisplay() {
    const statusContent = document.getElementById('tokenStatusContent');
    const chunkStatusContent = document.getElementById('chunkStatusContent');
    const chunkStatusSection = document.getElementById('chunkStatusSection');
    
    if (!statusContent) return;
    
    // Update main token status
    let tokenHtml = '';
    
    if (!tokenStatus.initialized) {
        tokenHtml = '<div class="status-line">Initializing...</div>';
    } else {
        tokenHtml += `<div class="status-line">Submissions: <span class="success">${tokenStatus.successfulSubmissions}</span> / ${tokenStatus.totalSubmissions}</div>`;
        
        if (tokenStatus.pendingTransaction) {
            tokenHtml += '<div class="status-line pending">⏳ Pending transaction...</div>';
        } else if (tokenStatus.lastUpdateTime) {
            const secondsAgo = Math.floor((Date.now() - tokenStatus.lastUpdateTime) / 1000);
            tokenHtml += `<div class="status-line">Last update: ${secondsAgo}s ago</div>`;
        }
        
        if (tokenStatus.lastError) {
            tokenHtml += `<div class="status-line error">⚠️ ${tokenStatus.lastError}</div>`;
        }
    }
    
    statusContent.innerHTML = tokenHtml;
    
    // Update chunk tokenization status
    if (chunkStatusContent && chunkStatusSection) {
        const hasChunkActivity = chunkTokenizationQueue.length > 0 || queueStatus.activeTasks > 0 || queueStatus.totalProcessed > 0;
        
        if (hasChunkActivity) {
            chunkStatusSection.style.display = 'block';
            
            let chunkHtml = '';
            
            if (queueStatus.activeTasks > 0) {
                chunkHtml += `<div class="status-line pending">Active: ${queueStatus.activeTasks}/${MAX_CONCURRENT_TASKS}</div>`;
                
                // Show first few active chunks
                if (queueStatus.currentlyProcessing.length > 0) {
                    const displayCount = Math.min(3, queueStatus.currentlyProcessing.length);
                    const chunks = queueStatus.currentlyProcessing.slice(0, displayCount).join(', ');
                    const moreCount = queueStatus.currentlyProcessing.length - displayCount;
                    const moreText = moreCount > 0 ? ` +${moreCount} more` : '';
                    chunkHtml += `<div class="status-line" style="font-size: 10px;">Processing: ${chunks}${moreText}</div>`;
                }
            }
            
            if (chunkTokenizationQueue.length > 0) {
                chunkHtml += `<div class="status-line">Queue: ${chunkTokenizationQueue.length} chunks</div>`;
            }
            
            if (queueStatus.totalProcessed > 0) {
                chunkHtml += `<div class="status-line success">Completed: ${queueStatus.totalProcessed}</div>`;
            }
            
            if (queueStatus.totalFailed > 0) {
                chunkHtml += `<div class="status-line error">Failed: ${queueStatus.totalFailed}</div>`;
            }
            
            if (queueStatus.lastError) {
                chunkHtml += `<div class="status-line error" style="font-size: 10px;">⚠️ ${queueStatus.lastError}</div>`;
            }
            
            if (chunkHtml === '') {
                chunkHtml = '<div class="status-line">No active tasks</div>';
            }
            
            chunkStatusContent.innerHTML = chunkHtml;
        } else {
            chunkStatusSection.style.display = 'none';
        }
    }
}

// Track all pending mint transactions
const pendingMintTransactions = new Map(); // key: "x,z", value: mint data

// Chunk tokenization queue
const chunkTokenizationQueue = [];
let queueProcessingPaused = false;
const MAX_CONCURRENT_TASKS = 128;
const activeTasks = new Map(); // Track active concurrent tasks

// Queue status for monitoring
const queueStatus = {
    totalQueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
    activeTasks: 0,
    currentlyProcessing: [],
    lastProcessedTime: null,
    lastError: null
};

// Process chunk tokenization queue with concurrent tasks
async function processChunkTokenizationQueue() {
    if (queueProcessingPaused) {
        return;
    }
    
    // Process tasks while queue has items and we haven't reached max concurrent limit
    while (chunkTokenizationQueue.length > 0 && activeTasks.size < MAX_CONCURRENT_TASKS && !queueProcessingPaused) {
        const task = chunkTokenizationQueue.shift();
        const { chunkX, chunkZ } = task;
        const taskKey = `${chunkX},${chunkZ}`;
        
        // Skip if already being processed
        if (activeTasks.has(taskKey)) {
            continue;
        }
        
        // Create async task
        const taskPromise = processChunkTask(task);
        activeTasks.set(taskKey, taskPromise);
        
        // Update status
        queueStatus.activeTasks = activeTasks.size;
        queueStatus.currentlyProcessing = Array.from(activeTasks.keys());
        
        // Clean up when task completes
        taskPromise.finally(() => {
            activeTasks.delete(taskKey);
            queueStatus.activeTasks = activeTasks.size;
            queueStatus.currentlyProcessing = Array.from(activeTasks.keys());
            
            // Try to process more tasks
            if (!queueProcessingPaused) {
                processChunkTokenizationQueue();
            }
        });
    }
}

// Process individual chunk task
async function processChunkTask(task) {
    const { chunkX, chunkZ } = task;
    
    
    try {
        // Process the chunk tokenization
        await tokenizeChunk(chunkX, chunkZ);
        
        queueStatus.totalProcessed++;
        queueStatus.lastProcessedTime = Date.now();
    } catch (error) {
        queueStatus.totalFailed++;
        queueStatus.lastError = `Chunk (${chunkX}, ${chunkZ}): ${error.message}`;
        console.error(`Failed to tokenize chunk (${chunkX}, ${chunkZ}):`, error);
        
        // Re-queue failed chunks with retry limit
        if (task.retryCount === undefined) task.retryCount = 0;
        if (task.retryCount < 3) {
            task.retryCount++;
            
            // Add back to queue with a delay
            setTimeout(() => {
                if (!queueProcessingPaused) {
                    chunkTokenizationQueue.push(task);
                    processChunkTokenizationQueue();
                }
            }, 1000 * task.retryCount); // Exponential backoff
        }
    }
}

// Add chunk to tokenization queue
function queueChunkTokenization(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    
    // Check if already in queue
    const alreadyQueued = chunkTokenizationQueue.some(task => 
        task.chunkX === chunkX && task.chunkZ === chunkZ
    );
    
    if (alreadyQueued) {
        return;
    }
    
    // Check if already being processed
    if (chunksBeingTokenized.has(chunkKey)) {
        return;
    }
    
    // Add to queue
    chunkTokenizationQueue.push({
        chunkX,
        chunkZ,
        addedAt: Date.now()
    });
    
    queueStatus.totalQueued++;
    
    // Start processing if not already running
    processChunkTokenizationQueue();
}

// Save pending transactions before page unload
window.addEventListener('beforeunload', () => {
    // Pause queue processing
    queueProcessingPaused = true;
    
    // Log active tasks
    if (activeTasks.size > 0) {
    }
    
    if (pendingMintTransactions.size > 0) {
        
        // Force save all pending mint transactions
        pendingMintTransactions.forEach((mintData, chunkKey) => {
            const [x, z] = chunkKey.split(',').map(Number);
            const mintTxKey = getChunkStorageKey(x, z, 'mintTx');
            try {
                localStorage.setItem(mintTxKey, JSON.stringify(mintData));
            } catch (e) {
                console.error(`Failed to save mint transaction for chunk (${x}, ${z}):`, e);
            }
        });
    }
    
    // Save queue state including active tasks
    const tasksToSave = [...chunkTokenizationQueue];
    
    // Add active tasks back to queue for next session
    activeTasks.forEach((promise, taskKey) => {
        const [x, z] = taskKey.split(',').map(Number);
        tasksToSave.push({
            chunkX: x,
            chunkZ: z,
            addedAt: Date.now(),
            wasActive: true
        });
    });
    
    if (tasksToSave.length > 0) {
        localStorage.setItem('chunkTokenizationQueue', JSON.stringify(tasksToSave));
    }
});

// Initialize the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
});

// Stats screen functions
function showStatsScreen() {
    const statsScreen = document.getElementById('statsScreen');
    statsScreen.classList.add('show');
    
    // Update player name input
    document.getElementById('playerNameInput').value = playerStats.playerName;
    
    // Update statistics
    updateStatsDisplay();
    
    // Pause the game
    isPaused = true;
}

function hideStatsScreen() {
    const statsScreen = document.getElementById('statsScreen');
    statsScreen.classList.remove('show');
    
    // Save player name if changed
    const newName = document.getElementById('playerNameInput').value.trim();
    if (newName && newName !== playerStats.playerName) {
        playerStats.playerName = newName;
        localStorage.setItem('unicityRunner_playerName', newName);
    }
}

function updateStatsDisplay() {
    const runHistory = document.getElementById('runHistory');
    const totalRuns = document.getElementById('totalRuns');
    const totalDistance = document.getElementById('totalDistance');
    const bestDistance = document.getElementById('bestDistance');
    const totalCoins = document.getElementById('totalCoins');
    
    // Update run history
    if (playerStats.runHistory.length === 0) {
        runHistory.innerHTML = '<div class="noRunsMessage">No runs completed yet. Start playing!</div>';
    } else {
        runHistory.innerHTML = playerStats.runHistory
            .slice(-10) // Show last 10 runs
            .reverse() // Most recent first
            .map((run, index) => {
                // Try to get corresponding token data if available
                const runIndex = playerStats.runHistory.length - index - 1;
                const correspondingToken = playerStats.tokenHistory[runIndex];
                const tokenState = correspondingToken ? extractTokenState(correspondingToken) : null;
                
                return `
                    <div class="runEntry">
                        <div class="runNumber">Run #${playerStats.runHistory.length - index}</div>
                        <div class="runStat">
                            <span class="label">Distance:</span>
                            <span class="value">${run.distance} blocks</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Coins:</span>
                            <span class="value">${run.coins} URC</span>
                        </div>
                        ${tokenState ? `
                        <div class="runStat">
                            <span class="label">Final Health:</span>
                            <span class="value">${tokenState.health || 0}/100</span>
                        </div>
                        ` : ''}
                        <div class="runStat">
                            <span class="label">Death:</span>
                            <span class="value">${run.deathReason}</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Duration:</span>
                            <span class="value">${formatDuration(run.duration)}</span>
                        </div>
                    </div>
                `;
            }).join('');
    }
    
    // Calculate totals
    const totals = playerStats.runHistory.reduce((acc, run) => {
        acc.runs++;
        acc.distance += run.distance;
        acc.coins += run.coins;
        acc.bestDistance = Math.max(acc.bestDistance, run.distance);
        return acc;
    }, { runs: 0, distance: 0, coins: 0, bestDistance: 0 });
    
    totalRuns.textContent = totals.runs;
    totalDistance.textContent = `${totals.distance} blocks`;
    bestDistance.textContent = `${totals.bestDistance} blocks`;
    totalCoins.textContent = `${totals.coins} URC`;
    
    // Update token count
    const totalTokens = document.getElementById('totalTokens');
    totalTokens.textContent = playerStats.tokenHistory.length + 1; // +1 for current token
    
    // Update token history
    const tokenHistoryDiv = document.getElementById('tokenHistory');
    if (playerStats.tokenHistory.length === 0) {
        tokenHistoryDiv.innerHTML = '<div class="noRunsMessage">No previous tokens yet.</div>';
    } else {
        tokenHistoryDiv.innerHTML = playerStats.tokenHistory
            .slice(-5) // Show last 5 tokens
            .reverse() // Most recent first
            .map((token, index) => {
                const tokenId = token.tokenData?.tokenId?.value || 'Unknown';
                const shortId = typeof tokenId === 'string' ? 
                    tokenId.substring(0, 8) + '...' : 
                    'Token ' + (playerStats.tokenHistory.length - index);
                    
                // Extract state data from token if available
                const tokenState = extractTokenState(token);
                
                // Calculate distance from token position if available
                let tokenDistance = token.finalStats.distance;
                if (tokenState && tokenState.position && playerStartZ !== null) {
                    tokenDistance = Math.abs(tokenState.position[2] - playerStartZ);
                }
                
                return `
                    <div class="runEntry">
                        <div class="runNumber">${shortId}</div>
                        <div class="runStat">
                            <span class="label">Distance:</span>
                            <span class="value">${Math.floor(tokenDistance)} blocks</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Coins:</span>
                            <span class="value">${token.finalStats.coins} URC</span>
                        </div>
                        ${tokenState ? `
                        <div class="runStat">
                            <span class="label">Final Health:</span>
                            <span class="value">${tokenState.health || 0}/100</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Final Position:</span>
                            <span class="value">Z: ${Math.floor(tokenState.position?.[2] || 0)}</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Score:</span>
                            <span class="value">${tokenState.score || 0}</span>
                        </div>
                        ` : ''}
                        <div class="runStat">
                            <span class="label">Death:</span>
                            <span class="value">${token.finalStats.deathReason}</span>
                        </div>
                        <div class="runStat">
                            <span class="label">Last Update:</span>
                            <span class="value">${tokenState?.lastUpdate ? 
                                new Date(tokenState.lastUpdate).toLocaleTimeString() : 
                                'Unknown'}</span>
                        </div>
                    </div>
                `;
            }).join('');
    }
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper function to extract state from archived token
function extractTokenState(token) {
    try {
        if (token?.tokenData?.state?.data) {
            // Check if SDK is loaded
            if (!window.UnicitySDK || !window.UnicitySDK.Base64Converter) {
                console.warn('SDK not loaded yet, cannot extract token state');
                return null;
            }
            
            const stateDataEncoded = token.tokenData.state.data;
            const stateDataBytes = window.UnicitySDK.Base64Converter.decode(stateDataEncoded);
            const stateDataString = new TextDecoder().decode(stateDataBytes);
            return JSON.parse(stateDataString);
        }
    } catch (e) {
        console.error('Error extracting token state:', e);
    }
    return null;
}

function recordRunStats(distance, coins, deathReason, duration) {
    const runData = {
        distance: Math.floor(distance),
        coins: coins,
        deathReason: deathReason,
        duration: duration,
        timestamp: Date.now()
    };
    
    playerStats.runHistory.push(runData);
    
    // Keep only last 50 runs
    if (playerStats.runHistory.length > 50) {
        playerStats.runHistory = playerStats.runHistory.slice(-50);
    }
    
    // Save to localStorage
    localStorage.setItem('unicityRunner_runHistory', JSON.stringify(playerStats.runHistory));
}

// Export token history to JSON file
window.exportTokenHistory = function() {
    const exportData = {
        playerName: playerStats.playerName,
        exportDate: new Date().toISOString(),
        gameVersion: GAMEDEV_VERSION,
        runHistory: playerStats.runHistory,
        tokenHistory: playerStats.tokenHistory,
        currentToken: playerToken ? 'Active' : 'None'
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unicityrunner_tokens_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function initializeGame() {
    
    // Wait for SDK to load before showing stats screen
    const checkSDKInterval = setInterval(() => {
        if (window.UnicitySDK && window.UnicitySDK.Base64Converter) {
            clearInterval(checkSDKInterval);
            showStatsScreen();
        }
    }, 1000);
    
    // Handle stats screen key events
    document.addEventListener('keydown', (e) => {
        const statsScreen = document.getElementById('statsScreen');
        if (statsScreen.classList.contains('show')) {
            if (e.code === 'KeyP') {
                e.preventDefault();
                hideStatsScreen();
                isPaused = false;
            } else if (e.code === 'Space') {
                e.preventDefault();
                hideStatsScreen();
                isPaused = false;
                // Start new game
                if (!noa) {
                    setupNoaEngine();
                }
            }
        }
    });
    
    // Check for gamedev version change and clear chunk tokens if needed
    checkGamedevVersionAndClearChunks();
    
    // Save reference to saved queue but don't process yet
    const savedQueue = localStorage.getItem('chunkTokenizationQueue');
    
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
    
    // Initialize URC inventory
    await initializeURCInventory();
    
    // Now that player token (and private key) is initialized, restore chunk tokenization queue
    if (savedQueue) {
        try {
            const restoredTasks = JSON.parse(savedQueue);
            chunkTokenizationQueue.push(...restoredTasks);
            queueStatus.totalQueued = restoredTasks.length;
            localStorage.removeItem('chunkTokenizationQueue');
            
            // Start processing restored queue after a delay
            setTimeout(() => {
                processChunkTokenizationQueue();
            }, 2000);
        } catch (e) {
            console.error('Failed to restore chunk tokenization queue:', e);
            localStorage.removeItem('chunkTokenizationQueue');
        }
    }
    
    // Set up noa engine
    setupNoaEngine();
    
    // Don't start periodic updates if game is paused (on stats screen)
    if (!isPaused) {
        startPeriodicUpdates();
    }
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
    // SIMPLIFIED: Always spawn in the center of the blue corridor
    const chunkSize = 32;
    const spawnChunkX = 0; // Spawn at origin chunk
    const spawnChunkZ = 0;
    
    // Blue corridor is at x=14-16, spawn in the middle (x=15)
    const worldX = (spawnChunkX * chunkSize) + 15 + 0.5;
    const worldZ = (spawnChunkZ * chunkSize) + 16; // Middle of chunk
    const spawnPos = [worldX, 6, worldZ]; // Spawn at y=6 (above the raised corridor at y=3)
    
    console.log(`Calculated spawn position: ${spawnPos}, expected corridor at x=14-16`);
    return spawnPos;
}

// RNG functions for room and exit determination
function roomExists(x, z, seed) {
    const rng = seededRandom(seed + '_room_' + x + '_' + z);
    const result = rng() < 0.2; // 20% chance of room (doubled from 10%)
    return result;
}

function getRoomDimensions(x, z, seed) {
    // Fixed room size for all rooms
    const width = 7; // Fixed 7 blocks wide
    const length = 7; // Fixed 7 blocks long
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
async function tokenizeChunk(chunkX, chunkZ) {
    const chunkKey = `${chunkX},${chunkZ}`;
    
    // Check if this chunk is already being tokenized (in-memory)
    if (chunksBeingTokenized.has(chunkKey)) {
        return await chunksBeingTokenized.get(chunkKey);
    }
    
    // SYNCHRONOUS CHECK AND SET - critical section
    // Check for pending state BEFORE creating the promise
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    const existingPending = localStorage.getItem(pendingKey);
    
    if (existingPending) {
        const pending = JSON.parse(existingPending);
        
        // Check if we have a mint transaction for this chunk
        const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
        const savedMintTx = localStorage.getItem(mintTxKey);
        
        if (savedMintTx) {
            const mintData = JSON.parse(savedMintTx);
            // Check gamedev version
            if (mintData.chunkState && mintData.chunkState.gamedevVersion !== GAMEDEV_VERSION) {
                localStorage.removeItem(pendingKey);
                localStorage.removeItem(mintTxKey);
                // Continue with normal flow
            } else if (mintData.submitted) {
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
    
    // Get pending key once at the beginning
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    
    // Declare client at function scope so it's available in error handler
    let client;
    
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
                // Remove the old mint transaction
                localStorage.removeItem(mintTxKey);
                // Proceed to create new token
            } else {
                shouldCreateNew = false;
                // Recover from saved mint transaction
                
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
                const privateKeyHex = localStorage.getItem('unicityRunner_privateKey');
                if (!privateKeyHex) {
                    throw new Error('Private key not found in localStorage');
                }
                const privateKey = window.UnicitySDK.HexConverter.decode(privateKeyHex);
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
            const privateKeyHex = localStorage.getItem('unicityRunner_privateKey');
            if (!privateKeyHex) {
                throw new Error('Private key not found in localStorage');
            }
            const privateKey = window.UnicitySDK.HexConverter.decode(privateKeyHex);
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
            
            // IMPORTANT: Recreate mintData from saved data to ensure consistency
            // This ensures we use EXACTLY the same data that we'll use for recovery
            const savedDataForSubmission = JSON.parse(localStorage.getItem(mintTxKey));
            mintData = await window.UnicitySDK.MintTransactionData.create(
                window.UnicitySDK.TokenId.create(window.UnicitySDK.HexConverter.decode(savedDataForSubmission.tokenId)),
                window.UnicitySDK.TokenType.create(window.UnicitySDK.HexConverter.decode(savedDataForSubmission.tokenType)),
                window.UnicitySDK.HexConverter.decode(savedDataForSubmission.tokenData),
                null, // No coin data
                savedDataForSubmission.recipient,
                window.UnicitySDK.HexConverter.decode(savedDataForSubmission.salt),
                null, // No data hash for chunk tokens
                null // reason
            );
        }
        
        // Submit to Unicity network
        const aggregatorClient = new window.UnicitySDK.AggregatorClient(
            'https://goggregator-test.unicity.network'
        );
        client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        let commitment;
        
        // Load the saved data for submission
        const savedData = JSON.parse(localStorage.getItem(mintTxKey));
        
        // Only do critical checks if we're recovering from saved data (not fresh creation)
        if (!shouldCreateNew) {
            // CRITICAL SAFETY CHECK: Verify mint data exists when recovering
            if (!savedData) {
                const errorMsg = `CRITICAL ERROR: Attempting to recover chunk (${chunkX}, ${chunkZ}) but no saved recovery data found! This should NEVER happen!`;
                console.error(errorMsg);
                throw new Error(errorMsg);
            }
            
            // Verify all required fields are present in recovered data
            const requiredFields = ['tokenId', 'tokenType', 'recipient', 'salt', 'nonce', 'chunkState'];
            const missingFields = requiredFields.filter(field => !savedData[field]);
            
            // Special handling for old format data missing tokenData
            if (!savedData.tokenData && savedData.submitted && savedData.requestId) {
                // Old format data that was already submitted - provide default tokenData
                console.warn(`Chunk (${chunkX}, ${chunkZ}) has old format mint data without tokenData, but was already submitted. Using default empty tokenData for recovery.`);
                savedData.tokenData = window.UnicitySDK.HexConverter.encode(new Uint8Array(0));
            } else if (!savedData.tokenData) {
                // Old format data that was never submitted - add to missing fields
                missingFields.push('tokenData');
            }
            
            if (missingFields.length > 0) {
                const errorMsg = `CRITICAL ERROR: Recovered mint data for chunk (${chunkX}, ${chunkZ}) is missing required fields: ${missingFields.join(', ')}`;
                console.error(errorMsg);
                throw new Error(errorMsg);
            }
        }
        
        // Ensure we have saved data at this point
        if (!savedData) {
            const errorMsg = `CRITICAL ERROR: No saved mint data for chunk (${chunkX}, ${chunkZ}) after save operation! This should NEVER happen!`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Check if we already have a request ID (meaning it was already submitted)
        if (savedData.submitted && savedData.requestId) {
            console.warn(`Chunk (${chunkX}, ${chunkZ}) mint transaction was already submitted with request ID: ${savedData.requestId}`);
            
            // First check if the token was already minted and saved
            const existingToken = loadChunkTokenData(chunkX, chunkZ);
            if (existingToken.token && existingToken.state && existingToken.state.gamedevVersion === GAMEDEV_VERSION) {
                // Token was successfully minted, clean up pending state
                localStorage.removeItem(pendingKey);
                localStorage.removeItem(mintTxKey);
                const chunkKey = `${chunkX},${chunkZ}`;
                pendingMintTransactions.delete(chunkKey);
                
                // Recreate and return the token
                const predicateFactory = new window.UnicitySDK.PredicateJsonFactory();
                const tokenJsonSerializer = new window.UnicitySDK.TokenJsonSerializer(predicateFactory);
                const tokenFactory = new window.UnicitySDK.TokenFactory(tokenJsonSerializer);
                return await tokenFactory.create(existingToken.token);
            }
            
            // Transaction was submitted but token not saved - try to recover it
            
            try {
                // For recovery, we need to reconstruct the mint data first
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
                
                // Reconstruct a minimal commitment - we need the mint data and request ID
                const requestId = window.UnicitySDK.RequestId.fromJSON(savedData.requestId);
                
                // For the SDK's createTransaction, we need a commitment with transactionData property
                const commitment = {
                    transactionData: mintData,
                    requestId: requestId
                };
                
                // Wait for inclusion proof
                const inclusionProof = await window.UnicitySDK.waitInclusionProof(
                    client,
                    commitment,
                    AbortSignal.timeout(30000), // 30 second timeout
                    1000 // Check every second
                );
                
                
                // For mint transactions that were already submitted, we might not get a proper inclusion proof
                // In this case, we need to construct the transaction manually
                let mintTransaction;
                try {
                    mintTransaction = await retryOnInclusionProofError(async () => {
                        return await client.createTransaction(commitment, inclusionProof);
                    });
                } catch (error) {
                    console.error(`Failed to create transaction from inclusion proof:`, error);
                    
                    // If we can't create transaction from inclusion proof, we can't recover the token
                    throw new Error('Cannot recover mint transaction - inclusion proof invalid');
                }
                
                // Reconstruct the predicate
                const chunkNonce = window.UnicitySDK.HexConverter.decode(savedData.nonce);
                const chunkSigningService = await window.UnicitySDK.SigningService.createFromSecret(
                    crypto.getRandomValues(new Uint8Array(32)), // Random key for chunk
                    chunkNonce
                );
                
                const predicate = await window.UnicitySDK.MaskedPredicate.create(
                    tokenId,
                    tokenType,
                    chunkSigningService,
                    window.UnicitySDK.HashAlgorithm.SHA256,
                    chunkNonce
                );
                
                // Create token state with chunk data
                const tokenState = await window.UnicitySDK.TokenState.create(
                    predicate,
                    new TextEncoder().encode(JSON.stringify(savedData.chunkState))
                );
                
                // Create the token
                const chunkToken = new window.UnicitySDK.Token(
                    tokenState,
                    mintTransaction,
                    []
                );
                
                // Save the recovered token
                const tokenToSave = {
                    token: chunkToken.toJSON(),
                    state: savedData.chunkState,
                    tokenId: savedData.tokenId,
                    tokenType: savedData.tokenType,
                    timestamp: Date.now()
                };
                
                saveChunkTokenData(chunkX, chunkZ, tokenToSave);
                
                // Clean up pending state
                localStorage.removeItem(pendingKey);
                localStorage.removeItem(mintTxKey);
                const chunkKey = `${chunkX},${chunkZ}`;
                pendingMintTransactions.delete(chunkKey);
                
                return chunkToken;
                
            } catch (recoveryError) {
                console.error(`Failed to recover mint transaction for chunk (${chunkX}, ${chunkZ}):`, recoveryError);
                
                // If recovery fails, clear the pending state
                localStorage.removeItem(pendingKey);
                localStorage.removeItem(mintTxKey);
                const chunkKey = `${chunkX},${chunkZ}`;
                pendingMintTransactions.delete(chunkKey);
                return null;
            }
        } else {
            // First time submission
            
            // FINAL SAFETY CHECK: Ensure mint data is still saved right before submission
            const preSubmitCheck = localStorage.getItem(mintTxKey);
            if (!preSubmitCheck) {
                const errorMsg = `CRITICAL ERROR: Mint data for chunk (${chunkX}, ${chunkZ}) disappeared before submission! This should NEVER happen!`;
                console.error(errorMsg);
                throw new Error(errorMsg);
            }
            
            // TEST RECOVERY: Verify we can recover the token before submitting
            try {
                // Simulate recovery by recreating all necessary objects from saved data
                const testTokenId = window.UnicitySDK.TokenId.create(
                    window.UnicitySDK.HexConverter.decode(savedData.tokenId)
                );
                const testTokenType = window.UnicitySDK.TokenType.create(
                    window.UnicitySDK.HexConverter.decode(savedData.tokenType)
                );
                
                // Recreate mint data to ensure all fields are valid
                const testMintData = await window.UnicitySDK.MintTransactionData.create(
                    testTokenId,
                    testTokenType,
                    window.UnicitySDK.HexConverter.decode(savedData.tokenData),
                    null, // No coin data
                    savedData.recipient,
                    window.UnicitySDK.HexConverter.decode(savedData.salt),
                    null, // No data hash for chunk tokens
                    null // reason
                );
                
                // Recreate signing service to ensure nonce works
                const privateKeyHex = localStorage.getItem('unicityRunner_privateKey');
                if (!privateKeyHex) {
                    throw new Error('Private key not found for recovery test');
                }
                const testSigningService = await window.UnicitySDK.SigningService.createFromSecret(
                    window.UnicitySDK.HexConverter.decode(privateKeyHex),
                    window.UnicitySDK.HexConverter.decode(savedData.nonce)
                );
                
                // Recreate predicate to ensure it's valid
                const testPredicate = await window.UnicitySDK.MaskedPredicate.create(
                    testTokenId,
                    testTokenType,
                    testSigningService,
                    window.UnicitySDK.HashAlgorithm.SHA256,
                    window.UnicitySDK.HexConverter.decode(savedData.nonce)
                );
                
            } catch (recoveryTestError) {
                const errorMsg = `CRITICAL ERROR: Recovery test failed for chunk (${chunkX}, ${chunkZ}) BEFORE submission: ${recoveryTestError.message}`;
                console.error(errorMsg);
                throw new Error(errorMsg);
            }
            
            try {
                commitment = await client.submitMintTransaction(mintData);
                
                // Update saved data with submission info
                savedData.submitted = true;
                savedData.requestId = commitment.requestId.toJSON();
                localStorage.setItem(mintTxKey, JSON.stringify(savedData));
                
                // Update in-memory tracking
                const chunkKey = `${chunkX},${chunkZ}`;
                pendingMintTransactions.set(chunkKey, savedData);
            } catch (submitError) {
                console.error(`Error submitting mint transaction for chunk (${chunkX}, ${chunkZ}):`, submitError);
                
                // Check if it's a REQUEST_ID_EXISTS error
                if (submitError.message && submitError.message.includes('REQUEST_ID_EXISTS')) {
                    
                    // Check if another process already saved this token
                    const existingToken = loadChunkTokenData(chunkX, chunkZ);
                    if (existingToken.token && existingToken.state && existingToken.state.gamedevVersion === GAMEDEV_VERSION) {
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
                    
                    // Transaction was already submitted - mark it as submitted for recovery
                    console.warn(`Chunk (${chunkX}, ${chunkZ}) mint transaction already exists (REQUEST_ID_EXISTS). Marking as submitted for recovery.`);
                    
                    // Mark the transaction as submitted instead of clearing it
                    savedData.submitted = true;
                    
                    // Ensure tokenData exists (for old format compatibility)
                    if (!savedData.tokenData) {
                        savedData.tokenData = window.UnicitySDK.HexConverter.encode(new Uint8Array(0));
                    }
                    
                    // IMPORTANT: Update the mintTx data, not just the pending status!
                    localStorage.setItem(mintTxKey, JSON.stringify(savedData));
                    
                    // Clear from in-memory tracking to allow retry on next cycle
                    const chunkKey = `${chunkX},${chunkZ}`;
                    pendingMintTransactions.delete(chunkKey);
                    
                    // Return null for now - will be recovered on next attempt
                    return null;
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
        
        // Only proceed if we have a valid commitment
        if (!commitment) {
            console.error(`No commitment available for chunk (${chunkX}, ${chunkZ})`);
            return null;
        }
        
        // Wait for inclusion proof using SDK utility
        let inclusionProof = await window.UnicitySDK.waitInclusionProof(
            client,
            commitment,
            AbortSignal.timeout(30000), // 30 second timeout
            1000 // Check every second
        );
        
        // Create the transaction with inclusion proof, with retry for sporadic hash algorithm error
        const mintTransaction = await retryOnInclusionProofError(async () => {
            return await client.createTransaction(commitment, inclusionProof);
        });
        
        // Create token state with empty data to match mint transaction
        const tokenState = await window.UnicitySDK.TokenState.create(predicate, new Uint8Array(0));
        
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
        
        return chunkToken;
        
    } catch (error) {
        // Clear pending state on error
        localStorage.removeItem(pendingKey);
        
        // Check for REQUEST_ID_EXISTS error
        if (error.message && error.message.includes('REQUEST_ID_EXISTS')) {
            console.warn(`REQUEST_ID_EXISTS for chunk (${chunkX}, ${chunkZ}), attempting recovery...`);
            
            // The mint transaction was already submitted, try to wait for inclusion proof
            const mintTxKey = getChunkStorageKey(chunkX, chunkZ, 'mintTx');
            const savedMintTx = localStorage.getItem(mintTxKey);
            
            if (savedMintTx && JSON.parse(savedMintTx).submitted) {
                // Clear the pending state
                localStorage.removeItem(pendingKey);
                
                // Try to recover by waiting for inclusion proof
                try {
                    // We need to recreate the commitment to poll for inclusion proof
                    const signingService = await window.UnicitySDK.SigningService.createFromSecret(
                        window.UnicitySDK.MINTER_SECRET,
                        tokenId.bytes
                    );
                    const commitment = await window.UnicitySDK.Commitment.create(mintData, signingService);
                    
                    // Wait for inclusion proof
                    const inclusionProof = await window.UnicitySDK.waitInclusionProof(
                        client,
                        commitment,
                        AbortSignal.timeout(30000),
                        1000
                    );
                    
                    // Create the transaction
                    const mintTransaction = await retryOnInclusionProofError(async () => {
                        return await client.createTransaction(commitment, inclusionProof);
                    });
                    
                    // Create token state with empty data to match mint transaction
                    const tokenState = await window.UnicitySDK.TokenState.create(predicate, new Uint8Array(0));
                    
                    // Create the complete token
                    const chunkToken = new window.UnicitySDK.Token(
                        tokenState,
                        mintTransaction,
                        []
                    );
                    
                    // Save the complete token
                    const tokenJson = chunkToken.toJSON();
                    saveChunkTokenData(chunkX, chunkZ, { 
                        token: tokenJson,
                        state: chunkState
                    });
                    
                    // Clear mint transaction
                    localStorage.removeItem(mintTxKey);
                    pendingMintTransactions.delete(`${chunkX},${chunkZ}`);
                    
                    return chunkToken;
                } catch (recoveryError) {
                    console.error(`Recovery failed for chunk (${chunkX}, ${chunkZ}):`, recoveryError);
                    // Keep the mint transaction data for later recovery
                    return null;
                }
            }
            
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
        
        // Clear all chunk tokens and mint transactions
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('unicityRunner_chunk_')) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
    }
    
    // Save current version
    localStorage.setItem(GAMEDEV_VERSION_KEY, GAMEDEV_VERSION);
}

// Function to manually clear stale pending chunk tokens
window.clearStalePendingChunks = function(maxAgeMinutes = 10) {
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
                }
            }
        } catch (e) {
            console.error(`Error processing ${key}:`, e);
        }
    });
    
    return clearedCount;
};

// Function to manually clear saved mint transactions
window.clearSavedMintTransactions = function() {
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
    });
    
    return clearedCount;
};

// Function to manually retry chunk tokenization
window.retryChunkTokenization = async function(chunkX, chunkZ) {
    
    // Clear any pending state
    const pendingKey = getChunkStorageKey(chunkX, chunkZ, 'pending');
    localStorage.removeItem(pendingKey);
    
    // Clear from in-memory tracking
    const chunkKey = `${chunkX},${chunkZ}`;
    chunksBeingTokenized.delete(chunkKey);
    
    try {
        const result = await ensureChunkToken(chunkX, chunkZ);
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
        return null;
    }
    
    const parsed = JSON.parse(savedData);
    
    // Decode hex values for inspection
    
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
    
    if (stats.chunks.minted.length > 0) {
    }
    
    if (stats.chunks.pending.length > 0) {
    }
    
    if (stats.chunks.inProgress.length > 0) {
    }
    
    if (stats.chunks.failed.length > 0) {
    }
    
    
    return stats;
};

// Generate level structure for a chunk (rooms and corridors)
function generateLevelForChunk(chunkX, chunkZ, seed) {
    const chunkSize = 32; // Match noa chunk size
    const tiles = Array(chunkSize).fill(null).map(() => Array(chunkSize).fill('wall'));
    
    // SIMPLIFIED: Only generate infinite blue corridor
    // Comment out room generation for now
    /*
    // Check if this chunk should have a room
    const hasRoom = roomExists(chunkX, chunkZ, seed);
    
    if (hasRoom) {*/
    const hasRoom = false; // Force no rooms
    
    if (false) { // Never execute room generation
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
        for (let checkX = chunkX - 1; checkX >= chunkX - 200; checkX--) {
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
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 200; checkZ--) {
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
        for (let checkX = chunkX + 1; checkX <= chunkX + 200; checkX++) {
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
        // SIMPLIFIED: Just generate infinite blue corridor
        // Only generate corridor in the center column of chunks (chunkX = 0)
        if (chunkX === 0) {
            // Generate north-bound corridor through entire chunk (3 blocks wide)
            for (let z = 0; z < chunkSize; z++) {
                for (let x = 14; x <= 16; x++) {
                    tiles[x][z] = 'corridor_north';
                }
            }
        }
        // All other chunks remain empty (just walls)
        
        /* COMMENTED OUT ORIGINAL CORRIDOR LOGIC
        // No room in this chunk - check for corridors from the closest room in each direction
        // Check East (from the closest room to the west)
        for (let checkX = chunkX - 1; checkX >= chunkX - 200; checkX--) {
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
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 200; checkZ--) {
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
        for (let checkZ = chunkZ - 1; checkZ >= chunkZ - 200; checkZ--) {
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
            for (let checkZ = chunkZ; checkZ <= chunkZ + 200; checkZ++) {
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
        for (let checkX = chunkX + 1; checkX <= chunkX + 200; checkX++) {
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
        */ // END OF COMMENTED OUT CORRIDOR LOGIC
    }
    
    // Generate coins in blue (north) corridors
    const coinPositions = [];
    const rng = seededRandom(`${seed}_coins_${chunkX}_${chunkZ}`);
    
    
    // Determine safe zones around rooms (5 blocks before and after to include stairs)
    const roomSafeZones = new Set();
    
    // Check for rooms in this chunk and neighboring chunks
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const checkChunkX = chunkX + dx;
            const checkChunkZ = chunkZ + dz;
            
            if (roomExists(checkChunkX, checkChunkZ, seed)) {
                const { width, length } = getRoomDimensions(checkChunkX, checkChunkZ, seed);
                // Room position within its chunk
                const roomXInChunk = Math.floor((chunkSize - width) / 2);
                const roomZInChunk = Math.floor((chunkSize - length) / 2);
                
                // Room position in world coordinates
                const roomWorldX = checkChunkX * chunkSize + roomXInChunk;
                const roomWorldZ = checkChunkZ * chunkSize + roomZInChunk;
                
                // Mark safe zones (4 blocks around room boundaries to cover stairs)
                // Stairs are placed 0-1 blocks from room edge, so 4 blocks gives extra safety
                // With fixed 7x7 rooms, this creates a reasonable safe zone
                for (let worldZ = roomWorldZ - 4; worldZ < roomWorldZ + length + 4; worldZ++) {
                    const localZ = worldZ - (chunkZ * chunkSize);
                    if (localZ >= 0 && localZ < chunkSize) {
                        // Only mark north corridor lanes (x=14,15,16)
                        for (let x = 14; x <= 16; x++) {
                            roomSafeZones.add(`${x},${localZ}`);
                        }
                    }
                }
            }
        }
    }
    
    // Check each row in the chunk for north corridors
    for (let z = 0; z < chunkSize; z++) {
        // Check if this row has a continuous north corridor
        let hasNorthCorridor = true;
        for (let x = 14; x <= 16; x++) {
            if (tiles[x][z] !== 'corridor_north') {
                hasNorthCorridor = false;
                break;
            }
        }
        
        if (hasNorthCorridor && z >= 5 && z < chunkSize - 5) {
            // Check if we're in a safe zone
            let inSafeZone = false;
            for (let x = 14; x <= 16; x++) {
                if (roomSafeZones.has(`${x},${z}`)) {
                    inSafeZone = true;
                    break;
                }
            }
            
            // Calculate coin probability based on distance north
            // Start at 0.5% at spawn (z=0), increase to 50% at z=250 chunks, max 75% at z=375
            const distanceNorth = Math.max(0, chunkZ);
            const coinProbability = Math.min(0.75, 0.005 + (0.495 * distanceNorth / 250));
            
            // Only place coins if not in safe zone
            if (!inSafeZone && rng() < coinProbability) {
                // Determine coin cluster length (1-10)
                const clusterLength = Math.floor(rng() * 10) + 1;
                
                // Determine lane position (0=left, 1=center, 2=right)
                const lane = Math.floor(rng() * 3);
                const xPos = 14 + lane; // 14=left, 15=center, 16=right
                
                // Place coins
                for (let i = 0; i < clusterLength && z + i < chunkSize - 5; i++) {
                    // Verify the corridor continues
                    if (tiles[xPos][z + i] === 'corridor_north') {
                        coinPositions.push({ x: xPos, z: z + i });
                    } else {
                        break; // Stop if corridor ends
                    }
                }
                
                // Skip ahead to avoid overlapping clusters
                z += clusterLength + 2;
            }
        }
    }
    
    // Generate electric traps in blue (north) corridors
    const trapPositions = [];
    
    // Skip traps in spawn chunk and two chunks north for player safety
    if (chunkX === 0 && (chunkZ === 0 || chunkZ === 1 || chunkZ === 2)) {
        return { tiles, coinPositions, trapPositions };
    }
    
    // Check if this chunk has a room - if so, no traps!
    const chunkHasRoom = roomExists(chunkX, chunkZ, seed);
    if (chunkHasRoom) {
        return { tiles, coinPositions, trapPositions };
    }
    
    // Check if this chunk has any north corridors
    let hasNorthCorridor = false;
    for (let z = 0; z < chunkSize; z++) {
        for (let x = 14; x <= 16; x++) {
            if (tiles[x][z] === 'corridor_north') {
                hasNorthCorridor = true;
                break;
            }
        }
        if (hasNorthCorridor) break;
    }
    
    // Only generate traps if we have north corridors but no room
    if (!hasNorthCorridor) {
        return { tiles, coinPositions, trapPositions };
    }
    
    const trapRng = seededRandom(`${seed}_traps_${chunkX}_${chunkZ}`);
    
    
    // Create a set of coin positions for quick lookup
    const coinPosSet = new Set(coinPositions.map(pos => `${pos.x},${pos.z}`));
    
    // Check each position in north corridors for trap placement
    let corridorCount = 0;
    let coinBlockedCount = 0;
    
    for (let z = 0; z < chunkSize; z++) {
        for (let x = 14; x <= 16; x++) {
            if (tiles[x][z] === 'corridor_north') {
                corridorCount++;
                const posKey = `${x},${z}`;
                // Skip if has a coin
                if (coinPosSet.has(posKey)) {
                    coinBlockedCount++;
                } else {
                    // Calculate trap probability based on distance north
                    // Start at 0.05% at spawn (z=0), increase to 7.5% at z=250 chunks, max 11.25% at z=375
                    const distanceNorth = Math.max(0, chunkZ);
                    const trapProbability = Math.min(0.1125, 0.0005 + (0.0745 * distanceNorth / 250));
                    
                    // Place trap based on calculated probability
                    if (trapRng() < trapProbability) {
                        trapPositions.push({ x, z });
                        // Skip ahead to ensure traps are spaced out
                        x += 2;
                    }
                }
            }
        }
    }
    
    
    // Generate holes/carvers in the corridor
    const carverPositions = [];
    
    // Skip carvers in spawn chunk and safe zones for player safety
    if (chunkX === 0 && chunkZ <= 2) {
        return { tiles, coinPositions, trapPositions, carverPositions };
    }
    
    // Only generate carvers in corridor chunks
    if (chunkX === 0) {
        const carverRng = seededRandom(`${seed}_carvers_${chunkX}_${chunkZ}`);
        
        // Calculate carver probability based on distance north
        // Start at 0.1% at spawn, increase to 10% at z=250 chunks, max 15% at z=375
        const distanceNorth = Math.max(0, chunkZ);
        const carverProbability = Math.min(0.15, 0.001 + (0.099 * distanceNorth / 250));
        
        // Check each z position for potential carver placement
        for (let z = 2; z < chunkSize - 2; z++) {
            // Don't place carvers too close together
            if (carverRng() < carverProbability) {
                // Determine carver properties
                const fromEast = carverRng() < 0.5; // 50% chance from each side
                const carverWidth = Math.floor(carverRng() * 5) + 1; // 1-5 blocks wide
                const carverDepth = Math.floor(carverRng() * 3) + 1; // 1-3 blocks deep into corridor
                
                // For wide carvers (4-5 blocks), ensure at least one corridor block remains
                let actualDepth = carverDepth;
                if (carverWidth >= 4) {
                    actualDepth = Math.min(carverDepth, 2); // Max 2 blocks deep for wide carvers
                }
                
                // Apply carver to tiles
                for (let w = 0; w < carverWidth && z + w < chunkSize - 2; w++) {
                    const carveZ = z + w;
                    
                    if (fromEast) {
                        // Carve from east side (right side when facing north)
                        for (let d = 0; d < actualDepth; d++) {
                            const carveX = 16 - d; // Start from x=16 and go west
                            if (carveX >= 14) { // Don't carve past the corridor
                                tiles[carveX][carveZ] = 'carved'; // Mark as carved/empty
                            }
                        }
                    } else {
                        // Carve from west side (left side when facing north)
                        for (let d = 0; d < actualDepth; d++) {
                            const carveX = 14 + d; // Start from x=14 and go east
                            if (carveX <= 16) { // Don't carve past the corridor
                                tiles[carveX][carveZ] = 'carved'; // Mark as carved/empty
                            }
                        }
                    }
                }
                
                // Record carver position for any special handling
                carverPositions.push({
                    z: z,
                    width: carverWidth,
                    depth: actualDepth,
                    fromEast: fromEast
                });
                
                // Skip ahead to avoid overlapping carvers
                z += carverWidth + 3;
            }
        }
    }
    
    // Generate slowing floor patches in the corridor
    const slowingFloorPositions = [];
    
    // Skip slowing floors in spawn chunk and safe zones
    if (chunkX === 0 && chunkZ <= 2) {
        return { tiles, coinPositions, trapPositions, carverPositions, slowingFloorPositions };
    }
    
    // Only generate slowing floors in corridor chunks
    if (chunkX === 0) {
        const slowingRng = seededRandom(`${seed}_slowing_${chunkX}_${chunkZ}`);
        
        // Calculate slowing floor probability based on distance north
        // Start at 0.1% at spawn, increase to 12% at z=250 chunks, max 18% at z=375
        const distanceNorth = Math.max(0, chunkZ);
        const slowingProbability = Math.min(0.18, 0.001 + (0.119 * distanceNorth / 250));
        
        // Create a set to track occupied positions (coins, traps, carved areas)
        const occupiedPositions = new Set();
        
        // Add coin positions
        coinPositions.forEach(pos => {
            occupiedPositions.add(`${pos.x},${pos.z}`);
        });
        
        // Add trap positions
        trapPositions.forEach(pos => {
            occupiedPositions.add(`${pos.x},${pos.z}`);
        });
        
        // Add carved positions
        for (let x = 14; x <= 16; x++) {
            for (let z = 0; z < chunkSize; z++) {
                if (tiles[x][z] === 'carved') {
                    occupiedPositions.add(`${x},${z}`);
                }
            }
        }
        
        // Check each z position for potential slowing floor placement
        for (let z = 2; z < chunkSize - 10; z++) {
            if (slowingRng() < slowingProbability) {
                // Determine patch properties
                const patchWidth = Math.floor(slowingRng() * 3) + 1; // 1-3 blocks wide
                const patchLength = Math.floor(slowingRng() * 10) + 1; // 1-10 blocks long
                
                // Choose starting lane (ensuring patch fits within corridor)
                const maxStartX = 16 - patchWidth + 1;
                const startX = 14 + Math.floor(slowingRng() * (maxStartX - 14 + 1));
                
                // Check if this area is clear of other obstacles
                let canPlace = true;
                for (let w = 0; w < patchWidth; w++) {
                    for (let l = 0; l < patchLength && z + l < chunkSize; l++) {
                        const checkX = startX + w;
                        const checkZ = z + l;
                        const posKey = `${checkX},${checkZ}`;
                        
                        if (occupiedPositions.has(posKey) || tiles[checkX][checkZ] !== 'corridor_north') {
                            canPlace = false;
                            break;
                        }
                    }
                    if (!canPlace) break;
                }
                
                if (canPlace) {
                    // Place slowing floor patches
                    const patches = [];
                    for (let w = 0; w < patchWidth; w++) {
                        for (let l = 0; l < patchLength && z + l < chunkSize; l++) {
                            const patchX = startX + w;
                            const patchZ = z + l;
                            
                            // Mark tile as slowing floor
                            tiles[patchX][patchZ] = 'slowing_floor';
                            patches.push({ x: patchX, z: patchZ });
                            
                            // Add to occupied positions
                            occupiedPositions.add(`${patchX},${patchZ}`);
                        }
                    }
                    
                    // Record slowing floor area
                    slowingFloorPositions.push({
                        z: z,
                        startX: startX,
                        width: patchWidth,
                        length: patchLength,
                        patches: patches
                    });
                    
                    // Skip ahead to avoid overlapping patches
                    z += patchLength + 2;
                }
            }
        }
    }
    
    return { tiles, coinPositions, trapPositions, carverPositions, slowingFloorPositions };
}


// Initialize URC inventory from localStorage
async function initializeURCInventory() {
    try {
        // Load confirmed balance from minted tokens
        const inventoryData = localStorage.getItem('unicityRunner_urcInventory');
        if (inventoryData) {
            const inventory = JSON.parse(inventoryData);
            confirmedURCBalance = inventory.confirmedBalance || 0;
            
            // Load and verify each token
            if (inventory.tokens && Array.isArray(inventory.tokens)) {
                // TODO: Verify tokens still exist on chain
            }
        }
        
        // Load pending mints
        const pendingMints = localStorage.getItem('unicityRunner_pendingURCMints');
        if (pendingMints) {
            const pending = JSON.parse(pendingMints);
            pendingURCBalance = pending.totalAmount || 0;
            
            // Try to complete any pending mints
            if (pending.mints && Array.isArray(pending.mints)) {
                for (const mint of pending.mints) {
                    completeURCMint(mint).catch(err => {
                        console.error('Failed to complete pending URC mint:', err);
                    });
                }
            }
        }
        
        updateCoinDisplay();
    } catch (error) {
        console.error('Failed to initialize URC inventory:', error);
    }
}

// Mint URC token for collected coins
async function mintURCToken(amount) {
    if (!signingService || amount <= 0) return;
    
    try {
        // Check if SDK is properly loaded
        if (!window.UnicitySDK) {
            console.error('UnicitySDK not loaded');
            return;
        }
        // Add to pending balance immediately
        pendingURCBalance += amount;
        updateCoinDisplay();
        
        // Generate unique token ID
        const tokenId = window.UnicitySDK.TokenId.create(crypto.getRandomValues(new Uint8Array(32)));
        const tokenType = window.UnicitySDK.TokenType.create(URC_TOKEN_TYPE_BYTES);
        
        // Create coin data for the amount
        // Use hex string instead of CoinId constructor which may not be exposed
        const coinIdHex = window.UnicitySDK.HexConverter.encode(URC_COIN_ID_BYTES);
        const coinData = window.UnicitySDK.TokenCoinData.fromJSON([
            [coinIdHex, amount.toString()]
        ]);
        
        // Generate nonce and predicate
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const predicate = await window.UnicitySDK.MaskedPredicate.create(
            tokenId,
            tokenType,
            signingService,
            window.UnicitySDK.HashAlgorithm.SHA256,
            nonce
        );
        
        // Create mint transaction data
        const recipient = await window.UnicitySDK.DirectAddress.create(predicate.reference);
        const salt = crypto.getRandomValues(new Uint8Array(32));
        
        const mintData = await window.UnicitySDK.MintTransactionData.create(
            tokenId,
            tokenType,
            new Uint8Array(0), // No immutable data
            coinData,
            recipient.toString(),
            salt,
            null, // No data hash
            null  // No reason
        );
        
        // Save pending mint
        const pendingMint = {
            tokenId: window.UnicitySDK.HexConverter.encode(tokenId.bytes),
            tokenType: window.UnicitySDK.HexConverter.encode(tokenType.bytes),
            amount: amount,
            nonce: window.UnicitySDK.HexConverter.encode(nonce),
            salt: window.UnicitySDK.HexConverter.encode(salt),
            recipient: recipient.toString(),
            timestamp: Date.now(),
            status: 'pending'
        };
        
        savePendingURCMint(pendingMint);
        
        // Submit mint transaction
        const aggregatorClient = new window.UnicitySDK.AggregatorClient(
            'https://goggregator-test.unicity.network'
        );
        const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        const commitment = await client.submitMintTransaction(mintData);
        
        // Update pending mint with commitment info
        pendingMint.status = 'submitted';
        pendingMint.requestId = commitment.requestId.toJSON();
        savePendingURCMint(pendingMint);
        
        // Poll for inclusion proof
        const inclusionProof = await waitForInclusionProof(client, commitment);
        
        // Create transaction with retry logic for hash algorithm errors
        const transaction = await retryOnInclusionProofError(async () => {
            return await client.createTransaction(commitment, inclusionProof);
        });
        
        // Create token state
        const tokenState = await window.UnicitySDK.TokenState.create(predicate, null);
        const token = new window.UnicitySDK.Token(tokenState, transaction, []);
        
        // Save to inventory
        saveURCTokenToInventory(token, amount, pendingMint);
        
        // Update balances - handle case where player died during minting
        if (isPlayerDead) {
            // Player died - add minted coins to the last death's backpack if it exists
            const backpackKeys = Array.from(backpackData.keys());
            if (backpackKeys.length > 0) {
                // Find the most recent backpack
                const mostRecentKey = backpackKeys.reduce((latest, key) => {
                    const latestData = backpackData.get(latest);
                    const keyData = backpackData.get(key);
                    return keyData.createdAt > latestData.createdAt ? key : latest;
                });
                
                // Add the minted coins to the backpack
                const data = backpackData.get(mostRecentKey);
                data.lostCoins += amount;
                
                // Update inventory in backpack
                if (!data.inventory) {
                    data.inventory = {
                        confirmedBalance: 0,
                        pendingBalance: 0,
                        totalCoins: data.lostCoins,
                        mintedTokens: [],
                        pendingMints: []
                    };
                }
                
                // Add this newly minted token to the backpack's inventory
                data.inventory.confirmedBalance += amount;
                data.inventory.totalCoins = data.lostCoins;
                data.inventory.mintedTokens.push({
                    tokenId: pendingMint.tokenId,
                    amount: amount,
                    token: token.toJSON(),
                    mintedAt: Date.now()
                });
                
                backpackData.set(mostRecentKey, data);
                
                // Update the backpack entity if it exists
                if (backpacks.has(mostRecentKey)) {
                    const backpackEntity = backpacks.get(mostRecentKey);
                    if (noa.entities.hasComponent(backpackEntity, 'isBackpack')) {
                        const backpackState = noa.entities.getState(backpackEntity, 'isBackpack');
                        backpackState.lostCoins = data.lostCoins;
                        backpackState.inventory = data.inventory;
                    }
                }
                
                console.log(`Player died during minting - added ${amount} coins to backpack at ${mostRecentKey}`);
            }
            // Don't update balances since player is dead
        } else {
            // Normal case - player is alive
            // Ensure we don't go negative
            if (pendingURCBalance >= amount) {
                pendingURCBalance -= amount;
                confirmedURCBalance += amount;
            } else {
                // This shouldn't happen, but handle it gracefully
                console.warn(`Pending balance ${pendingURCBalance} is less than mint amount ${amount}`);
                confirmedURCBalance += pendingURCBalance; // Add whatever was pending
                pendingURCBalance = 0;
            }
            updateCoinDisplay();
        }
        
    } catch (error) {
        console.error('Failed to mint URC token:', error);
        // Keep in pending state for retry
    }
}

// Save pending URC mint
function savePendingURCMint(mintData) {
    let pending = { mints: [], totalAmount: 0 };
    const stored = localStorage.getItem('unicityRunner_pendingURCMints');
    if (stored) {
        pending = JSON.parse(stored);
    }
    
    // Update or add mint
    const existingIndex = pending.mints.findIndex(m => m.tokenId === mintData.tokenId);
    if (existingIndex >= 0) {
        pending.mints[existingIndex] = mintData;
    } else {
        pending.mints.push(mintData);
    }
    
    // Recalculate total
    pending.totalAmount = pending.mints.reduce((sum, m) => sum + m.amount, 0);
    
    localStorage.setItem('unicityRunner_pendingURCMints', JSON.stringify(pending));
}

// Save URC token to inventory
function saveURCTokenToInventory(token, amount, pendingMint) {
    let inventory = { tokens: [], confirmedBalance: 0 };
    const stored = localStorage.getItem('unicityRunner_urcInventory');
    if (stored) {
        inventory = JSON.parse(stored);
    }
    
    // Add token
    inventory.tokens.push({
        tokenId: pendingMint.tokenId,
        amount: amount,
        token: token.toJSON(),
        mintedAt: Date.now()
    });
    
    // Update balance
    inventory.confirmedBalance = inventory.tokens.reduce((sum, t) => sum + t.amount, 0);
    
    localStorage.setItem('unicityRunner_urcInventory', JSON.stringify(inventory));
    
    // Remove from pending
    removePendingURCMint(pendingMint.tokenId);
}

// Remove completed pending mint
function removePendingURCMint(tokenId) {
    const stored = localStorage.getItem('unicityRunner_pendingURCMints');
    if (stored) {
        const pending = JSON.parse(stored);
        pending.mints = pending.mints.filter(m => m.tokenId !== tokenId);
        pending.totalAmount = pending.mints.reduce((sum, m) => sum + m.amount, 0);
        localStorage.setItem('unicityRunner_pendingURCMints', JSON.stringify(pending));
    }
}

// Try to complete a pending mint
async function completeURCMint(pendingMint) {
    if (!signingService || !pendingMint) return;
    
    try {
        console.log(`Attempting to complete pending mint for ${pendingMint.amount} URC (tokenId: ${pendingMint.tokenId})`);
        
        // Check if SDK is properly loaded
        if (!window.UnicitySDK) {
            console.error('UnicitySDK not loaded');
            return;
        }
        
        // Reconstruct the commitment from saved data
        const tokenId = window.UnicitySDK.TokenId.create(window.UnicitySDK.HexConverter.decode(pendingMint.tokenId));
        const tokenType = window.UnicitySDK.TokenType.create(window.UnicitySDK.HexConverter.decode(pendingMint.tokenType));
        const nonce = window.UnicitySDK.HexConverter.decode(pendingMint.nonce);
        const salt = window.UnicitySDK.HexConverter.decode(pendingMint.salt);
        
        // Recreate coin data
        const coinIdHex = window.UnicitySDK.HexConverter.encode(URC_COIN_ID_BYTES);
        const coinData = window.UnicitySDK.TokenCoinData.fromJSON([
            [coinIdHex, pendingMint.amount.toString()]
        ]);
        
        // Recreate predicate
        const predicate = await window.UnicitySDK.MaskedPredicate.create(
            tokenId,
            tokenType,
            signingService,
            window.UnicitySDK.HashAlgorithm.SHA256,
            nonce
        );
        
        // Initialize client
        const aggregatorClient = new window.UnicitySDK.AggregatorClient(
            'https://goggregator-test.unicity.network'
        );
        const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        // Check if we have a requestId (mint was already submitted)
        if (pendingMint.requestId && pendingMint.status === 'submitted') {
            // Try to get inclusion proof for existing submission
            try {
                const requestId = window.UnicitySDK.RequestId.fromJSON(pendingMint.requestId);
                const commitment = {
                    requestId: requestId,
                    transactionData: null, // We don't need this for getting proof
                    authenticator: null
                };
                
                const inclusionProof = await waitForInclusionProof(client, commitment, 5); // Fewer attempts for recovery
                
                // If we got a proof, complete the mint
                if (inclusionProof) {
                    // We need to recreate the mint data to build the transaction
                    const mintData = await window.UnicitySDK.MintTransactionData.create(
                        tokenId,
                        tokenType,
                        new Uint8Array(0),
                        coinData,
                        pendingMint.recipient,
                        salt,
                        null,
                        null
                    );
                    
                    // Recreate commitment with mint data
                    const fullCommitment = await window.UnicitySDK.Commitment.create(
                        mintData,
                        await window.UnicitySDK.SigningService.createFromSecret(
                            window.UnicitySDK.StateTransitionClient.MINTER_SECRET || 
                            window.UnicitySDK.HexConverter.decode('495f414d5f554e4956455253414c5f4d494e5445525f464f525f'),
                            tokenId.bytes
                        )
                    );
                    fullCommitment.requestId = requestId;
                    
                    // Create transaction
                    const transaction = await retryOnInclusionProofError(async () => {
                        return await client.createTransaction(fullCommitment, inclusionProof);
                    });
                    
                    // Create token state
                    const tokenState = await window.UnicitySDK.TokenState.create(predicate, null);
                    const token = new window.UnicitySDK.Token(tokenState, transaction, []);
                    
                    // Save to inventory
                    saveURCTokenToInventory(token, pendingMint.amount, pendingMint);
                    
                    // Update balances
                    pendingURCBalance -= pendingMint.amount;
                    confirmedURCBalance += pendingMint.amount;
                    updateCoinDisplay();
                    
                    console.log(`Successfully completed pending mint for ${pendingMint.amount} URC`);
                    return;
                }
            } catch (error) {
                console.warn('Could not recover existing mint submission:', error);
                // Fall through to resubmit
            }
        }
        
        // If we couldn't recover, resubmit the mint
        console.log('Resubmitting mint transaction...');
        const recipient = await window.UnicitySDK.DirectAddress.create(predicate.reference);
        
        const mintData = await window.UnicitySDK.MintTransactionData.create(
            tokenId,
            tokenType,
            new Uint8Array(0),
            coinData,
            recipient.toString(),
            salt,
            null,
            null
        );
        
        // Submit mint transaction
        const commitment = await client.submitMintTransaction(mintData);
        
        // Update pending mint with new commitment info
        pendingMint.status = 'submitted';
        pendingMint.requestId = commitment.requestId.toJSON();
        savePendingURCMint(pendingMint);
        
        // Poll for inclusion proof
        const inclusionProof = await waitForInclusionProof(client, commitment);
        
        // Create transaction
        const transaction = await retryOnInclusionProofError(async () => {
            return await client.createTransaction(commitment, inclusionProof);
        });
        
        // Create token state
        const tokenState = await window.UnicitySDK.TokenState.create(predicate, null);
        const token = new window.UnicitySDK.Token(tokenState, transaction, []);
        
        // Save to inventory
        saveURCTokenToInventory(token, pendingMint.amount, pendingMint);
        
        // Update balances
        pendingURCBalance -= pendingMint.amount;
        confirmedURCBalance += pendingMint.amount;
        updateCoinDisplay();
        
        console.log(`Successfully resubmitted and completed pending mint for ${pendingMint.amount} URC`);
        
    } catch (error) {
        console.error('Failed to complete pending URC mint:', error);
        // Don't remove from pending - we can retry later
    }
}

// Wait for inclusion proof with timeout and retry logic
async function waitForInclusionProof(client, commitment, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const proof = await client.getInclusionProof(commitment);
            const status = await proof.verify(commitment.requestId);
            
            if (status === window.UnicitySDK.InclusionProofVerificationStatus.OK) {
                return proof;
            }
        } catch (error) {
            // Continue polling
        }
        
        // Wait 1 second between attempts
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Timeout waiting for inclusion proof');
}

// Retry logic for inclusion proof validation errors
async function retryOnInclusionProofError(fn, maxRetries = 5) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Check if it's the specific inclusion proof hash algorithm error
            if (error.message && error.message.includes('Invalid inclusion proof hash algorithm')) {
                console.warn(`Inclusion proof hash algorithm error (attempt ${attempt}/${maxRetries}), retrying...`);
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                continue;
            }
            
            // For other errors, throw immediately
            throw error;
        }
    }
    
    // If we exhausted all retries, throw the last error
    throw lastError;
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
    // Show minting progress if on stats screen
    const statsScreen = document.getElementById('statsScreen');
    const initialMintingProgress = document.getElementById('initialMintingProgress');
    const statsContent = document.getElementById('statsContent');
    const initialMintingStatus = document.getElementById('initialMintingStatus');
    
    if (statsScreen && statsScreen.classList.contains('show')) {
        if (initialMintingProgress) initialMintingProgress.style.display = 'block';
        if (statsContent) statsContent.style.display = 'none';
    }
    
    // Update minting status
    if (initialMintingStatus) {
        initialMintingStatus.textContent = 'Generating cryptographic keys...';
    }
    
    // Reset token status for new token
    tokenStatus = {
        initialized: false,
        totalSubmissions: 0,
        successfulSubmissions: 0,
        lastUpdateTime: 0,
        lastError: null,
        pendingTransaction: false
    };
    updateTokenStatusDisplay();
    
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
    
    // Update minting status
    if (initialMintingStatus) {
        initialMintingStatus.textContent = 'Creating signing service...';
    }
    
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
    const aggregatorClient = new window.UnicitySDK.AggregatorClient('https://goggregator-test.unicity.network');
    const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
    
    // Update minting status
    if (initialMintingStatus) {
        initialMintingStatus.textContent = 'Preparing token transaction...';
    }
    
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
        
        const mintCommitment = await client.submitMintTransaction(mintTransactionData);
        
        // Wait for inclusion proof using SDK utility
        const inclusionProof = await window.UnicitySDK.waitInclusionProof(
            client,
            mintCommitment,
            AbortSignal.timeout(30000), // 30 second timeout
            1000 // Check every second
        );
        
        // Create the transaction with inclusion proof and retry logic
        const mintTransaction = await retryOnInclusionProofError(async () => {
            return await client.createTransaction(mintCommitment, inclusionProof);
        });
        
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
        
        
        tokenStatus.initialized = true;
        tokenStatus.totalSubmissions = 1;
        tokenStatus.successfulSubmissions = 1;
        tokenStatus.lastUpdateTime = Date.now();
        updateTokenStatusDisplay();
        
        // Hide minting progress if on stats screen
        if (statsScreen && statsScreen.classList.contains('show')) {
            if (initialMintingProgress) initialMintingProgress.style.display = 'none';
            if (statsContent) statsContent.style.display = 'block';
        }
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
        
        // Show error in minting progress if on stats screen
        if (statsScreen && statsScreen.classList.contains('show')) {
            if (initialMintingStatus) {
                initialMintingStatus.textContent = 'Failed to create token. Press SPACE to continue in offline mode.';
                initialMintingStatus.style.color = '#ff5555';
            }
        }
        
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
function damagePlayer(amount, source = 'Unknown') {
    // Don't damage if already dead
    if (currentPlayerHealth <= 0 || isPlayerDead) {
        return;
    }
    
    currentPlayerHealth = Math.max(0, currentPlayerHealth - amount);
    updateHealthDisplay(currentPlayerHealth);
    
    
    // Check for death
    if (currentPlayerHealth <= 0) {
        handlePlayerDeath(source);
    }
}

// Heal player
function healPlayer(amount) {
    currentPlayerHealth = Math.min(100, currentPlayerHealth + amount);
    updateHealthDisplay(currentPlayerHealth);
    
}


// Set up noa engine
function setupNoaEngine() {
    // Create engine options
    const opts = {
        domElement: document.getElementById('app'),
        debug: true,
        showFPS: true,
        chunkSize: 32,
        chunkAddDistance: 6,  // Reduced from 10 for better performance
        chunkRemoveDistance: 8,  // Reduced to match
        // Add more aggressive chunk loading
        worldGenWhilePaused: true,
        manuallyControlChunkLoading: false, // Let noa handle chunk loading
        // Enable auto-step for climbing stairs
        playerAutoStep: true,
        // Disable fog to see the skybox better
        fogDisabled: true,
        // Remove clear color to let skybox show
        // clearColor: [0, 0, 0, 0],
    };
    
    // Create engine
    noa = new Engine(opts);
    
    // Note: noa-engine handles chunk loading automatically based on chunkAddDistance
    // We've set it to 10 chunks which should provide good visibility
    
    // Create full skybox with textures
    setTimeout(() => {
        try {
            const scene = noa.rendering.getScene();
            
            // Set dark background with bright yellowish tint
            scene.clearColor = new BABYLON.Color3(0.15, 0.12, 0.05); // Dark with bright yellow tint
            
            // Store skybox entities and their offsets
            const skyboxEntities = [];
            
            // Create skybox faces using entities
            const createSkyboxFace = (name, size, offset, rotation, texturePath) => {
                const plane = BABYLON.MeshBuilder.CreatePlane(name, { 
                    size: size,
                    sideOrientation: BABYLON.Mesh.DOUBLESIDE 
                }, scene);
                
                // Create material with texture
                const mat = noa.rendering.makeStandardMaterial(name + 'Mat');
                mat.diffuseTexture = new BABYLON.Texture(texturePath, scene);
                mat.emissiveTexture = mat.diffuseTexture;
                mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
                mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.backFaceCulling = false;
                
                plane.material = mat;
                plane.rotation = rotation;
                
                // Create entity for this face
                const entity = noa.entities.add(
                    [0, 0, 0],  // position (will be updated)
                    1, 1,       // width, height
                    null,       // mesh (will add)
                    null,       // meshOffset
                    false,      // doPhysics
                    false       // shadow
                );
                
                // Add mesh component
                noa.entities.addComponent(entity, noa.entities.names.mesh, {
                    mesh: plane,
                    offset: [0, 0, 0]
                });
                
                skyboxEntities.push({ entity, offset });
                return plane;
            };
            
            // Distance from camera for north face
            const distance = 3000;
            
            // Only create the north face since we're always facing north
            const skyboxFaces = [
                // North (front) - positive Z, twice as large and 25% down
                createSkyboxFace('skyNorth', distance * 2,  // Twice as large
                    new BABYLON.Vector3(0, -distance * 0.25, distance), // 25% down
                    new BABYLON.Vector3(0, 0, 0), // No tilt
                    '/assets/unirun_skyline.png')
            ];
            
            // Update skybox position to follow camera smoothly
            scene.registerBeforeRender(() => {
                if (noa.camera) {
                    const cameraPos = noa.camera.getPosition();
                    
                    skyboxEntities.forEach(({ entity, offset }, index) => {
                        const pos = [
                            cameraPos[0] + offset.x,
                            cameraPos[1] + offset.y,
                            cameraPos[2] + offset.z
                        ];
                        noa.entities.setPosition(entity, pos);
                    });
                }
            });
            
            console.log('Created full skybox with 6 textured faces');
            
        } catch (error) {
            console.error('Error creating skybox:', error);
        }
    }, 1500); // Delay to ensure engine is fully initialized
    
    // Log default camera parameters
    
    // Set up 3rd person camera - looking from behind and above
    noa.camera.zoomDistance = 20;  // Doubled distance for better view
    noa.camera.pitch = 0.333;      // Positive pitch looks up (about 19 degrees)
    
    // Disable camera collision avoidance and vertical following
    noa.camera.updateAfterEntityRenderSystems = function() {
        // Override the default behavior - no obstruction checking
        // Camera will always stay at zoomDistance behind player
        this.currentZoom = this.zoomDistance;
    };
    
    // Keep original camera behavior - follows player naturally
    
    // Also ensure immediate zoom updates (no smoothing)
    noa.camera.zoomSpeed = 1.0;  // Instant zoom changes
    
    
    // Register materials - using simple colors
    var brownish = [0.45, 0.36, 0.22];
    var grayish = [0.6, 0.6, 0.6];
    var roomFloorColor = [0.4, 0.5, 0.4]; // Greenish for rooms
    var corridorEastColor = [0.8, 0.3, 0.3]; // Reddish for east corridors
    var corridorNorthColor = [0.3, 0.3, 0.8]; // Bluish for north corridors
    var corridorWestColor = [0.8, 0.8, 0.3]; // Yellowish for west corridors
    var stairColor = [0.5, 0.5, 0.7]; // Light blue for stairs
    var slowingFloorColor = [0.5, 0.2, 0.5]; // Purple for slowing floors
    
    // Create custom material for dirt/wall blocks with transparency support
    var wallMat = noa.rendering.makeStandardMaterial('wallMat');
    var wallTex = new BABYLON.Texture('/assets/wall_unirun.png', scene);
    wallMat.diffuseTexture = wallTex;
    wallMat.opacityTexture = wallTex; // Use texture's alpha channel for opacity
    wallMat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular for consistent look
    
    noa.registry.registerMaterial('dirt', {
        renderMaterial: wallMat
    });
    noa.registry.registerMaterial('stone', { color: grayish });
    noa.registry.registerMaterial('roomFloor', { color: roomFloorColor });
    noa.registry.registerMaterial('corridorEast', { color: corridorEastColor });
    // Create custom material for blue corridor floor with full transparency support
    // Note: noa-engine has limited support for partial transparency, but this hack works
    var scene = noa.rendering.getScene();
    var floorMat = noa.rendering.makeStandardMaterial('floorMat');
    var floorTex = new BABYLON.Texture('/assets/unirun_floor.png', scene);
    
    // Rotate texture 180 degrees
    floorTex.wAng = Math.PI; // 180 degrees in radians
    
    floorMat.diffuseTexture = floorTex;
    floorMat.opacityTexture = floorTex; // Use texture's alpha channel for opacity
    floorMat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular for glass-like effect
    
    noa.registry.registerMaterial('corridorNorth', {
        renderMaterial: floorMat
    });
    noa.registry.registerMaterial('corridorWest', { color: corridorWestColor });
    noa.registry.registerMaterial('stair', { color: stairColor });
    // Create custom material for slowing floor blocks with transparency support
    var slowingMat = noa.rendering.makeStandardMaterial('slowingMat');
    var slowingTex = new BABYLON.Texture('/assets/unirun_slower.png', scene);
    slowingMat.diffuseTexture = slowingTex;
    slowingMat.opacityTexture = slowingTex; // Use texture's alpha channel for opacity
    slowingMat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular for consistent look
    
    noa.registry.registerMaterial('slowingFloor', {
        renderMaterial: slowingMat
    });
    
    // Create material for floor block sides with stripes texture
    var stripesMat = noa.rendering.makeStandardMaterial('stripesMat');
    var stripesTex = new BABYLON.Texture('/assets/unirun_stripes.png', scene);
    stripesMat.diffuseTexture = stripesTex;
    stripesMat.opacityTexture = stripesTex; // Use texture's alpha channel for opacity
    stripesMat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular
    
    noa.registry.registerMaterial('floorStripes', {
        renderMaterial: stripesMat
    });
    
    // Register blocks
    var dirtID = noa.registry.registerBlock(1, { 
        material: 'dirt',
        opaque: false, // Not fully opaque due to transparency
        solid: true
    });
    var stoneID = noa.registry.registerBlock(2, { material: 'stone' });
    roomFloorID = noa.registry.registerBlock(3, { 
        material: ['roomFloor', 'floorStripes'], // [top/bottom, sides]
        opaque: false // Due to stripes transparency
    });
    corridorEastID = noa.registry.registerBlock(4, { 
        material: ['corridorEast', 'floorStripes'], // [top/bottom, sides]
        opaque: false // Due to stripes transparency
    });
    corridorNorthID = noa.registry.registerBlock(5, { 
        material: ['corridorNorth', 'floorStripes'], // [top/bottom, sides]
        opaque: false, // Not fully opaque due to transparency
        solid: true
    });
    corridorWestID = noa.registry.registerBlock(6, { 
        material: ['corridorWest', 'floorStripes'], // [top/bottom, sides]
        opaque: false // Due to stripes transparency
    });
    // Simple stair block - full cube collision
    var stairID = noa.registry.registerBlock(7, { 
        material: 'stair',
        solid: true,
        opaque: false
    });
    slowingFloorID = noa.registry.registerBlock(8, {
        material: ['slowingFloor', 'floorStripes'], // [top/bottom, sides]
        solid: true,
        opaque: false // Not fully opaque due to transparency
    });
    
    // Stripe warning blocks to place around holes/edges
    stripeBlockID = noa.registry.registerBlock(9, {
        material: 'floorStripes', // All faces use stripes
        solid: true,
        opaque: false // Not fully opaque due to transparency
    });
    
    // Create pillar material with transparency
    var pillarMat = noa.rendering.makeStandardMaterial('pillarMat');
    var pillarTex = new BABYLON.Texture('/assets/unirun_pillar.png', scene);
    pillarMat.diffuseTexture = pillarTex;
    pillarMat.opacityTexture = pillarTex; // Use texture's alpha channel for opacity
    pillarMat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular
    
    noa.registry.registerMaterial('pillar', {
        renderMaterial: pillarMat
    });
    
    // Pillar blocks for corridor decoration
    pillarBlockID = noa.registry.registerBlock(10, {
        material: 'pillar', // All faces use pillar texture
        solid: true,
        opaque: false // Not fully opaque due to transparency
    });
    
    
    // Function to find a valid spawn position in a room
    function findSpawnRoom(seed) {
        
        // First check if chunk 0,0 has a room
        
        // Search in a spiral pattern from origin
        for (let radius = 0; radius < 10; radius++) {
            for (let x = -radius; x <= radius; x++) {
                for (let z = -radius; z <= radius; z++) {
                    // Check if we're on the edge of the search square
                    if (Math.abs(x) === radius || Math.abs(z) === radius) {
                        const hasRoom = roomExists(x, z, seed);
                        if (hasRoom) {
                            // Get room center in local chunk coordinates
                            const localPos = getRoomCenter(x, z, seed);
                            // Convert to world coordinates
                            const worldX = x * 32 + localPos[0];
                            const worldZ = z * 32 + localPos[2];
                            return [worldX, 1, worldZ];
                        }
                    }
                }
            }
        }
        // Fallback to origin
        return [8, 1, 8];
    }
    
    // Set player position from token
    const playerState = getPlayerState();
    let position = playerState?.position || null;
    
    // Initialize health display
    if (playerState && playerState.health !== undefined) {
        currentPlayerHealth = playerState.health;
        updateHealthDisplay(currentPlayerHealth);
        
        // If player died in previous session, respawn them
        if (currentPlayerHealth <= 0) {
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
        position = [15.5, 50, 16]; // High up to prevent getting stuck, center of blue corridor
        
        // After chunks generate, find proper spawn
        setTimeout(() => {
            // Force chunk generation around origin first
            forceChunkGeneration();
            
            setTimeout(() => {
                const spawnPos = calculateInitialSpawnPoint(WORLD_SEED);
                noa.entities.setPosition(noa.playerEntity, spawnPos);
                
                // Verify spawn
                setTimeout(() => {
                    const blockBelow = noa.world.getBlockID(
                        Math.floor(spawnPos[0]), 
                        Math.floor(spawnPos[1] - 1), 
                        Math.floor(spawnPos[2])
                    );
                    
                    // If still not in a room, try to find the actual room center
                    if (blockBelow !== roomFloorID) {
                        const chunkX = Math.floor(spawnPos[0] / 32);
                        const chunkZ = Math.floor(spawnPos[2] / 32);
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
    
    // Initialize starting position for distance tracking
    if (playerStartZ === null) {
        playerStartZ = position[2];
        // Start tracking the run
        playerStats.currentRunStartTime = Date.now();
        playerStats.currentRunDistance = 0;
    }
    
    // Add a red cylinder mesh to the player
    // Scene already declared above for skybox
    
    // Create box with separate materials for each face
    const box = BABYLON.MeshBuilder.CreateBox('playerBox', {
        height: 1.8,  // Player height
        width: 0.6,   // Player width (0.6 blocks)
        depth: 0.6    // Player depth (0.6 blocks)
    }, scene);
    
    // Create multi-material for different textures per face
    const multiMat = new BABYLON.MultiMaterial('playerMultiMat', scene);
    
    // Face order in Babylon.js: front, back, right, left, top, bottom
    const faceConfigs = [
        { name: 'front', texture: '/assets/unirun_robot_front.png' },
        { name: 'back', texture: '/assets/unirun_robot_back.png' },
        { name: 'right', texture: '/assets/unirun_robot_side.png' },
        { name: 'left', texture: '/assets/unirun_robot_side.png' },
        { name: 'top', texture: '/assets/unirun_robot_topbottom.png' },
        { name: 'bottom', texture: '/assets/unirun_robot_topbottom.png' }
    ];
    
    // Create materials for each face
    faceConfigs.forEach((config, index) => {
        const mat = noa.rendering.makeStandardMaterial(`player_${config.name}`);
        
        try {
            const texture = new BABYLON.Texture(config.texture, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
            texture.hasAlpha = true;
            
            // Flip texture horizontally for left side to mirror the right side
            if (config.name === 'left') {
                texture.uScale = -1;
            }
            
            mat.diffuseTexture = texture;
            mat.specularColor = new BABYLON.Color3(0, 0, 0); // No specular
            mat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Slight emission for visibility
            
        } catch (e) {
            // Fallback to red color if texture fails
            console.warn(`Failed to load texture ${config.texture}, using red fallback`);
            mat.diffuseColor = new BABYLON.Color3(1, 0, 0);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
        }
        
        multiMat.subMaterials[index] = mat;
    });
    
    // Apply multi-material and create submeshes
    box.material = multiMat;
    box.subMeshes = [];
    
    // Create submeshes for each face
    const verticesPerFace = 4;
    const indicesPerFace = 6;
    for (let i = 0; i < 6; i++) {
        box.subMeshes.push(new BABYLON.SubMesh(
            i,                          // materialIndex
            i * verticesPerFace,        // verticesStart
            verticesPerFace,            // verticesCount
            i * indicesPerFace,         // indexStart
            indicesPerFace,             // indexCount
            box                         // mesh
        ));
    }
    
    // Add mesh component to player entity
    noa.entities.addComponent(noa.playerEntity, noa.entities.names.mesh, {
        mesh: box,
        offset: [0, 0.9, 0] // Offset to center the box on the player
    });
    
    // Add flashing lights on robot's head
    const lightColors = [
        new BABYLON.Color3(1, 1, 1),      // White
        new BABYLON.Color3(0, 1, 0),      // Green
        new BABYLON.Color3(1, 1, 0)       // Yellow
    ];
    
    // Create light spheres on top of robot
    const lights = [];
    // Robot is 1.8 tall, centered at 0.9, so top is at 0.9 + 0.9 = 1.8
    // Place lights slightly above the top
    const lightPositions = [
        [-0.15, 1.0, -0.15],  // Front-left (above head)
        [0.15, 1.0, -0.15],   // Front-right (above head)
        [-0.15, 1.0, 0.15],   // Back-left (above head)
        [0.15, 1.0, 0.15]     // Back-right (above head)
    ];
    
    lightPositions.forEach((pos, index) => {
        // Create larger sphere for light
        const lightSphere = BABYLON.MeshBuilder.CreateSphere(`robotLight${index}`, {
            diameter: 0.25,  // Even larger
            segments: 16
        }, scene);
        
        // Parent to robot box
        lightSphere.parent = box;
        lightSphere.position.set(pos[0], pos[1], pos[2]);
        
        // Create highly emissive material
        const lightMat = noa.rendering.makeStandardMaterial(`robotLightMat${index}`);
        lightMat.emissiveColor = lightColors[0].scale(2); // Much brighter
        lightMat.diffuseColor = lightColors[0];
        lightMat.specularColor = new BABYLON.Color3(1, 1, 1);
        lightMat.alpha = 0.8;
        lightSphere.material = lightMat;
        
        // Add a glow sphere around each light
        const glowSphere = BABYLON.MeshBuilder.CreateSphere(`robotGlow${index}`, {
            diameter: 0.5,  // Larger glow area
            segments: 8
        }, scene);
        glowSphere.parent = box;
        glowSphere.position.set(pos[0], pos[1], pos[2]);
        glowSphere.renderingGroupId = 1;  // Render on top
        
        const glowMat = noa.rendering.makeStandardMaterial(`robotGlowMat${index}`);
        glowMat.emissiveColor = lightColors[0];
        glowMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
        glowMat.alpha = 0.3;
        glowMat.backFaceCulling = false;
        glowSphere.material = glowMat;
        
        lights.push({ 
            sphere: lightSphere, 
            material: lightMat,
            glow: glowSphere,
            glowMat: glowMat
        });
    });
    
    // Animate the lights
    let lightTime = 0;
    scene.registerBeforeRender(() => {
        lightTime += 0.08;  // Faster animation
        
        // Calculate which color to show (cycle through colors)
        const colorIndex = Math.floor(lightTime * 2) % lightColors.length;
        
        // Update all lights with flashing effect
        lights.forEach((light, index) => {
            // Add some offset so lights don't all flash in sync
            const offsetColorIndex = (colorIndex + index) % lightColors.length;
            const lightColor = lightColors[offsetColorIndex];
            
            // Strong pulse effect
            const pulse = 0.3 + 0.7 * Math.sin(lightTime * 6 + index * Math.PI / 2);
            
            // Update main light
            light.material.emissiveColor = lightColor.scale(2 + pulse);
            light.material.diffuseColor = lightColor.scale(0.5);
            
            // Update glow
            light.glowMat.emissiveColor = lightColor.scale(pulse);
            light.glowMat.alpha = 0.2 + 0.3 * pulse;
            
            // Scale the light sphere for extra effect
            const scale = 1 + 0.2 * pulse;
            light.sphere.scaling.set(scale, scale, scale);
        });
    });
    
    // Make the robot material brighter too
    faceConfigs.forEach((config, index) => {
        const mat = multiMat.subMaterials[index];
        if (mat && mat.diffuseTexture) {
            mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Increased emission
            mat.diffuseTexture.level = 1.5; // Brighten texture
        }
    });
    
    
    // Increase the player's movement speed 4x total (was 2x, now doubling again)
    const playerMovement = noa.entities.getMovement(noa.playerEntity);
    if (playerMovement) {
        playerMovement.maxSpeed *= 4; // 4x the max speed (was 2x)
        playerMovement.moveSpeed *= 4; // 4x the move speed (was 2x)
        
        // Double the jump height and gravity
        playerMovement.jumpImpulse = 36.0; // 2x higher jump (~8 blocks)
        
        // Set movement gravity (may not be used but keeping for compatibility)
        playerMovement.gravity = 160.0; // 16x the default gravity
        
        // Set gravity on physics body (this is what actually works)
        const physics = noa.entities.getPhysics(noa.playerEntity);
        if (physics && physics.body) {
            physics.body.gravityMultiplier = 16.0; // 16x gravity (doubled from 8x)
        }
        
        // Reduce air drag to maintain horizontal momentum during long jumps
        playerMovement.airDrag *= 0.5; // Half the air resistance
    }
    
    // Drone will be created after player spawn is finalized
    
    
    
    // Set up world generation with rooms and corridors
    noa.world.on('worldDataNeeded', async function (id, data, x, y, z) {
        const chunkSize = data.shape[0];
        
        // Calculate which chunk we're in
        const chunkX = Math.floor(x / chunkSize);
        const chunkZ = Math.floor(z / chunkSize);
        
        
        // Queue chunk for tokenization (non-blocking)
        // SIMPLIFIED: Only tokenize chunks on the x=0 axis (where the corridor is)
        if (localStorage.getItem('unicityRunner_privateKey') && chunkX === 0) {
            // Add to queue for async processing
            queueChunkTokenization(chunkX, chunkZ);
        }
        
        // Generate level structure for this chunk
        const levelData = generateLevelForChunk(chunkX, chunkZ, WORLD_SEED);
        const level = levelData.tiles;
        const coinPositions = levelData.coinPositions;
        const trapPositions = levelData.trapPositions || [];
        
        // Fill the chunk
        for (var i = 0; i < chunkSize; i++) {
            for (var j = 0; j < chunkSize; j++) {
                for (var k = 0; k < chunkSize; k++) {
                    const worldX = x + i;
                    const worldY = y + j;
                    const worldZ = z + k;
                    
                    let voxelID = 0;
                    
                    // Underground is empty void
                    if (worldY < 0) {
                        voxelID = 0; // Empty void below ground
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
                        } else {
                            // Everything else (including walls) is empty space
                            voxelID = 0; // Empty space - no floor outside rooms and corridors
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
                    // Handle carved sections - create holes in the corridor
                    else if (worldY === 3 && level[i][k] === 'carved') {
                        voxelID = 0; // Empty space - hole in the corridor
                    }
                    // Handle slowing floor sections
                    else if (worldY === 3 && level[i][k] === 'slowing_floor') {
                        voxelID = slowingFloorID; // Purple slowing floor
                    }
                    // Walls alongside raised north corridors at y=4 and y=5
                    else if ((worldY === 4 || worldY === 5)) {
                        // Check if we're next to a north corridor, carved section, or slowing floor
                        if (i === 13 && (level[14][k] === 'corridor_north' || level[14][k] === 'carved' || level[14][k] === 'slowing_floor')) {
                            // Don't place wall next to carved sections
                            if (level[14][k] === 'carved') {
                                voxelID = 0; // No wall next to holes
                            } else {
                                voxelID = dirtID; // West wall of north corridor (including slowing floor areas)
                            }
                        } else if (i === 17 && (level[16][k] === 'corridor_north' || level[16][k] === 'carved' || level[16][k] === 'slowing_floor')) {
                            // Don't place wall next to carved sections
                            if (level[16][k] === 'carved') {
                                voxelID = 0; // No wall next to holes
                            } else {
                                voxelID = dirtID; // East wall of north corridor (including slowing floor areas)
                            }
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
        
        // Second pass: Add stripe blocks around carved holes
        // Check north corridor level (y=3) for holes and add stripes around them
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                // Check if there's a hole (empty space) at y=3 where there should be corridor floor
                if (data.get(x, 3, z) === 0 && level[x][z] === 'carved') {
                    // Place stripe blocks around the hole at y=3
                    // Check all 4 directions
                    const directions = [
                        {dx: -1, dz: 0}, // west
                        {dx: 1, dz: 0},  // east
                        {dx: 0, dz: -1}, // north
                        {dx: 0, dz: 1}   // south
                    ];
                    
                    for (const dir of directions) {
                        const nx = x + dir.dx;
                        const nz = z + dir.dz;
                        
                        // Check bounds
                        if (nx >= 0 && nx < chunkSize && nz >= 0 && nz < chunkSize) {
                            // If adjacent position has corridor floor, replace with stripe block
                            const adjacentBlock = data.get(nx, 3, nz);
                            if (adjacentBlock === corridorNorthID || adjacentBlock === slowingFloorID) {
                                data.set(nx, 3, nz, stripeBlockID);
                            }
                        }
                    }
                }
            }
        }
        
        // Third pass: Add pillars every 128 blocks along corridors
        for (let i = 0; i < chunkSize; i++) {
            for (let k = 0; k < chunkSize; k++) {
                const worldX = x + i;
                const worldZ = z + k;
                
                // Check if this position should have a pillar (every 150 blocks)
                const shouldHavePillar = (worldZ % 150) === 0;
                
                if (shouldHavePillar) {
                    // Check for east/west corridors at ground level (y=0)
                    if (level[i][k] === 'corridor_east' || level[i][k] === 'corridor_west') {
                        // Place pillars on the sides of east/west corridors
                        // East/West corridors are 3 blocks wide, so pillars go at edges
                        
                        // For east corridor (z=12-14), place pillars at z=11 and z=15
                        if (k >= 12 && k <= 14 && level[i][k] === 'corridor_east') {
                            if (k === 12) {
                                // Place pillar to the north (z-1)
                                for (let h = 1; h <= 8; h++) {
                                    data.set(i, h, k - 1, pillarBlockID);
                                }
                            } else if (k === 14) {
                                // Place pillar to the south (z+1)
                                for (let h = 1; h <= 8; h++) {
                                    data.set(i, h, k + 1, pillarBlockID);
                                }
                            }
                        }
                        
                        // For west corridor (z=16-18), place pillars at z=15 and z=19
                        if (k >= 16 && k <= 18 && level[i][k] === 'corridor_west') {
                            if (k === 16) {
                                // Place pillar to the north (z-1)
                                for (let h = 1; h <= 8; h++) {
                                    data.set(i, h, k - 1, pillarBlockID);
                                }
                            } else if (k === 18) {
                                // Place pillar to the south (z+1)
                                for (let h = 1; h <= 8; h++) {
                                    data.set(i, h, k + 1, pillarBlockID);
                                }
                            }
                        }
                    }
                    
                    // Check for north corridor at y=3
                    if (level[i][k] === 'corridor_north') {
                        // North corridor is at x=14-16, place pillars at x=13 and x=17
                        if (i === 14) {
                            // Place pillar to the west (x-1)
                            for (let h = 4; h <= 11; h++) { // Pillars from y=4 to y=11 for raised corridor
                                data.set(i - 1, h, k, pillarBlockID);
                            }
                        } else if (i === 16) {
                            // Place pillar to the east (x+1)
                            for (let h = 4; h <= 11; h++) { // Pillars from y=4 to y=11 for raised corridor
                                data.set(i + 1, h, k, pillarBlockID);
                            }
                        }
                    }
                }
            }
        }
        
        // Fourth pass: Create banners between pillars
        // Banners span from one pillar location to the next (150 blocks)
        for (let i = 0; i < chunkSize; i++) {
            for (let k = 0; k < chunkSize; k++) {
                const worldX = x + i;
                const worldZ = z + k;
                
                // Check if this is a pillar position
                if ((worldZ % 150) === 0) {
                    // Check for corridors that should have banners
                    
                    // East/West corridors
                    if (level[i][k] === 'corridor_east' || level[i][k] === 'corridor_west') {
                        const corridorType = level[i][k] === 'corridor_east' ? 'east' : 'west';
                        const bannerKey = `${corridorType}_${worldZ}`;
                        
                        // Only create banner if it doesn't exist
                        if (!banners.has(bannerKey)) {
                            // Determine banner Y position based on corridor type
                            const bannerY = 7; // Top of 8-block pillars
                            
                            // Create banner entity at the starting position
                            const bannerEntity = noa.entities.add(
                                [worldX, bannerY, worldZ], // Will be repositioned when mesh is created
                                1, // width
                                1, // height
                                null, // mesh (will be added later)
                                [0, 0, 0], // meshOffset
                                false, // doPhysics
                                false  // shadow
                            );
                            
                            if (bannerEntity) {
                                noa.entities.addComponent(bannerEntity, 'isBanner', {
                                    startZ: worldZ,
                                    corridorType: corridorType,
                                    meshName: `banner_${bannerKey}`,
                                    needsMesh: true
                                });
                                
                                banners.set(bannerKey, bannerEntity);
                            }
                        }
                    }
                    
                    // North corridor
                    if (level[i][k] === 'corridor_north' && i === 15) { // Center of corridor
                        const bannerKey = `north_${worldZ}`;
                        
                        // Only create banner if it doesn't exist
                        if (!banners.has(bannerKey)) {
                            const bannerY = 10; // Top of raised corridor pillars
                            
                            // Create banner entity
                            const bannerEntity = noa.entities.add(
                                [worldX, bannerY, worldZ], // Will be repositioned when mesh is created
                                1, // width
                                1, // height
                                null, // mesh (will be added later)
                                [0, 0, 0], // meshOffset
                                false, // doPhysics
                                false  // shadow
                            );
                            
                            if (bannerEntity) {
                                noa.entities.addComponent(bannerEntity, 'isBanner', {
                                    startZ: worldZ,
                                    corridorType: 'north',
                                    meshName: `banner_${bannerKey}`,
                                    needsMesh: true
                                });
                                
                                banners.set(bannerKey, bannerEntity);
                            }
                        }
                    }
                }
            }
        }
        
        // Create coin entities for this chunk, checking each position
        let coinsCreated = 0;
        coinPositions.forEach(coinPos => {
            const worldX = x + coinPos.x;
            const worldZ = z + coinPos.z;
            const worldY = 4.5; // Coins float at y=4.5 in north corridors (which are at y=3)
            
            const coinKey = `${worldX},${worldZ}`; // Use only X,Z for key since Y is constant
            
            // Check if we've ever generated a coin at this position
            if (generatedCoins.has(coinKey)) {
                return; // Skip - coin was already generated here
            }
            
            // Mark this position as having a coin generated
            generatedCoins.add(coinKey);
            
            // Check if coin entity already exists at this position (shouldn't happen now)
            if (!coins.has(coinKey)) {
                coinsCreated++;
                // Create coin entity with proper parameters
                // Parameters: position, width, height, mesh, meshOffset, doPhysics, shadow
                const coinEntity = noa.entities.add(
                    [worldX + 0.5, worldY + 0.5, worldZ + 0.5], // position
                    0.5, // width
                    0.5, // height
                    null, // mesh (will be added later)
                    [0, 0, 0], // meshOffset
                    false, // doPhysics - no physics for coins
                    false  // shadow
                );
                
                // Verify entity was created
                if (!coinEntity) {
                    return;
                }
                
                // Don't create mesh immediately - will be created when coin is visible
                // Store coin data for later mesh creation
                noa.entities.addComponent(coinEntity, 'pendingMesh', {
                    meshName: 'coin_' + coinKey,
                    needsMesh: true
                });
                
                // Add custom coin component for tracking
                noa.entities.addComponent(coinEntity, 'isCoin', {
                    position: [worldX, worldY, worldZ],
                    collected: false,
                    value: 1,
                    coinKey: coinKey  // Store the key for efficient removal
                });
                
                // Track coin globally and by chunk
                coins.set(coinKey, coinEntity);
                
                // Also track by chunk for efficient processing
                const chunkKey = `${chunkX},${chunkZ}`;
                if (!coinsByChunk.has(chunkKey)) {
                    coinsByChunk.set(chunkKey, new Map());
                    
                    // Don't pre-compute neighbors - we'll do it dynamically based on corridor
                    // This allows us to only load coins in the direction we're facing
                    chunkNeighbors.set(chunkKey, new Set());
                }
                coinsByChunk.get(chunkKey).set(coinKey, coinEntity);
            }
        });
        
        // Create electric trap entities for this chunk
        if (trapPositions.length > 0) {
        }
        trapPositions.forEach(trapPos => {
            const worldX = x + trapPos.x;
            const worldZ = z + trapPos.z;
            const worldY = 4; // On top of the blue corridor floor (y=3)
            
            const trapKey = `${worldX},${worldZ}`;
            
            // Check if we've ever generated a trap at this position
            if (generatedTraps.has(trapKey)) {
                return; // Skip - trap was already generated here
            }
            
            // Mark this position as having a trap generated
            generatedTraps.add(trapKey);
            
            // Check if trap entity already exists at this position
            if (!traps.has(trapKey)) {
                // Create electric trap entity
                const trapEntity = noa.entities.add(
                    [worldX + 0.5, worldY + 0.5, worldZ + 0.5], // position (centered on block, raised for bolts)
                    0.8, // width (slightly smaller than full block)
                    2.0, // height (tall for lightning bolts)
                    null, // mesh (will be added later)
                    [0, 0, 0], // meshOffset
                    false, // doPhysics - no physics for traps
                    false  // shadow
                );
                
                // Add custom trap component for tracking
                noa.entities.addComponent(trapEntity, 'isElectricTrap', {
                    position: [worldX, worldY, worldZ],
                    trapKey: trapKey
                });
                
                // Create mesh data for lazy loading
                noa.entities.addComponent(trapEntity, 'pendingTrapMesh', {
                    meshName: 'trap_' + trapKey,
                    needsMesh: true
                });
                
                // Track trap globally
                traps.set(trapKey, trapEntity);
            }
        });
        
        // Check for backpacks that should be spawned in this chunk
        const backpacksToSpawn = [];
        backpackData.forEach((data, backpackKey) => {
            const [backpackX, backpackZ] = backpackKey.split(',').map(Number);
            const backpackChunkX = Math.floor(backpackX / 32);
            const backpackChunkZ = Math.floor(backpackZ / 32);
            
            if (backpackChunkX === chunkX && backpackChunkZ === chunkZ) {
                // This backpack belongs in this chunk
                if (!backpacks.has(backpackKey)) {
                    // Backpack entity doesn't exist, create it
                    backpacksToSpawn.push({ key: backpackKey, data: data });
                }
            }
        });
        
        // Spawn backpacks after chunk is set
        backpacksToSpawn.forEach(({ key, data }) => {
            console.log(`Recreating backpack at ${key} in newly loaded chunk`);
            
            // Create backpack entity without physics
            const backpackEntity = noa.entities.add(
                data.position,
                1.0, // width
                1.2, // height
                null, // mesh will be added later
                [0, 0, 0], // meshOffset
                false, // no physics
                false  // shadow
            );
            
            if (backpackEntity) {
                // Create mesh immediately
                const backpackInstance = backpackMesh.createInstance('backpack_recreated_' + key);
                backpackInstance.setEnabled(true);
                noa.entities.addComponent(backpackEntity, noa.entities.names.mesh, {
                    mesh: backpackInstance,
                    offset: [0, 0.6, 0]
                });
                
                // Add backpack component with inventory
                noa.entities.addComponent(backpackEntity, 'isBackpack', {
                    position: data.position,
                    lostCoins: data.lostCoins,
                    backpackKey: key,
                    inventory: data.inventory || null
                });
                
                // Track the entity
                backpacks.set(key, backpackEntity);
            }
        });
        
        // tell noa the chunk's terrain data is now set
        noa.world.setChunkData(id, data);
    });
    
    // Animate flying coins - MUST be outside worldDataNeeded to avoid duplicate listeners!
    noa.on('tick', function(dt) {
        const currentTime = Date.now();
        const coinsToRemove = [];
        
        // No death screen timer needed anymore - handled by token creation
        
        flyingCoins.forEach((flyData, coinEntity) => {
            const elapsed = (currentTime - flyData.startTime) / 1000; // seconds
            const flySpeed = 15; // blocks per second
            const newY = flyData.startY + (flySpeed * elapsed);
            
            if (newY >= 25) {
                // Reached max height, remove coin
                // Dispose of the mesh first
                const meshData = noa.entities.getMeshData(coinEntity);
                if (meshData && meshData.mesh) {
                    meshData.mesh.dispose();
                }
                noa.ents.deleteEntity(coinEntity);
                coinsToRemove.push(coinEntity);
            } else {
                // Update position
                const pos = noa.entities.getPosition(coinEntity);
                noa.entities.setPosition(coinEntity, pos[0], newY, pos[2]);
                
                // Make coin spin faster as it flies up
                const meshData = noa.entities.getMeshData(coinEntity);
                if (meshData && meshData.mesh) {
                    meshData.mesh.rotation.y += 0.3;
                }
            }
        });
        
        // Clean up completed animations
        coinsToRemove.forEach(entity => flyingCoins.delete(entity));
        
        // Update backpack positions and animation
        backpacks.forEach((backpackEntity, backpackKey) => {
            if (!noa.entities.hasComponent(backpackEntity, noa.entities.names.position)) {
                // Backpack entity was deleted, remove from tracking
                backpacks.delete(backpackKey);
                return;
            }
            
            // Animate backpack - rotate and bob up/down
            const meshData = noa.entities.getMeshData(backpackEntity);
            if (meshData && meshData.mesh) {
                // Rotate slowly
                meshData.mesh.rotation.y += 0.02;
                
                // Bob up and down
                const time = Date.now() * 0.001;
                const bobAmount = Math.sin(time * 2) * 0.1;
                meshData.mesh.position.y = bobAmount;
                
                // Pulse the glow
                const pulse = (Math.sin(time * 3) + 1) * 0.25 + 0.3; // Between 0.3 and 0.8
                meshData.mesh.material.emissiveColor.r = pulse * 0.8;
                meshData.mesh.material.emissiveColor.g = pulse * 0.6;
                meshData.mesh.material.emissiveColor.b = pulse * 0.2;
            }
        });
    });
    
    // Handle chunk unloading - clean up coins when chunks are removed
    noa.world.on('chunkBeingRemoved', function(id, data, x, y, z) {
        const chunkX = Math.floor(x / 32);
        const chunkZ = Math.floor(z / 32);
        const chunkKey = `${chunkX},${chunkZ}`;
        
        // Remove all coins from this chunk
        const chunkCoins = coinsByChunk.get(chunkKey);
        if (chunkCoins) {
            console.log(`Removing ${chunkCoins.size} coins from chunk (${chunkX}, ${chunkZ})`);
            chunkCoins.forEach((entity, coinKey) => {
                // Remove entity if it exists
                if (noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                    // Dispose of the Babylon.js mesh instance first
                    const meshData = noa.entities.getMeshData(entity);
                    if (meshData && meshData.mesh) {
                        meshData.mesh.dispose();
                    }
                    noa.ents.deleteEntity(entity);
                }
                // Remove from global tracking
                coins.delete(coinKey);
            });
            // Remove chunk from tracking
            coinsByChunk.delete(chunkKey);
            chunkNeighbors.delete(chunkKey);
            // Note: We intentionally don't remove coins from generatedCoins Set
            // This ensures coins are never duplicated even if chunks are reloaded
        }
        
        // Remove all traps from this chunk
        const trapsToRemove = [];
        traps.forEach((entity, trapKey) => {
            const [trapX, trapZ] = trapKey.split(',').map(Number);
            const trapChunkX = Math.floor(trapX / 32);
            const trapChunkZ = Math.floor(trapZ / 32);
            
            if (trapChunkX === chunkX && trapChunkZ === chunkZ) {
                // Remove entity if it exists
                if (noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                    // Dispose of the Babylon.js mesh instance first
                    const meshData = noa.entities.getMeshData(entity);
                    if (meshData && meshData.mesh) {
                        meshData.mesh.dispose();
                    }
                    noa.ents.deleteEntity(entity);
                }
                trapsToRemove.push(trapKey);
            }
        });
        
        // Remove traps from tracking
        trapsToRemove.forEach(key => traps.delete(key));
        // Note: We don't remove from generatedTraps to prevent duplication
        
        // Remove all backpacks from this chunk
        const backpacksToRemove = [];
        backpacks.forEach((entity, backpackKey) => {
            const [backpackX, backpackZ] = backpackKey.split(',').map(Number);
            const backpackChunkX = Math.floor(backpackX / 32);
            const backpackChunkZ = Math.floor(backpackZ / 32);
            
            if (backpackChunkX === chunkX && backpackChunkZ === chunkZ) {
                // Remove entity if it exists
                if (noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                    // Dispose of the Babylon.js mesh instance first
                    const meshData = noa.entities.getMeshData(entity);
                    if (meshData && meshData.mesh) {
                        meshData.mesh.dispose();
                    }
                    noa.ents.deleteEntity(entity);
                }
                backpacksToRemove.push(backpackKey);
            }
        });
        
        // Remove backpacks from entity tracking only (keep persistent data)
        backpacksToRemove.forEach(key => {
            backpacks.delete(key);
            // Note: We intentionally keep backpackData so backpacks can be recreated
        });
    });
    
    
    // Register coin component
    noa.ents.createComponent({
        name: 'isCoin',
        state: {
            position: null,
            collected: false,
            value: 1
        }
    });
    
    // Register pending mesh component for lazy mesh creation
    noa.ents.createComponent({
        name: 'pendingMesh',
        state: {
            meshName: '',
            needsMesh: true
        }
    });
    
    // Register electric trap component
    noa.ents.createComponent({
        name: 'isElectricTrap',
        state: {
            position: null,
            trapKey: null
        }
    });
    
    // Register pending trap mesh component
    noa.ents.createComponent({
        name: 'pendingTrapMesh',
        state: {
            meshName: '',
            needsMesh: true
        }
    });
    
    // Register banner component
    noa.ents.createComponent({
        name: 'isBanner',
        state: {
            startZ: 0,
            corridorType: '', // 'north', 'east', or 'west'
            meshName: '',
            needsMesh: true
        }
    });
    
    // Register backpack component
    noa.ents.createComponent({
        name: 'isBackpack',
        state: {
            position: null,
            lostCoins: 0,
            backpackKey: null
        }
    });
    
    // Create coin mesh with lower tessellation for better performance
    const coinMesh = BABYLON.MeshBuilder.CreateCylinder('coin', {
        diameter: 0.5,
        height: 0.1,
        tessellation: 8 // Reduced from 16 for better performance
    }, noa.rendering.getScene());
    
    // Golden coin material - simplified for performance
    const coinMaterial = new BABYLON.StandardMaterial('coinMaterial', noa.rendering.getScene());
    coinMaterial.diffuseColor = new BABYLON.Color3(1, 0.84, 0); // Gold color
    coinMaterial.specularColor = new BABYLON.Color3(0, 0, 0); // Disable specular for performance
    coinMaterial.emissiveColor = new BABYLON.Color3(0.4, 0.35, 0); // Slightly brighter emissive instead
    coinMaterial.freeze(); // Freeze material to improve performance
    coinMesh.material = coinMaterial;
    
    // Hide the original mesh
    coinMesh.setEnabled(false);
    
    // Create electric trap mesh - multiple vertical lightning bolts
    // Use existing scene variable from above
    
    // Create a group of vertical planes for lightning effect
    const boltMeshes = [];
    const boltCount = 4; // 4 bolts arranged in cross pattern
    
    for (let i = 0; i < boltCount; i++) {
        const angle = (i / boltCount) * Math.PI * 2;
        const boltPlane = BABYLON.MeshBuilder.CreatePlane(`bolt_${i}`, {
            width: 0.6,
            height: 2.0, // Tall vertical bolts
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);
        
        // Position and rotate each bolt
        boltPlane.position.x = Math.cos(angle) * 0.1;
        boltPlane.position.z = Math.sin(angle) * 0.1;
        boltPlane.position.y = 1.0; // Center vertically
        boltPlane.rotation.y = angle;
        
        boltMeshes.push(boltPlane);
    }
    
    // Merge all bolts into single mesh for performance
    const trapMesh = BABYLON.Mesh.MergeMeshes(boltMeshes, true, true, undefined, false, true);
    trapMesh.name = 'electricTrap';
    
    // Electric trap material - glowing lightning effect
    const trapMaterial = new BABYLON.StandardMaterial('trapMaterial', scene);
    trapMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.9, 1.0); // Light blue-white
    trapMaterial.emissiveColor = new BABYLON.Color3(0.3, 0.6, 1.0); // Electric blue glow
    trapMaterial.specularColor = new BABYLON.Color3(1.0, 1.0, 1.0); // White specular
    trapMaterial.alpha = 0.9; // Slightly transparent
    trapMaterial.backFaceCulling = false; // Show both sides
    trapMaterial.freeze(); // Freeze material to improve performance
    trapMesh.material = trapMaterial;
    
    // Hide the original trap mesh
    trapMesh.setEnabled(false);
    
    // Create backpack mesh - a larger box for better visibility
    backpackMesh = BABYLON.MeshBuilder.CreateBox('backpack', {
        width: 1.0,  // Increased from 0.7
        height: 1.2, // Increased from 0.8
        depth: 0.8   // Increased from 0.5
    }, noa.rendering.getScene());
    
    // Backpack material - glowing golden appearance for visibility
    const backpackMaterial = new BABYLON.StandardMaterial('backpackMaterial', noa.rendering.getScene());
    backpackMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.2); // Golden brown color
    backpackMaterial.specularColor = new BABYLON.Color3(0.8, 0.7, 0.3); // Golden shine
    backpackMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.4, 0.1); // Strong golden glow
    backpackMaterial.freeze(); // Freeze material to improve performance
    backpackMesh.material = backpackMaterial;
    
    // Hide the original backpack mesh
    backpackMesh.setEnabled(false);
    
    // Track coins that are flying up after collection
    const flyingCoins = new Map(); // key: entity, value: { startY, startTime }
    
    // Coin collection check - optimized with spatial indexing
    const nearbyCoins = new Set(); // Track only nearby coins
    let lastPlayerChunkX = null;
    let lastPlayerChunkZ = null;
    let collectionCheckCount = 0;
    
    // Add memory tracking
    let memoryStats = {
        startTime: Date.now(),
        initialCoinsSize: 0,
        initialCoinsByChunkSize: 0,
        totalCoinsInChunks: 0,
        totalEntities: 0,
        initialized: false
    };
    
    // Optimized coin collection - only check current and north chunks
    setInterval(() => {
        if (!noa || !noa.playerEntity) return;
        
        const startTime = performance.now();
        collectionCheckCount++;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const playerChunkX = Math.floor(playerPos[0] / 32);
        const playerChunkZ = Math.floor(playerPos[2] / 32);
        
        // Rebuild nearby coins list if player moved to new chunk
        if (playerChunkX !== lastPlayerChunkX || playerChunkZ !== lastPlayerChunkZ) {
            lastPlayerChunkX = playerChunkX;
            lastPlayerChunkZ = playerChunkZ;
            
            nearbyCoins.clear();
            
            // Use pre-computed neighbors for current chunk
            const currentChunkKey = `${playerChunkX},${playerChunkZ}`;
            
            // Add coins from current chunk
            const currentChunkCoins = coinsByChunk.get(currentChunkKey);
            if (currentChunkCoins) {
                currentChunkCoins.forEach((entity) => {
                    nearbyCoins.add(entity);
                });
            }
            
            // Add coins from 4 chunks to the north for much better visibility
            for (let northOffset = 1; northOffset <= 4; northOffset++) {
                const northChunkKey = `${playerChunkX},${playerChunkZ - northOffset}`;
                const northChunkCoins = coinsByChunk.get(northChunkKey);
                if (northChunkCoins) {
                    northChunkCoins.forEach((entity) => {
                        nearbyCoins.add(entity);
                    });
                }
            }
        }
        
        // Get player movement direction
        const movement = noa.entities.getMovement(noa.playerEntity);
        const heading = movement ? movement.heading : 0;
        const forwardX = Math.sin(heading);
        const forwardZ = Math.cos(heading);
        
        // Only check nearby coins
        let coinsProcessed = 0;
        let getPositionTime = 0;
        
        // Convert to array to avoid iterator invalidation when deleting
        const nearbyCoinsArray = Array.from(nearbyCoins);
        for (let i = 0; i < nearbyCoinsArray.length; i++) {
            const coinEntity = nearbyCoinsArray[i];
            
            // Skip if already flying (don't even count as processed)
            if (flyingCoins.has(coinEntity)) {
                // Remove flying coins from nearbyCoins to prevent repeated checks
                nearbyCoins.delete(coinEntity);
                continue;
            }
            
            coinsProcessed++;
            
            // Check if entity still exists
            if (!noa.entities.hasComponent(coinEntity, noa.entities.names.position)) {
                // Dead entity - remove it
                nearbyCoins.delete(coinEntity);
                continue;
            }
            
            const posStart = performance.now();
            const coinPos = noa.entities.getPosition(coinEntity);
            getPositionTime += performance.now() - posStart;
            
            // Calculate distance between player and coin
            const dx = coinPos[0] - playerPos[0];
            const dy = coinPos[1] - playerPos[1];
            const dz = coinPos[2] - playerPos[2];
            
            // Skip far coins for performance
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8 || Math.abs(dz) > 8) continue;
            
            // Project coin offset onto forward direction
            const forwardDistance = dx * forwardX + dz * forwardZ;
            
            // Calculate perpendicular (side) distance
            const sideX = dx - forwardDistance * forwardX;
            const sideZ = dz - forwardDistance * forwardZ;
            const sideDistanceSq = sideX * sideX + sideZ * sideZ;
            
            // Narrow but long hitbox (front only):
            // - Forward: 0.0 to +2.5 blocks (only in front)
            // - Side-to-side: 0.5 block radius
            // - Vertical: 1.5 blocks
            if (forwardDistance >= 0.0 && forwardDistance <= 2.5 && 
                sideDistanceSq < 0.25 && // 0.5 * 0.5
                Math.abs(dy) < 1.5) {
                
                const coinData = noa.entities.getState(coinEntity, 'isCoin');
                
                if (coinData && !coinData.collected) {
                    // Mark as collected
                    coinData.collected = true;
                    
                    // Add to player balance
                    playerCoins += coinData.value;
                    
                    // Update display
                    updateCoinDisplay();
                    
                    // Mint URC token for this coin (with small delay to batch multiple coins)
                    setTimeout(() => mintURCToken(coinData.value), 100);
                    
                    // Start fly-up animation
                    flyingCoins.set(coinEntity, {
                        startY: coinPos[1],
                        startTime: Date.now()
                    });
                    
                    // Remove from tracking efficiently using stored key
                    const storedKey = coinData.coinKey;
                    if (storedKey) {
                        coins.delete(storedKey);
                        
                        // CRITICAL: Remove from nearbyCoins immediately
                        nearbyCoins.delete(coinEntity);
                        
                        // Also remove from chunk tracking
                        const [x, z] = storedKey.split(',').map(Number);
                        const chunkX = Math.floor(x / 32);
                        const chunkZ = Math.floor(z / 32);
                        const chunkKey = `${chunkX},${chunkZ}`;
                        const chunkCoins = coinsByChunk.get(chunkKey);
                        if (chunkCoins) {
                            chunkCoins.delete(storedKey);
                        }
                    }
                }
            }
        }
        
    }, 50); // Check every 50ms (doubled frequency for faster player)
    
    // Backpack collection check
    setInterval(() => {
        if (!noa || !noa.playerEntity || isPlayerDead) return;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        
        // Check all backpacks for collection
        const backpacksToRemove = [];
        backpacks.forEach((backpackEntity, backpackKey) => {
            // Check if entity still exists
            if (!noa.entities.hasComponent(backpackEntity, noa.entities.names.position)) {
                backpacksToRemove.push(backpackKey);
                return;
            }
            
            const backpackPos = noa.entities.getPosition(backpackEntity);
            
            // Calculate distance between player and backpack
            const dx = backpackPos[0] - playerPos[0];
            const dy = backpackPos[1] - playerPos[1];
            const dz = backpackPos[2] - playerPos[2];
            
            // Check if player is close enough (within 2 blocks for larger backpack)
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < 4.0) { // 2.0 * 2.0
                // Collect backpack
                const backpackData = noa.entities.getState(backpackEntity, 'isBackpack');
                if (backpackData && backpackData.inventory) {
                    // Restore full inventory from backpack
                    const inv = backpackData.inventory;
                    
                    // Restore balances
                    confirmedURCBalance += inv.confirmedBalance || 0;
                    pendingURCBalance += inv.pendingBalance || 0;
                    playerCoins += inv.totalCoins || 0;
                    
                    // Restore minted tokens to inventory
                    if (inv.mintedTokens && inv.mintedTokens.length > 0) {
                        let currentInventory = { tokens: [], confirmedBalance: 0 };
                        const stored = localStorage.getItem('unicityRunner_urcInventory');
                        if (stored) {
                            currentInventory = JSON.parse(stored);
                        }
                        
                        // Add tokens from backpack
                        currentInventory.tokens.push(...inv.mintedTokens);
                        currentInventory.confirmedBalance = currentInventory.tokens.reduce((sum, t) => sum + t.amount, 0);
                        localStorage.setItem('unicityRunner_urcInventory', JSON.stringify(currentInventory));
                    }
                    
                    // Restore pending mints
                    if (inv.pendingMints && inv.pendingMints.length > 0) {
                        let currentPending = { mints: [], totalAmount: 0 };
                        const stored = localStorage.getItem('unicityRunner_pendingURCMints');
                        if (stored) {
                            currentPending = JSON.parse(stored);
                        }
                        
                        // Add pending mints from backpack
                        currentPending.mints.push(...inv.pendingMints);
                        currentPending.totalAmount = currentPending.mints.reduce((sum, m) => sum + m.amount, 0);
                        localStorage.setItem('unicityRunner_pendingURCMints', JSON.stringify(currentPending));
                        
                        // Resume pending mints
                        inv.pendingMints.forEach(mint => {
                            completeURCMint(mint).catch(err => {
                                console.error('Failed to resume pending URC mint from backpack:', err);
                            });
                        });
                    }
                    
                    updateCoinDisplay();
                    
                    console.log(`Collected backpack with full inventory: ${inv.confirmedBalance} confirmed, ${inv.pendingBalance} pending, ${inv.mintedTokens.length} tokens, ${inv.pendingMints.length} pending mints`);
                } else if (backpackData) {
                    // Legacy backpack without inventory - just restore coins as pending
                    pendingURCBalance += backpackData.lostCoins;
                    playerCoins += backpackData.lostCoins;
                    updateCoinDisplay();
                    console.log(`Collected legacy backpack with ${backpackData.lostCoins} URC!`);
                }
                
                // Remove backpack mesh and entity (for both new and legacy backpacks)
                try {
                    const meshData = noa.entities.getMeshData(backpackEntity);
                    if (meshData && meshData.mesh) {
                        meshData.mesh.dispose();
                    }
                    noa.entities.deleteEntity(backpackEntity);
                } catch (e) {
                    console.error('Error deleting backpack entity:', e);
                }
                
                backpacksToRemove.push(backpackKey);
            }
        });
        
        // Clean up collected backpacks from tracking
        backpacksToRemove.forEach(key => {
            backpacks.delete(key);
            backpackData.delete(key); // Remove from persistent data
            console.log(`Removed backpack ${key} from tracking`);
        });
    }, 100); // Check every 100ms
    
    // Update total distance traveled periodically
    setInterval(() => {
        if (!noa || !noa.playerEntity || isPlayerDead || playerStartZ === null) return;
        
        const currentPos = noa.entities.getPosition(noa.playerEntity);
        totalDistanceTraveled = Math.abs(currentPos[2] - playerStartZ);
        
        // Update distance display
        const distanceValue = document.querySelector('#distanceDisplay .distance-value');
        if (distanceValue) {
            distanceValue.textContent = `${Math.floor(totalDistanceTraveled)} blocks`;
        }
    }, 100); // Update 10 times per second
    
    // Track previous player position for path-based collision detection
    let previousPlayerPosition = null;
    
    // Electric trap collision detection with path checking
    setInterval(() => {
        if (!noa || !noa.playerEntity || isPlayerDead) return;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const playerFeetY = playerPos[1] - 0.8; // Player center is ~0.8 above feet when running
        
        // Get player physics to check if grounded
        const physics = noa.entities.getPhysics(noa.playerEntity);
        const movement = noa.entities.getMovement(noa.playerEntity);
        
        // Check if player is on ground (not jumping)
        // Player is considered grounded if:
        // 1. Y velocity is very small (not moving up/down significantly)
        // 2. Player is at or very close to floor level (y ~= 3)
        const isGrounded = physics && physics.body && 
                          Math.abs(physics.body.velocity[1]) < 0.1 && 
                          Math.abs(physics.body.velocity[1]) < 0.5 && 
                          playerPos[1] < 4.2; // Player is below trap height when running
        
        // If we have a previous position and player is grounded, check the path between positions
        if (previousPlayerPosition && isGrounded) {
            const steps = 10; // Number of intermediate points to check
            
            for (let step = 0; step <= steps; step++) {
                // Interpolate position along the path
                const t = step / steps;
                const checkX = previousPlayerPosition[0] + (playerPos[0] - previousPlayerPosition[0]) * t;
                const checkY = previousPlayerPosition[1] + (playerPos[1] - previousPlayerPosition[1]) * t;
                const checkZ = previousPlayerPosition[2] + (playerPos[2] - previousPlayerPosition[2]) * t;
                const checkFeetY = checkY - 0.8;
                
                // Check each trap for collision at this interpolated position
                for (const [trapKey, trapEntity] of traps) {
                    if (!noa.entities.hasComponent(trapEntity, noa.entities.names.position)) continue;
                    
                    const trapPos = noa.entities.getPosition(trapEntity);
                    
                    // Check if player path crosses the trap
                    const dx = Math.abs(checkX - trapPos[0]);
                    const dy = Math.abs(checkFeetY - trapPos[1]);
                    const dz = Math.abs(checkZ - trapPos[2]);
                    
                    // Check collision - trap is 0.8 wide, at y=4
                    // Player runs at ~y=3.8 (feet at y=3, center ~0.8 above)
                    // Use tighter collision bounds for more precise detection
                    if (dx < 0.65 && Math.abs(checkFeetY - 3) < 0.5 && dz < 0.65) {
                        // Player path crossed electric trap - instant death!
                        console.log(`Trap collision detected via path checking at interpolated position (${checkX.toFixed(2)}, ${checkY.toFixed(2)}, ${checkZ.toFixed(2)})`);
                        handlePlayerDeath('Electrocuted');
                        previousPlayerPosition = null; // Reset to prevent multiple deaths
                        return; // Exit function after death
                    }
                }
            }
        }
        
        // Also check current position (for cases where player spawns on trap or stands still)
        if (isGrounded) {
            for (const [trapKey, trapEntity] of traps) {
                if (!noa.entities.hasComponent(trapEntity, noa.entities.names.position)) continue;
                
                const trapPos = noa.entities.getPosition(trapEntity);
                
                // Check if player is above the trap
                const dx = Math.abs(playerPos[0] - trapPos[0]);
                const dy = Math.abs(playerFeetY - trapPos[1]);
                const dz = Math.abs(playerPos[2] - trapPos[2]);
                
                // Check collision - more precise bounds
                // Trap is at y=4, player feet should be at y=3 when running
                if (dx < 0.65 && Math.abs(playerFeetY - 3) < 0.5 && dz < 0.65) {
                    // Player on electric trap - instant death!
                    console.log(`Trap collision detected at current position (${playerPos[0].toFixed(2)}, ${playerPos[1].toFixed(2)}, ${playerPos[2].toFixed(2)})`);
                    handlePlayerDeath('Electrocuted');
                    previousPlayerPosition = null; // Reset to prevent multiple deaths
                    return; // Exit function after death
                }
            }
        }
        
        // Update previous position for next check
        previousPlayerPosition = [playerPos[0], playerPos[1], playerPos[2]];
    }, 25); // Check 40 times per second (doubled frequency for faster player)
    
    // Moved outside of worldDataNeeded - see line after world generation setup
    
    // Cleanup non-existent coins periodically - only check nearby chunks
    // DISABLED: This might be causing performance issues
    /*setInterval(() => {
        if (!noa || !noa.playerEntity) return;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const playerChunkX = Math.floor(playerPos[0] / 32);
        const playerChunkZ = Math.floor(playerPos[2] / 32);
        
        // Only clean up coins in chunks within 2 chunks of player
        const toDelete = [];
        coinsByChunk.forEach((chunkCoins, chunkKey) => {
            const [chunkX, chunkZ] = chunkKey.split(',').map(Number);
            const dx = Math.abs(chunkX - playerChunkX);
            const dz = Math.abs(chunkZ - playerChunkZ);
            
            // Only process nearby chunks
            if (dx <= 2 && dz <= 2) {
                chunkCoins.forEach((entity, coinKey) => {
                    if (!noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                        toDelete.push({ coinKey, chunkKey });
                    }
                });
            }
        });
        
        toDelete.forEach(({ coinKey, chunkKey }) => {
            coins.delete(coinKey);
            const chunkCoins = coinsByChunk.get(chunkKey);
            if (chunkCoins) {
                chunkCoins.delete(coinKey);
                // Clean up empty chunk entries
                if (chunkCoins.size === 0) {
                    coinsByChunk.delete(chunkKey);
                }
            }
        });
    }, 5000); // Every 5 seconds*/
    
    // Update coin visibility based on distance and frustum
    const maxRenderDistance = 288; // 9 chunks ahead for fast movement (9 * 32 = 288 blocks)
    const maxRenderDistanceSq = maxRenderDistance * maxRenderDistance;
    let visibilityUpdateCounter = 0;
    let lastPlayerChunkKey = null;
    let currentVisibleCoins = new Set();
    
    // Update visibility more frequently - every 10 frames (6 times per second at 60fps)
    noa.on('beforeRender', function() {
        visibilityUpdateCounter++;
        if (visibilityUpdateCounter % 10 !== 0) return; // Run every 10th frame
        
        if (!noa.playerEntity) return;
        
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const playerChunkX = Math.floor(playerPos[0] / 32);
        const playerChunkZ = Math.floor(playerPos[2] / 32);
        const playerChunkKey = `${playerChunkX},${playerChunkZ}`;
        
        // Only rebuild visible coins list if player moved to a new chunk
        if (playerChunkKey !== lastPlayerChunkKey) {
            lastPlayerChunkKey = playerChunkKey;
            
            // Hide all currently visible coins
            currentVisibleCoins.forEach(entity => {
                if (noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                    const meshData = noa.entities.getMeshData(entity);
                    if (meshData && meshData.mesh) {
                        meshData.mesh.setEnabled(false);
                    }
                }
            });
            
            // Clear and rebuild visible coins set
            currentVisibleCoins.clear();
            
            // Add coins from current chunk
            const currentChunkCoins = coinsByChunk.get(playerChunkKey);
            if (currentChunkCoins) {
                currentChunkCoins.forEach((entity, coinKey) => {
                    // Check if entity actually exists
                    if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                        currentVisibleCoins.add(entity);
                    }
                });
            }
            
            // Determine movement direction based on corridor type
            const blockBelow = noa.world.getBlockID(
                Math.floor(playerPos[0]), 
                Math.floor(playerPos[1] - 1), 
                Math.floor(playerPos[2])
            );
            
            // Add coins from neighbor chunks based on corridor direction
            if (blockBelow === corridorNorthID) {
                // Blue corridor - load coins 9 chunks north, none to sides
                let foundCoinsInChunks = 0;
                for (let dz = 1; dz <= 9; dz++) {
                    const northChunkKey = `${playerChunkX},${playerChunkZ + dz}`;
                    const northChunkCoins = coinsByChunk.get(northChunkKey);
                    if (northChunkCoins && northChunkCoins.size > 0) {
                        foundCoinsInChunks++;
                        northChunkCoins.forEach((entity, coinKey) => {
                            if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                                currentVisibleCoins.add(entity);
                            }
                        });
                    }
                }
            } else if (blockBelow === corridorEastID) {
                // Red corridor - load coins 9 chunks east
                for (let dx = 1; dx <= 9; dx++) {
                    const eastChunkKey = `${playerChunkX + dx},${playerChunkZ}`;
                    const eastChunkCoins = coinsByChunk.get(eastChunkKey);
                    if (eastChunkCoins) {
                        eastChunkCoins.forEach((entity, coinKey) => {
                            if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                                currentVisibleCoins.add(entity);
                            }
                        });
                    }
                }
            } else if (blockBelow === corridorWestID) {
                // Yellow corridor - load coins 9 chunks west
                for (let dx = 1; dx <= 9; dx++) {
                    const westChunkKey = `${playerChunkX - dx},${playerChunkZ}`;
                    const westChunkCoins = coinsByChunk.get(westChunkKey);
                    if (westChunkCoins) {
                        westChunkCoins.forEach((entity, coinKey) => {
                            if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                                currentVisibleCoins.add(entity);
                            }
                        });
                    }
                }
            } else {
                // In room or other - load coins in all directions (3x3 area)
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const neighborKey = `${playerChunkX + dx},${playerChunkZ + dz}`;
                        const neighborCoins = coinsByChunk.get(neighborKey);
                        if (neighborCoins) {
                            neighborCoins.forEach((entity, coinKey) => {
                                if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                                    currentVisibleCoins.add(entity);
                                }
                            });
                        }
                    }
                }
            }
        }
        
        // Update visibility only for coins in visible set
        const camera = noa.rendering.camera;
        
        
        // Track processing time
        let processedCount = 0;
        let skippedCount = 0;
        let renderedCount = 0;
        let tooFarCount = 0;
        const visStartTime = performance.now();
        
        currentVisibleCoins.forEach(entity => {
            // Check if entity needs a mesh created
            if (noa.entities.hasComponent(entity, 'pendingMesh')) {
                const pendingData = noa.entities.getState(entity, 'pendingMesh');
                if (pendingData.needsMesh) {
                    // Create mesh on demand
                    const coinInstance = coinMesh.createInstance(pendingData.meshName);
                    coinInstance.rotation.z = Math.PI / 2;
                    coinInstance.rotation.y = Math.PI / 2;
                    coinInstance.setEnabled(true);
                    noa.entities.addComponent(entity, noa.entities.names.mesh, {
                        mesh: coinInstance,
                        offset: [0, 0.25, 0]
                    });
                    // Remove pending mesh component
                    noa.entities.removeComponent(entity, 'pendingMesh');
                }
            }
            
            if (!noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                skippedCount++;
                return;
            }
            processedCount++;
            
            const coinPos = noa.entities.getPosition(entity);
            const meshData = noa.entities.getMeshData(entity);
            
            if (meshData && meshData.mesh) {
                // Calculate distance to player
                const dx = coinPos[0] - playerPos[0];
                const dz = coinPos[2] - playerPos[2];
                const distanceSq = dx * dx + dz * dz;
                
                // Simple distance check (no Y component for performance)
                if (distanceSq <= maxRenderDistanceSq) {
                    // Always show coins within 20 blocks, otherwise check frustum
                    if (distanceSq <= 400) { // 20*20 = 400
                        meshData.mesh.setEnabled(true);
                        renderedCount++;
                    } else {
                        // Check if in camera frustum with some leniency
                        const inFrustum = camera.isInFrustum(meshData.mesh);
                        meshData.mesh.setEnabled(inFrustum);
                        if (inFrustum) renderedCount++;
                    }
                } else {
                    meshData.mesh.setEnabled(false);
                    tooFarCount++;
                }
            }
        });
        
        if (visibilityUpdateCounter % 60 === 0) { // Log every second
            console.log(`Coins - Visible set: ${currentVisibleCoins.size}, Processed: ${processedCount}, Rendered: ${renderedCount}, Too far: ${tooFarCount}, Skipped: ${skippedCount}`);
        }
        
        // Handle backpack visibility
        let backpackCount = 0;
        let backpacksVisible = 0;
        backpacks.forEach((backpackEntity, backpackKey) => {
            backpackCount++;
            if (noa.entities.hasComponent(backpackEntity, noa.entities.names.mesh)) {
                const backpackPos = noa.entities.getPosition(backpackEntity);
                const meshData = noa.entities.getMeshData(backpackEntity);
                
                if (meshData && meshData.mesh) {
                    // Calculate distance to player
                    const dx = backpackPos[0] - playerPos[0];
                    const dz = backpackPos[2] - playerPos[2];
                    const distanceSq = dx * dx + dz * dz;
                    const distance = Math.sqrt(distanceSq);
                    
                    // Simple distance check
                    const isVisible = distanceSq <= maxRenderDistanceSq;
                    meshData.mesh.setEnabled(isVisible);
                    
                    if (isVisible) {
                        backpacksVisible++;
                    }
                    
                    // Log backpack positions periodically
                    if (visibilityUpdateCounter % 60 === 0) {
                        console.log(`Backpack at ${backpackKey}: distance=${distance.toFixed(1)}, visible=${isVisible}, pos=${backpackPos}`);
                    }
                }
            }
        });
        
        if (visibilityUpdateCounter % 60 === 0 && backpackCount > 0) {
            console.log(`Backpacks - Total: ${backpackCount}, Visible: ${backpacksVisible}`);
        }
        
        // Handle electric trap visibility
        traps.forEach((trapEntity, trapKey) => {
            // Check if entity needs a mesh created
            if (noa.entities.hasComponent(trapEntity, 'pendingTrapMesh')) {
                const pendingData = noa.entities.getState(trapEntity, 'pendingTrapMesh');
                if (pendingData.needsMesh) {
                    // Check distance to player before creating mesh
                    const trapPos = noa.entities.getPosition(trapEntity);
                    const dx = trapPos[0] - playerPos[0];
                    const dz = trapPos[2] - playerPos[2];
                    const distanceSq = dx * dx + dz * dz;
                    
                    // Only create mesh if within reasonable distance
                    if (distanceSq <= maxRenderDistanceSq) {
                        // Create mesh on demand
                        const trapInstance = trapMesh.createInstance(pendingData.meshName);
                        trapInstance.setEnabled(true);
                        noa.entities.addComponent(trapEntity, noa.entities.names.mesh, {
                            mesh: trapInstance,
                            offset: [0, 0, 0]
                        });
                        // Remove pending mesh component
                        noa.entities.removeComponent(trapEntity, 'pendingTrapMesh');
                    }
                }
            }
            
            // Update visibility for traps with meshes
            if (noa.entities.hasComponent(trapEntity, noa.entities.names.mesh)) {
                const trapPos = noa.entities.getPosition(trapEntity);
                const meshData = noa.entities.getMeshData(trapEntity);
                
                if (meshData && meshData.mesh) {
                    // Calculate distance to player
                    const dx = trapPos[0] - playerPos[0];
                    const dz = trapPos[2] - playerPos[2];
                    const distanceSq = dx * dx + dz * dz;
                    
                    // Simple distance check
                    meshData.mesh.setEnabled(distanceSq <= maxRenderDistanceSq);
                    
                    // Animate trap with electric bolt effects
                    const time = Date.now() * 0.001;
                    const fastFlicker = Math.sin(time * 20) * 0.3; // Fast flicker
                    const slowPulse = Math.sin(time * 3) * 0.5 + 0.5; // Slow pulse
                    const randomFlicker = Math.random() > 0.95 ? 0 : 1; // Occasional blackout
                    
                    // Animate emissive color for electric effect
                    const intensity = (slowPulse + fastFlicker) * randomFlicker;
                    meshData.mesh.material.emissiveColor.r = 0.3 + intensity * 0.4;
                    meshData.mesh.material.emissiveColor.g = 0.6 + intensity * 0.3;
                    meshData.mesh.material.emissiveColor.b = 1.0;
                    
                    // Animate scale for pulsing effect
                    const scaleY = 0.8 + slowPulse * 0.4; // Vertical scaling
                    meshData.mesh.scaling.y = scaleY;
                    
                    // Slight rotation for movement
                    meshData.mesh.rotation.y = time * 0.5;
                }
            }
        });
        
        // Handle banner visibility and mesh creation
        banners.forEach((bannerEntity, bannerKey) => {
            if (!noa.entities.hasComponent(bannerEntity, noa.entities.names.position)) return;
            
            const bannerData = noa.entities.getState(bannerEntity, 'isBanner');
            const bannerPos = noa.entities.getPosition(bannerEntity);
            
            // Check if banner needs mesh created
            if (bannerData.needsMesh) {
                const dx = bannerPos[0] - playerPos[0];
                const dz = bannerPos[2] - playerPos[2];
                const distanceSq = dx * dx + dz * dz;
                
                // Only create mesh if within reasonable distance
                if (distanceSq <= maxRenderDistanceSq * 4) { // Larger distance for banners
                    // Calculate color based on Z position (gradually from green to red)
                    const targetZ = 250 * 32; // 250 chunks * 32 blocks = 8000 blocks
                    const progress = Math.min(Math.max(bannerData.startZ / targetZ, 0), 1);
                    const red = progress;
                    const green = 1 - progress;
                    
                    // Create banner mesh - spans between left and right pillars of corridor
                    let bannerWidth, bannerMesh;
                    
                    if (bannerData.corridorType === 'north') {
                        // North corridor: pillars are at x=13 and x=17, so banner spans 4 blocks
                        bannerWidth = 4;
                        bannerMesh = BABYLON.MeshBuilder.CreatePlane(bannerData.meshName, {
                            width: bannerWidth,
                            height: 2,  // 2 blocks tall
                            sideOrientation: BABYLON.Mesh.DOUBLESIDE
                        }, scene);
                    } else {
                        // East/West corridors: pillars are at edges of 3-block wide corridor, so banner spans 4 blocks
                        bannerWidth = 4;
                        bannerMesh = BABYLON.MeshBuilder.CreatePlane(bannerData.meshName, {
                            width: bannerWidth,
                            height: 2,  // 2 blocks tall
                            sideOrientation: BABYLON.Mesh.DOUBLESIDE
                        }, scene);
                    }
                    
                    // Create banner material with color gradient
                    const bannerMaterial = new BABYLON.StandardMaterial(`${bannerData.meshName}_mat`, scene);
                    bannerMaterial.diffuseColor = new BABYLON.Color3(1, 1, 1); // White to show texture properly
                    bannerMaterial.emissiveColor = new BABYLON.Color3(red * 0.5, green * 0.5, 0); // Original emissive strength
                    bannerMaterial.alpha = 0.5; // Half transparent
                    bannerMaterial.backFaceCulling = false;
                    
                    // Create dynamic texture for displaying Z position with colored background
                    const dynamicTexture = new BABYLON.DynamicTexture(`${bannerData.meshName}_texture`, {width: 512, height: 256}, scene);
                    const textureContext = dynamicTexture.getContext();
                    
                    // Fill background with dark gradient color
                    textureContext.fillStyle = `rgb(${Math.floor(red * 80)}, ${Math.floor(green * 80)}, 0)`;
                    textureContext.fillRect(0, 0, 512, 256);
                    
                    // Draw Z position on texture with bright colors
                    textureContext.font = "bold 80px Arial";
                    textureContext.fillStyle = "#00FFFF"; // Bright cyan
                    textureContext.strokeStyle = "#FFFFFF"; // White outline
                    textureContext.lineWidth = 3;
                    textureContext.textAlign = "center";
                    textureContext.textBaseline = "middle";
                    textureContext.strokeText(`${bannerData.startZ}`, 256, 128);
                    textureContext.fillText(`${bannerData.startZ}`, 256, 128);
                    dynamicTexture.update();
                    
                    bannerMaterial.diffuseTexture = dynamicTexture;
                    bannerMaterial.diffuseTexture.hasAlpha = true;
                    
                    bannerMesh.material = bannerMaterial;
                    
                    // Position banner correctly based on corridor type
                    if (bannerData.corridorType === 'north') {
                        // North corridor: banner hangs between pillars at x=13 and x=17
                        bannerMesh.position.x = 15; // Center between pillars
                        bannerMesh.position.y = bannerPos[1] + 1; // Center of top 2 blocks
                        bannerMesh.position.z = bannerPos[2]; // At pillar Z position
                        bannerMesh.rotation.y = 0; // Face north/south (was PI/2)
                    } else if (bannerData.corridorType === 'east') {
                        // East corridor at z=12-14: pillars at z=11 and z=15
                        bannerMesh.position.x = bannerPos[0]; // Keep X from entity
                        bannerMesh.position.y = bannerPos[1] + 1; // Center of top 2 blocks
                        bannerMesh.position.z = 13; // Center of corridor
                        bannerMesh.rotation.y = Math.PI / 2; // Face east/west (was 0)
                    } else { // west
                        // West corridor at z=16-18: pillars at z=15 and z=19
                        bannerMesh.position.x = bannerPos[0]; // Keep X from entity
                        bannerMesh.position.y = bannerPos[1] + 1; // Center of top 2 blocks
                        bannerMesh.position.z = 17; // Center of corridor
                        bannerMesh.rotation.y = Math.PI / 2; // Face east/west (was 0)
                    }
                    
                    // Add mesh to entity
                    noa.entities.addComponent(bannerEntity, noa.entities.names.mesh, {
                        mesh: bannerMesh,
                        offset: [0, 0, 0]
                    });
                    
                    bannerData.needsMesh = false;
                }
            }
            
            // Update visibility and color for existing banner mesh
            if (noa.entities.hasComponent(bannerEntity, noa.entities.names.mesh)) {
                const meshData = noa.entities.getMeshData(bannerEntity);
                if (meshData && meshData.mesh) {
                    const dx = bannerPos[0] - playerPos[0];
                    const dz = bannerPos[2] - playerPos[2];
                    const distanceSq = dx * dx + dz * dz;
                    
                    meshData.mesh.setEnabled(distanceSq <= maxRenderDistanceSq * 4);
                    
                    // Update banner color based on its absolute Z position
                    if (meshData.mesh.isEnabled()) {
                        // Use the banner's actual Z position to calculate color
                        const bannerWorldZ = bannerData.startZ;
                        const targetZ = 250 * 32; // 250 chunks * 32 blocks = 8000 blocks
                        const progress = Math.min(Math.max(bannerWorldZ / targetZ, 0), 1);
                        const red = progress;
                        const green = 1 - progress;
                        
                        // Update material colors
                        if (meshData.mesh.material) {
                            // Update emissive color
                            meshData.mesh.material.emissiveColor.r = red * 0.5;
                            meshData.mesh.material.emissiveColor.g = green * 0.5;
                            meshData.mesh.material.emissiveColor.b = 0;
                            
                            // Update the texture to reflect new color
                            if (meshData.mesh.material.diffuseTexture && meshData.mesh.material.diffuseTexture.getContext) {
                                const textureContext = meshData.mesh.material.diffuseTexture.getContext();
                                
                                // Fill background with dark gradient color
                                textureContext.fillStyle = `rgb(${Math.floor(red * 80)}, ${Math.floor(green * 80)}, 0)`;
                                textureContext.fillRect(0, 0, 512, 256);
                                
                                // Redraw Z position text with bright colors
                                textureContext.font = "bold 80px Arial";
                                textureContext.fillStyle = "#00FFFF"; // Bright cyan
                                textureContext.strokeStyle = "#FFFFFF"; // White outline
                                textureContext.lineWidth = 3;
                                textureContext.textAlign = "center";
                                textureContext.textBaseline = "middle";
                                textureContext.strokeText(`${bannerWorldZ}`, 256, 128);
                                textureContext.fillText(`${bannerWorldZ}`, 256, 128);
                                
                                meshData.mesh.material.diffuseTexture.update();
                            }
                            
                            // Log every 60 frames to avoid spam
                            if (visibilityUpdateCounter % 60 === 0) {
                                console.log(`Updating banner at Z=${bannerWorldZ}, progress=${progress.toFixed(3)}, red=${red.toFixed(2)}, green=${green.toFixed(2)}`);
                            }
                        }
                    }
                }
            }
        });
        
    });
    
    // Force chunk generation periodically
    setInterval(() => {
        if (noa && noa.playerEntity) {
            forceChunkGeneration();
        }
    }, 5000); // Every 5 seconds
    
    // Check if player has fallen into the void
    setInterval(() => {
        if (!noa || !noa.playerEntity || isPlayerDead) return;
        
        const pos = noa.entities.getPosition(noa.playerEntity);
        
        // Debug log when falling
        if (pos[1] < 0) {
            console.log(`Player Y position: ${pos[1]}`);
        }
        
        // Kill player if they fall below y=-10 into the void
        if (pos[1] < -10) {
            console.log('Player fell into void! Triggering death...');
            handlePlayerDeath('Fell into the void');
        }
    }, 100); // Check 10 times per second
    
    // Check backpacks and remove those that fall into void
    setInterval(() => {
        if (!noa) return;
        
        const toRemove = [];
        backpacks.forEach((entity, key) => {
            if (noa.entities.hasComponent(entity, noa.entities.names.position)) {
                const pos = noa.entities.getPosition(entity);
                
                // Remove backpack if it falls below y=-50
                if (pos[1] < -50) {
                    console.log(`Removing backpack at ${key} - fell into void (y=${pos[1]})`);
                    toRemove.push(key);
                }
            }
        });
        
        // Remove fallen backpacks
        toRemove.forEach(key => {
            const entity = backpacks.get(key);
            if (entity && noa.entities.hasComponent(entity, noa.entities.names.mesh)) {
                noa.entities.deleteEntity(entity);
            }
            backpacks.delete(key);
            backpackData.delete(key); // Also remove persistent data
        });
    }, 1000); // Check every second
    
    // Track slowing floor state
    let isSlowed = false;
    let baseMaxSpeed = null;
    let baseMoveSpeed = null;
    let baseJumpImpulse = null;
    
    // Check for slowing floor and apply movement penalties
    setInterval(() => {
        if (!noa || !noa.playerEntity || isPlayerDead) return;
        
        const pos = noa.entities.getPosition(noa.playerEntity);
        const movement = noa.entities.getMovement(noa.playerEntity);
        const physics = noa.entities.getPhysics(noa.playerEntity);
        if (!movement || !physics || !physics.body) return;
        
        // Check block at player's feet
        const blockBelow = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1] - 1), 
            Math.floor(pos[2])
        );
        
        // Also check the block at exact player position (in case player is clipping into floor)
        const blockAt = noa.world.getBlockID(
            Math.floor(pos[0]), 
            Math.floor(pos[1]), 
            Math.floor(pos[2])
        );
        
        // Initialize base values on first run (after 4x multiplier has been applied)
        if (baseMaxSpeed === null) {
            baseMaxSpeed = movement.maxSpeed;
            baseMoveSpeed = movement.moveSpeed;
            baseJumpImpulse = movement.jumpImpulse;
        }
        
        // Check if player is on or in a slowing floor
        const onSlowingFloor = (blockBelow === slowingFloorID || blockAt === slowingFloorID);
        
        if (onSlowingFloor && !isSlowed) {
            // Apply severe slowing effect
            movement.maxSpeed = baseMaxSpeed / 32;  // Much slower (1/32 of boosted speed)
            movement.moveSpeed = baseMoveSpeed / 32;
            movement.jumpImpulse = 0; // No jumping allowed
            
            // Also slow down current velocity
            physics.body.velocity[0] *= 0.125; // Instant velocity reduction
            physics.body.velocity[2] *= 0.125;
            
            isSlowed = true;
            console.log(`Slowing floor activated - speed reduced to 1/32 (was ${baseMaxSpeed}, now ${movement.maxSpeed})`);
        } else if (!onSlowingFloor && isSlowed) {
            // Restore original speed
            movement.maxSpeed = baseMaxSpeed;
            movement.moveSpeed = baseMoveSpeed;
            movement.jumpImpulse = baseJumpImpulse;
            isSlowed = false;
            console.log(`Left slowing floor - speed restored to ${movement.maxSpeed}`);
        }
    }, 50); // Check frequently for responsive slowing
    
    
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
            
            // Snap to nearest cardinal direction (excluding south)
            // Divide the circle into three equal parts for N, E, W
            // North: 330° to 30° (300° to 60°)
            // East: 30° to 150°
            // West: 150° to 330° (210° to 300°)
            
            if (normalizedHeading < Math.PI / 6 || normalizedHeading >= Math.PI * 11 / 6) {
                targetHeading = 0; // North (330° to 30°)
            } else if (normalizedHeading >= Math.PI / 6 && normalizedHeading < Math.PI * 5 / 6) {
                targetHeading = Math.PI / 2; // East (30° to 150°)
            } else {
                targetHeading = -Math.PI / 2; // West (150° to 330°)
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
        if (!noa || !noa.playerEntity || isPlayerDead) return;
        
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
        if (!noa || !noa.playerEntity || !noa._isTurning || isPlayerDead) return;
        
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
        } else {
            // Rotate towards target using the shortest path
            const rotationStep = Math.sign(diff) * turnSpeed;
            movement.heading += rotationStep;
            noa.camera.heading += rotationStep;
            
            // Normalize heading to prevent accumulation errors
            movement.heading = movement.heading % (2 * Math.PI);
            noa.camera.heading = noa.camera.heading % (2 * Math.PI);
        }
    }, 50); // Run frequently for smooth rotation
    
    // Add render callback for continuous movement and chunk processing
    noa.on('beforeRender', () => {
        // Process world chunks on each frame for smoother loading
        noa.world.tick();
        
        // Get player movement component
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (!movement) return;
        
        // Stop all movement if player is dead
        if (isPlayerDead) {
            movement.running = false;
            noa.inputs.state.forward = false;
            noa.inputs.state.backward = false;
            noa.inputs.state.left = false;
            noa.inputs.state.right = false;
            noa.inputs.state.jump = false;
            return;
        }
        
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
                    // Turn right (clockwise): N->E, E->W, S->W, W->N
                    if (currentDir === 'north') targetDir = 'east';
                    else if (currentDir === 'east') targetDir = 'west'; // Skip south, go to west
                    else if (currentDir === 'south') targetDir = 'west';
                    else if (currentDir === 'west') targetDir = 'north';
                } else if (noa.inputs.state.left) {
                    // Turn left (counter-clockwise): N->W, W->E, S->E, E->N
                    if (currentDir === 'north') targetDir = 'west';
                    else if (currentDir === 'west') targetDir = 'east'; // Skip south, go to east
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
                
                
                // Store target heading for smooth turning
                noa._targetHeading = targetHeading;
                noa._isTurning = true;
                
                // Store the target exit info for continuous strafing
                noa._targetExit = targetExit;
                noa._targetDir = targetDir;
                
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
    
    // Set up touch controls for mobile devices
    setupTouchControls();
    
    // Re-check mobile status on window resize
    window.addEventListener('resize', () => {
        setupTouchControls();
    });
    
    // Set up pause functionality with P key
    setupPauseControls();
    
    // Configure jump settings to prevent flying and limit jump height
    const movement = noa.entities.getMovement(noa.playerEntity);
    movement.airJumps = 0;  // No jumping while in air - prevents double jumping/flying
    
    // Configure jump - commented out to use our custom settings from earlier
    // movement.jumpImpulse = 4.2;  // Commented out - using our 1000 value set earlier
    movement.jumpForce = 0;      // No sustained upward force during jump
    movement.jumpTime = 100;     // Short jump time since we're using impulse only
    
    
    // Force immediate chunk generation
    forceChunkGeneration();
    
    // Force initial chunk generation after a delay
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
    // Reduced to single tick - noa-engine handles chunk loading automatically
    noa.world.tick();
}

// Track if update is in progress
let isUpdatingPlayerToken = false;
let updateIntervalId = null;

// Start periodic state updates
function startPeriodicUpdates() {
    // Prevent multiple intervals
    if (updateIntervalId) {
        console.warn('Periodic updates already started');
        return;
    }
    
    updateIntervalId = setInterval(async () => {
        if (!noa || !playerToken || !signingService) return;
        
        // Skip if game is paused, player is dead, or already updating
        if (isPaused || isPlayerDead || isUpdatingPlayerToken) {
            return;
        }
        
        isUpdatingPlayerToken = true;
        
        // First check if we already have a pending transaction
        const pendingTxKey = 'unicityRunner_pendingTransaction';
        const existingPendingTx = localStorage.getItem(pendingTxKey);
        if (existingPendingTx) {
            try {
                const pending = JSON.parse(existingPendingTx);
                if (pending.submitted) {
                    // Check how old this submitted transaction is
                    const age = Date.now() - pending.timestamp;
                    if (age > 60000) { // If older than 60 seconds, consider it failed
                        console.warn(`Clearing stuck pending transaction (age: ${Math.floor(age/1000)}s)`);
                        localStorage.removeItem(pendingTxKey);
                        tokenStatus.lastError = 'Previous transaction timed out';
                    } else {
                        tokenStatus.pendingTransaction = true;
                        tokenStatus.lastError = 'Transaction pending - waiting for completion';
                        updateTokenStatusDisplay();
                        isUpdatingPlayerToken = false;
                        return;
                    }
                }
            } catch (e) {
                console.error('Failed to parse existing pending transaction:', e);
                localStorage.removeItem(pendingTxKey);
            }
        }
        
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
        const aggregatorClient = new window.UnicitySDK.AggregatorClient('https://goggregator-test.unicity.network');
        const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
        
        // Check if we have a pending transaction from a previous attempt
        let pendingTx = null;
        const pendingTxString = localStorage.getItem(pendingTxKey);
        if (pendingTxString) {
            try {
                pendingTx = JSON.parse(pendingTxString);
                
                // Check if this pending transaction is too old
                const maxAge = 2 * 60 * 1000; // 2 minutes
                const age = Date.now() - pendingTx.timestamp;
                if (age > maxAge) {
                    console.warn(`Clearing old pending transaction (age: ${Math.floor(age/1000)}s)`);
                    localStorage.removeItem(pendingTxKey);
                    pendingTx = null;
                }
            } catch (e) {
                console.error('Failed to parse pending transaction:', e);
                localStorage.removeItem(pendingTxKey);
            }
        }
        
        let commitment, newPredicate, newNonce, transactionData;
        
        // Update pending status
        tokenStatus.pendingTransaction = !!pendingTx;
        updateTokenStatusDisplay();
        
        if (pendingTx && pendingTx.submitted) {
            // We have a submitted transaction - try to recover it
            
            try {
                // Create aggregator client for recovery
                const aggregatorClient = new window.UnicitySDK.AggregatorClient('https://goggregator-test.unicity.network');
                const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
                // Recreate the transaction data from saved info
                const salt = window.UnicitySDK.HexConverter.decode(pendingTx.transactionData.salt);
                const savedDataHash = window.UnicitySDK.DataHash.fromJSON(pendingTx.transactionData.dataHash);
                const message = window.UnicitySDK.HexConverter.decode(pendingTx.transactionData.message);
                
                transactionData = await window.UnicitySDK.TransactionData.create(
                    playerToken.state,
                    pendingTx.transactionData.recipientAddress,
                    salt,
                    savedDataHash,
                    message,
                    [] // no nametag tokens
                );
                
                // For player token recovery, we can't reliably recreate the exact commitment
                // that was submitted because the hash might be different. Instead, we'll
                // clear the stuck transaction and let it retry with fresh data.
                console.warn('Cannot reliably recover player token transaction. Clearing and will retry.');
                localStorage.removeItem(pendingTxKey);
                tokenStatus.pendingTransaction = false;
                tokenStatus.lastError = 'Previous transaction cleared - retrying';
                updateTokenStatusDisplay();
                isUpdatingPlayerToken = false;
                return;
                
            } catch (recoveryError) {
                console.error('Failed to recover submitted transaction:', recoveryError);
                
                // Clear the stuck transaction
                localStorage.removeItem(pendingTxKey);
                tokenStatus.pendingTransaction = false;
                tokenStatus.lastError = 'Failed to recover transaction - cleared';
                updateTokenStatusDisplay();
                isUpdatingPlayerToken = false;
                return;
            }
        } else if (pendingTx && !pendingTx.submitted) {
            // We have a pending transaction that wasn't submitted yet - clear it
            localStorage.removeItem(pendingTxKey);
            tokenStatus.pendingTransaction = false;
            updateTokenStatusDisplay();
        }
        
        // Generate new nonce for one-time address
        newNonce = crypto.getRandomValues(new Uint8Array(32));
        
        // Create a new signing service with the new nonce for the new predicate
        // This is required because MaskedPredicate needs a signing service created with the same nonce
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
        // Save commitment info and transaction data for recovery
        const pendingData = {
            requestId: commitment.requestId.toJSON(), // Save request ID in JSON format
            transactionData: {
                // Save data needed to reconstruct transaction data
                recipientAddress: recipient.toString(),
                salt: window.UnicitySDK.HexConverter.encode(transactionData.salt),
                dataHash: dataHash.toJSON(),
                message: window.UnicitySDK.HexConverter.encode(new TextEncoder().encode('State update'))
            },
            newPredicate: newPredicate.toJSON(),
            newNonce: window.UnicitySDK.HexConverter.encode(newNonce),
            stateData: window.UnicitySDK.HexConverter.encode(stateData), // Save the actual state data
            timestamp: Date.now(),
            submitted: false // Track if actually submitted
        };
        localStorage.setItem(pendingTxKey, JSON.stringify(pendingData));
        
        // Update status to show pending
        tokenStatus.pendingTransaction = true;
        updateTokenStatusDisplay();
        
        
        try {
            // Submit commitment
            const response = await client.submitCommitment(commitment);
            
            if (response.status !== window.UnicitySDK.SubmitCommitmentStatus.SUCCESS) {
                throw new Error(`Failed to submit transaction commitment: ${response.status}`);
            }
            
            // Mark as submitted immediately after successful submission
            const savedPendingData = localStorage.getItem(pendingTxKey);
            if (savedPendingData) {
                const pendingDataToUpdate = JSON.parse(savedPendingData);
                pendingDataToUpdate.submitted = true;
                localStorage.setItem(pendingTxKey, JSON.stringify(pendingDataToUpdate));
            } else {
                console.error('WARNING: No pending transaction found to mark as submitted!');
            }
            
            // Wait for inclusion proof using SDK utility
            const inclusionProof = await window.UnicitySDK.waitInclusionProof(
                client,
                commitment,
                AbortSignal.timeout(30000), // 30 second timeout for submitted transactions
                1000 // Check every second
            );
            const transaction = await retryOnInclusionProofError(async () => {
                return await client.createTransaction(commitment, inclusionProof);
            });
            
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
            
            // Reset update flag on success
            isUpdatingPlayerToken = false;
            
        } catch (error) {
            // Update status for failure
            tokenStatus.totalSubmissions++;
            tokenStatus.lastError = error.message || 'Transaction failed';
            updateTokenStatusDisplay();
            
            // Clear any stuck pending transaction on error
            const savedPendingTx = localStorage.getItem(pendingTxKey);
            if (savedPendingTx) {
                try {
                    const pending = JSON.parse(savedPendingTx);
                    if (pending.submitted) {
                        console.warn('Clearing submitted transaction that failed:', error.message);
                        localStorage.removeItem(pendingTxKey);
                        tokenStatus.pendingTransaction = false;
                    }
                } catch (e) {
                    localStorage.removeItem(pendingTxKey);
                }
            }
            
            // Check for REQUEST_ID_EXISTS - this means we lost track of a submitted transaction
            if (error.message && error.message.includes('REQUEST_ID_EXISTS')) {
                console.error('REQUEST_ID_EXISTS - Transaction was already submitted:', error);
                
                // Load the pending transaction we just saved
                const savedPendingTx = localStorage.getItem(pendingTxKey);
                if (savedPendingTx) {
                    const pendingToUpdate = JSON.parse(savedPendingTx);
                    if (!pendingToUpdate.submitted) {
                        console.warn('Transaction was submitted but not marked. Updating pending state.');
                        // Mark it as submitted and try again next cycle
                        pendingToUpdate.submitted = true;
                        localStorage.setItem(pendingTxKey, JSON.stringify(pendingToUpdate));
                        tokenStatus.lastError = 'Transaction already submitted - will check status next cycle';
                    } else {
                        // Already marked as submitted - this shouldn't happen
                        console.error('Transaction already marked as submitted but got REQUEST_ID_EXISTS');
                        localStorage.removeItem(pendingTxKey);
                        tokenStatus.pendingTransaction = false;
                        tokenStatus.lastError = 'Duplicate transaction - cleared pending state';
                    }
                } else {
                    // No pending transaction found - this shouldn't happen
                    console.error('No pending transaction found after REQUEST_ID_EXISTS');
                    tokenStatus.pendingTransaction = false;
                    tokenStatus.lastError = 'Transaction state lost - please try again';
                }
            } else {
                console.warn('Failed to submit to Unicity network, will retry next time:', error);
            }
            
            // Reset update flag on error
            isUpdatingPlayerToken = false;
            
            // Don't re-throw REQUEST_ID_EXISTS errors - they're handled above
            if (!error.message || !error.message.includes('REQUEST_ID_EXISTS')) {
                throw error;
            }
        } finally {
            // Ensure flag is always reset
            isUpdatingPlayerToken = false;
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
    
    // Create multi-material for different textures per face
    const droneMultiMat = new BABYLON.MultiMaterial('droneMultiMat', scene);
    
    // Face order in Babylon.js: front, back, right, left, top, bottom
    const droneFaceConfigs = [
        { name: 'front', texture: '/assets/unirun_drone_face.png' },
        { name: 'back', texture: '/assets/unirun_drone_back.png' },
        { name: 'right', texture: '/assets/unirun_drone_side.png' },
        { name: 'left', texture: '/assets/unirun_drone_side.png' },
        { name: 'top', texture: '/assets/unirun_drone_top.png' },
        { name: 'bottom', texture: '/assets/unirun_drone_button.png' }
    ];
    
    // Create materials for each face
    droneFaceConfigs.forEach((config, index) => {
        const mat = noa.rendering.makeStandardMaterial(`drone_${config.name}`);
        
        try {
            const texture = new BABYLON.Texture(config.texture, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
            texture.hasAlpha = true;
            
            // Flip texture horizontally for left side to mirror the right side
            if (config.name === 'left') {
                texture.uScale = -1;
            }
            
            mat.diffuseTexture = texture;
            mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            mat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Slight emission
            
        } catch (e) {
            // Fallback to dark gray if texture fails
            console.warn(`Failed to load drone texture ${config.texture}, using gray fallback`);
            mat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
            mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        }
        
        droneMultiMat.subMaterials[index] = mat;
    });
    
    // Apply multi-material and create submeshes
    droneBox.material = droneMultiMat;
    droneBox.subMeshes = [];
    
    // Create submeshes for each face
    const verticesPerFace = 4;
    const indicesPerFace = 6;
    for (let i = 0; i < 6; i++) {
        droneBox.subMeshes.push(new BABYLON.SubMesh(
            i,                          // materialIndex
            i * verticesPerFace,        // verticesStart
            verticesPerFace,            // verticesCount
            i * indicesPerFace,         // indexStart
            indicesPerFace,             // indexCount
            droneBox                    // mesh
        ));
    }
    
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
    const fireRate = 250; // Fire every 0.25 seconds (4x faster)
    const shootingRange = 20; // Shooting range in blocks
    const pursuitAltitude = { min: 10, max: 15 }; // High altitude during pursuit
    const combatAltitude = 8; // Lower altitude during combat
    
    setInterval(() => {
        if (!droneEntity || !noa.entities.hasComponent(droneEntity, noa.entities.names.position)) return;
        if (isPaused) return; // Skip AI update when paused
        
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
        
        // Get player velocity to check if they're running
        const playerPhysics = noa.entities.getPhysics(noa.playerEntity);
        if (!playerPhysics) return;
        
        const playerVel = playerPhysics.body.velocity;
        const playerSpeed = Math.sqrt(playerVel[0] * playerVel[0] + playerVel[2] * playerVel[2]);
        const isPlayerRunning = playerSpeed > 10; // Threshold for running (adjust as needed)
        
        // Debug log for mode switching (uncomment if needed)
        // console.log(`Player speed: ${playerSpeed.toFixed(1)}, Distance: ${horizontalDistance.toFixed(1)}, Mode: ${(horizontalDistance > shootingRange || isPlayerRunning) ? 'PURSUIT' : 'COMBAT'}`);
        
        // Pursue if: 1) out of shooting range OR 2) player is running
        if (horizontalDistance > shootingRange || isPlayerRunning) {
            // PURSUIT MODE - fly high and approach player
            
            // Calculate target altitude (random between min and max for variety)
            const targetAltitude = playerPos[1] + pursuitAltitude.min + 
                                 Math.random() * (pursuitAltitude.max - pursuitAltitude.min);
            const altitudeDiff = targetAltitude - dronePos[1];
            
            // Calculate horizontal direction to player
            const horizDir = horizontalDistance > 0 ? 1 / horizontalDistance : 0;
            const dirX = dx * horizDir;
            const dirZ = dz * horizDir;
            
            // Set drone velocity to match player's 4x speed
            const pursuitSpeed = 32; // Match player's 4x movement speed
            
            // Apply forces instead of setting velocity directly
            const forceMult = 40; // Doubled force multiplier for 4x speed
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
            
            // Make drone face the player during pursuit
            const meshData = noa.entities.getMeshData(droneEntity);
            if (meshData && meshData.mesh) {
                // Calculate angle to face player (yaw)
                const angleToPlayer = Math.atan2(dx, dz);
                meshData.mesh.rotation.y = angleToPlayer;
                
                // Slight downward pitch during pursuit
                meshData.mesh.rotation.x = 0.1;
            }
            
        } else {
            // COMBAT MODE - hover around player at lower altitude and shoot
            // Only enters this mode when player is within range AND not running
            
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
            const hoverSpeed = 16; // Match player's movement speed in combat
            
            // Apply forces for smoother movement
            physics.body.applyForce([hoverDx * 20, hoverDy * 30, hoverDz * 20]);
            
            // Also set velocity directly
            physics.body.velocity[0] = hoverDx * 2.0; // 2x faster hovering
            physics.body.velocity[1] = hoverDy * 3.0; // 2x faster altitude adjustment
            physics.body.velocity[2] = hoverDz * 2.0;
            
            // Make drone face the player while circling
            const meshData = noa.entities.getMeshData(droneEntity);
            if (meshData && meshData.mesh) {
                // Calculate angle to face player (yaw)
                const angleToPlayer = Math.atan2(dx, dz);
                meshData.mesh.rotation.y = angleToPlayer;
                
                // Calculate pitch to look at player
                const horizontalDist = Math.sqrt(dx * dx + dz * dz);
                const pitch = Math.atan2(-dy, horizontalDist);
                meshData.mesh.rotation.x = pitch * 0.5; // Reduced pitch for better look
            }
            
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
    const bulletSpeed = 60; // Doubled speed for deadlier bullets
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
    if (isPaused) return; // Skip projectile updates when paused
    
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
            damagePlayer(10, 'Killed by drone'); // Doubled damage from 5 to 10
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

// Archive current player token to history
async function archivePlayerToken() {
    if (!playerToken) return;
    
    try {
        // Get current token data
        const tokenData = await playerToken.toJSON();
        
        // Add metadata
        const archivedToken = {
            tokenData: tokenData,
            archivedAt: Date.now(),
            finalStats: {
                distance: totalDistanceTraveled,
                coins: confirmedURCBalance + pendingURCBalance,
                deathReason: deathReason,
                playerName: playerStats.playerName
            }
        };
        
        // Add to token history
        playerStats.tokenHistory.push(archivedToken);
        
        // Keep only last 20 tokens
        if (playerStats.tokenHistory.length > 20) {
            playerStats.tokenHistory = playerStats.tokenHistory.slice(-20);
        }
        
        // Save to localStorage
        localStorage.setItem('unicityRunner_tokenHistory', JSON.stringify(playerStats.tokenHistory));
        
        console.log('Player token archived successfully');
    } catch (error) {
        console.error('Error archiving player token:', error);
    }
}

// Handle player death
function handlePlayerDeath(reason = 'Unknown') {
    if (isPlayerDead) return; // Already dead
    
    isPlayerDead = true;
    deathReason = reason;
    
    // Calculate distance traveled
    const currentPos = noa.entities.getPosition(noa.playerEntity);
    totalDistanceTraveled = Math.abs(currentPos[2] - playerStartZ);
    
    // Get total coins lost (confirmed + pending)
    const totalCoinsLost = confirmedURCBalance + pendingURCBalance;
    
    // Record run statistics
    const runDuration = playerStats.currentRunStartTime ? 
        (Date.now() - playerStats.currentRunStartTime) / 1000 : 0;
    recordRunStats(totalDistanceTraveled, totalCoinsLost, reason, runDuration);
    
    // Archive the current player token
    archivePlayerToken();
    
    // Stop periodic token updates
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
        updateIntervalId = null;
        console.log('Stopped periodic token updates on death');
    }
    
    // Prepare inventory data for backpack
    let backpackInventory = {
        confirmedBalance: confirmedURCBalance,
        pendingBalance: pendingURCBalance,
        totalCoins: totalCoinsLost,
        mintedTokens: [],
        pendingMints: []
    };
    
    // Get minted tokens from inventory
    const inventoryData = localStorage.getItem('unicityRunner_urcInventory');
    if (inventoryData) {
        const inventory = JSON.parse(inventoryData);
        backpackInventory.mintedTokens = inventory.tokens || [];
    }
    
    // Get pending mints
    const pendingMintsData = localStorage.getItem('unicityRunner_pendingURCMints');
    if (pendingMintsData) {
        const pending = JSON.parse(pendingMintsData);
        backpackInventory.pendingMints = pending.mints || [];
    }
    
    // Drop backpack if player had coins and didn't fall into void
    if (totalCoinsLost > 0 && reason !== 'Fell into the void') {
        console.log(`Dropping backpack with ${totalCoinsLost} coins (${backpackInventory.mintedTokens.length} minted tokens, ${backpackInventory.pendingMints.length} pending mints). Death reason: ${reason}`);
        const playerPos = noa.entities.getPosition(noa.playerEntity);
        const physics = noa.entities.getPhysics(noa.playerEntity);
        
        // Get player's velocity for inertia
        let velocity = [0, 0, 0];
        if (physics && physics.body) {
            velocity = [...physics.body.velocity];
        }
        
        console.log(`Player position: ${playerPos}, velocity: ${velocity}`);
        
        // Calculate backpack spawn position - 3 to 6 blocks north of death position
        const northOffset = 3 + Math.random() * 3; // Random between 3 and 6 blocks
        let backpackSpawnPos = [
            playerPos[0],
            playerPos[1] + 1.5, // Higher spawn to avoid getting stuck in floor
            playerPos[2] + northOffset // Positive Z is north
        ];
        
        // Find solid ground for the backpack
        let foundGround = false;
        let checkY = Math.floor(backpackSpawnPos[1]);
        
        // Check downward for solid ground (up to 10 blocks)
        for (let y = checkY; y >= checkY - 10; y--) {
            const blockBelow = noa.world.getBlockID(
                Math.floor(backpackSpawnPos[0]),
                y - 1,
                Math.floor(backpackSpawnPos[2])
            );
            
            if (blockBelow !== 0) { // Found solid ground
                backpackSpawnPos[1] = y + 0.1; // Place backpack just above the ground
                foundGround = true;
                console.log(`Found solid ground for backpack at y=${y-1}, block type: ${blockBelow}`);
                break;
            }
        }
        
        // If no ground found, try to place it at the player's death position
        if (!foundGround) {
            console.log(`No ground found north of death position, checking at death position`);
            checkY = Math.floor(playerPos[1]);
            
            for (let y = checkY; y >= checkY - 10; y--) {
                const blockBelow = noa.world.getBlockID(
                    Math.floor(playerPos[0]),
                    y - 1,
                    Math.floor(playerPos[2])
                );
                
                if (blockBelow !== 0) { // Found solid ground
                    backpackSpawnPos = [
                        playerPos[0],
                        y + 0.1, // Place just above ground
                        playerPos[2]
                    ];
                    foundGround = true;
                    console.log(`Found solid ground at death position, y=${y-1}, block type: ${blockBelow}`);
                    break;
                }
            }
        }
        
        // If still no ground, don't spawn backpack
        if (!foundGround) {
            console.error(`Cannot spawn backpack - no solid ground found near death position`);
            // Still clear the coins but don't create entity
            confirmedURCBalance = 0;
            pendingURCBalance = 0;
            playerCoins = 0;
            updateCoinDisplay();
            return;
        }
        
        console.log(`Backpack spawn position: ${backpackSpawnPos}`);
        
        let finalSpawnPos = backpackSpawnPos;
        
        // Create backpack entity at offset position
        const backpackEntity = noa.entities.add(
            finalSpawnPos,
            1.0, // width - increased for visibility
            1.2, // height - increased for visibility
            null, // mesh (will be added later)
            [0, 0, 0], // meshOffset
            false, // doPhysics - no physics for backpack
            false  // shadow
        );
        
        if (!backpackEntity) {
            console.error(`Failed to create backpack entity at position ${backpackSpawnPos}`);
            return;
        }
        
        // No physics - backpack stays where placed
        
        // Create mesh immediately
        const backpackInstance = backpackMesh.createInstance('backpack_' + Date.now());
        backpackInstance.setEnabled(true);
        noa.entities.addComponent(backpackEntity, noa.entities.names.mesh, {
            mesh: backpackInstance,
            offset: [0, 0.6, 0] // Center the larger mesh
        });
        
        // Add backpack component with full inventory
        const backpackKey = `${Math.floor(finalSpawnPos[0])},${Math.floor(finalSpawnPos[2])}`;
        noa.entities.addComponent(backpackEntity, 'isBackpack', {
            position: finalSpawnPos,
            lostCoins: totalCoinsLost,
            backpackKey: backpackKey,
            inventory: backpackInventory
        });
        
        // Track backpack entity and persistent data
        backpacks.set(backpackKey, backpackEntity);
        backpackData.set(backpackKey, {
            position: finalSpawnPos,
            lostCoins: totalCoinsLost,
            inventory: backpackInventory,
            createdAt: Date.now()
        });
        console.log(`Backpack created at ${backpackKey} (${northOffset.toFixed(1)} blocks north), entity: ${backpackEntity}, mesh available: ${backpackMesh !== null}`);
    } else {
        console.log(`No backpack dropped. Coins: ${totalCoinsLost}, Reason: ${reason}`);
    }
    
    // Clear player's coin balance and inventory
    confirmedURCBalance = 0;
    pendingURCBalance = 0;
    playerCoins = 0;
    
    // Clear stored inventory data since it's now in the backpack
    if (totalCoinsLost > 0 && reason !== 'Fell into the void') {
        localStorage.removeItem('unicityRunner_urcInventory');
        localStorage.removeItem('unicityRunner_pendingURCMints');
    }
    
    updateCoinDisplay();
    
    // Show death screen with stats
    const deathScreen = document.getElementById('deathScreen');
    const deathReasonElement = document.getElementById('deathReason');
    const deathHumorElement = document.getElementById('deathHumor');
    
    if (deathScreen) {
        deathScreen.classList.add('show');
    }
    
    if (deathReasonElement) {
        let deathText = reason;
        if (totalCoinsLost > 0) {
            deathText += ` • Lost ${totalCoinsLost} URC`;
        }
        deathText += ` • Distance: ${Math.floor(totalDistanceTraveled)} blocks`;
        deathReasonElement.textContent = deathText;
    }
    
    if (deathHumorElement) {
        // Pick a random humor message
        const randomMessage = deathMessages[Math.floor(Math.random() * deathMessages.length)];
        deathHumorElement.textContent = randomMessage;
    }
    
    // Start creating new token immediately
    isCreatingNewToken = true;
    
    // Hide respawn hint and show minting progress
    const respawnHint = document.getElementById('respawnHint');
    const mintingProgress = document.getElementById('mintingProgress');
    const mintingStatus = document.getElementById('mintingStatus');
    
    if (respawnHint) {
        respawnHint.style.display = 'none';
    }
    if (mintingProgress) {
        mintingProgress.style.display = 'block';
        if (mintingStatus) {
            mintingStatus.textContent = 'Initializing new token...';
        }
    }
    
    // Create new token asynchronously
    createNewPlayerToken().then(() => {
        console.log('New player token created on death');
        isCreatingNewToken = false;
        
        // Show respawn hint
        if (respawnHint) {
            respawnHint.style.display = 'block';
            respawnHint.style.color = '#888888';
        }
        if (mintingProgress) {
            mintingProgress.style.display = 'none';
        }
    }).catch((error) => {
        console.error('Error creating new player token on death:', error);
        isCreatingNewToken = false;
        
        // Show error state
        if (mintingStatus) {
            mintingStatus.textContent = 'Failed to create token. Press SPACE to retry.';
            mintingStatus.style.color = '#ff5555';
        }
        if (respawnHint) {
            respawnHint.style.display = 'block';
            respawnHint.style.color = '#888888';
        }
    })
    
    // Stop player movement
    if (noa && noa.playerEntity) {
        const movement = noa.entities.getMovement(noa.playerEntity);
        if (movement) {
            movement.running = false;
        }
        // Disable all input
        noa.inputs.state.forward = false;
        noa.inputs.state.backward = false;
        noa.inputs.state.left = false;
        noa.inputs.state.right = false;
        noa.inputs.state.jump = false;
    }
    
    // Listen for space key to respawn
    const respawnHandler = (e) => {
        if (e.code === 'Space' && isPlayerDead && !isCreatingNewToken) {
            e.preventDefault();
            document.removeEventListener('keydown', respawnHandler);
            respawnPlayer();
        }
    };
    document.addEventListener('keydown', respawnHandler);
    
    // Also listen for touch/click on death screen
    const deathScreenClickHandler = (e) => {
        if (isPlayerDead && !isCreatingNewToken) {
            e.preventDefault();
            document.removeEventListener('keydown', respawnHandler);
            deathScreen.removeEventListener('click', deathScreenClickHandler);
            deathScreen.removeEventListener('touchend', deathScreenClickHandler);
            respawnPlayer();
        }
    };
    
    if (deathScreen) {
        deathScreen.addEventListener('click', deathScreenClickHandler);
        deathScreen.addEventListener('touchend', deathScreenClickHandler);
    }
}

// Set up pause controls with P key
function setupPauseControls() {
    // Store original update functions
    let originalBeforeRender = null;
    let originalTick = null;
    let pausedVelocities = new Map(); // Store velocities when pausing
    
    // Listen for P key to toggle pause
    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyP' && !isPlayerDead) {
            e.preventDefault();
            isPaused = !isPaused;
            
            // Show or hide stats screen
            if (isPaused) {
                showStatsScreen();
            } else {
                hideStatsScreen();
            }
            
            if (isPaused) {
                console.log('Game PAUSED - Press P to resume');
                
                // Stop player movement
                if (noa && noa.playerEntity) {
                    const movement = noa.entities.getMovement(noa.playerEntity);
                    if (movement) {
                        movement.running = false;
                    }
                    // Disable all input
                    noa.inputs.state.forward = false;
                    noa.inputs.state.backward = false;
                    noa.inputs.state.left = false;
                    noa.inputs.state.right = false;
                    noa.inputs.state.jump = false;
                    
                    // Store and freeze player physics
                    const physics = noa.entities.getPhysics(noa.playerEntity);
                    if (physics && physics.body) {
                        pausedVelocities.set('player', [...physics.body.velocity]);
                        physics.body.velocity = [0, 0, 0];
                        physics.body.sleepTimeLimit = 0;
                    }
                }
                
                // Freeze drone
                if (droneEntity && noa.entities.hasComponent(droneEntity, noa.entities.names.position)) {
                    const physics = noa.entities.getPhysics(droneEntity);
                    if (physics && physics.body) {
                        pausedVelocities.set('drone', [...physics.body.velocity]);
                        physics.body.velocity = [0, 0, 0];
                        physics.body.sleepTimeLimit = 0;
                    }
                }
                
                // Freeze all projectiles
                projectiles.forEach((proj, index) => {
                    if (noa.entities.hasComponent(proj.entity, noa.entities.names.position)) {
                        const physics = noa.entities.getPhysics(proj.entity);
                        if (physics && physics.body) {
                            pausedVelocities.set(`projectile_${index}`, [...physics.body.velocity]);
                            physics.body.velocity = [0, 0, 0];
                            physics.body.sleepTimeLimit = 0;
                        }
                    }
                });
                
                // Show pause indicator
                const pauseDiv = document.createElement('div');
                pauseDiv.id = 'pauseIndicator';
                pauseDiv.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0, 0, 0, 0.8);
                    color: white;
                    padding: 20px 40px;
                    font-family: sans-serif;
                    font-size: 48px;
                    font-weight: bold;
                    border-radius: 10px;
                    z-index: 9999;
                    pointer-events: none;
                `;
                pauseDiv.textContent = 'PAUSED';
                document.body.appendChild(pauseDiv);
                
            } else {
                console.log('Game RESUMED');
                
                // Restore player physics
                if (noa && noa.playerEntity) {
                    const physics = noa.entities.getPhysics(noa.playerEntity);
                    if (physics && physics.body && pausedVelocities.has('player')) {
                        physics.body.velocity = pausedVelocities.get('player');
                        physics.body.sleepTimeLimit = -1;
                    }
                }
                
                // Restore drone physics
                if (droneEntity && noa.entities.hasComponent(droneEntity, noa.entities.names.position)) {
                    const physics = noa.entities.getPhysics(droneEntity);
                    if (physics && physics.body && pausedVelocities.has('drone')) {
                        physics.body.velocity = pausedVelocities.get('drone');
                        physics.body.sleepTimeLimit = -1;
                    }
                }
                
                // Restore projectile physics
                projectiles.forEach((proj, index) => {
                    if (noa.entities.hasComponent(proj.entity, noa.entities.names.position)) {
                        const physics = noa.entities.getPhysics(proj.entity);
                        const key = `projectile_${index}`;
                        if (physics && physics.body && pausedVelocities.has(key)) {
                            physics.body.velocity = pausedVelocities.get(key);
                            physics.body.sleepTimeLimit = -1;
                        }
                    }
                });
                
                // Clear stored velocities
                pausedVelocities.clear();
                
                // Remove pause indicator
                const pauseDiv = document.getElementById('pauseIndicator');
                if (pauseDiv) {
                    pauseDiv.remove();
                }
            }
        }
    });
    
    // Override input handling during pause
    const originalBindings = {};
    ['forward', 'backward', 'left', 'right', 'jump'].forEach(action => {
        const original = noa.inputs.state[action];
        Object.defineProperty(noa.inputs.state, action, {
            get: function() {
                return isPaused ? false : this['_' + action];
            },
            set: function(value) {
                this['_' + action] = value;
            }
        });
        noa.inputs.state['_' + action] = original;
    });
}

// Set up touch controls for mobile devices
function setupTouchControls() {
    // Detect if we're on a mobile device (not just touch-capable)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (window.innerWidth <= 768 && 'ontouchstart' in window);
    
    const touchControls = document.getElementById('touchControls');
    if (!touchControls) return;
    
    // Show controls on mobile devices only
    if (isMobile) {
        touchControls.classList.add('show');
        console.log('Mobile device detected - touch controls enabled');
        
        // Only attach event listeners if not already attached
        if (!touchControls.hasAttribute('data-listeners-attached')) {
            attachTouchEventListeners(touchControls);
            touchControls.setAttribute('data-listeners-attached', 'true');
        }
    } else {
        touchControls.classList.remove('show');
        console.log('Desktop device detected - touch controls disabled');
    }
}

// Separate function to attach touch event listeners
function attachTouchEventListeners(touchControls) {
    const touchZones = touchControls.querySelectorAll('.touchZone');
    touchZones.forEach(zone => {
        const action = zone.getAttribute('data-action');
        
        // Touch start - simulate key down
        zone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (isPlayerDead) {
                // Special handling for respawn (check if token is ready)
                if (action === 'jump' && !isCreatingNewToken) {
                    respawnPlayer();
                }
                return;
            }
            
            // Simulate key press
            if (action === 'left') {
                noa.inputs.state.left = true;
            } else if (action === 'right') {
                noa.inputs.state.right = true;
            } else if (action === 'jump') {
                noa.inputs.state.jump = true;
            }
        });
        
        // Touch end - simulate key up
        zone.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Simulate key release
            if (action === 'left') {
                noa.inputs.state.left = false;
            } else if (action === 'right') {
                noa.inputs.state.right = false;
            } else if (action === 'jump') {
                noa.inputs.state.jump = false;
            }
        });
        
        // Also handle mouse events for testing on desktop (only if controls are visible)
        zone.addEventListener('mousedown', (e) => {
            // Skip if controls are not visible
            if (!touchControls.classList.contains('show')) return;
            e.preventDefault();
            
            if (isPlayerDead) {
                if (action === 'jump' && !isCreatingNewToken) {
                    respawnPlayer();
                }
                return;
            }
            
            if (action === 'left') {
                noa.inputs.state.left = true;
            } else if (action === 'right') {
                noa.inputs.state.right = true;
            } else if (action === 'jump') {
                noa.inputs.state.jump = true;
            }
        });
        
        zone.addEventListener('mouseup', (e) => {
            // Skip if controls are not visible
            if (!touchControls.classList.contains('show')) return;
            e.preventDefault();
            
            if (action === 'left') {
                noa.inputs.state.left = false;
            } else if (action === 'right') {
                noa.inputs.state.right = false;
            } else if (action === 'jump') {
                noa.inputs.state.jump = false;
            }
        });
        
        // Prevent context menu on touch hold
        zone.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    });
}

// Respawn player after death
async function respawnPlayer() {
    isPlayerDead = false;
    
    // Hide death screen
    const deathScreen = document.getElementById('deathScreen');
    if (deathScreen) {
        deathScreen.classList.remove('show');
    }
    
    // Token should already be created during death screen
    // Just start periodic updates
    updateTokenStatusDisplay();
    startPeriodicUpdates();
    console.log('Started periodic token updates for new token');
    
    // Reset health
    currentPlayerHealth = 100;
    updateHealthDisplay(currentPlayerHealth);
    
    // Find spawn position
    const spawnPos = calculateInitialSpawnPoint(WORLD_SEED);
    console.log(`Respawning player at: ${spawnPos}`);
    noa.entities.setPosition(noa.playerEntity, spawnPos);
    
    // Check what's at spawn position after setting
    setTimeout(() => {
        const actualPos = noa.entities.getPosition(noa.playerEntity);
        const blockBelow = noa.world.getBlockID(
            Math.floor(actualPos[0]), 
            Math.floor(actualPos[1] - 1), 
            Math.floor(actualPos[2])
        );
        console.log(`Player actual position after respawn: ${actualPos}, block below: ${blockBelow} (5=blue corridor)`);
    }, 100);
    
    // Reset distance tracking
    playerStartZ = spawnPos[2];
    totalDistanceTraveled = 0;
    
    // Start new run tracking
    playerStats.currentRunStartTime = Date.now();
    playerStats.currentRunDistance = 0;
    
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
    
}