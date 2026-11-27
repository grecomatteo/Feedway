// The editor's logic with no page around it (plan 06 Task 5): which types go with the files,
// when a draft is born and how it saves by itself, and when the checks are asked again. The
// composables wrap these with the page's state; here they are plain, so the tests drive them.

import { normalizeCollaborator } from '@app/domain'

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
  /** the Instagram usernames invited to collaborate, as typed (D-125) */
  instagramCollaborators: string[]
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
    body.instagramCollaborators.length > 0 ||
    texts.some((t) => t !== '')
  )
}

/**
 * The names typed in «Invita in collaborazione» (D-125): one for each piece between spaces,
 * commas or semicolons, as the editor keeps them. A wrong one stays: the checks say why.
 */
export const typedCollaborators = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map(normalizeCollaborator)
    .filter((name) => name !== '')

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
  /** a failure with no answer (the network): the save may have reached the server; all by default */
  isLost?: (error: unknown) => boolean
  /**
   * A 409 may be a save of this tab that reached the server while the tab kept an older version:
   * an answer lost on a slow network (D-120.1), or a save the tab did not count (D-131.1). Gets
   * the post as it is now: its version when what the server has is this tab's own (see
   * `sentByThisTab`); null when someone else changed it. `lost`: the saves left without an answer.
   */
  recover?: (postId: string, version: number, lost: number) => Promise<SavedPost | null>
  /** an existing post */
  post?: SavedPost | null
  delayMs?: number
  now?: () => Date
}

/**
 * The draft that saves itself (Scelta 7): born at its first content, then saved after a pause
 * of 1.5 s, one save at a time with the version read. «Salvata» only after the server's answer;
 * a 409 stops it (the local text stays, the page offers to reload); a failure waits for
 * «Riprova» or the next change. A 409 asks `recover` first: when the post on the server is this
 * tab's own save (an answer lost, D-120.1; a version not counted, D-131.1), its version is taken
 * and the save goes again, without a conflict.
 * Paused (a scheduled post), it only saves on `flush`.
 */
class RecoverFailed extends Error {
  constructor(cause: unknown) {
    super('the post could not be read after a conflict', { cause })
  }
}

// ---- what this tab sent ----

/**
 * The content of a save, the same whichever way it is written: the editor's body or the post the
 * server gives back. A text for a platform equal to the common one counts as none.
 */
export function contentKey(b: DraftBody): string {
  const own = (text: string | undefined) =>
    text === undefined || text === b.caption.common ? null : text
  return JSON.stringify([
    b.type,
    b.mediaIds,
    b.caption.common,
    own(b.caption.instagram),
    own(b.caption.facebook),
    b.destinations.map((d) => d.accountId).sort(),
    b.when === null ? null : [b.when.localDate, b.when.localTime],
    b.shareToFeed,
    b.choices.map((c) => JSON.stringify([c.key, c.option, c.crop ?? null])).sort(),
    b.mediaIds.length === 0 || b.cover === null
      ? null
      : b.cover.source === 'frame'
        ? ['frame', b.cover.offsetMs]
        : ['image', b.cover.mediaId],
    [...b.labelIds].sort(),
    b.instagramCollaborators,
  ])
}

const SENT_KEPT = 20
const sentKeys = new Map<string, string[]>()
/** A save this tab sent for a post, whatever became of its answer. */
export function rememberSent(postId: string, body: DraftBody): string {
  const key = contentKey(body)
  const list = sentKeys.get(postId) ?? []
  list.push(key)
  sentKeys.set(postId, list.slice(-SENT_KEPT))
  return key
}
/**
 * The server answered that save: the ones sent before it are behind the post now, and matching
 * them later could undo a change the same person made elsewhere in between.
 */
export function confirmSent(postId: string, key: string): void {
  const list = sentKeys.get(postId)
  const at = list?.lastIndexOf(key) ?? -1
  if (list && at > 0) sentKeys.set(postId, list.slice(at))
}
/**
 * The post as the server has it is one this tab sent (D-131.1): only this tab could have
 * written exactly that content. Another tab, or another person, is a conflict.
 */
export const sentByThisTab = (postId: string, body: DraftBody) =>
  sentKeys.get(postId)?.includes(contentKey(body)) ?? false

/**
 * The saves of a post still on their way in this tab: an editor that opens the post waits for
 * them, so it never reads the post as it was before the last save of the editor just closed.
 */
const pendingSaves = new Map<string, Promise<unknown>>()
export function savingInThisTab(postId: string, save: Promise<unknown>): void {
  const done = save.catch(() => undefined)
  pendingSaves.set(postId, done)
  void done.then(() => {
    if (pendingSaves.get(postId) === done) pendingSaves.delete(postId)
  })
}
export const savesOf = (postId: string): Promise<unknown> =>
  pendingSaves.get(postId) ?? Promise.resolve()

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
  /** updates sent since the last answer, whose outcome is not known (failed without a 409) */
  let lost = 0

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
            : await updateKnowingLost(state.postId, state.version, body)
        lost = 0
        set({ status: 'saved', postId: saved.id, version: saved.version, savedAt: now() })
      } catch (error) {
        const conflict = o.isConflict?.(error) ?? false
        const unread = error instanceof RecoverFailed
        if (!conflict && !unread && state.postId !== null && (o.isLost?.(error) ?? true)) lost++
        set({
          status: conflict ? 'conflict' : 'failed',
          dirty: true,
          error: unread ? error.cause : error,
        })
      } finally {
        running = null
      }
    })()
    await running
    // what changed while it was saving goes after it
    if (dirty() && state.status === 'saved' && !paused) schedule()
  }

  /** The update; its 409 after lost saves is checked once against the post as it is now. */
  async function updateKnowingLost(postId: string, version: number, body: DraftBody) {
    try {
      return await o.update(postId, version, body)
    } catch (error) {
      if (!o.recover || !(o.isConflict?.(error) ?? false)) throw error
      // a failed read says nothing yet: «not saved, retry», and the next 409 asks again
      let own: SavedPost | null
      try {
        own = await o.recover(postId, version, lost)
      } catch (readError) {
        throw new RecoverFailed(readError)
      }
      if (own === null) throw error
      lost = 0
      // the version this tab owns now: a retry whose answer is lost again counts from it
      state.version = own.version
      return o.update(postId, own.version, body)
    }
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
      lost = 0
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

// ---- «Quando» ----

/** The day and the time it is now in a zone, as wall values. */
export function wallNow(timeZone: string, now: Date): { date: string; time: string } {
  const parts: Record<string, string> = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  const part = (type: string) => parts[type] ?? '00'
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}

/**
 * Tomorrow at a time already gone today, in the post's zone (D-120.5): in the evening the editor
 * proposes, or the person picks, a time that only tomorrow has, and «Quando» says it.
 */
export function passedToTomorrow(
  when: { localDate: string; localTime: string } | null,
  timeZone: string,
  now = new Date(),
): boolean {
  if (!when?.localDate || !when.localTime) return false
  const { date, time } = wallNow(timeZone, now)
  const tomorrow = new Date(`${date}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return when.localDate === tomorrow.toISOString().slice(0, 10) && when.localTime <= time
}
