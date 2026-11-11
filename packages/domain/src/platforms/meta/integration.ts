/**
 * The settings of an agency's Meta app (spec §8.3, ADR 020), never the secret. Only the App ID
 * is required: the unified login needs `configId` (Task 7, postponed), `businessId` is kept but
 * no longer used by the system user's listing (real Meta, 2026-11-11, docs/platforms/meta.md), and
 * the Data Use Checkup has no API, so the Owner types its due date (empty while in development).
 */
export interface MetaIntegrationConfig {
  appId: string
  configId: string | null
  businessId: string | null
  /** YYYY-MM-DD */
  dataUseCheckupDueOn: string | null
}

export type MetaIntegrationField = keyof MetaIntegrationConfig

export type MetaIntegrationCheck =
  { ok: true; value: MetaIntegrationConfig } | { ok: false; field: string }

const FIELDS: readonly MetaIntegrationField[] = [
  'appId',
  'configId',
  'businessId',
  'dataUseCheckupDueOn',
]

// Meta's ids are numbers written as strings; 32 digits leave room above today's 15–17.
const META_ID = /^\d{1,32}$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** Trimmed; empty means not set. undefined: not a string. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Checks what the Owner typed, or a stored row read back; names the first field that is off. */
export function checkMetaIntegrationConfig(value: unknown): MetaIntegrationCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, field: 'appId' }
  const record = value as Record<string, unknown>
  const extra = Object.keys(record).find((k) => !(FIELDS as readonly string[]).includes(k))
  if (extra !== undefined) return { ok: false, field: extra }

  const appId = optionalText(record.appId)
  if (typeof appId !== 'string' || !META_ID.test(appId)) return { ok: false, field: 'appId' }
  const configId = optionalText(record.configId)
  if (configId === undefined || (configId !== null && !META_ID.test(configId)))
    return { ok: false, field: 'configId' }
  const businessId = optionalText(record.businessId)
  if (businessId === undefined || (businessId !== null && !META_ID.test(businessId)))
    return { ok: false, field: 'businessId' }
  const dueOn = optionalText(record.dataUseCheckupDueOn)
  if (dueOn === undefined || (dueOn !== null && !isCalendarDate(dueOn)))
    return { ok: false, field: 'dataUseCheckupDueOn' }
  return { ok: true, value: { appId, configId, businessId, dataUseCheckupDueOn: dueOn } }
}
