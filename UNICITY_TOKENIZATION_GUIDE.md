# Unicity Token Management Guide for In-Game Objects

This guide provides instructions for tokenizing in-game objects using the Unicity SDK. It covers patterns, best practices, and implementation details for creating and managing tokens that represent game assets.

## Overview

Unicity tokens can represent any in-game object with:
- Unique identity (TokenId)
- Type classification (TokenType)
- Mutable state (position, health, owner, etc.)
- Immutable properties (creation data, rarity, etc.)
- Ownership via predicates

## Token Structure

### 1. Token Components

```javascript
{
    id: TokenId,           // Unique identifier
    type: TokenType,       // Classification (weapon, item, currency, etc.)
    state: TokenState,     // Current state with predicate
    genesis: GenesisData,  // Immutable creation data
    transactions: [],      // History of state changes
}
```

### 2. TokenType Categories

Define token types for different object categories:

```javascript
const TOKEN_TYPES = {
    PLAYER: new Uint8Array([1]),      // Player tokens
    WEAPON: new Uint8Array([2]),      // Weapons
    ARMOR: new Uint8Array([3]),       // Armor pieces
    CONSUMABLE: new Uint8Array([4]),  // Potions, food, etc.
    CURRENCY: new Uint8Array([5]),    // Game currency
    KEY_ITEM: new Uint8Array([6]),    // Quest items
    BUILDING: new Uint8Array([7]),    // Player structures
    RESOURCE: new Uint8Array([8]),    // Crafting materials
};
```

## Implementation Patterns

### 1. Creating a New Game Object Token

```javascript
async function createGameObjectToken(objectType, initialData, ownerSigningService) {
    // Generate unique token ID
    const tokenId = window.UnicitySDK.TokenId.create(crypto.getRandomValues(new Uint8Array(32)));
    
    // Set token type based on object category
    const tokenType = TOKEN_TYPES[objectType];
    
    // Prepare state data
    const stateData = {
        name: initialData.name,
        owner: initialData.owner,
        attributes: initialData.attributes,
        position: initialData.position,
        equipped: false,
        stackSize: initialData.stackSize || 1,
        durability: initialData.durability || 100,
        lastModified: Date.now()
    };
    
    // Encode state data
    const encodedState = new TextEncoder().encode(JSON.stringify(stateData));
    const dataHash = await new window.UnicitySDK.DataHasher(
        window.UnicitySDK.HashAlgorithm.SHA256
    ).update(encodedState).digest();
    
    // Create predicate for ownership
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const predicate = await window.UnicitySDK.MaskedPredicate.create(
        tokenId,
        tokenType,
        ownerSigningService,
        window.UnicitySDK.HashAlgorithm.SHA256,
        nonce
    );
    
    // Create mint transaction
    const recipient = await window.UnicitySDK.DirectAddress.create(predicate.reference);
    const mintData = await window.UnicitySDK.MintTransactionData.create(
        tokenId,
        tokenType,
        new Uint8Array(0), // No immutable data for most items
        null,               // No coin data
        recipient.toString(),
        crypto.getRandomValues(new Uint8Array(32)), // salt
        dataHash,
        null // reason
    );
    
    // Submit to network
    const client = new window.UnicitySDK.StateTransitionClient(aggregatorClient);
    const commitment = await client.submitMintTransaction(mintData);
    const inclusionProof = await window.UnicitySDK.waitInclusionProof(
        client, 
        commitment,
        AbortSignal.timeout(30000)
    );
    
    // Create token state
    const tokenState = await window.UnicitySDK.TokenState.create(predicate, encodedState);
    
    // Create genesis record
    const genesis = await window.UnicitySDK.Genesis.create(
        commitment.requestId,
        inclusionProof,
        tokenState
    );
    
    // Create token
    const token = await window.UnicitySDK.Token.create(
        tokenId,
        tokenType,
        tokenState,
        genesis
    );
    
    return token;
}
```

### 2. Transferring Object Ownership

```javascript
async function transferGameObject(token, currentOwnerSigning, newOwnerAddress) {
    // Create new state with updated owner
    const currentState = JSON.parse(new TextDecoder().decode(token.state.data));
    currentState.owner = newOwnerAddress;
    currentState.lastModified = Date.now();
    
    const newStateData = new TextEncoder().encode(JSON.stringify(currentState));
    const dataHash = await new window.UnicitySDK.DataHasher(
        window.UnicitySDK.HashAlgorithm.SHA256
    ).update(newStateData).digest();
    
    // Create transaction data
    const transactionData = await window.UnicitySDK.TransactionData.create(
        token.state,
        newOwnerAddress,
        crypto.getRandomValues(new Uint8Array(32)), // salt
        dataHash,
        new TextEncoder().encode('Transfer ownership'),
        [] // no nametag tokens
    );
    
    // Create and submit commitment
    const commitment = await window.UnicitySDK.Commitment.create(
        transactionData, 
        currentOwnerSigning
    );
    
    // Process transaction...
}
```

