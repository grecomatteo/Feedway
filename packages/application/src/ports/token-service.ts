/** Random single-use tokens for our links (invites, activation); only the hash is stored. */
export interface TokenService {
  generate(): { token: string; hash: Buffer }
  hash(token: string): Buffer
}

export type SignedTokenPurpose = 'security_lock'

/** Stateless tokens signed with a key derived from APP_ENCRYPTION_KEY. */
export interface SignedTokens {
  sign(
    purpose: SignedTokenPurpose,
    payload: { userId: string; issuedAt: Date; expiresAt: Date },
  ): string
  /** `issuedAt` is null for a token signed before issue times were recorded. */
  verify(
    purpose: SignedTokenPurpose,
    token: string,
    now: Date,
  ): { userId: string; issuedAt: Date | null } | null
  /** Keyed hash of the random `__Host-device` cookie id, never of the user agent. */
  deviceHash(userId: string, deviceId: string): Buffer
  /** Keyed hash of an email address, for counters that must not hold the address itself. */
  addressHash(email: string): Buffer
}
