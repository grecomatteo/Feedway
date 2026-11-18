import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createAutosave,
  createCheckRunner,
  hasContent,
  missingFiles,
  nextType,
  typeOptions,
  type DraftBody,
} from '../app/utils/post-editor.ts'

const photo = { kind: 'image' as const }
const video = { kind: 'video' as const }

describe('the type of the post (D-60, §11.2 point 2)', () => {
  test('with no file the four types are there and none is chosen', () => {
    expect(typeOptions([]).every((o) => o.enabled)).toBe(true)
    expect(nextType(null, false, [])).toBeNull()
  })

  test('the types that do not go are off with their reason', () => {
    const two = typeOptions([photo, video])
    expect(two.find((o) => o.type === 'carousel')?.enabled).toBe(true)
    expect(two.filter((o) => !o.enabled).map((o) => [o.type, o.reason])).toEqual([
      ['photo', 'onePhoto'],
      ['reel', 'oneVideo'],
      ['story', 'oneFile'],
    ])
    expect(typeOptions([video]).find((o) => o.type === 'photo')?.reason).toBe('photoNotVideo')
    expect(typeOptions([photo]).find((o) => o.type === 'reel')?.reason).toBe('reelNotPhoto')
    expect(typeOptions([photo]).find((o) => o.type === 'carousel')?.reason).toBe('carouselTwo')
  })

  test('the editor proposes the type until the person chooses, never a story', () => {
    expect(nextType(null, false, [photo])).toBe('photo')
    expect(nextType('photo', false, [video])).toBe('reel')
    expect(nextType('reel', false, [video, photo])).toBe('carousel')
    expect(nextType(null, false, [photo]) === 'story').toBe(false)
  })

  test('the choice of the person is sovereign: adding or taking files never changes it', () => {
    expect(nextType('story', true, [photo])).toBe('story')
    expect(nextType('photo', true, [photo, photo])).toBe('photo')
    expect(nextType('carousel', true, [video])).toBe('carousel')
  })
})

const body = (over: Partial<DraftBody> = {}): DraftBody => ({
  type: 'photo',
  mediaIds: [],
  caption: { common: '' },
  destinations: [],
  when: null,
  shareToFeed: true,
  choices: [],
  cover: null,
  labelIds: [],
  ...over,
})

test('a draft is born with its first content, not when the page opens', () => {
  expect(hasContent(body())).toBe(false)
  expect(hasContent(body({ caption: { common: ' ' } }))).toBe(true)
  expect(hasContent(body({ mediaIds: ['m'] }))).toBe(true)
  expect(hasContent(body({ destinations: [{ accountId: 'a' }] }))).toBe(true)
  expect(hasContent(body({ caption: { common: '', instagram: 'x' } }))).toBe(true)
  // a label is kept only by a saved post
  expect(hasContent(body({ labelIds: ['l'] }))).toBe(true)
})

test('the files a destination leaves out are said, with their place (D-56)', () => {
  const media = [photo, video, photo]
  expect(missingFiles(media, [0, 2])).toEqual([{ index: 1, kind: 'video' }])
  expect(missingFiles(media, [0, 1, 2])).toEqual([])
})

