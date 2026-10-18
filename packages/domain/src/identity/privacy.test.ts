import { describe, expect, test } from 'vitest'
import { ANONYMIZED_NAME, RETENTION, anonymizedEmail, retentionCutoffs } from './privacy.js'

const at = (iso: string) => new Date(iso)

describe('retention', () => {
  test('cutoffs are computed from now', () => {
    const c = retentionCutoffs(at('2026-10-15T03:30:00Z'))
    expect(c.expiredSessionsBefore).toEqual(at('2026-09-15T03:30:00Z'))
    expect(c.auditIpBefore).toEqual(at('2026-07-17T03:30:00Z'))
    expect(c.knownDevicesBefore).toEqual(at('2025-10-15T03:30:00Z'))
    expect(c.disabledUserBefore).toEqual(at('2024-10-15T03:30:00Z'))
    expect(c.anonymizationNoticeBefore).toEqual(at('2026-09-15T03:30:00Z'))
    expect(c.dataExportBefore).toEqual(at('2026-10-14T03:30:00Z'))
    expect(c.avatarStagingBefore).toEqual(at('2026-10-15T02:30:00Z'))
  })

  test('every retention entry has a cutoff', () => {
    expect(Object.keys(retentionCutoffs(at('2026-10-15T00:00:00Z')))).toHaveLength(
      Object.keys(RETENTION).length,
    )
  })

  test('cutoffs do not mutate the input date', () => {
    const now = at('2026-10-15T03:30:00Z')
    retentionCutoffs(now)
    expect(now).toEqual(at('2026-10-15T03:30:00Z'))
  })
})

describe('anonymization', () => {
  test('anonymized name', () => {
    expect(ANONYMIZED_NAME).toBe('Utente rimosso')
  })

  test('anonymized email is unique per user and undeliverable', () => {
    const id = '0192f0a1-0000-7000-8000-000000000001'
    expect(anonymizedEmail(id)).toBe(`${id}@utente-rimosso.invalid`)
    expect(anonymizedEmail('a')).not.toBe(anonymizedEmail('b'))
  })
})
