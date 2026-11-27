import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  contentKey,
  createAutosave,
  passedToTomorrow,
  confirmSent,
  rememberSent,
  sentByThisTab,
  createCheckRunner,
  hasContent,
  missingFiles,
  nextType,
  roomFor,
  typeHint,
  typeOptions,
  typedCollaborators,
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

  test('one sentence says why the others are off, written for the files there are (R5)', () => {
    expect(typeHint([])).toBeNull()
    expect(typeHint([photo, video])).toEqual({ key: 'many', n: 2 })
    expect(typeHint([photo])).toEqual({ key: 'onePhoto', n: 1 })
    expect(typeHint([video])).toEqual({ key: 'oneVideo', n: 1 })
    // a file still uploading: its kind is not known yet
    expect(typeHint([{ kind: null }])).toEqual({ key: 'oneFile', n: 1 })
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
  instagramCollaborators: [],
  ...over,
})

describe('at most 10 files in a post (D-118, Matteo 22/11)', () => {
  test('the files that still fit go in, the others are counted', () => {
    expect(roomFor(['a', 'b', 'c'], 0, 10)).toEqual({ kept: ['a', 'b', 'c'], leftOut: 0 })
    expect(roomFor(['a', 'b', 'c'], 8, 10)).toEqual({ kept: ['a', 'b'], leftOut: 1 })
    expect(
      roomFor(
        Array.from({ length: 11 }, (_, i) => i),
        0,
        10,
      ).leftOut,
    ).toBe(1)
  })

  test('a post already full, or over from before, takes nothing', () => {
    expect(roomFor(['a'], 10, 10)).toEqual({ kept: [], leftOut: 1 })
    expect(roomFor(['a', 'b'], 12, 10)).toEqual({ kept: [], leftOut: 2 })
  })
})

test('a draft is born with its first content, not when the page opens', () => {
  expect(hasContent(body())).toBe(false)
  expect(hasContent(body({ caption: { common: ' ' } }))).toBe(true)
  expect(hasContent(body({ mediaIds: ['m'] }))).toBe(true)
  expect(hasContent(body({ destinations: [{ accountId: 'a' }] }))).toBe(true)
  expect(hasContent(body({ caption: { common: '', instagram: 'x' } }))).toBe(true)
  // a label is kept only by a saved post
  expect(hasContent(body({ labelIds: ['l'] }))).toBe(true)
  expect(hasContent(body({ instagramCollaborators: ['forno.luce'] }))).toBe(true)
})

