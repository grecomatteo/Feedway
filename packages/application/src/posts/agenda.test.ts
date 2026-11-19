import { describe, expect, test } from 'vitest'
import { agendaPeriod, draftMissing, textStart } from './agenda.js'

const NOW = new Date('2026-11-19T09:00:00Z')

describe('agendaPeriod', () => {
  test('without a period: the next seven days from now', () => {
    expect(agendaPeriod(NOW)).toEqual({
      from: NOW,
      to: new Date('2026-11-26T09:00:00Z'),
    })
  })

  test('the period asked, up to six weeks', () => {
    const from = '2026-11-15T23:00:00.000Z'
    const to = '2026-12-27T23:00:00.000Z'
    expect(agendaPeriod(NOW, from, to)).toEqual({ from: new Date(from), to: new Date(to) })
  })

  test('refuses an empty, reversed or longer period', () => {
    const at = '2026-11-16T23:00:00.000Z'
    expect(() => agendaPeriod(NOW, at, at)).toThrow('Periodo non valido')
    expect(() => agendaPeriod(NOW, at, '2026-11-10T23:00:00.000Z')).toThrow('Periodo non valido')
    expect(() => agendaPeriod(NOW, at, '2026-12-28T23:00:01.000Z')).toThrow('al massimo di 42')
    expect(() => agendaPeriod(NOW, 'ieri')).toThrow('Periodo non valido')
  })
})

describe('textStart', () => {
  test('the common text on one line, else a platform’s', () => {
    expect(textStart({ caption: '  Pane\n\ncaldo  ', captionByPlatform: {} })).toBe('Pane caldo')
    expect(textStart({ caption: ' ', captionByPlatform: { facebook: 'Solo Facebook' } })).toBe(
      'Solo Facebook',
    )
    expect(textStart({ caption: '', captionByPlatform: {} })).toBe('')
  })

  test('at most 140 characters, never half an emoji', () => {
    expect(textStart({ caption: 'a'.repeat(300), captionByPlatform: {} })).toHaveLength(140)
    const cut = textStart({ caption: `${'a'.repeat(139)}🥐🥐`, captionByPlatform: {} })
    expect(cut).toBe(`${'a'.repeat(139)}🥐`)
  })
})

describe('draftMissing', () => {
  const ready = {
    mediaIds: ['m'],
    caption: 'Testo',
    captionByPlatform: {},
    targets: [{ id: 't', accountId: 'a', status: 'draft' as const, fingerprint: null }],
  }

  test('nothing: ready to schedule', () => {
    expect(draftMissing(ready)).toEqual([])
  })

  test('files, text and accounts, in the editor’s order', () => {
    expect(draftMissing({ ...ready, mediaIds: [], caption: '', targets: [] })).toEqual([
      'media',
      'text',
      'accounts',
    ])
    expect(
      draftMissing({ ...ready, caption: '', captionByPlatform: { instagram: 'Solo IG' } }),
    ).toEqual([])
  })
})
