// An upload in pieces (ADR 021, plan 04 Task 9): the session in the database, the pieces on the
// web's disk (MEDIA_UPLOAD_DIR), outside the keys of the storage.

/** One upload of one person, as stored. */
export interface UploadSessionRecord {
  id: string
  organizationId: string
  workspaceId: string
  userId: string
  folderId: string | null
  originalName: string
  /** as declared; the bytes decide at completion */
  mime: string
  sizeBytes: number
  firstPartSha256: string
  /** piece number → hex sha256 of the piece received */
  parts: Record<string, string>
  expiresAt: Date
  completedAt: Date | null
  mediaId: string | null
  createdAt: Date
}

export interface UploadSessionsRepository {
  create(
    record: Omit<UploadSessionRecord, 'parts' | 'completedAt' | 'mediaId' | 'createdAt'>,
  ): Promise<UploadSessionRecord>
  /** `forUpdate`: the row stays locked until the transaction ends (one piece at a time). */
  findById(
    organizationId: string,
    uploadId: string,
    opts?: { forUpdate?: boolean },
  ): Promise<UploadSessionRecord | null>
  /** The person's uploads of the workspace neither completed nor expired, oldest first. */
  listOpen(
    organizationId: string,
    workspaceId: string,
    userId: string,
    now: Date,
  ): Promise<UploadSessionRecord[]>
  recordPart(organizationId: string, uploadId: string, n: number, sha256: string): Promise<void>
  complete(organizationId: string, uploadId: string, mediaId: string, at: Date): Promise<void>
  /**
   * Takes the completion of an upload not complete until `until`, unless another one holds it:
   * false then. Its space stays reserved at least as long (the expiry moves to `until` if
   * earlier), so an upload expiring while its pieces are joined does not free it.
   */
  claimCompletion(
    organizationId: string,
    uploadId: string,
    now: Date,
    until: Date,
  ): Promise<boolean>
  /**
   * Gives the completion back after a failure, if it is still the one held `until`: the next
   * call may try again at once, and a hold taken by another call stays.
   */
  releaseCompletion(organizationId: string, uploadId: string, until: Date): Promise<void>
  delete(organizationId: string, uploadId: string): Promise<void>
  /**
   * The space the uploads neither completed nor expired keep for their files: in the agency and
   * in one workspace.
   */
  reservedBytes(
    organizationId: string,
    workspaceId: string,
    now: Date,
  ): Promise<{ organization: number; workspace: number }>
  /**
   * Upload creations of the agency go one at a time until the transaction ends, so two of them
   * cannot both take the last free space.
   */
  lockReservations(organizationId: string): Promise<void>
  /** Removes the agency's uploads expired before `now`, completed or not; returns their ids. */
  deleteExpired(organizationId: string, now: Date): Promise<string[]>
  /** The ids of every upload of the agency still in the table. */
  listIds(organizationId: string): Promise<string[]>
}

/** Where a piece waits; `pending` is the server's own name for it until it is kept. */
export interface ReceivedPart {
  size: number
  sha256: string
  pending: string
}

/** The pieces of the uploads, on disk. Every name is built from ids the server checked. */
export interface UploadParts {
  /**
   * Writes the body as it arrives, with its sha256, as a pending piece. Past `maxBytes` it stops
   * reading and keeps nothing: `too_large`.
   */
  receive(
    organizationId: string,
    uploadId: string,
    body: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<ReceivedPart | 'too_large'>
  /** The pending piece becomes piece `n` (replacing any file of that number). */
  keep(organizationId: string, uploadId: string, n: number, pending: string): Promise<void>
  /** Idempotent. */
  discard(organizationId: string, uploadId: string, pending: string): Promise<void>
  /** The first `bytes` bytes of piece 1, or fewer if it is shorter. */
  head(organizationId: string, uploadId: string, bytes: number): Promise<Uint8Array>
  /**
   * Pieces 1 to `count`, one after the other. `sha256()` is the digest of every byte the body
   * gave, once it is read to the end.
   */
  assemble(
    organizationId: string,
    uploadId: string,
    count: number,
  ): { body: AsyncIterable<Uint8Array>; sha256(): string }
  /** Every piece of the upload, pending or kept. Idempotent. */
  remove(organizationId: string, uploadId: string): Promise<void>
  /** The uploads of the agency with pieces on disk, and when their folder last changed. */
  list(organizationId: string): Promise<{ uploadId: string; modifiedAt: Date }[]>
}
