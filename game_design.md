# Game Design Document: Project Maze Runner (Revision 4)

## 1\. Introduction

### 1.1. Game Concept

Project Maze Runner is an HTML5-based, infinite-runner MMORPG designed for both mobile and PC web browsers. Drawing inspiration from the core mechanics of "Temple Run," the game places all players in a single, shared, procedurally generated 2D maze. The experience is non-stop, with players constantly running, dodging obstacles, and competing for loot in a persistent world.

### 1.2. Core Pillars

**Massively Multiplayer, Zero Server:** A true peer-to-peer (P2P) experience where the world is shared by everyone, but all game logic runs on the players' machines.

**Synchronized Infinite World:** All players generate the exact same world on their local machines. The world seed is periodically regenerated based on a verifiable random number generation (RNG) process and agreed upon by all players via a consensus mechanism.

**High-Stakes Competition:** Death is not the end, but it comes at a cost. Players drop all their loot upon death, creating a dynamic and competitive environment where others can seize their fortune.

## 2\. Game Mechanics

### 2.1. Player Movement

The player character is always running forward automatically. Player control is limited to navigation.

**Turning:** Players can only turn left or right when inside a room to choose an exit corridor. Corridors themselves do not intersect; they can only overlap (see section 3.1).

**Strafing:** Players can strafe left or right to dodge obstacles and collect items.

### 2.2. Health and Damage

Players start with 100 Health Points (HP), which can be decreased by hazards and traps or increased by power-ups. Death occurs at 0 HP or from instant-kill events.

### 2.3. Death and Respawn

**Standard Death:** Upon death, a backpack containing all loot is dropped at the nearest safe tile. This backpack can be collected by other players.

**Void Death:** Falling into a void results in an instant kill. The player's loot is permanently lost and an equivalent value is re-spawned elsewhere in the level.

**Respawn:** The player respawns at their last activated checkpoint.

### 2.4. Checkpoints

Checkpoints are personal respawn points activated by running over them. A checkpoint is disabled if the path segment between it and all subsequent checkpoints is cleared of loot, forcing players to be relocated to the nearest active checkpoint.

## 3\. Level Design

The level is an infinite, procedurally generated directed acyclic graph (DAG) composed of rooms and corridors.

**Corridors:** 3 tiles or less in width.

**Rooms:** 4 tiles or more in width and length.

### 3.1. Procedural Generation \& Layout

The layout consists of perpendicular and parallel corridors. Corridors can overlap as skybridges but are not connected at these overlaps; players can only switch paths by going through a room.

### 3.2. Navigation and Flow Control

One-way flow is enforced by doors and bridges.

**Doors (corridor-to-room):** Automated.

**Exits (room-to-corridor):** Automated or opened via a pressure plate in the room.

**Dimensions \& Hazards:** All doors/bridges are 1-tile wide. Tiles next to bridges are void (instant kill), while tiles next to doors are walls.

## 4\. Player-to-Player (P2P) Interaction

### 4.1. Lethal Interactions

**Collision Kill:** A moving player bumping into a stationary (blocked) player results in an instant kill and loot transfer.

**Speed Kill:** A speed-boosted player hitting a slower player results in an instant kill and loot transfer.

### 4.2. Non-Lethal Interactions

**Strafe Damage:** Strafing into another player inflicts a moderate amount of damage.

## 5\. Items and Loot

The level contains collectible boosters (health packs, armor, speed modifiers) and loot (coins of various denominations and rare emerald banknotes).

## 6\. System Architecture

The game's architecture is designed for platform independence and modularity, separating the core logic from the user interface.

### 6.1. Meta-Game Engine

This is the heart of the game. It is a platform-agnostic JavaScript module capable of running in both Node.js and browser environments.

**Responsibilities:**

* **Game Logic:** Manages the entire game state, simulation, physics, and rule enforcement.
* **P2P Communication:** Handles all peer-to-peer networking logic for sharing player state and game events.
* **Proofs:** Generates proofs of correct game simulation to be validated by peers, forming the basis of the anti-cheat and consensus system.
* **API (Application Programming Interface):** The engine provides a well-defined API. The Game Terminal interacts with the game exclusively through this API, allowing for a clean separation of concerns.

### 6.2. Game Terminal

The Game Terminal is the interface between a user (human or bot) and the Meta-Game Engine.

**Role:** It renders the game state provided by the engine and passes user/bot input back to the engine via its API.

**Examples of Terminals:**

* **Browser Graphical Terminal:** The primary interface for most players, implemented as an HTML5 application.

  * **View:** Renders a graphical view of the game, either top-down or with a more advanced 3rd-person flying camera.
  * **Controls:** Handles input from a keyboard (for PC) or touchscreen/accelerometer (for mobile devices).

* **Text-Based Terminal:** A minimalist interface designed for bots or remote play (e.g., via SSH) in a Node.js environment.

  * **View:** Renders the game state using text characters in a console.
  * **Controls:** Accepts input directly from keyboard keystrokes.

## 7\. Technical Foundation

### 7.1. Platform

**Technology:** Universal JavaScript (for the Meta-Game Engine), HTML5 (for the graphical terminal).

**Compatibility:** Modern web browsers and Node.js environments.

### 7.2. Network Architecture

**Model:** Peer-to-Peer (P2P) with client-side authority, validated by proofs.

**Overlay Network Server:** A lightweight server using WebSockets Secure (wss://) is used only for P2P connection brokering and discovery. It does not handle game logic.

