import { DomainError } from '@app/domain'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const OWNER = `(org|users)/${UUID}/`
// Segments never start with a dot: the disk keeps temporary files beside the objects and they
// must not be reachable as keys.
const SEGMENT = '[a-z0-9_-][a-z0-9._-]*'

/** The rules every `Storage` adapter applies to keys, prefixes and content types. */
export const KEY = new RegExp(`^${OWNER}(${SEGMENT}/)*${SEGMENT}$`)
export const PREFIX = new RegExp(`^${OWNER}(${SEGMENT}/)*$`)
// Listing may also cover every owner of a kind (the daily retention); removing never does.
export const LIST_PREFIX = new RegExp(`^(org|users)/$|${PREFIX.source}`)
// Printable ASCII only: the disk keeps it in a short one-line header.
export const CONTENT_TYPE = /^[\x20-\x7e]{1,200}$/

export const invalid = (what: string) =>
  new DomainError('VALIDATION', `Percorso di archiviazione non valido: ${what}`)

export function checkKey(key: string, pattern: RegExp = KEY): void {
  if (!pattern.test(key)) throw invalid(key)
}

export function checkContentType(contentType: string): void {
  if (!CONTENT_TYPE.test(contentType)) throw invalid(`tipo di contenuto «${contentType}»`)
}

export function checkRange(start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
    throw new DomainError(
      'VALIDATION',
      `Intervallo di byte non valido: ${String(start)}-${String(end)}`,
    )
}

/** Keys in byte order, like S3: not locale-dependent. */
export const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0
