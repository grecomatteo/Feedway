import { describe, expect, it } from 'vitest'
import { mayMove, movedWhen } from '../app/utils/calendar-move.ts'

const ME = 'u-me'
const OTHER = 'u-other'
const post = (over: Partial<Parameters<typeof mayMove>[0]> = {}) => ({
  status: 'scheduled' as const,
  createdBy: ME,
  localDate: '2026-12-03',
  localTime: '18:00',
  ...over,
})
const client = (myRole: string, archivedAt: string | null = null) => ({ myRole, archivedAt })

describe('mayMove', () => {
  it('moves a scheduled post for whoever may schedule it', () => {
    expect(mayMove(post(), client('publisher'), ME)).toBe(true)
    expect(mayMove(post({ createdBy: OTHER }), client('manager'), ME)).toBe(true)
  })

  it('moves a draft with a day for its author and for who manages the posts of others', () => {
    expect(mayMove(post({ status: 'draft' }), client('editor'), ME)).toBe(true)
    expect(mayMove(post({ status: 'draft', createdBy: OTHER }), client('editor'), ME)).toBe(false)
    expect(mayMove(post({ status: 'draft', createdBy: OTHER }), client('admin'), ME)).toBe(true)
  })

  it('does not move a scheduled post for an Editor, who may not schedule', () => {
    expect(mayMove(post(), client('editor'), ME)).toBe(false)
  })

  it('does not move a post of another for a Publisher, as the editor does not let it change', () => {
    expect(mayMove(post({ createdBy: OTHER }), client('publisher'), ME)).toBe(false)
  })

  it('never moves for a Viewer, in an archived client or a client not known', () => {
    expect(mayMove(post(), client('viewer'), ME)).toBe(false)
    expect(mayMove(post(), client('owner', '2026-11-01T00:00:00Z'), ME)).toBe(false)
    expect(mayMove(post(), undefined, ME)).toBe(false)
  })

  it('does not move a post on its way, out, partly out, failed, paused or cancelled (R6)', () => {
    for (const status of [
      'publishing',
      'published',
      'partial',
      'failed',
      'problem',
      'paused',
      'cancelled',
    ] as const)
      expect(mayMove(post({ status }), client('owner'), ME), status).toBe(false)
  })

  it('does not move a post without a day or a time: there is nothing to carry', () => {
    expect(mayMove(post({ status: 'draft', localDate: null }), client('owner'), ME)).toBe(false)
    expect(mayMove(post({ status: 'draft', localTime: null }), client('owner'), ME)).toBe(false)
  })
})

describe('movedWhen', () => {
  it('gives the day and time as they are when the post has the agency zone', () => {
    expect(
      movedWhen(
        { timezone: 'Europe/Rome' },
        { localDate: '2026-12-05', localTime: '18:00' },
        'Europe/Rome',
      ),
    ).toEqual({ localDate: '2026-12-05', localTime: '18:00' })
  })

  it('carries the agency day and time into the post own zone (D-58)', () => {
    // 18:00 in Rome on 5 December is 17:00 in London
    expect(
      movedWhen(
        { timezone: 'Europe/London' },
        { localDate: '2026-12-05', localTime: '18:00' },
        'Europe/Rome',
      ),
    ).toEqual({ localDate: '2026-12-05', localTime: '17:00' })
    // 00:30 in Rome is still the day before in New York
    expect(
      movedWhen(
        { timezone: 'America/New_York' },
        { localDate: '2026-12-05', localTime: '00:30' },
        'Europe/Rome',
      ),
    ).toEqual({ localDate: '2026-12-04', localTime: '18:30' })
  })

  it('keeps 02:30 on the night the clocks go back, in its own day', () => {
    expect(
      movedWhen(
        { timezone: 'Europe/Rome' },
        { localDate: '2026-10-25', localTime: '02:30' },
        'Europe/Rome',
      ),
    ).toEqual({ localDate: '2026-10-25', localTime: '02:30' })
  })
})
