// Network module - Stub functions for future multiplayer integration

export function connectToServer(serverUrl) {
    // TODO: Implement WebSocket connection to game server
    console.log('connectToServer stub called with:', serverUrl);
}

export function sendPlayerUpdate(playerState) {
    // TODO: Send player state updates to server
    console.log('sendPlayerUpdate stub called with:', playerState);
}

export function handleStateUpdate(callback) {
    // TODO: Register callback for handling incoming state updates from server
    console.log('handleStateUpdate stub called');
}