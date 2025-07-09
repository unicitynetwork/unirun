// Unicity Network Integration for Real Proofs

import { 
    UnicityClient,
    TransactionBuilder,
    TransactionType,
    NetworkType
} from '@unicitylabs/state-transition-sdk';

// Configuration for Unicity network
const UNICITY_CONFIG = {
    // Replace with actual Unicity network endpoint
    endpoint: process.env.UNICITY_ENDPOINT || 'https://api.unicity.network',
    networkType: NetworkType.TESTNET, // or MAINNET
    timeout: 30000
};

// Initialize Unicity client
let unicityClient = null;

export async function initializeUnicityClient() {
    try {
        unicityClient = new UnicityClient({
            endpoint: UNICITY_CONFIG.endpoint,
            networkType: UNICITY_CONFIG.networkType,
            timeout: UNICITY_CONFIG.timeout
        });
        
        console.log('Unicity client initialized');
        return unicityClient;
    } catch (error) {
        console.error('Failed to initialize Unicity client:', error);
        throw error;
    }
}

// Submit state transition to Unicity network
export async function submitStateTransition(playerToken, newState, signingService) {
    if (!unicityClient) {
        throw new Error('Unicity client not initialized');
    }
    
    try {
        // Build the state transition transaction
        const transaction = await TransactionBuilder.createStateTransition({
            token: playerToken,
            newStateData: new TextEncoder().encode(JSON.stringify(newState)),
            signingService: signingService,
            transactionType: TransactionType.STATE_UPDATE
        });
        
        // Submit transaction to network
        const response = await unicityClient.submitTransaction(transaction);
        
        // Wait for transaction confirmation
        const receipt = await unicityClient.waitForTransactionReceipt(
            response.transactionId,
            { timeout: 20000 }
        );
        
        // Get inclusion proof
        const inclusionProof = await unicityClient.getInclusionProof(
            receipt.blockNumber,
            receipt.transactionIndex
        );
        
        return {
            transactionId: response.transactionId,
            receipt: receipt,
            inclusionProof: inclusionProof,
            blockNumber: receipt.blockNumber
        };
    } catch (error) {
        console.error('Failed to submit state transition:', error);
        throw error;
    }
}

// Verify token state against network
export async function verifyTokenState(tokenId) {
    if (!unicityClient) {
        throw new Error('Unicity client not initialized');
    }
    
    try {
        // Query current token state from network
        const networkState = await unicityClient.getTokenState(tokenId);
        
        // Verify inclusion proof
        const verificationResult = await unicityClient.verifyInclusionProof(
            networkState.inclusionProof
        );
        
        return {
            isValid: verificationResult.isValid,
            networkState: networkState,
            lastBlockNumber: networkState.blockNumber,
            stateHash: networkState.stateHash
        };
    } catch (error) {
        console.error('Failed to verify token state:', error);
        throw error;
    }
}

// Create token on network (for new players)
export async function createTokenOnNetwork(tokenId, tokenType, initialState, signingService) {
    if (!unicityClient) {
        throw new Error('Unicity client not initialized');
    }
    
    try {
        // Build token creation transaction
        const transaction = await TransactionBuilder.createToken({
            tokenId: tokenId,
            tokenType: tokenType,
            initialStateData: new TextEncoder().encode(JSON.stringify(initialState)),
            signingService: signingService,
            transactionType: TransactionType.TOKEN_CREATE
        });
        
        // Submit to network
        const response = await unicityClient.submitTransaction(transaction);
        
        // Wait for confirmation
        const receipt = await unicityClient.waitForTransactionReceipt(
            response.transactionId,
            { timeout: 30000 }
        );
        
        return {
            success: true,
            transactionId: response.transactionId,
            blockNumber: receipt.blockNumber
        };
    } catch (error) {
        console.error('Failed to create token on network:', error);
        throw error;
    }
}

// Get transaction history for a token
export async function getTokenTransactionHistory(tokenId, limit = 10) {
    if (!unicityClient) {
        throw new Error('Unicity client not initialized');
    }
    
    try {
        const history = await unicityClient.getTokenTransactions(tokenId, {
            limit: limit,
            includeProofs: true
        });
        
        return history.transactions.map(tx => ({
            transactionId: tx.id,
            blockNumber: tx.blockNumber,
            timestamp: tx.timestamp,
            stateHash: tx.stateHash,
            proof: tx.inclusionProof
        }));
    } catch (error) {
        console.error('Failed to get transaction history:', error);
        throw error;
    }
}