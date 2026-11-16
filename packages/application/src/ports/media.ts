import type {
  FileAnalysis,
  MediaChecks,
  MediaFailure,
  MediaKind,
  MediaProgress,
  MediaStatus,
  StorageUsed,
  VariantPurpose,
} from '@app/domain'

/** A file of a workspace, with its library entry (spec §13). */
export interface MediaRecord {
  id: string
  organizationId: string
  workspaceId: string
  uploadedBy: string
  kind: MediaKind
  status: MediaStatus
  originalName: string
  mime: string
  sizeBytes: number
  sha256: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
  progress: MediaProgress | null
  /** why the file is `failed`; null otherwise */
  failure: MediaFailure | null
  /** what the worker corrected and what it proposes, once `ready` */
  checks: MediaChecks | null
  /** how many times the worker picked the file (plan 04 Task 10) */
  processingAttempts: number
  /** the original file; null once removed */
  storageKey: string | null
  deletedAt: Date | null
  createdAt: Date
  /** null: not in the library (or no folder: `inLibrary` tells) */
  folderId: string | null
  tags: string[]
  inLibrary: boolean
}

/** A copy made by the worker. Its `public_token` never leaves the database before stage 7. */
export interface MediaVariantRecord {
  id: string
  mediaId: string
  purpose: VariantPurpose
  storageKey: string
  mime: string
  sizeBytes: number
  width: number | null
  height: number | null
}

/** A file as the completion of an upload writes it, with its library entry (§11.8). */
export interface NewMedia {
  id: string
  organizationId: string
  workspaceId: string
  uploadedBy: string
  kind: MediaKind
  status: Extract<MediaStatus, 'processing' | 'failed'>
  originalName: string
  mime: string
  sizeBytes: number
  /** of the whole file; null when nothing was stored */
  sha256: string | null
  /** null: nothing was stored (a file of no type Feedway takes) */
  storageKey: string | null
  /** what the bytes said, when they said it already (`{ kind: 'unknown' }`) */
  analysis: Record<string, unknown> | null
  /** `failed` at once: why */
  failure: MediaFailure | null
  folderId: string | null
}

/** A copy the worker made, as it is stored. */
export interface NewMediaVariant {
  id: string
  purpose: VariantPurpose
  storageKey: string
  /** only the copy to publish has one (plan 04, Scelta 6); never the preview */
  publicToken: string | null
  mime: string
  sizeBytes: number
  width: number
  height: number
}

/** What the analysis read, into the columns of the file (spec §13). */
export interface MediaFacts {
  analysis: FileAnalysis
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  videoCodec: string | null
  audioCodec: string | null
}

/** The file the worker picks next: ids only, read across the agencies (ADR 021). */
export interface MediaTurn {
  organizationId: string
  mediaId: string
}

export interface MediaRepository {
  /** Writes the file and puts it into the library of its workspace. */
  create(media: NewMedia): Promise<void>
  /** Whether the folder exists in the library of that workspace. */
  folderExists(organizationId: string, workspaceId: string, folderId: string): Promise<boolean>
  /**
   * The deleted files of the agency that still have an original or a copy stored: their
   * `media.delete_files` did not run, or did not finish.
   */
  deletedWithFiles(organizationId: string): Promise<string[]>
  /** The files still `processing` not changed since `before`: their wake-up may be lost. */
  processingSince(organizationId: string, before: Date): Promise<string[]>
  /**
   * SYSTEM scope only: the next file `processing` of the installation, from the agency served
   * least recently (the latest `processing_started_at` of its files), the oldest file first.
   */
  nextToProcess(): Promise<MediaTurn | null>
  /**
   * The worker takes a file still `processing`: one more attempt, and its start is the agency's
   * turn. null: no such file any more.
   */
  claimProcessing(organizationId: string, mediaId: string, at: Date): Promise<MediaRecord | null>
  /**
   * Gives back the attempt of a claim that ended in a passing failure (thrown to be retried):
   * only runs that never ended, a crash or the memory, count toward the cap.
   */
  releaseAttempt(organizationId: string, mediaId: string): Promise<void>
  /** Writes or replaces the copy of that purpose. */
  saveVariant(organizationId: string, mediaId: string, variant: NewMediaVariant): Promise<void>
  /** Removes the copies' rows; returns their keys, for the storage. */
  dropVariants(organizationId: string, mediaId: string): Promise<string[]>
  /**
   * A file still `processing` becomes `ready`, with what the analysis read; `forgetOriginal`
   * clears its key (a photo's original goes). false: it is no longer `processing` (deleted).
   */
  markReady(
    organizationId: string,
    mediaId: string,
    ready: MediaFacts & { checks: MediaChecks; forgetOriginal: boolean },
  ): Promise<boolean>
  /** A file still `processing` becomes `failed` with its reason. false: no longer `processing`. */
  markFailed(
    organizationId: string,
    mediaId: string,
    failed: { failure: MediaFailure; facts: MediaFacts | null },
  ): Promise<boolean>
  /** Sets the progress of a file still `processing`; false: no such file. */
  setProgress(organizationId: string, mediaId: string, progress: MediaProgress): Promise<boolean>
  /** The files of a workspace not deleted, newest first; `before`: the files after this one. */
  listForWorkspace(
    organizationId: string,
    workspaceId: string,
    page: { before?: string; limit: number },
  ): Promise<MediaRecord[]>
  /** Any status, deleted included. */
  findById(organizationId: string, mediaId: string): Promise<MediaRecord | null>
  variantsOf(organizationId: string, mediaIds: readonly string[]): Promise<MediaVariantRecord[]>
  /**
   * Marks the file of the workspace deleted and takes it out of the library. false: there is no
   * such file, or it was deleted already.
   */
  markDeleted(
    organizationId: string,
    workspaceId: string,
    mediaId: string,
    at: Date,
  ): Promise<boolean>
  /** After the files are removed: the variants' rows go and the original's key is cleared. */
  forgetFiles(organizationId: string, mediaId: string): Promise<void>
  /** Bytes still stored (originals and variants), in the agency and in one of its workspaces. */
  storageUsed(organizationId: string, workspaceId: string): Promise<StorageUsed>
}
