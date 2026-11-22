// The editor's logic with no page around it (plan 06 Task 5): which types go with the files,
// when a draft is born and how it saves by itself, and when the checks are asked again. The
// composables wrap these with the page's state; here they are plain, so the tests drive them.

export type PostType = 'photo' | 'carousel' | 'reel' | 'story'
export const POST_TYPES: readonly PostType[] = ['photo', 'carousel', 'reel', 'story']

type Kind = 'image' | 'video' | null

/** Why a type is off with these files (the page says it once, with `typeHint`). */
export type TypeOffReason =
  'onePhoto' | 'photoNotVideo' | 'carouselTwo' | 'oneVideo' | 'reelNotPhoto' | 'oneFile'

export interface TypeOption {
  type: PostType
  enabled: boolean
  reason: TypeOffReason | null
}

function offReason(type: PostType, media: readonly { kind: Kind }[]): TypeOffReason | null {
  const n = media.length
  if (n === 0) return null
  const first = media[0]?.kind
  switch (type) {
    case 'photo':
      if (n > 1) return 'onePhoto'
      return first === 'video' ? 'photoNotVideo' : null
    case 'carousel':
      return n < 2 ? 'carouselTwo' : null
    case 'reel':
      if (n > 1) return 'oneVideo'
      return first === 'image' ? 'reelNotPhoto' : null
    case 'story':
      return n > 1 ? 'oneFile' : null
  }
}

/** The four buttons, the ones that do not go with the files off with their reason (D-60). */
export function typeOptions(media: readonly { kind: Kind }[]): TypeOption[] {
  return POST_TYPES.map((type) => {
    const reason = offReason(type, media)
    return { type, enabled: reason === null, reason }
  })
}

/** The one sentence under «Tipo» (screen 08): `posts.type.hint.<key>` of it.json. */
export type TypeHint = { key: 'many' | 'onePhoto' | 'oneVideo' | 'oneFile'; n: number }

/** Why the other types are off, said once for the files there are, not once per button. */
export function typeHint(media: readonly { kind: Kind }[]): TypeHint | null {
  const n = media.length
  if (n === 0) return null
  if (n > 1) return { key: 'many', n }
  const kind = media[0]?.kind
  return { key: kind === 'image' ? 'onePhoto' : kind === 'video' ? 'oneVideo' : 'oneFile', n }
}

/** What `suggestType` of the rules proposes: never a story (D-60). */
export function suggestedType(media: readonly { kind: Kind }[]): PostType | null {
  if (media.length === 0) return null
  if (media.length > 1) return 'carousel'
  return media[0]?.kind === 'video' ? 'reel' : 'photo'
}

/**
 * The type after the files changed. Until the person chooses, the editor follows the files;
 * after, it never changes the type by itself: the block proposes the right one (§11.2 point 2).
 */
export function nextType(
  current: PostType | null,
  chosen: boolean,
  media: readonly { kind: Kind }[],
): PostType | null {
  if (chosen) return current
  return suggestedType(media) ?? current
}

/** The type the block «Passa a …» proposes when the files no longer go with the chosen one. */
export function properType(type: PostType, media: readonly { kind: Kind }[]): PostType | null {
  if (media.length === 0 || offReason(type, media) === null) return null
  return suggestedType(media)
}

// ---- the body the editor saves ----

/**
 * A post has at most `max` files (D-118, Matteo 22/11: «mi faccia già mettere e selezionare solo
 * 10 foto»): of `list`, the first that still fit after the `have` already there, and how many
 * are left out.
 */
export function roomFor<T>(
  list: readonly T[],
  have: number,
  max: number,
): { kept: T[]; leftOut: number } {
  const room = Math.max(0, max - have)
  return { kept: list.slice(0, room), leftOut: Math.max(0, list.length - room) }
}

export interface CaptionBody {
  common: string
  instagram?: string
  facebook?: string
}

export interface ChoiceBody {
  key: string
  option: string
  crop?: { x: number; y: number; width: number; height: number }
}

export interface DraftBody {
  type: PostType
  mediaIds: string[]
  caption: CaptionBody
  destinations: { accountId: string }[]
  when: { localDate: string; localTime: string } | null
  shareToFeed: boolean
  choices: ChoiceBody[]
  cover: { source: 'frame'; offsetMs: number } | { source: 'image'; mediaId: string } | null
  /** every label of the post (§11.7) */
  labelIds: string[]
}

/**
 * A draft is born with its first content: a file, a character or a destination (Scelta 7), or
 * a label, which only a saved post can keep.
 */
export function hasContent(body: DraftBody): boolean {
  const texts = [body.caption.common, body.caption.instagram ?? '', body.caption.facebook ?? '']
  return (
    body.mediaIds.length > 0 ||
    body.destinations.length > 0 ||
    body.labelIds.length > 0 ||
    texts.some((t) => t !== '')
  )
}

/** The files a destination does not publish, with their place in the post (D-56). */
export function missingFiles(
  media: readonly { kind: Kind }[],
  published: readonly number[],
): { index: number; kind: Kind }[] {
  const out = new Set(published)
  return media.flatMap((m, index) => (out.has(index) ? [] : [{ index, kind: m.kind }]))
}

// ---- saving by itself ----

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict'

