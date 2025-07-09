// Export everything from the Unicity SDK
export * from '@unicitylabs/state-transition-sdk';

// Additional SDK exports that might not be in the main export
export { TokenJsonSerializer } from '@unicitylabs/state-transition-sdk/lib/serializer/json/token/TokenJsonSerializer.js';
export { TransactionJsonSerializer } from '@unicitylabs/state-transition-sdk/lib/serializer/json/transaction/TransactionJsonSerializer.js';
export { waitInclusionProof } from '@unicitylabs/state-transition-sdk/lib/utils/InclusionProofUtils.js';
export { Commitment } from '@unicitylabs/state-transition-sdk/lib/transaction/Commitment.js';

// Commons exports - Signing
export { SigningService } from '@unicitylabs/commons/lib/signing/SigningService.js';
export { Signature } from '@unicitylabs/commons/lib/signing/Signature.js';
export type { ISigningService } from '@unicitylabs/commons/lib/signing/ISigningService.js';
export type { ISignature } from '@unicitylabs/commons/lib/signing/ISignature.js';

// Commons exports - Hashing
export { HashAlgorithm } from '@unicitylabs/commons/lib/hash/HashAlgorithm.js';
export { DataHasher } from '@unicitylabs/commons/lib/hash/DataHasher.js';
export { DataHash } from '@unicitylabs/commons/lib/hash/DataHash.js';
export type { IDataHasher } from '@unicitylabs/commons/lib/hash/IDataHasher.js';

// Commons exports - Utilities
export { HexConverter } from '@unicitylabs/commons/lib/util/HexConverter.js';

// Commons exports - API/Inclusion Proof
export { InclusionProof, InclusionProofVerificationStatus } from '@unicitylabs/commons/lib/api/InclusionProof.js';
export { RequestId } from '@unicitylabs/commons/lib/api/RequestId.js';
export { Authenticator } from '@unicitylabs/commons/lib/api/Authenticator.js';
export { SubmitCommitmentStatus } from '@unicitylabs/commons/lib/api/SubmitCommitmentResponse.js';