### 3. Updating Object State

```javascript
async function updateObjectState(token, updates, ownerSigning) {
    // Merge updates with current state
    const currentState = JSON.parse(new TextDecoder().decode(token.state.data));
    const newState = { ...currentState, ...updates, lastModified: Date.now() };
    
    // Create new predicate for one-time address
    const newNonce = crypto.getRandomValues(new Uint8Array(32));
    const newSigningService = await window.UnicitySDK.SigningService.createFromSecret(
        ownerPrivateKey, 
        newNonce
    );
    const newPredicate = await window.UnicitySDK.MaskedPredicate.create(
        token.id,
        token.type,
        newSigningService,
        window.UnicitySDK.HashAlgorithm.SHA256,
        newNonce
    );
    
    // Continue with state transition...
}
```

## Game Integration Patterns

### 1. Inventory Management

```javascript
class TokenizedInventory {
    constructor(playerToken, signingService) {
        this.playerToken = playerToken;
        this.signingService = signingService;
        this.items = new Map(); // tokenId -> token
    }
    
    async addItem(itemToken) {
        // Update item to be owned by player
        await transferGameObject(itemToken, itemOwnerSigning, this.playerToken.id);
        this.items.set(itemToken.id.toString(), itemToken);
    }
    
    async equipItem(tokenId) {
        const item = this.items.get(tokenId);
        if (!item) throw new Error('Item not found');
        
        await updateObjectState(item, { equipped: true }, this.signingService);
    }
}
```

### 2. Crafting System

```javascript
async function craftItem(recipe, materialTokens, crafterSigning) {
    // Verify materials match recipe
    if (!verifyRecipeRequirements(recipe, materialTokens)) {
        throw new Error('Invalid materials for recipe');
    }
    
    // Burn material tokens (transfer to null address or special burn address)
    for (const material of materialTokens) {
        await burnToken(material, crafterSigning);
    }
    
    // Mint new crafted item
    const craftedItem = await createGameObjectToken(
        recipe.outputType,
        recipe.outputData,
        crafterSigning
    );
    
    return craftedItem;
}
```

### 3. Trading System

```javascript
async function createTrade(offer, request, offererSigning) {
    // Create atomic swap transaction
    const tradeData = {
        id: crypto.randomUUID(),
        offerer: offer.owner,
        requestor: request.owner,
        offerTokens: offer.tokenIds,
        requestTokens: request.tokenIds,
        status: 'pending',
        created: Date.now()
    };
    
    // Use escrow pattern or atomic swap
    // Implementation depends on Unicity features
}
```

## Best Practices

### 1. State Management
- Keep state data minimal and relevant
- Use compression for large state data
- Separate immutable properties (in genesis) from mutable state
- Version your state schema for upgrades

### 2. Performance Optimization
- Batch related operations
- Cache tokens locally with proper invalidation
- Use pending transaction recovery for reliability
- Implement retry logic with exponential backoff

### 3. Security Considerations
- Never store private keys in game state
- Validate all state transitions
- Use time locks for valuable items
- Implement multi-sig for high-value transfers

### 4. Token Design
- Use consistent type system across game
- Design for composability (items that can combine)
- Plan for token evolution (upgrades, enchantments)
- Consider token supply limits

## Common Patterns

### 1. Stackable Items
```javascript
// For fungible items like resources
const stateData = {
    ...baseData,
    stackSize: 100,
    maxStack: 999
};
```

### 2. Durability System
```javascript
// For equipment that degrades
const stateData = {
    ...baseData,
    durability: 100,
    maxDurability: 100,
    repairCount: 0
};
```

### 3. Bound Items
```javascript
// For soulbound/account-bound items
const stateData = {
    ...baseData,
    boundTo: playerTokenId,
    bindOnPickup: true,
    tradeable: false
};
```

### 4. Time-Limited Items
```javascript
// For temporary boosts or event items
const stateData = {
    ...baseData,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    activated: false
};
```

## Error Handling

Always implement proper error handling:

```javascript
try {
    const token = await createGameObjectToken(type, data, signing);
    return token;
} catch (error) {
    if (error.message.includes('REQUEST_ID_EXISTS')) {
        // Handle duplicate transaction
    } else if (error.message.includes('Predicate verification failed')) {
        // Handle ownership issues
    } else {
        // General error handling
    }
}
```

## Testing Patterns

1. **Mock Token Creation**: Create test tokens without network submission
2. **State Validation**: Verify state transitions follow game rules
3. **Load Testing**: Test with many tokens to ensure performance
4. **Recovery Testing**: Test pending transaction recovery

## Future Considerations

1. **Batch Operations**: Mint/transfer multiple tokens in one transaction
2. **Token Metadata**: Store additional data off-chain with hash reference
3. **Cross-Game Compatibility**: Design tokens for interoperability
4. **Upgrade Mechanisms**: Plan for token evolution and migrations