describe('saving by itself (Scelta 7)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function saver(over: Partial<Parameters<typeof createAutosave>[0]> = {}) {
    let current = body()
    const create = vi.fn(() => Promise.resolve({ id: 'p1', version: 1 }))
    const update = vi.fn((_id: string, version: number) =>
      Promise.resolve({ id: 'p1', version: version + 1 }),
    )
    const states: string[] = []
    const s = createAutosave({
      body: () => current,
      create,
      update,
      onState: (st) => states.push(st.status),
      ...over,
    })
    return {
      s,
      create,
      update,
      states,
      set: (b: Partial<DraftBody>) => {
        current = body({ ...current, ...b })
        s.changed()
      },
    }
  }

  test('nothing is created while there is no content', async () => {
    const { s, create } = saver()
    s.changed()
    await vi.advanceTimersByTimeAsync(5000)
    expect(create).not.toHaveBeenCalled()
  })

  test('it saves after 1.5 s of pause, and says «saved» only after the answer', async () => {
    let answer: (v: { id: string; version: number }) => void = () => undefined
    const create = vi.fn(() => new Promise<{ id: string; version: number }>((r) => (answer = r)))
    const { s, set } = saver({ create })
    set({ caption: { common: 'Il pane' } })
    await vi.advanceTimersByTimeAsync(1000)
    set({ caption: { common: 'Il pane di segale' } })
    await vi.advanceTimersByTimeAsync(1400)
    expect(create).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(create).toHaveBeenCalledTimes(1)
    expect(s.state().status).toBe('saving')
    answer({ id: 'p1', version: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(s.state()).toMatchObject({ status: 'saved', postId: 'p1', version: 1 })
  })

  test('then each save carries the version it read', async () => {
    const { s, set, update } = saver()
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(update).toHaveBeenCalledWith('p1', 1, expect.anything())
    expect(s.state().version).toBe(2)
  })

  test('a change during a save is saved after it, never two at once', async () => {
    let answer: (v: { id: string; version: number }) => void = () => undefined
    const update = vi.fn(
      (_id: string, version: number) =>
        new Promise<{ id: string; version: number }>((r) => {
          answer = () => {
            r({ id: 'p1', version: version + 1 })
          }
        }),
    )
    const { set } = saver({ update })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'abc' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(update).toHaveBeenCalledTimes(1)
    answer({ id: 'p1', version: 2 })
    await vi.advanceTimersByTimeAsync(1500)
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1]?.[1]).toBe(2)
  })

  test('a 409 says the conflict and keeps the local text, no more saves', async () => {
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('409'), { conflict: true })))
    const { s, set } = saver({
      update,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'il mio testo' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(s.state().status).toBe('conflict')
    set({ caption: { common: 'il mio testo, ancora' } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(update).toHaveBeenCalledTimes(1)
  })

  test('a fall of the network is «not saved: retry», never «saved»', async () => {
    const update = vi.fn((): Promise<{ id: string; version: number }> =>
      Promise.reject(new Error('offline')),
    )
    const { s, set, states } = saver({ update })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(s.state().status).toBe('failed')
    expect(states.at(-1)).toBe('failed')
    update.mockImplementationOnce(() => Promise.resolve({ id: 'p1', version: 2 }))
    await s.flush()
    expect(s.state().status).toBe('saved')
  })

  test('flush saves at once (leaving the page, hiding the tab)', async () => {
    const { s, set, create } = saver()
    set({ caption: { common: 'a' } })
    await s.flush()
    expect(create).toHaveBeenCalledTimes(1)
    expect(s.state().dirty).toBe(false)
  })

  test('paused (a scheduled post) it never saves by itself', async () => {
    const { s, set, update } = saver()
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    s.pause(true)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(update).not.toHaveBeenCalled()
    expect(s.state().dirty).toBe(true)
  })
})

describe('the checks while writing (Scelta 8, D-57)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('one call after 500 ms of pause, none if the body did not change', async () => {
    const run = vi.fn((b: unknown) => Promise.resolve(b))
    const seen: unknown[] = []
    const c = createCheckRunner({ run, onReport: (r) => seen.push(r) })
    c.request({ a: 1 })
    await vi.advanceTimersByTimeAsync(300)
    c.request({ a: 2 })
    await vi.advanceTimersByTimeAsync(499)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    c.request({ a: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ a: 2 }])
  })

  test('an answer older than a failure is thrown away: the error stays (P2 c of the review)', async () => {
    const calls: { ok: (v: string) => void; fail: (e: Error) => void }[] = []
    const run = vi.fn(() => new Promise<string>((ok, fail) => calls.push({ ok, fail })))
    const seen: string[] = []
    const errors: unknown[] = []
    const c = createCheckRunner({
      run,
      onReport: (r) => seen.push(r),
      onError: (e) => errors.push(e),
    })
    c.request({ cover: 'A' })
    await vi.advanceTimersByTimeAsync(500)
    c.request({ cover: 'B' })
    await vi.advanceTimersByTimeAsync(500)
    calls[1]?.fail(new Error('422'))
    await vi.advanceTimersByTimeAsync(0)
    calls[0]?.ok('report of A')
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(1)
    expect(seen).toEqual([])
  })

  test('an answer that comes after a newer one is thrown away', async () => {
    const answers: ((v: string) => void)[] = []
    const run = vi.fn(() => new Promise<string>((r) => answers.push(r)))
    const seen: string[] = []
    const c = createCheckRunner({ run, onReport: (r) => seen.push(r) })
    c.request({ a: 1 })
    await vi.advanceTimersByTimeAsync(500)
    c.request({ a: 2 })
    await vi.advanceTimersByTimeAsync(500)
    answers[1]?.('new')
    await vi.advanceTimersByTimeAsync(0)
    answers[0]?.('old')
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual(['new'])
  })
})
