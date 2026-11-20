import type { MediaDto, PostCheckResponse, PostResponse } from '@app/contracts'
import { publishedFps } from '@app/domain'
import type { FetchError } from 'ofetch'
import type { UploadItem } from './useUploads'
import {
  createAutosave,
  createCheckRunner,
  keepEditorKey,
  nextType,
  type ChoiceBody,
  type DraftBody,
  type PostType,
  type SaveState,
} from '../utils/post-editor'

/**
 * The editor of one post (plan 06 Task 5, spec §11.2, §11.9; brief F02): its state, the draft
 * that saves itself, the checks while writing, the uploads of its files and the actions
 * (schedule, back to draft, cancel, delete). The page and its blocks only draw it.
 */

/** A file of the post as the editor shows it. */
export interface EditorFile {
  id: string
  kind: 'image' | 'video' | null
  name: string | null
  /** of the original as uploaded; null when the post does not say it */
  sizeBytes: number | null
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted'
  width: number | null
  height: number | null
  durationMs: number | null
  /** of the copy that is published: the reel's cover frames (D-60) */
  fps: number | null
  variants: string[]
}

/** A place in the list of files: a file of the library, or one still uploading. */
export interface EditorEntry {
  key: string
  file: EditorFile | null
  /** the upload's key in the workspace's store, while the file has no media yet */
  upload: string | null
}

export type WorkspaceRoleName = WorkspaceView['myRole']
const PUBLISHERS: readonly WorkspaceRoleName[] = ['owner', 'admin', 'manager', 'publisher']
const MANAGERS: readonly WorkspaceRoleName[] = ['owner', 'admin', 'manager']

export const fromMedia = (m: MediaDto): EditorFile => ({
  id: m.id,
  kind: m.kind,
  name: m.originalName,
  sizeBytes: m.sizeBytes,
  status: m.status,
  width: m.width,
  height: m.height,
  durationMs: m.durationMs,
  fps: publishedFps(m.fps, m.checks?.warnings ?? []),
  variants: m.variants.map((v) => v.purpose),
})

const fromPostMedia = (m: PostResponse['media'][number]): EditorFile => ({
  id: m.id,
  kind: m.kind,
  name: m.originalName,
  sizeBytes: m.sizeBytes,
  status: m.status,
  width: m.width,
  height: m.height,
  durationMs: m.durationMs,
  fps: m.fps,
  variants: m.variants,
})

