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

/** The copy behind a public token (`/m/*`, spec §16.1): what the public host needs to serve it. */
export interface PublicVariantRecord {
  id: string
  organizationId: string
  storageKey: string
  mime: string
  sizeBytes: number
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

/** A folder of a workspace's library (§11.8), with the files right inside it. */
export interface LibraryFolderRecord {
  id: string
  parentId: string | null
  name: string
  createdAt: Date
  /** files not deleted right inside it, not in its subfolders */
  fileCount: number
}

/** What narrows the library's list (plan 04 Task 12); all of them at once. */
export interface MediaFilter {
  kind?: MediaKind
  /** a folder's files, right inside it; `none`: the files in no folder */
  folder?: string
  /** files with this tag */
  tag?: string
  /** a part of the file's name, any case */
  name?: string
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
  /** Whether the workspace has a file not deleted, in any state. */
  hasFiles(organizationId: string, workspaceId: string): Promise<boolean>
  /**
   * The deleted files of the agency that still have an original or a copy stored: their
   * `media.delete_files` did not run, or did not finish.
   */
  deletedWithFiles(organizationId: string): Promise<string[]>
  /** The files still `processing` not changed since `before`: their wake-up may be lost. */
  processingSince(organizationId: string, before: Date): Promise<string[]>
  /** The files `failed` not changed since `before`, with their workspace (D-43). */
  failedSince(organizationId: string, before: Date): Promise<{ id: string; workspaceId: string }[]>
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
  /** Writes or replaces the copy of that purpose; a replaced copy takes the new id. */
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
  /**
   * A file still `processing` becomes `failed` with its reason; `forgetOriginal` clears its key
   * (a final refusal). false: no longer `processing`.
   */
  markFailed(
    organizationId: string,
    mediaId: string,
    failed: { failure: MediaFailure; facts: MediaFacts | null; forgetOriginal: boolean },
  ): Promise<boolean>
  /** Sets the progress of a file still `processing`; false: no such file. */
  setProgress(organizationId: string, mediaId: string, progress: MediaProgress): Promise<boolean>
  /**
   * The files of a workspace not deleted, newest first, narrowed by the filter; `before`: the
   * files after this one.
   */
  listForWorkspace(
    organizationId: string,
    workspaceId: string,
    page: { before?: string; limit: number; filter?: MediaFilter },
  ): Promise<MediaRecord[]>
  /** Every tag used in the library of the workspace, by name. */
  tagsOf(organizationId: string, workspaceId: string): Promise<string[]>
  /**
   * Files the folder and the tags of a file of the workspace, putting it into the library if it
   * was not. Only what is given changes.
   */
  setLibraryEntry(
    organizationId: string,
    workspaceId: string,
    mediaId: string,
    entry: { folderId?: string | null; tags?: string[] },
  ): Promise<void>
  /**
   * Until the transaction ends, no other change to the folders of this workspace: the checks on
   * loops, depth and count read the tree first.
   */
  lockFolders(organizationId: string, workspaceId: string): Promise<void>
  /** The folders of the workspace's library, by name. */
  listFolders(organizationId: string, workspaceId: string): Promise<LibraryFolderRecord[]>
  /** `taken`: a folder beside it has the same name, whatever the case. */
  createFolder(folder: {
    id: string
    organizationId: string
    workspaceId: string
    name: string
    parentId: string | null
  }): Promise<'created' | 'taken'>
  /** Renames or moves a folder; `taken` as above; `missing`: no such folder. */
  updateFolder(
    organizationId: string,
    workspaceId: string,
    folderId: string,
    change: { name?: string; parentId?: string | null },
  ): Promise<'updated' | 'taken' | 'missing'>
  /** The files right inside these folders of the workspace's library, any status but deleted. */
  mediaInFolders(
    organizationId: string,
    workspaceId: string,
    folderIds: readonly string[],
  ): Promise<string[]>
  /**
   * Deletes these folders of the workspace, which must hold no file any more (the caller marks
   * them deleted first). An upload still open into one of them lands outside any folder.
   */
  deleteFolders(
    organizationId: string,
    workspaceId: string,
    folderIds: readonly string[],
  ): Promise<void>
  /** Any status, deleted included. */
  findById(organizationId: string, mediaId: string): Promise<MediaRecord | null>
  variantsOf(organizationId: string, mediaIds: readonly string[]): Promise<MediaVariantRecord[]>
  /**
   * The copy with this public token, if its file is `ready`; read in the system scope, by the
   * public host only (ADR 021). null: no such token, or its file is not ready (deleted included).
   */
  findPublicVariant(token: string): Promise<PublicVariantRecord | null>
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
  /**
   * Bytes still stored (originals and variants), in the agency and in one of its workspaces
   * (0 for the workspace when none is named).
   */
  storageUsed(organizationId: string, workspaceId: string | null): Promise<StorageUsed>
}
