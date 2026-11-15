import type {
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

export interface MediaRepository {
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