/** The day and the time the editor proposes: the client's time (or 18:00), today if still ahead. */
export function proposedWhen(defaultTime: string | null, timeZone: string, now = new Date()) {
  const time = defaultTime ?? '18:00'
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
  const today = `${part('year')}-${part('month')}-${part('day')}`
  const nowTime = `${part('hour')}:${part('minute')}`
  if (nowTime < time) return { localDate: today, localTime: time }
  const tomorrow = new Date(`${today}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return { localDate: tomorrow.toISOString().slice(0, 10), localTime: time }
}

interface ErrorBody {
  error?: { code?: string; reason?: string; report?: PostCheckResponse; message?: string }
}
const bodyOf = (e: unknown) => (e as FetchError<ErrorBody> | undefined)?.data?.error
const isConflict = (e: unknown) => bodyOf(e)?.reason === 'post_version_conflict'

export function usePostEditor(opts: {
  client: Ref<WorkspaceView>
  postId: string | null
  /** the profile of the context (`?profilo=`): its accounts start ticked */
  profileKey: string | null
  profiles: Ref<WorkspaceProfile[]>
}) {
  const org = useOrganization()
  const { call, failure } = useApi()
  const { t } = useI18n()
  const workspaceId = opts.client.value.id
  const base = org.api(`/workspaces/${encodeURIComponent(workspaceId)}`)
  // a file of the post the worker has just made ready (or failed): its tile and the checks
  // follow, so «In attesa del file N» does not stay after the file is ready (D-80.1)
  const uploads = useUploads(workspaceId, {
    shown: true,
    onChange: (media) => {
      if (!media) return
      let moved = false
      for (const entry of entries.value)
        if (entry.file?.id === media.id && entry.file.status !== media.status) {
          entry.file = fromMedia(media)
          moved = true
        }
      if (moved) askChecks()
    },
  })

  const role = computed(() => opts.client.value.myRole)
  const may = computed(() => ({
    draft: role.value !== 'viewer',
    publish: PUBLISHERS.includes(role.value),
    manageOthers: MANAGERS.includes(role.value),
  }))

  // ---- state ----
  const post = ref<PostResponse | null>(null)
  const loadState = ref<'loading' | 'ready' | 'missing' | 'error'>(
    opts.postId ? 'loading' : 'ready',
  )
  const type = ref<PostType | null>(null)
  /** the person chose the type: the editor never changes it again (D-60, D-71) */
  const typeChosen = ref(false)
  const entries = ref<EditorEntry[]>([])
  const caption = reactive<{ common: string; instagram?: string; facebook?: string }>({
    common: '',
  })
  const split = ref(false)
  const destinations = ref<string[]>([])
  const when = ref<{ localDate: string; localTime: string } | null>(null)
  const shareToFeed = ref(true)
  const choices = ref<ChoiceBody[]>([])
  const cover = ref<DraftBody['cover']>(null)
  const labelIds = ref<string[]>([])
  const timeZone = ref('Europe/Rome')

  const save = ref<SaveState>({
    status: 'idle',
    postId: null,
    version: null,
    dirty: false,
    savedAt: null,
    error: null,
  })
  const report = ref<PostCheckResponse | null>(null)
  /** the files the report was made on: its indices point into these (the preview, Task 6) */
  const reportMedia = ref<string[]>([])
  const checking = ref(false)
  const checkProblem = ref<string | null>(null)
  /** the answer of a «Programma» or «Salva modifiche» the server refused */
  const actionProblem = ref<string | null>(null)
  const acting = ref<null | 'schedule' | 'unschedule' | 'cancel' | 'delete' | 'saveScheduled'>(null)

  const status = computed(() => post.value?.status ?? 'draft')
  const mine = computed(() => !post.value || post.value.createdBy === org.me.value?.id)
  /** what this person may change of this post (§10.2) */
  const editable = computed(() => {
    if (!may.value.draft || opts.client.value.archivedAt) return false
    if (!mine.value && !may.value.manageOthers) return false
    if (status.value === 'cancelled') return false
    if (status.value === 'scheduled') return may.value.publish
    return true
  })
  /** a cancelled post goes away with «Elimina post»; not in an archived client (D-70) */
  const mayDelete = computed(
    () =>
      status.value === 'cancelled' &&
      may.value.draft &&
      !opts.client.value.archivedAt &&
      (mine.value || may.value.manageOthers),
  )

  const files = computed(() => entries.value.flatMap((e) => (e.file ? [e.file] : [])))
  const kinds = computed(() => entries.value.map((e) => ({ kind: entryKind(e) })))
  function entryKind(e: EditorEntry): 'image' | 'video' | null {
    if (e.file) return e.file.kind
    const item = uploadItem(e)
    return item?.kind ?? null
  }
  const uploadItem = (e: EditorEntry): UploadItem | null =>
    e.upload ? (uploads.items.value.find((i) => i.key === e.upload) ?? null) : null

  /** What a save sends: the type the editor shows, `photo` while none (D-71). */
  function body(): DraftBody {
    const captionBody: DraftBody['caption'] = { common: caption.common }
    if (split.value) {
      if (caption.instagram !== undefined) captionBody.instagram = caption.instagram
      if (caption.facebook !== undefined) captionBody.facebook = caption.facebook
    }
    return {
      type: type.value ?? 'photo',
      mediaIds: files.value.map((f) => f.id),
      caption: captionBody,
      destinations: destinations.value.map((accountId) => ({ accountId })),
      when: when.value,
      shareToFeed: shareToFeed.value,
      choices: choices.value,
      // a reel's cover stays only while there are files (handoff B2)
      cover: files.value.length > 0 ? cover.value : null,
      labelIds: labelIds.value,
    }
  }

  // ---- saving ----
  const asPost = (p: PostResponse) => {
    post.value = p
    timeZone.value = p.timezone
    // a file deleted from the library meanwhile says so on its tile
    for (const e of entries.value) {
      if (!e.file) continue
      const fresh = p.media.find((m) => m.id === e.file?.id)
      if (fresh) e.file = fromPostMedia(fresh)
    }
    return { id: p.id, version: p.version }
  }
  const autosave = createAutosave({
    body,
    create: async (b) => asPost(await call<PostResponse>('POST', `${base}/posts`, b)),
    update: async (id, version, b) =>
      asPost(
        await call<PostResponse>('PATCH', `${base}/posts/${encodeURIComponent(id)}`, {
          ...b,
          version,
        }),
      ),
    isConflict,
    onState: (s) => {
      save.value = s
      // the address follows the draft once it exists, without a new page
      // not while the person leaves: the new address would cancel where they are going
      if (s.postId && !opts.postId && !replaced && !leaving) {
        replaced = true
        keepEditorKey(s.postId, 'nuovo')
        void navigateTo(
          {
            path: org.to(
              `/spazi/${encodeURIComponent(opts.client.value.slug)}/post/${encodeURIComponent(s.postId)}`,
            ),
          },
          { replace: true },
        )
      }
    },
  })
  let replaced = false
  let leaving = false

  /** Something the person changed: save (a draft) and check again. */
  function touched() {
    if (!editable.value) return
    actionProblem.value = null
    autosave.changed()
    askChecks()
  }

  // ---- checks ----
  const checks = createCheckRunner<
    { mediaIds: string[] } & Record<string, unknown>,
    { report: PostCheckResponse; mediaIds: string[] }
  >({
    run: async (b) => ({
      report: await call<PostCheckResponse>('POST', `${base}/post-checks`, b),
      mediaIds: b.mediaIds,
    }),
    onReport: (r) => {
      report.value = r.report
      reportMedia.value = r.mediaIds
      checkProblem.value = null
    },
    onError: (e) => {
      // the report of an older body is not shown as if it were still true (P2 of the review)
      report.value = null
      reportMedia.value = []
      checkProblem.value = failure(e).message
    },
    onBusy: (b) => (checking.value = b),
  })
  /** nothing is scheduled in an archived client (D-70): no checks to run, the summary says so */
  const archived = computed(() => opts.client.value.archivedAt !== null)
  function askChecks() {
    const b = body()
    if (!when.value || archived.value) return
    checks.request({
      type: b.type,
      mediaIds: b.mediaIds,
      caption: b.caption,
      destinations: b.destinations,
      when: { mode: 'at', ...when.value },
      shareToFeed: b.shareToFeed,
      choices: b.choices,
      ...(b.cover ? { cover: b.cover } : {}),
      ...(save.value.postId ? { postId: save.value.postId } : {}),
    })
  }

  // ---- the type ----
  function chooseType(next: PostType) {
    type.value = next
    typeChosen.value = true
    touched()
  }
  function followFiles() {
    type.value = nextType(type.value, typeChosen.value, kinds.value)
  }

  // ---- files ----
  let entryKeys = 0
  const newKey = () => `e${String(++entryKeys)}`
  let alive = true

  /** Files from the computer into the post; into `folderId` of the library when given (D-103). */
  async function addFiles(list: readonly File[], folderId: string | null = null) {
    if (!editable.value || list.length === 0) return
    const items = await uploads.add(list, folderId, (media) => {
      attached(media)
    })
    for (const item of items)
      if (item.state !== 'rejected')
        entries.value.push({ key: newKey(), file: null, upload: item.key })
    // a refused file says why in the uploads, and stays out of the post
    refused.value = items.filter((i) => i.state === 'rejected')
    followFiles()
    touched()
  }
  const refused = ref<UploadItem[]>([])

  /** Uploads taken out of the post that may still finish: they must not come back in. */
  const dropped = new Set<string>()
  function dropUpload(item: UploadItem | null) {
    if (!item || item.media) return
    dropped.add(item.key)
    void uploads.cancel(item)
  }

  /** A file of this editor reached the library. */
  function attached(media: MediaDto) {
    const gone = uploads.items.value.find((i) => dropped.has(i.key) && i.media?.id === media.id)
    if (gone) return
    if (!alive) {
      attachLater(media)
      return
    }
    const entry = entries.value.find((e) => uploadItem(e)?.media?.id === media.id)
    if (entry) {
      entry.file = fromMedia(media)
      entry.upload = null
    } else entries.value.push({ key: newKey(), file: fromMedia(media), upload: null })
    followFiles()
    touched()
  }

  /**
   * The editor was closed while the file uploaded: it goes into the post all the same, as the
   * last file (D-21, Matteo: «non devo restare sulla pagina»). One at a time, with the version
   * read; with no draft yet the draft is made with it.
   */
  let later: Promise<unknown> = Promise.resolve()
  function attachLater(media: MediaDto) {
    later = later
      .then(async () => {
        const id = save.value.postId
        if (!id) {
          const made = await call<PostResponse>('POST', `${base}/posts`, {
            ...body(),
            type: nextType(type.value, typeChosen.value, [...kinds.value, { kind: media.kind }]),
            mediaIds: [...files.value.map((f) => f.id), media.id],
          })
          save.value = { ...save.value, postId: made.id, version: made.version }
          return
        }
        for (let tries = 0; tries < 2; tries++) {
          const now = await call<PostResponse>('GET', `${base}/posts/${encodeURIComponent(id)}`)
          if (now.status !== 'draft') return
          try {
            await call<PostResponse>('PATCH', `${base}/posts/${encodeURIComponent(id)}`, {
              version: now.version,
              mediaIds: [...now.media.map((m) => m.id), media.id],
            })
            return
          } catch (e) {
            if (!isConflict(e)) return
          }
        }
      })
      .catch(() => undefined)
  }

  function addFromLibrary(list: readonly MediaDto[]) {
    if (!editable.value) return
    const have = new Set(files.value.map((f) => f.id))
    for (const m of list)
      if (!have.has(m.id)) entries.value.push({ key: newKey(), file: fromMedia(m), upload: null })
    followFiles()
    touched()
  }

  /**
   * «Sostituisci» of a reel's only video (screen 09, B4): the new file takes the place of every
   * file of the post, and the type stays. A file refused by the browser's checks leaves the post
   * as it was; one that fails later shows its error, and the old video is still in the library.
   */
  function dropEntries() {
    for (const x of entries.value) dropUpload(uploadItem(x))
    entries.value = []
  }
  async function replaceFiles(list: readonly File[]) {
    if (!editable.value || list.length === 0) return
    const items = await uploads.add(list.slice(0, 1), null, (media) => {
      attached(media)
    })
    refused.value = items.filter((i) => i.state === 'rejected')
    const ok = items.filter((i) => i.state !== 'rejected')
    if (ok.length === 0) return
    dropEntries()
    for (const item of ok) entries.value.push({ key: newKey(), file: null, upload: item.key })
    followFiles()
    touched()
  }
  function replaceFromLibrary(list: readonly MediaDto[]) {
    if (!editable.value || list.length === 0) return
    dropEntries()
    addFromLibrary(list.slice(0, 1))
  }

  function move(key: string, by: -1 | 1) {
    const i = entries.value.findIndex((e) => e.key === key)
    const j = i + by
    if (i < 0 || j < 0 || j >= entries.value.length) return
    const list = [...entries.value]
    const [moved] = list.splice(i, 1)
    if (moved) list.splice(j, 0, moved)
    entries.value = list
    touched()
  }
  function moveTo(key: string, index: number) {
    const i = entries.value.findIndex((e) => e.key === key)
    if (i < 0 || i === index) return
    const list = [...entries.value]
    const [moved] = list.splice(i, 1)
    if (moved) list.splice(Math.max(0, Math.min(index, list.length)), 0, moved)
    entries.value = list
    touched()
  }
  function removeEntry(key: string) {
    const e = entries.value.find((x) => x.key === key)
    if (!e) return
    // a file still uploading stops; one already in the library stays there
    dropUpload(uploadItem(e))
    entries.value = entries.value.filter((x) => x.key !== key)
    followFiles()
    touched()
  }

  // ---- caption ----
  function setSplit(on: boolean) {
    split.value = on
    // the tabs start from a copy of the common text (design E1)
    if (on) {
      caption.instagram ??= caption.common
      caption.facebook ??= caption.common
    }
    touched()
  }

  // ---- choices of the warnings ----
  /** `crop`: the box of a «Ritaglia», in fractions of the original (D-61). */
  function choose(key: string, option: string | null, crop?: ChoiceBody['crop']) {
    const rest = choices.value.filter((c) => c.key !== key)
    choices.value =
      option === null ? rest : [...rest, crop ? { key, option, crop } : { key, option }]
    touched()
  }

  // ---- the reel: its cover and the feed (D-60, §9.1) ----
  function setCover(next: DraftBody['cover'], fromUpload = false) {
    // the person chose another cover: an upload still going no longer becomes it
    if (!fromUpload) coverUpload.value = null
    cover.value = next
    touched()
  }
  /** The labels of the post, all of them (§11.7). */
  function setLabels(ids: string[]) {
    labelIds.value = ids
    touched()
  }
  function setShareToFeed(on: boolean) {
    shareToFeed.value = on
    touched()
  }
  /** A cover uploaded from the editor: it becomes the cover once in the library. */
  const coverUpload = ref<string | null>(null)
  /** the upload's own picture, while the library has no copy of it yet */
  const coverPreview = ref<string | null>(null)
  async function uploadCover(file: File) {
    if (!editable.value) return
    const [item] = await uploads.add([file], null, (media) => {
      if (coverUpload.value !== item?.key) return
      coverUpload.value = null
      if (!alive) {
        coverLater(media.id)
        return
      }
      coverFile.value = fromMedia(media)
      coverPreview.value = item.preview?.url ?? null
      setCover({ source: 'image', mediaId: media.id }, true)
    })
    coverUpload.value = item && item.state !== 'rejected' ? item.key : null
    return item
  }
  /** The cover's image as the library has it, when one was chosen in this editor. */
  const coverFile = ref<EditorFile | null>(null)
  /** The picture of the cover chosen as an image: its copy, or the upload's while it is made. */
  const coverSrc = computed(() => {
    const c = cover.value
    if (c?.source !== 'image') return null
    const f = coverFile.value
    if (f?.id === c.mediaId && !f.variants.includes('ig_feed'))
      return (
        coverPreview.value ?? (f.variants.includes('thumbnail') ? fileUrl(f.id, 'thumbnail') : null)
      )
    return fileUrl(c.mediaId, 'ig_feed')
  })
  /**
   * The editor was closed while the cover uploaded: it becomes the draft's cover all the same,
   * as the files do (D-21), while the post is still a draft reel.
   */
  function coverLater(mediaId: string) {
    later = later
      .then(async () => {
        const id = save.value.postId
        if (!id) return
        for (let tries = 0; tries < 2; tries++) {
          const now = await call<PostResponse>('GET', `${base}/posts/${encodeURIComponent(id)}`)
          if (now.status !== 'draft' || now.type !== 'reel') return
          try {
            await call<PostResponse>('PATCH', `${base}/posts/${encodeURIComponent(id)}`, {
              version: now.version,
              cover: { source: 'image', mediaId },
            })
            return
          } catch (e) {
            if (!isConflict(e)) return
          }
        }
      })
      .catch(() => undefined)
  }
  const fileUrl = (id: string, variant: string) =>
    `${base}/media/${encodeURIComponent(id)}/file/${variant}`

  // ---- loading ----
  async function load() {
    if (!opts.postId) {
      await start()
      return
    }
    loadState.value = 'loading'
    try {
      const p = await call<PostResponse>('GET', `${base}/posts/${encodeURIComponent(opts.postId)}`)
      fill(p)
      loadState.value = 'ready'
      askChecks()
    } catch (e) {
      loadState.value = failure(e).status === 404 ? 'missing' : 'error'
    }
  }

  function fill(p: PostResponse) {
    asPost(p)
    // a saved post with files keeps its type, the person saw it; without files the type is
    // chosen again, as on a new post (D-71)
    type.value = p.media.length > 0 ? p.type : null
    typeChosen.value = p.media.length > 0
    entries.value = p.media.map((m) => ({ key: newKey(), file: fromPostMedia(m), upload: null }))
    caption.common = p.caption.common
    split.value = p.caption.instagram !== undefined || p.caption.facebook !== undefined
    if (split.value) {
      caption.instagram = p.caption.instagram ?? p.caption.common
      caption.facebook = p.caption.facebook ?? p.caption.common
    } else {
      delete caption.instagram
      delete caption.facebook
    }
    destinations.value = p.destinations.map((d) => d.accountId)
    when.value = p.when
    shareToFeed.value = p.shareToFeed
    choices.value = p.choices.map((c) => ({ ...c }))
    cover.value = p.cover
    labelIds.value = [...p.labelIds]
    autosave.adopt({ id: p.id, version: p.version })
    autosave.pause(p.status !== 'draft')
  }

  /** A new post: the client's time, the profile of the context ticked. */
  async function start() {
    try {
      const settings = await call<{ timezone: string }>('GET', org.api('/settings'))
      timeZone.value = settings.timezone
    } catch {
      // only who sees the agency's settings reads it: the draft says its zone once saved
    }
    when.value = proposedWhen(opts.client.value.defaultPostTime ?? null, timeZone.value)
    askChecks()
  }
  watch(
    opts.profiles,
    (list) => {
      if (opts.postId || destinations.value.length > 0 || list.length === 0) return
      const profile =
        list.find((p) => p.key === opts.profileKey) ?? (list.length === 1 ? list[0] : undefined)
      if (!profile) return
      // a profile to reconnect is not ticked: «Dove» shows its accounts off (D-93.2)
      destinations.value = reconnecting(opts.client.value, profile.key)
        ? []
        : profile.accounts.filter(selectable).map((a) => a.id)
      // a ticked profile is not a content: the draft is not born for it
      askChecks()
    },
    { immediate: true },
  )

  /** «Ricarica» after a conflict: the post as it is now, the local changes dropped. */
  async function reload() {
    const id = save.value.postId
    if (!id) return
    const p = await call<PostResponse>('GET', `${base}/posts/${encodeURIComponent(id)}`)
    fill(p)
    askChecks()
  }

  // ---- actions ----
  /** the files of the post when an action left: a refusal's report points into these */
  let sent: string[] | null = null
  async function act(what: 'schedule' | 'unschedule' | 'cancel'): Promise<PostResponse | null> {
    sent = null
    actionProblem.value = null
    acting.value = what
    try {
      if (what === 'schedule') {
        await autosave.flush()
        if (save.value.status !== 'saved') return null
      }
      const id = save.value.postId
      const version = save.value.version
      if (!id || version === null) return null
      sent = files.value.map((f) => f.id)
      // back to draft keeps what was changed and not saved yet: it is saved on the draft
      const keep = what === 'unschedule' && save.value.dirty
      const p = await call<PostResponse>(
        'POST',
        `${base}/posts/${encodeURIComponent(id)}/${what}`,
        { version },
      )
      if (keep) {
        asPost(p)
        autosave.adopt({ id: p.id, version: p.version })
        autosave.pause(false)
        autosave.changed()
        await autosave.flush()
      } else fill(p)
      askChecks()
      return p
    } catch (e) {
      failed(e)
      return null
    } finally {
      acting.value = null
    }
  }

  /** «Salva modifiche» of a scheduled post: saved only if the checks pass. */
  async function saveScheduled() {
    sent = null
    actionProblem.value = null
    acting.value = 'saveScheduled'
    autosave.pause(false)
    try {
      await autosave.flush()
      if (save.value.status === 'failed') failed(save.value.error)
    } finally {
      autosave.pause(status.value !== 'draft')
      acting.value = null
    }
  }

  async function remove(): Promise<boolean> {
    const id = save.value.postId
    if (!id) return true
    acting.value = 'delete'
    try {
      await call('DELETE', `${base}/posts/${encodeURIComponent(id)}`)
      autosave.stop()
      return true
    } catch (e) {
      failed(e)
      return false
    } finally {
      acting.value = null
    }
  }

  function failed(e: unknown) {
    const b = bodyOf(e)
    if (b?.report) {
      report.value = b.report
      reportMedia.value = sent ?? files.value.map((f) => f.id)
    }
    if (isConflict(e)) save.value = { ...save.value, status: 'conflict' }
    actionProblem.value =
      b?.reason === 'post_not_schedulable' ? t('posts.actions.notSchedulable') : failure(e).message
  }

  // ---- the page around ----
  function hidden() {
    if (document.visibilityState === 'hidden' && status.value === 'draft') void autosave.flush()
  }
  onMounted(() => {
    void load()
    document.addEventListener('visibilitychange', hidden)
  })
  onBeforeUnmount(() => {
    alive = false
    document.removeEventListener('visibilitychange', hidden)
    checks.stop()
    // what is left goes with the leaving (the page asked first if it could not); a file that
    // finishes later waits for this save, so it finds the draft it made (P6 of the review)
    if (status.value === 'draft') later = later.then(() => autosave.flush()).catch(() => undefined)
  })

  return {
    may,
    post,
    loadState,
    status,
    editable,
    mine,
    mayDelete,
    type,
    typeChosen,
    entries,
    files,
    kinds,
    caption,
    split,
    destinations,
    when,
    shareToFeed,
    choices,
    cover,
    labelIds,
    setLabels,
    timeZone,
    save,
    archived,
    report,
    reportMedia,
    checking,
    checkProblem,
    actionProblem,
    acting,
    refused,
    uploads,
    uploadItem,
    chooseType,
    addFiles,
    addFromLibrary,
    replaceFiles,
    replaceFromLibrary,
    move,
    moveTo,
    removeEntry,
    setSplit,
    choose,
    setCover,
    setShareToFeed,
    uploadCover,
    coverUpload,
    coverFile,
    touched,
    flush: () => autosave.flush(),
    /** The person leaves the page (or stays after all): the address no longer follows the draft. */
    leaving: (yes: boolean) => {
      leaving = yes
    },
    reload,
    schedule: () => act('schedule'),
    unschedule: () => act('unschedule'),
    cancel: () => act('cancel'),
    saveScheduled,
    remove,
    fileUrl,
    coverSrc,
  }
}

/** An account the post can go to: connected and working (§11.2 point 5). */
export const selectable = (a: ProfileAccount) => a.active && a.health !== 'error'
/** The profile's connection to Meta expired: its accounts wait to be reconnected (D-93.2). */
export const reconnecting = (client: WorkspaceView, profileKey: string) =>
  (client.profiles ?? []).some((p) => p.key === profileKey && p.link === 'reconnect')

export type PostEditor = ReturnType<typeof usePostEditor>
