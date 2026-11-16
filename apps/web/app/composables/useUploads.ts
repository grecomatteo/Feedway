import type { MediaDto, UploadDto } from '@app/contracts'
import type { ApiFailure } from './useApi'

/**
 * The uploads of one workspace from the panel (spec §11.1 points 1–3, §14.2 «Avanzamento
 * visibile», plan 04 Task 13, ADR 021 Scelta 3): files are checked at once, sent in pieces of
 * 20 MiB with their sha-256, two files at a time, and resumed on their own when the connection
 * comes back or the tab is shown again. After a reload the uploads left halfway are listed: the
 * same file chosen again goes on from where it stopped.
 */

export type UploadState =
  | 'queued'
  | 'hashing'
  | 'uploading'
  | 'paused'
  | 'offline'
  | 'completing'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'error'
  | 'rejected'

export interface UploadItem {
  key: string
  name: string
  size: number
  kind: UploadKind | null
  state: UploadState
  /** bytes the server has, plus those of the piece on its way */
  sent: number
  /** bytes per second of the last seconds; null: not yet known */
  rate: number | null
  /** why it was refused, or what went wrong */
  message: string | null
  uploadId: string | null
  media: MediaDto | null
  /** a `blob:` of the file, when the browser can show it before the upload */
  preview: { url: string; kind: UploadKind } | null
}

export type Leftover = UploadDto

/** Files sent at once: more only splits the same connection. */
const MAX_ACTIVE = 2
const RUNNING: readonly UploadState[] = ['hashing', 'uploading', 'completing']
const PREVIEWABLE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** A request of ours that did not answer 2xx, with what the server said. */
class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: { code?: string; message?: string } } | null,
    readonly retryAfter: number | null = null,
  ) {
    super(`HTTP ${String(status)}`)
  }
}
class Stopped extends Error {}

interface Side {
  file: File | null
  type: UploadType | null
  folderId: string | null
  first: Uint8Array | null
  /** the upload left halfway this file must be */
  expect: Leftover | null
  upload: UploadDto | null
  run: number
  abort: AbortController | null
  tries: number
  timer: ReturnType<typeof setTimeout> | undefined
  meter: ReturnType<typeof rateMeter>
  watching: boolean
}