describe('the collaborators typed in the field (D-125)', () => {
  test('names written together become one each, empty pieces go away', () => {
    expect(typedCollaborators('forno, @mulino  pane;')).toEqual(['forno', 'mulino', 'pane'])
    expect(typedCollaborators(' , @ ')).toEqual([])
  })

  test('a wrong name stays as typed: the checks say what is wrong', () => {
    expect(typedCollaborators('forno-luce')).toEqual(['forno-luce'])
  })
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

  test('a save whose answer was lost and then a 409: its own version is taken, no conflict (D-120.1)', async () => {
    const conflict = Object.assign(new Error('409'), { conflict: true })
    // the server saved version 2 but the answer never came back
    const update = vi
      .fn<(id: string, version: number) => Promise<{ id: string; version: number }>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(conflict)
      .mockImplementation((_id, version) => Promise.resolve({ id: 'p1', version: version + 1 }))
    const recover = vi.fn(() => Promise.resolve({ id: 'p1', version: 2 }))
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(s.state().status).toBe('failed')
    set({ caption: { common: 'abc' } })
    await s.flush()
    // asked once, with the version it had and how many saves may have landed
    expect(recover).toHaveBeenCalledWith('p1', 1, 1)
    expect(update.mock.calls.map((c) => c[1])).toEqual([1, 1, 2])
    expect(s.state()).toMatchObject({ status: 'saved', version: 3, dirty: false })
  })

  test('the retry after a recover loses its answer too: the next 409 counts from the version taken', async () => {
    const conflict = Object.assign(new Error('409'), { conflict: true })
    const update = vi
      .fn<(id: string, version: number) => Promise<{ id: string; version: number }>>()
      .mockRejectedValueOnce(new Error('network')) // v1 → server v2, answer lost
      .mockRejectedValueOnce(conflict) // sent v1
      .mockRejectedValueOnce(new Error('network')) // retry with v2 → server v3, answer lost
      .mockRejectedValueOnce(conflict) // sent v2
      .mockImplementation((_id, version) => Promise.resolve({ id: 'p1', version: version + 1 }))
    const recover = vi
      .fn<(id: string, version: number, lost: number) => Promise<{ id: string; version: number }>>()
      .mockResolvedValueOnce({ id: 'p1', version: 2 })
      .mockResolvedValueOnce({ id: 'p1', version: 3 })
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    await s.flush()
    expect(s.state().status).toBe('failed')
    await s.flush()
    expect(recover).toHaveBeenLastCalledWith('p1', 2, 1)
    expect(s.state()).toMatchObject({ status: 'saved', version: 4 })
  })

  test('a 409 after a save that failed, with a version not its own, stays a conflict', async () => {
    const conflict = Object.assign(new Error('409'), { conflict: true })
    const update = vi
      .fn<(id: string, version: number) => Promise<{ id: string; version: number }>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValue(conflict)
    const recover = vi.fn(() => Promise.resolve(null))
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    await s.flush()
    expect(recover).toHaveBeenCalledTimes(1)
    expect(s.state().status).toBe('conflict')
  })

  test('the post not read after that 409 is «not saved: retry», and the next 409 asks again', async () => {
    const conflict = Object.assign(new Error('409'), { conflict: true })
    const update = vi
      .fn<(id: string, version: number) => Promise<{ id: string; version: number }>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockImplementation((_id, version) => Promise.resolve({ id: 'p1', version: version + 1 }))
    const recover = vi
      .fn<() => Promise<{ id: string; version: number } | null>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ id: 'p1', version: 2 })
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    await s.flush()
    expect(s.state().status).toBe('failed')
    await s.flush()
    expect(recover).toHaveBeenLastCalledWith('p1', 1, 1)
    expect(s.state()).toMatchObject({ status: 'saved', version: 3 })
  })

  test('a 409 with no save lost asks too: another person or tab is a conflict (D-131.1)', async () => {
    const recover = vi.fn(() => Promise.resolve(null))
    const update = vi.fn(() => Promise.reject(Object.assign(new Error('409'), { conflict: true })))
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } })
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(recover).toHaveBeenCalledWith('p1', 1, 0)
    expect(s.state().status).toBe('conflict')
  })

  test('a version this tab did not count, on its own save: taken, no conflict (D-131.1)', async () => {
    // the server is at 3 with this tab's own content, the tab still says 1
    const update = vi
      .fn<(id: string, version: number) => Promise<{ id: string; version: number }>>()
      .mockRejectedValueOnce(Object.assign(new Error('409'), { conflict: true }))
      .mockImplementation((_id, version) => Promise.resolve({ id: 'p1', version: version + 1 }))
    const recover = vi.fn(() => Promise.resolve({ id: 'p1', version: 3 }))
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
    })
    set({ caption: { common: 'a' } }) // created, v1
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(update.mock.calls.map((c) => c[1])).toEqual([1, 3])
    expect(s.state()).toMatchObject({ status: 'saved', version: 4 })
  })

  test('a save refused with an answer (500, 429) is not lost: the next 409 asks, never guesses', async () => {
    const recover = vi.fn(() => Promise.resolve(null))
    const update = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('500'), { answered: true }))
      .mockRejectedValueOnce(Object.assign(new Error('409'), { conflict: true, answered: true }))
    const { s, set } = saver({
      update,
      recover,
      isConflict: (e) => (e as { conflict?: boolean }).conflict === true,
      isLost: (e) => (e as { answered?: boolean }).answered !== true,
    })
    set({ caption: { common: 'a' } }) // created, v1
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'ab' } }) // 500
    await vi.advanceTimersByTimeAsync(1500)
    set({ caption: { common: 'abc' } }) // 409
    await vi.advanceTimersByTimeAsync(1500)
    expect(recover).toHaveBeenCalledWith('p1', 1, 0)
    expect(s.state().status).toBe('conflict')
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

