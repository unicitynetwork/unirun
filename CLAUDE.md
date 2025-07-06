# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository: unirun

A JavaScript/Node.js project by Unicity Labs (MIT License).

## Project Status

Unicity Runner Demo - A standalone, single-player voxel game prototype that manages player identity and state through Unicity Tokens. The game features:
- 3rd person camera controls
- Continuous procedural maze generation
- Player state persistence via Unicity SDK
- Token-based identity management

## Development Commands

1. `npm install` - Install all dependencies
2. `npm run build-sdk` - Build the Unicity SDK bundle (required before running dev server)
3. `npm run dev` - Start the Vite development server on port 3000
4. `npm run build` - Build the project for production
5. `npm run preview` - Preview the production build

## Architecture Notes

The project uses:
- **Vite** as the development server and build tool
- **noa-engine** for voxel rendering and physics (built on Babylon.js)
- **Unicity SDK** (bundled via webpack) for token management
- **localStorage** for client-side persistence
- **TypeScript** support for SDK development

Key files:
- `main.js` - Core game logic, token management, world generation (~931 lines)
- `network.js` - Stub functions for future multiplayer
- `sdk-bundler/` - Webpack configuration to bundle Unicity SDK for browser
- `public/unicity-sdk.js` - Bundled SDK output (UMD format)
- `test-sdk.html` - Manual test page for SDK functionality

## Key Patterns

1. **Token Management**: Player state is stored entirely in a Unicity token, serialized to localStorage
2. **Deterministic Generation**: World generation uses seeded RNG based on WORLD_SEED constant
3. **State Updates**: Position updates happen every 10 seconds via setInterval
4. **Maze Algorithm**: Dynamic room/corridor generation using seeded RNG:
   - Each chunk has 40% chance to contain a room (7-15 blocks)
   - Rooms have exits (East at z=13, North at x=15, West at z=17)
   - Corridors are color-coded by direction (red=east, blue=north, yellow=west)
   - Chunks check neighboring chunks for connecting corridors
5. **SDK Bundling**: Webpack bundles Unicity SDK with Node.js polyfills for browser compatibility