export interface SaveState {
  status: SaveStatus
  postId: string | null
  version: number | null
  /** changes not saved yet */
  dirty: boolean
  savedAt: Date | null
  error: unknown
}

export interface SavedPost {
  id: string
  version: number
}

export interface AutosaveOptions {
  body: () => DraftBody
  create: (body: DraftBody) => Promise<SavedPost>
  update: (postId: string, version: number, body: DraftBody) => Promise<SavedPost>
  onState?: (state: SaveState) => void
  /** a 409 with `post_version_conflict` */
  isConflict?: (error: unknown) => boolean
  /** an existing post */
  post?: SavedPost | null
  delayMs?: number
  now?: () => Date
}

/**
 * The draft that saves itself (Scelta 7): born at its first content, then saved after a pause
 * of 1.5 s, one save at a time with the version read. «Salvata» only after the server's answer;
 * a 409 stops it (the local text stays, the page offers to reload); a failure waits for
 * «Riprova» or the next change. Paused (a scheduled post), it only saves on `flush`.
 */
export function createAutosave(o: AutosaveOptions) {
  const delay = o.delayMs ?? 1500
  const now = o.now ?? (() => new Date())
  const state: SaveState = {
    status: o.post ? 'saved' : 'idle',
    postId: o.post?.id ?? null,
    version: o.post?.version ?? null,
    dirty: false,
    savedAt: null,
    error: null,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let paused = false

  // read through a function: a change while saving sets it, which the compiler cannot see
  const dirty = () => state.dirty
  const emit = () => o.onState?.({ ...state })
  const set = (patch: Partial<SaveState>) => {
    Object.assign(state, patch)
    emit()
  }

  async function saveNow(): Promise<void> {
    if (state.status === 'conflict') return
    if (running) {
      await running
      if (state.dirty) return saveNow()
      return
    }
    if (!state.dirty) return
    const body = o.body()
    if (state.postId === null && !hasContent(body)) return
    set({ status: 'saving', dirty: false, error: null })
    running = (async () => {
      try {
        const saved =
          state.postId === null || state.version === null
            ? await o.create(body)
            : await o.update(state.postId, state.version, body)
        set({ status: 'saved', postId: saved.id, version: saved.version, savedAt: now() })
      } catch (error) {
        const conflict = o.isConflict?.(error) ?? false
        set({ status: conflict ? 'conflict' : 'failed', dirty: true, error })
      } finally {
        running = null
      }
    })()
    await running
    // what changed while it was saving goes after it
    if (dirty() && state.status === 'saved' && !paused) schedule()
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => void saveNow(), delay)
  }

  return {
    state: () => ({ ...state }),
    /** something of the body changed */
    changed() {
      set({ dirty: true })
      if (paused || state.status === 'conflict') return
      if (running) return
      schedule()
    },
    /** saves at once: leaving the page, hiding the tab, «Riprova», «Salva bozza» */
    async flush() {
      clearTimeout(timer)
      if (state.status === 'failed') set({ status: state.postId ? 'saved' : 'idle' })
      await saveNow()
    },
    /** a scheduled post saves only with «Salva modifiche» */
    pause(on: boolean) {
      paused = on
      if (on) clearTimeout(timer)
    },
    /** the post as the server has it now (after schedule, unschedule, a reload) */
    adopt(post: SavedPost) {
      clearTimeout(timer)
      set({ status: 'saved', postId: post.id, version: post.version, dirty: false, error: null })
    },
    stop() {
      clearTimeout(timer)
    },
  }
}

export type Autosave = ReturnType<typeof createAutosave>

// ---- the checks while writing ----

/**
 * The full check after 500 ms of pause, only when the body changed since the last one sent; an
 * answer that comes after a newer one is thrown away (Scelta 8, D-57).
 */
export function createCheckRunner<B, R>(o: {
  run: (body: B) => Promise<R>
  onReport: (report: R) => void
  onError?: (error: unknown) => void
  onBusy?: (busy: boolean) => void
  delayMs?: number
}) {
  const delay = o.delayMs ?? 500
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSent: string | null = null
  let pending: string | null = null
  let seq = 0
  let shown = 0
  return {
    request(body: B) {
      const json = JSON.stringify(body)
      if (json === pending || (pending === null && json === lastSent)) return
      clearTimeout(timer)
      pending = json
      timer = setTimeout(() => {
        pending = null
        if (json === lastSent) return
        lastSent = json
        const mine = ++seq
        o.onBusy?.(true)
        o.run(body).then(
          (report) => {
            if (mine < shown) return
            shown = mine
            if (mine === seq) o.onBusy?.(false)
            o.onReport(report)
          },
          (error: unknown) => {
            if (mine !== seq) return
            // an older answer that comes after this failure is not shown as current
            shown = mine
            o.onBusy?.(false)
            // the same body asked again checks again
            lastSent = null
            o.onError?.(error)
          },
        )
      }, delay)
    },
    stop() {
      clearTimeout(timer)
    },
  }
}

// ---- the editor's page key ----

/**
 * The page of a new post becomes the page of its draft without a new page: the draft's id keeps
 * the key of the page that made it, so the editor stays mounted (and its uploads with it).
 */
const editorAliases = new Map<string, string>()
export const editorKeyOf = (postId: string) => editorAliases.get(postId) ?? postId
export function keepEditorKey(postId: string, from: string) {
  editorAliases.set(postId, from)
}