export function useUploads(workspaceId: Ref<string>, options: { onChange: () => void }) {
  const org = useOrganization()
  const { failure } = useApi()
  const i18n = useI18n()
  const t = i18n.t
  const base = computed(
    () => `${org.api(`/workspaces/${encodeURIComponent(workspaceId.value)}`)}/uploads`,
  )
  const mediaBase = computed(
    () => `${org.api(`/workspaces/${encodeURIComponent(workspaceId.value)}`)}/media`,
  )

  const items = ref<UploadItem[]>([])
  const leftovers = ref<Leftover[]>([])
  const limits = ref<UploadLimits | null>(null)
  const announcement = ref('')
  const sides = new Map<string, Side>()
  const hasher = import.meta.client ? createHasher() : null
  const hasherMode = ref<'idle' | 'worker' | 'inline'>('idle')
  let keys = 0
  let alive = true

  const side = (item: UploadItem) => {
    const s = sides.get(item.key)
    if (!s) throw new Error('an upload without its side')
    return s
  }
  /** The reactive copy of an item, the one the page draws. */
  const live = (key: string) => items.value.find((i) => i.key === key)

  // what is said in one tick is read together: a refusal is not covered by «N started»
  let said: string[] = []
  function announce(text: string) {
    said.push(text)
    if (said.length > 1) return
    // the same text twice is read twice
    announcement.value = ''
    void nextTick(() => {
      announcement.value = said.join(' ')
      said = []
    })
  }

  const request = <T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) =>
    $fetch<T>(path, {
      method,
      headers: { 'x-app-request': '1' },
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    })

  /** An error of $fetch, with or without an answer. */
  const isFetchFailure = (error: unknown) => error instanceof Error && error.name === 'FetchError'

  function failureOf(error: unknown): ApiFailure {
    if (!(error instanceof HttpFailure)) return failure(error)
    const code = error.body?.error?.code ?? 'INTERNAL'
    return {
      code,
      message:
        error.body?.error?.message ??
        (i18n.te(`errors.${code}`) ? t(`errors.${code}`) : t('errors.INTERNAL')),
      field: null,
      status: error.status,
      retryAfter: error.retryAfter,
      reason: null,
    }
  }

  /** A piece, with XHR: fetch tells nothing of the bytes sent. */
  function putPart(
    url: string,
    blob: Blob,
    digest: Uint8Array,
    signal: AbortSignal,
    progress: (loaded: number) => void,
  ) {
    return new Promise<UploadDto>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url)
      xhr.responseType = 'json'
      xhr.setRequestHeader('content-type', 'application/octet-stream')
      xhr.setRequestHeader('content-digest', contentDigest(digest))
      xhr.setRequestHeader('x-app-request', '1')
      xhr.upload.onprogress = (e) => {
        progress(e.loaded)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadDto)
        else {
          const retry = Number(xhr.getResponseHeader('retry-after') ?? '')
          reject(
            new HttpFailure(
              xhr.status,
              (xhr.response as HttpFailure['body']) ?? null,
              Number.isFinite(retry) && retry > 0 ? retry : null,
            ),
          )
        }
      }
      xhr.onerror = () => {
        reject(new HttpFailure(0, null))
      }
      xhr.ontimeout = () => {
        reject(new HttpFailure(0, null))
      }
      xhr.onabort = () => {
        reject(new Stopped())
      }
      signal.addEventListener(
        'abort',
        () => {
          xhr.abort()
        },
        { once: true },
      )
      xhr.send(blob)
    })
  }

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Stopped())
        },
        { once: true },
      )
    })

  async function digest(blob: Blob) {
    if (!hasher) throw new Error('no hashing on the server')
    const out = await hasher.digest(blob)
    hasherMode.value = hasher.mode
    return out
  }

  const confirmedBytes = (u: UploadDto) =>
    u.received.reduce((sum, n) => {
      const { start, end } = partSlice(n, u.sizeBytes, u.partBytes)
      return sum + (end - start)
    }, 0)

  // ---- one file, from the first piece to `complete`
  async function drive(key: string) {
    const item = live(key)
    if (!item) return
    const s = side(item)
    const run = ++s.run
    const abort = new AbortController()
    s.abort = abort
    const check = () => {
      if (s.run !== run || abort.signal.aborted || !alive) throw new Stopped()
    }
    try {
      if (!item.uploadId) {
        const file = s.file
        if (!file || !s.type) throw new Error('an upload without its file')
        item.state = 'hashing'
        s.first ??= await digest(file.slice(0, PART_BYTES))
        check()
        const first = toHex(s.first)
        if (s.expect && !sameFile(s.expect, file, first)) {
          item.state = 'error'
          item.message = t('upload.notSame', { name: s.expect.name })
          // the upload left halfway is still there, for the right file
          leftovers.value = [s.expect, ...leftovers.value]
          s.expect = null
          return
        }
        const left =
          s.expect ?? leftovers.value.find((u) => u.mediaId === null && sameFile(u, file, first))
        if (left) {
          leftovers.value = leftovers.value.filter((u) => u.id !== left.id)
          item.uploadId = left.id
        } else {
          const started = await request<UploadDto>(
            'POST',
            base.value,
            {
              name: file.name,
              type: s.type,
              sizeBytes: file.size,
              firstPartSha256: first,
              folderId: s.folderId,
            },
            abort.signal,
          )
          check()
          item.uploadId = started.id
          s.upload = started
        }
        s.expect = null
      }
      // what the server has: after a fall, a piece may have arrived without its answer
      for (;;) {
        const uploadId = item.uploadId
        if (!uploadId) throw new Error('an upload without its id')
        const at = `${base.value}/${encodeURIComponent(uploadId)}`
        s.upload = await request<UploadDto>('GET', at, undefined, abort.signal)
        check()
        const upload = s.upload
        item.sent = confirmedBytes(upload)
        const missing = missingParts(upload.partCount, upload.received)
        if (missing.length > 0) {
          const file = s.file
          if (!file) {
            item.state = 'error'
            item.message = t('upload.chooseAgainNeeded')
            return
          }
          item.state = 'uploading'
          for (const n of missing) {
            const { start, end } = partSlice(n, upload.sizeBytes, upload.partBytes)
            const blob = file.slice(start, end)
            const sha = n === 1 && s.first ? s.first : await digest(blob)
            check()
            const before = item.sent
            const answer = await putPart(
              `${at}/parts/${String(n)}`,
              blob,
              sha,
              abort.signal,
              (loaded) => {
                const now = live(key)
                if (!now || s.run !== run) return
                now.sent = before + Math.min(loaded, end - start)
                s.meter.add(Date.now(), now.sent)
                now.rate = s.meter.rate()
              },
            )
            check()
            s.upload = answer
            item.sent = confirmedBytes(answer)
            s.tries = 0
          }
        }
        item.state = 'completing'
        item.rate = null
        const media = await completeOnce(at, abort.signal)
        check()
        if (media === 'missing') continue
        item.media = media
        item.sent = item.size
        settled(item, media)
        options.onChange()
        return
      }
    } catch (error) {
      if (error instanceof Stopped || s.run !== run) return
      stumble(item, error)
    } finally {
      if (s.abort === abort) s.abort = null
      pump()
    }
  }

  /**
   * `complete`, again while another call joins the pieces (409, ADR 021). A 409 with pieces
   * still missing sends them first.
   */
  async function completeOnce(at: string, signal: AbortSignal): Promise<MediaDto | 'missing'> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request<MediaDto>('POST', `${at}/complete`, undefined, signal)
      } catch (error) {
        const f = failureOf(error)
        if (f.status !== 409 || attempt >= 60) throw error
        const fresh = await request<UploadDto>('GET', at, undefined, signal)
        if (missingParts(fresh.partCount, fresh.received).length > 0) return 'missing'
        await sleep(Math.min(1000 * 2 ** attempt, 5000), signal)
      }
    }
  }

  function stumble(item: UploadItem, error: unknown) {
    const s = side(item)
    const f = failureOf(error)
    item.rate = null
    s.meter.reset()
    // a file that can no longer be read (changed or removed after it was chosen) is no fall
    // of the network: it waits for the person, not for the connection
    if (!(error instanceof HttpFailure) && !isFetchFailure(error)) {
      item.state = 'error'
      item.message = t('upload.chooseAgainNeeded')
      announce(t('upload.announce.error', { name: item.name, reason: item.message }))
      return
    }
    // no answer, the server busy or slowing us down: wait and go on by ourselves
    if (f.status === 0 || f.status >= 500 || f.status === 429 || f.status === 408) {
      item.state = 'offline'
      item.message = null
      const wait = f.retryAfter ?? Math.min(2 ** s.tries * 2, 30)
      s.tries += 1
      clearTimeout(s.timer)
      s.timer = setTimeout(() => {
        wake(item.key)
      }, wait * 1000)
      return
    }
    item.state = 'error'
    if (f.status === 404 && item.uploadId) {
      // expired (24 hours) or cancelled elsewhere: «Riprova» starts again from the first piece
      item.uploadId = null
      s.upload = null
      item.sent = 0
      item.message = t('upload.expired')
    } else item.message = f.message
    announce(t('upload.announce.error', { name: item.name, reason: item.message }))
  }

  function settled(item: UploadItem, media: MediaDto) {
    const was = item.state
    if (media.status === 'ready') item.state = 'ready'
    else if (media.status === 'failed') item.state = 'failed'
    else item.state = 'processing'
    if (was === item.state) return
    if (item.state === 'processing') {
      announce(t('upload.announce.uploaded', { name: item.name }))
      void follow(item.key)
    } else if (item.state === 'ready') announce(t('upload.announce.ready', { name: item.name }))
    else
      announce(
        t('upload.announce.failed', {
          name: item.name,
          reason: media.failure ? t(`library.failure.${media.failure.code}`) : '',
        }),
      )
    if (item.state !== 'processing' && !items.value.some((i) => busy(i)))
      announce(t('upload.announce.allDone'))
  }

  /** The worker's progress (`media.progress`), until the file is ready or failed. */
  async function follow(key: string) {
    const first = live(key)
    if (!first) return
    const s = side(first)
    if (s.watching) return
    s.watching = true
    try {
      for (let round = 0; alive; round++) {
        await new Promise((r) => setTimeout(r, round < 10 ? 2000 : 5000))
        const item = live(key)
        if (!item?.media || item.state !== 'processing') return
        try {
          const media = await request<MediaDto>(
            'GET',
            `${mediaBase.value}/${encodeURIComponent(item.media.id)}`,
          )
          item.media = media
          if (media.status !== 'processing') {
            settled(item, media)
            options.onChange()
            return
          }
        } catch (error) {
          // deleted meanwhile: nothing left to wait for
          if (failure(error).status === 404) {
            const gone = live(key)
            if (gone) forget(gone)
            return
          }
        }
      }
    } finally {
      s.watching = false
    }
  }

  const busy = (i: UploadItem) =>
    ['queued', 'hashing', 'uploading', 'offline', 'completing', 'processing'].includes(i.state)

  function pump() {
    if (!alive) return
    let active = items.value.filter((i) => RUNNING.includes(i.state)).length
    for (const item of items.value) {
      if (active >= MAX_ACTIVE) break
      if (item.state !== 'queued') continue
      active += 1
      item.state = 'hashing'
      void drive(item.key)
    }
  }

  function wake(key: string) {
    const item = live(key)
    if (item?.state !== 'offline') return
    clearTimeout(side(item).timer)
    item.state = 'queued'
    pump()
  }
  const wakeAll = () => {
    for (const item of items.value) if (item.state === 'offline') wake(item.key)
  }

  function newItem(file: File | null, name: string, size: number): UploadItem {
    const key = `u${String(++keys)}`
    sides.set(key, {
      file: file ? markRaw(file) : null,
      type: null,
      folderId: null,
      first: null,
      expect: null,
      upload: null,
      run: 0,
      abort: null,
      tries: 0,
      timer: undefined,
      meter: rateMeter(8000),
      watching: false,
    })
    return {
      key,
      name,
      size,
      kind: null,
      state: 'queued',
      sent: 0,
      rate: null,
      message: null,
      uploadId: null,
      media: null,
      preview: null,
    }
  }

  function refusal(check: Exclude<FileCheck, { ok: true }>, size: number) {
    if (check.reason === 'type') return t('upload.refused.type')
    if (check.reason === 'empty') return t('upload.refused.empty')
    return t(check.kind === 'video' ? 'upload.refused.sizeVideo' : 'upload.refused.sizeImage', {
      size: formatBytes(size),
      limit: formatBytes(check.limit),
    })
  }

  /** Files chosen, dropped or pasted: each is checked on its own, the good ones start. */
  async function add(files: readonly File[], folderId: string | null) {
    // the limits come with the list: a file chosen at once waits for them
    await loading
    let started = 0
    const added: UploadItem[] = []
    for (const file of files) {
      const item = newItem(file, file.name, file.size)
      const s = sides.get(item.key)
      if (!s) continue
      const check = checkUploadFile(
        file,
        limits.value ?? { maxImageBytes: Infinity, maxVideoBytes: Infinity },
      )
      if (!check.ok) {
        item.state = 'rejected'
        item.message = refusal(check, file.size)
        announce(t('upload.announce.refused', { name: file.name, reason: item.message }))
      } else {
        item.kind = check.kind
        s.type = check.type
        s.folderId = folderId
        if (check.kind === 'video' || PREVIEWABLE_IMAGES.has(check.type))
          item.preview = { url: URL.createObjectURL(file), kind: check.kind }
        started += 1
      }
      added.push(item)
    }
    items.value = [...added, ...items.value]
    if (started > 0) announce(t('upload.announce.started', { n: started }, started))
    pump()
  }

  /** The same file chosen again for an upload left halfway; without a file, when all its pieces arrived. */
  function resumeLeftover(left: Leftover, file: File | null) {
    const item = newItem(file, left.name, left.sizeBytes)
    const s = sides.get(item.key)
    if (!s) return
    item.kind = left.type.startsWith('video/') ? 'video' : 'image'
    s.type = declaredTypeOf({ name: left.name, type: left.type })
    s.folderId = left.folderId
    if (file) {
      if (file.name !== left.name || file.size !== left.sizeBytes) {
        item.state = 'error'
        item.message = t('upload.notSame', { name: left.name })
        items.value = [item, ...items.value]
        return
      }
      s.expect = left
      // off the list at once: no second choice nor «Annulla» while the file is checked
      leftovers.value = leftovers.value.filter((u) => u.id !== left.id)
      if (item.kind === 'video' || PREVIEWABLE_IMAGES.has(left.type))
        item.preview = { url: URL.createObjectURL(file), kind: item.kind }
    } else {
      item.uploadId = left.id
      leftovers.value = leftovers.value.filter((u) => u.id !== left.id)
    }
    items.value = [item, ...items.value]
    announce(t('upload.announce.started', { n: 1 }, 1))
    pump()
  }

  const leftoverProblem = ref<string | null>(null)
  async function cancelLeftover(left: Leftover) {
    leftoverProblem.value = null
    try {
      await request('DELETE', `${base.value}/${encodeURIComponent(left.id)}`)
    } catch (error) {
      // already gone (expired) is what was asked
      if (failure(error).status !== 404) {
        leftoverProblem.value = failure(error).message
        return
      }
    }
    leftovers.value = leftovers.value.filter((u) => u.id !== left.id)
    announce(t('upload.announce.canceled', { name: left.name }))
  }

  function stop(item: UploadItem) {
    const s = side(item)
    s.run += 1
    s.abort?.abort()
    s.abort = null
    clearTimeout(s.timer)
    s.meter.reset()
    item.rate = null
  }

  function pause(item: UploadItem) {
    if (!['queued', 'hashing', 'uploading', 'offline'].includes(item.state)) return
    stop(item)
    item.state = 'paused'
    announce(t('upload.announce.paused', { name: item.name }))
    pump()
  }
  function resume(item: UploadItem) {
    if (!['paused', 'error', 'offline'].includes(item.state)) return
    const s = side(item)
    clearTimeout(s.timer)
    s.tries = 0
    if (!s.file && !item.uploadId) {
      // nothing to send and no upload left to finish: only the file chosen again helps
      item.state = 'error'
      item.message = t('upload.chooseAgainNeeded')
      return
    }
    item.message = null
    item.state = 'queued'
    pump()
  }
  function forget(item: UploadItem) {
    if (item.preview) URL.revokeObjectURL(item.preview.url)
    sides.delete(item.key)
    items.value = items.value.filter((i) => i.key !== item.key)
  }
  async function cancel(item: UploadItem) {
    if (['completing', 'processing', 'ready', 'failed'].includes(item.state)) return
    stop(item)
    const uploadId = item.uploadId
    forget(item)
    announce(t('upload.announce.canceled', { name: item.name }))
    pump()
    if (uploadId)
      await request('DELETE', `${base.value}/${encodeURIComponent(uploadId)}`).catch(
        () => undefined,
      )
  }
  /** Takes a finished or refused file off the list. */
  function dismiss(item: UploadItem) {
    if (busy(item) || item.state === 'paused') return
    forget(item)
  }
  function clearFinished() {
    for (const item of [...items.value])
      if (['ready', 'failed', 'rejected'].includes(item.state)) forget(item)
  }

  let loading: Promise<void> = Promise.resolve()
  async function load() {
    try {
      const answer = await request<{ items: Leftover[]; limits: UploadLimits }>('GET', base.value)
      limits.value = answer.limits
      const mine = new Set(items.value.map((i) => i.uploadId))
      leftovers.value = answer.items.filter((u) => !mine.has(u.id))
    } catch {
      // no list: the files still upload, and the server checks the limits
    }
  }

  const totals = computed(() => {
    const counted = items.value.filter((i) => i.state !== 'rejected')
    const size = counted.reduce((n, i) => n + i.size, 0)
    const sent = counted.reduce((n, i) => n + Math.min(i.sent, i.size), 0)
    const rates = counted.map((i) => i.rate).filter((r): r is number => r !== null && r > 0)
    const rate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) : null
    const left = counted
      .filter((i) => ['queued', 'hashing', 'uploading', 'offline'].includes(i.state))
      .reduce((n, i) => n + i.size - i.sent, 0)
    return {
      files: counted.length,
      uploaded: counted.filter((i) => i.sent >= i.size && i.state !== 'error').length,
      size,
      sent,
      percent: size > 0 ? Math.floor((sent / size) * 100) : 0,
      seconds: rate && left > 0 ? left / rate : null,
      active: counted.some((i) => busy(i) && i.state !== 'processing'),
    }
  })

  function online() {
    wakeAll()
  }
  function visible() {
    if (document.visibilityState === 'visible') wakeAll()
  }
  function leaving(event: BeforeUnloadEvent) {
    if (totals.value.active) event.preventDefault()
  }
  onMounted(() => {
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('beforeunload', leaving)
    loading = load()
  })
  onBeforeUnmount(() => {
    alive = false
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('beforeunload', leaving)
    for (const item of items.value) {
      stop(item)
      if (item.preview) URL.revokeObjectURL(item.preview.url)
    }
    hasher?.stop()
  })
  watch(workspaceId, () => (loading = load()))

  return {
    items,
    leftovers,
    leftoverProblem,
    limits,
    announcement,
    hasherMode,
    totals,
    add,
    pause,
    resume,
    cancel,
    dismiss,
    clearFinished,
    resumeLeftover,
    cancelLeftover,
    wake,
  }
}