describe('the evening moves the post to tomorrow, and says so (D-120.5)', () => {
  // 23 November 2026, 21:10 in Rome
  const evening = new Date('2026-11-23T20:10:00Z')
  test('tomorrow at a time already past today: said', () => {
    expect(
      passedToTomorrow({ localDate: '2026-11-24', localTime: '09:30' }, 'Europe/Rome', evening),
    ).toBe(true)
    expect(
      passedToTomorrow({ localDate: '2026-11-24', localTime: '21:10' }, 'Europe/Rome', evening),
    ).toBe(true)
  })
  test('tomorrow at a time still ahead today, today, or later: not said', () => {
    expect(
      passedToTomorrow({ localDate: '2026-11-24', localTime: '22:00' }, 'Europe/Rome', evening),
    ).toBe(false)
    expect(
      passedToTomorrow({ localDate: '2026-11-23', localTime: '22:00' }, 'Europe/Rome', evening),
    ).toBe(false)
    expect(
      passedToTomorrow({ localDate: '2026-11-25', localTime: '09:30' }, 'Europe/Rome', evening),
    ).toBe(false)
    expect(passedToTomorrow(null, 'Europe/Rome', evening)).toBe(false)
  })
  test('in the zone of the post, not of the browser', () => {
    // 21:10 in Rome is 15:10 in New York: 16:00 is gone in Rome, still ahead there
    const at = { localDate: '2026-11-24', localTime: '16:00' }
    expect(passedToTomorrow(at, 'Europe/Rome', evening)).toBe(true)
    expect(passedToTomorrow(at, 'America/New_York', evening)).toBe(false)
  })
})

describe('what this tab sent (D-131.1)', () => {
  const body = (over: Partial<DraftBody> = {}): DraftBody => ({
    type: 'photo',
    mediaIds: ['m1'],
    caption: { common: 'Pane' },
    destinations: [{ accountId: 'a1' }, { accountId: 'a2' }],
    when: { localDate: '2026-11-26', localTime: '11:30' },
    shareToFeed: true,
    choices: [],
    cover: null,
    labelIds: ['l2', 'l1'],
    instagramCollaborators: ['forno.luce'],
    ...over,
  })

  test('the same content written by the editor or read from the server is the same', () => {
    expect(contentKey(body())).toBe(
      contentKey(
        body({
          caption: { common: 'Pane', instagram: 'Pane' },
          destinations: [{ accountId: 'a2' }, { accountId: 'a1' }],
          labelIds: ['l1', 'l2'],
        }),
      ),
    )
    expect(contentKey(body({ mediaIds: [], cover: { source: 'frame', offsetMs: 0 } }))).toBe(
      contentKey(body({ mediaIds: [] })),
    )
  })

  test('another day, time, text or file is another content', () => {
    const one = contentKey(body())
    for (const other of [
      body({ when: { localDate: '2026-11-27', localTime: '11:30' } }),
      body({ when: { localDate: '2026-11-26', localTime: '11:31' } }),
      body({ caption: { common: 'Pane caldo' } }),
      body({ mediaIds: ['m1', 'm2'] }),
      body({ instagramCollaborators: ['mulino'] }),
    ])
      expect(contentKey(other)).not.toBe(one)
  })

  test('only what this tab sent for that post counts', () => {
    rememberSent('post-a', body())
    expect(sentByThisTab('post-a', body())).toBe(true)
    expect(sentByThisTab('post-a', body({ caption: { common: 'altro' } }))).toBe(false)
    expect(sentByThisTab('post-b', body())).toBe(false)
  })

  test('a confirmed save ends the older ones: they can no longer undo a later change', () => {
    const old = body({ caption: { common: 'vecchio' } })
    const kept = body({ caption: { common: 'salvato' } })
    const after = body({ caption: { common: 'in viaggio' } })
    rememberSent('post-c', old)
    const key = rememberSent('post-c', kept)
    rememberSent('post-c', after)
    confirmSent('post-c', key)
    expect(sentByThisTab('post-c', old)).toBe(false)
    expect(sentByThisTab('post-c', kept)).toBe(true)
    expect(sentByThisTab('post-c', after)).toBe(true)
  })
})
