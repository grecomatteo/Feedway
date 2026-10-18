const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

export const RETENTION = {
  expiredSessionsMs: 30 * DAY_MS,
  knownDevicesMs: 365 * DAY_MS,
  auditIpMs: 90 * DAY_MS,
  disabledUserMs: 730 * DAY_MS,
  anonymizationNoticeMs: 30 * DAY_MS,
  dataExportMs: 24 * HOUR_MS,
  avatarStagingMs: HOUR_MS,
} as const

export interface RetentionCutoffs {
  expiredSessionsBefore: Date
  knownDevicesBefore: Date
  auditIpBefore: Date
  disabledUserBefore: Date
  anonymizationNoticeBefore: Date
  dataExportBefore: Date
  avatarStagingBefore: Date
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const before = (ms: number) => new Date(now.getTime() - ms)
  return {
    expiredSessionsBefore: before(RETENTION.expiredSessionsMs),
    knownDevicesBefore: before(RETENTION.knownDevicesMs),
    auditIpBefore: before(RETENTION.auditIpMs),
    disabledUserBefore: before(RETENTION.disabledUserMs),
    anonymizationNoticeBefore: before(RETENTION.anonymizationNoticeMs),
    dataExportBefore: before(RETENTION.dataExportMs),
    avatarStagingBefore: before(RETENTION.avatarStagingMs),
  }
}

export const ANONYMIZED_NAME = 'Utente rimosso'

// `.invalid` is reserved (RFC 2606): the address is unique per user and can never be delivered.
export function anonymizedEmail(userId: string): string {
  return `${userId}@utente-rimosso.invalid`
}
