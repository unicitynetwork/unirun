# Unicity Token Integration Documentation

## Current Implementation

The game currently uses the **real Unicity SDK** (`@unicitylabs/state-transition-sdk`) to manage player state in tokens, 
but operates in **offline mode** without network proofs.

### How Player State is Stored:

1. **Token Structure**:
   ```javascript
   {
     id: TokenId,
     type: TokenType,
     state: {
       predicate: UnmaskedPredicate, // Controls who can update the token
       data: {
         name: "Runner-XXX",
         position: [x, y, z],
         health: 100,
         score: 0,
         lastUpdate: timestamp
       }
     }
   }
   ```

2. **State Updates**: Every 10 seconds, the game:
   - Captures current player position and health
   - Creates a new `TokenState` with updated data
   - Stores the token in localStorage
   - **Does NOT submit to Unicity network** (offline mode)

3. **Security**:
   - Uses `UnmaskedPredicate` with player's private key
   - Only the holder of the private key can update the token
   - Private key stored in localStorage (for demo purposes)

## What's Missing for Network Integration:

### 1. Network Connection
- Need Unicity network endpoint configuration
- Client authentication credentials
- Network type selection (testnet/mainnet)

### 2. Transaction Proofs
- State transitions should be submitted to network
- Each update should receive:
  - Transaction ID
  - Block number
  - Inclusion proof
  - Timestamp from network

### 3. Token Creation on Network
- New players should have tokens created on-chain
- Initial state should be recorded in network
- Creation fees/gas handling

### 4. State Verification
- Periodic verification against network state
- Conflict resolution if local/network states differ
- Proof validation

## To Enable Network Proofs:

1. **Configure Network Access**:
   ```javascript
   const UNICITY_CONFIG = {
     endpoint: 'https://api.unicity.network', // Replace with actual
     apiKey: 'YOUR_API_KEY',
     networkType: 'testnet'
   };
   ```

2. **Uncomment Network Code** in `main.js`:
   - Remove TODO comments in `startPeriodicUpdates()`
   - Import `unicity-integration.js`
   - Initialize client on game start

3. **Handle Network Failures**:
   - Continue saving locally if network is down
   - Queue updates for later submission
   - Show network status in UI

4. **Add Proof Display**:
   - Show last proof timestamp
   - Display transaction ID
   - Link to block explorer

## Benefits of Network Integration:

1. **Verifiable Game State**: Other players/services can verify your achievements
2. **Anti-Cheat**: State transitions are validated by network consensus
3. **Interoperability**: Tokens can be used in other Unicity applications
4. **Persistence**: State backed up on blockchain, not just localStorage
5. **Trading**: Players could potentially trade tokens/items

## Security Considerations:

1. **Private Key Management**: 
   - Currently stored in localStorage (demo only)
   - Production should use secure key storage
   - Consider hardware wallets or secure enclaves

2. **State Validation**:
   - Network validates state transitions
   - Prevents impossible state changes
   - Rate limiting on updates

3. **Cost Management**:
   - Each state update costs gas/fees
   - Consider batching updates
   - Implement update throttling

## Next Steps:

1. Obtain Unicity network access credentials
2. Test integration on testnet first
3. Implement proper error handling
4. Add UI indicators for network status
5. Consider offline-first architecture with sync