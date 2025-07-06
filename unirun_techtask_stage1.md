# **Technical Task: Unicity Runner (Demo Version) - Part 1: Standalone Client**

**Document Version:** 4.0 (Final for Part 1)
**Date:** July 6, 2025

## **1. High-Level Objective**

The goal of this development phase is to create a fully functional, **standalone, single-player client prototype** for the Unicity Runner. The application will run entirely in the browser and will serve as the foundation for all future development.

The core architectural principle to be validated is the management of the player's identity and state entirely within a **Unicity Token**. This token will act as the single source of truth for all player data and will be persisted in the browser's `localStorage` using the Unicity SDK's official serialization methods.

Key features to be implemented include a 3rd person camera, continuous procedural world generation from a deterministic seed, and a robust player lifecycle management system (creation, loading, and resetting).

**All backend, networking, and multiplayer functionality is explicitly out of scope for this part.**

## **2. Core Technologies & Reference Materials**

*   **Development Environment:** **Vite** or **Parcel** is highly recommended for its modern JavaScript tooling and fast development server.
*   **Rendering/Physics Engine:** [noa-engine](https://github.com/fenomas/noa) - A voxel game engine for the web.
*   **Unicity SDK:** [@unicity/state-transition-sdk](https://github.com/unicitynetwork/state-transition-sdk) - The core library for all token-related operations.
*   **SDK Bundler:** [Unicity JS SDK Bundler](https://github.com/unicitynetwork/android-wallet/tree/main/js-sdk-bundler) - A required tool to package the Node.js-centric Unicity SDK for browser compatibility.
*   **Default Textures:**
    *   **Wall Texture:** `https://cdn3.struffelproductions.com/file/ambientcg/media/images/Rock030_1K_Color.jpg`
    *   **Floor Texture:** `https://cdn3.struffelproductions.com/file/ambientcg/media/images/Ground037_1K_Color.jpg`

---

## **3. Detailed Implementation Plan**

### **Task 1: Project Setup**

1.  Initialize a new front-end project using Vite: `npm create vite@latest`.
2.  Install the `noa-engine` dependency: `npm install noa-engine`.
3.  Follow the instructions for the **Unicity JS SDK Bundler** to package the `@unicity/state-transition-sdk` into a browser-compatible JavaScript file. Integrate this bundled SDK into your project.
4.  Create a basic `index.html` file that includes a `<div id="app"></div>` for the game canvas and a button for resetting the player.

    ```html
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Unicity Runner - Demo</title>
        <style>
            body, html { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }
            #app { position: absolute; width: 100%; height: 100%; }
            #resetPlayer { position: absolute; top: 10px; left: 10px; z-index: 10; padding: 10px; font-family: sans-serif; cursor: pointer; }
        </style>
    </head>
    <body>
        <div id="app"></div>
        <button id="resetPlayer">Reset Player</button>
        <script type="module" src="/main.js"></script>
    </body>
    </html>
    ```

### **Task 2: Player Token Management & Deterministic Spawning**

This is the most critical part of the client's architecture.

1.  **Define World Seed:** At the top of your main game logic file, define a global constant for the world seed to ensure all procedural generation is repeatable.
    ```javascript
    const WORLD_SEED = 'UnicityRunnerDemo_v1_Seed_2025';
    ```
2.  **On Application Load:**
    *   Attempt to load the serialized player token string from `localStorage` using a single key: `unicityRunner_playerToken`.
    *   **If a saved token string exists:**
        *   Use the **Unicity SDK's import/deserialization method** to convert the string back into a live, usable token object (consult state-transition-sdk on how to achieve that). This is your `playerToken`.
        *   Log "Existing player token imported." to the console.
    *   **If no token exists (New Player Flow):**
        1.  **Calculate Spawn Point:** First, determine the player's starting position by running a deterministic calculation based on the `WORLD_SEED`. This ensures every new player starts in the same place. (See Task 4 for the helper function details).
        2.  **Define Initial State:** Create the initial state object using the calculated spawn point.
            ```javascript
            const spawnPosition = calculateInitialSpawnPoint(WORLD_SEED);
            const initialState = {
                name: "Runner-" + Math.floor(Math.random() * 1000),
                position: spawnPosition,
                health: 100,
                score: 0
            };
            ```
        3.  **Create and Save Token:** Use the Unicity SDK to generate a new keypair and create the new `playerToken` with this `initialState`. Then, use the **SDK's export/serialization method** to get a storable string and save it to `localStorage`.
3.  **Reset Functionality:**
    *   The `#resetPlayer` button's event handler must remove the token from `localStorage` (`localStorage.removeItem('unicityRunner_playerToken');`) and then force a page reload (`location.reload();`) to trigger the new player flow.

### **Task 3: `noa` Engine and World Setup**

1.  **Instantiate Engine & Configure 3rd Person Camera:**
    *   Set up the `noa` engine.
    *   Configure the camera for a 3rd person view that follows the player from a distance.
        ```javascript
        noa.camera.zoom = 5;      // Distance from player
        noa.camera.pitch = -0.5;  // Angle looking down
        ```
2.  **Set Initial Player Position from Token:**
    *   After the `playerToken` is loaded or created, extract the starting position directly from its state (`playerToken.state.position`).
    *   Set the player's position in the `noa` world: `noa.player.position.set(...initialPosition);`.
3.  **Register Materials & Blocks:** Register the wall and floor materials using the provided URLs. Define `wallID` and `floorID` blocks. **Block size is 1x1x1.**

### **Task 4: Continuous & Deterministic World Generation**

1.  **Initial Spawn Point Calculation `calculateInitialSpawnPoint(seed)`:**
    *   This helper function must be self-contained and not rely on `noa`.
    *   It must use the **exact same maze generation algorithm** (e.g., Recursive Backtracker) and a **seeded RNG** that the main world generator uses.
    *   Run this algorithm on a conceptual 2D grid for the central chunk (`0,0`).
    *   Select a deterministic open space as the spawn point (e.g., the center of the first open room found) and return its coordinate array `[x, y, z]`.
2.  **Continuous Generation (`noa.world.on('chunkBeingGenerated', ...)`):**
    *   This callback is the engine for the infinite world.
    *   It must use a seeded RNG based on the `WORLD_SEED` and the chunk's coordinates to ensure generation is deterministic.
    *   When called for the central chunk (`0,0`), it must generate the layout consistent with the `calculateInitialSpawnPoint` function.
    *   Render walls with a height of **2 blocks**.

### **Task 5: Periodic State Update and Token Persistence**

This task simulates the core gameplay loop of updating player state via Unicity transactions.

1.  Create a `setInterval` that runs every **10 seconds**.
2.  The callback function must perform the following sequence:
    1.  Get the player's current world position from `noa.player.getPosition()`.
    2.  Define the `newState` object, preserving all other state properties from the current token.
    3.  **Perform State Transition:** Use the Unicity SDK's state transition function to generate an **updated token object**.
    4.  **Update Live Token:** Replace the in-memory `playerToken` with the newly returned one.
    5.  **Serialize and Save:** Use the **SDK's export/serialization method** on the new token to get a storable string, then save that string to `localStorage`, overwriting the old entry.

### **Task 6: Stubbing for Future Multiplayer Integration**

1.  Create a `network.js` file with empty placeholder functions (`connectToServer`, `sendPlayerUpdate`, `handleStateUpdate`) to ensure a clean integration point for Part 2.

---

## **4. Definition of Done (Acceptance Criteria)**

The standalone client is considered complete when:
1.  The application loads and runs smoothly in a browser with a stable **3rd person camera**.
2.  **First Launch:** The application deterministically calculates a spawn point, creates a new Unicity **token** with this position in its state, and saves its **SDK-serialized representation** to `localStorage`.
3.  **Subsequent Launches:** The serialized token string is loaded from `localStorage` and **correctly deserialized by the SDK**. The player spawns at the position defined within that loaded token's state.
4.  **Deterministic Spawn:** After clicking "Reset Player," the new player character spawns at the **exact same initial location** as the very first player did.
5.  **Persistence:** The player can move to a new location, and after ~10 seconds, the application performs a **state transition via the SDK**. The new token is then **serialized via the SDK** and saved to `localStorage`. Reloading the page correctly loads this updated token and position.
6.  **World Generation:** The world is a continuous, deterministically generated maze with 2-block high walls, consistent with the spawn location. The player never reaches an "edge".
7.  The application code is clean, well-commented, and networking functions are correctly stubbed out for Part 2.