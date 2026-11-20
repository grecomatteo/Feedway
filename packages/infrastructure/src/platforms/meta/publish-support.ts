import {
  PublishError,
  type Clock,
  type ConnectionCredentials,
  type PlatformLoad,
  type StepUsage,
} from '@app/application'
import { publishErrorCodeOfMeta, type PublishErrorCode } from '@app/domain'
import type { MetaUsage } from '@app/domain/platforms/meta'
import { MetaError, type MetaErrorReason } from './errors.js'
import type { MetaGraphClient, MetaTokenCredentials } from './graph-client.js'
import type { MetaConnectorApp } from './system-user-connector.js'

// What the Meta publishers share (plan 07 Task 4): what the posts module sees is classified
// here, never a Meta error, never a token.

export interface MetaPublisherDeps {
  client: MetaGraphClient
  clock: Clock
}

/** The connection's credentials as the client takes them; the app is the Meta connector's. */
export function tokenCredentials(credentials: ConnectionCredentials): MetaTokenCredentials {
  const app = credentials.app as MetaConnectorApp
  return { accessToken: credentials.token, appSecret: app.appSecret }
}

const peak = (c: { callCount: number; totalCputime: number; totalTime: number }) =>
  Math.max(c.callCount, c.totalCputime, c.totalTime)

/** How close the limits are, from the usage headers of one answer (§8.6). */
export function loadOf(usage: MetaUsage): PlatformLoad {
  return {
    accountPercent: usage.business.length === 0 ? null : Math.max(...usage.business.map(peak)),
    appPercent: usage.app === null ? null : peak(usage.app),
    regainMinutes: Math.max(0, ...usage.business.map((b) => b.estimatedTimeToRegainAccessMinutes)),
  }
}

export const stepUsage = (usage: MetaUsage): StepUsage => ({ usage, load: loadOf(usage) })

/**
 * Meta's code as `target_attempts` keeps it: `code` or `code/subcode`. Instagram's negative
 * codes (-1, -2) keep only their subcode, which is Instagram's own and unique (D-105).
 */
export function platformCodeOf(err: MetaError): string | null {
  if (err.metaCode === null) return null
  if (err.metaCode < 0) return err.subcode === null ? null : String(err.subcode)
  return err.subcode === null
    ? String(err.metaCode)
    : `${String(err.metaCode)}/${String(err.subcode)}`
}

// Feedway's code where Meta gave none, or gave one the table does not know.
const CODE_OF_REASON: Partial<Record<MetaErrorReason, PublishErrorCode>> = {
  token_invalid: 'token_invalid',
  token_revoked: 'token_invalid',
  checkpoint: 'token_invalid',
  page_role_missing: 'permission_missing',
  permission_missing: 'permission_missing',
  rate_limited: 'rate_limited',
  media_not_ready: 'media_processing',
  media_rejected: 'media_rejected',
  quota_exhausted: 'quota_exhausted',
  account_restricted: 'account_restricted',
}

/** A Meta error as the posts module sees it. `uncertainAs`: what an uncertain answer becomes. */
export function publishErrorOf(
  err: MetaError,
  now: Date,
  opts: { uncertainAs?: 'uncertain' | 'transient' } = {},
): PublishError {
  const fromTable = publishErrorCodeOfMeta(err.metaCode, err.subcode)
  const code = fromTable === 'meta_error' ? (CODE_OF_REASON[err.reason] ?? fromTable) : fromTable
  const load = err.usage === null ? null : loadOf(err.usage)
  const waitSeconds =
    err.retryAfterSeconds ??
    (load !== null && load.regainMinutes > 0 ? load.regainMinutes * 60 : null)
  return new PublishError({
    kind: err.kind === 'uncertain' ? (opts.uncertainAs ?? 'uncertain') : err.kind,
    code,
    platformCode: platformCodeOf(err),
    retryAt: waitSeconds === null ? null : new Date(now.getTime() + waitSeconds * 1000),
    load,
  })
}

/** Runs a Meta call; a Meta error leaves as a `PublishError`, anything else as it is. */
export async function classified<T>(
  clock: Clock,
  run: () => Promise<T>,
  opts: { uncertainAs?: 'uncertain' | 'transient' } = {},
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof MetaError) throw publishErrorOf(err, clock.now(), opts)
    throw err
  }
}

/** Spaces and line breaks do not count: Meta may change them (plan 07, Scelta 7). */
export const normalizeCaption = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

/** The uncertain search looks this long after the step started (Scelta 7). */
export const FIND_WINDOW_MS = 10 * 60_000
