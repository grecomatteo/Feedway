import {
  ACCOUNT_AVATAR_MIN_SIDE,
  DomainError,
  formProfiles,
  profilePhotoAccount,
  seesAllWorkspaces,
  type OrgActor,
} from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { AvatarProcessor } from '../ports/avatar-processor.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { PlatformConnectors } from '../ports/platform-connector.js'
import type { Storage, StoredObject } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { currentActor } from '../workspaces/index.js'

// The pictures of the social accounts, kept by Feedway (plan 04 Task 4): Meta's addresses expire
// after some days, and the panel's CSP allows no image from Meta. `accounts.avatar` downloads the
// picture outside any transaction, checks its bytes and stores two WebP squares; the panel reads
// them from its own route.

export interface AccountAvatarDeps {
  uow: UnitOfWork
  storage: Storage
  /** The profile photo's processor: type from the bytes, metadata removed, square crop. */
  images: AvatarProcessor
  connectors: PlatformConnectors
  logger: Logger
}

/** The data of `accounts.avatar`: ids only. */
export interface AccountAvatarJob {
  organizationId: string
  accountId: string
}

export type AccountAvatarOutcome =
  /** The account is gone, inactive, without a picture, or its agency is suspended. */
  | { outcome: 'skipped' }
  /** The picture could not be read or is not an image: the previous one (or none) stays. */
  | { outcome: 'kept'; why: 'refused' | 'gone' | 'not_an_image' }
  | { outcome: 'stored'; changed: boolean }

/** One running and one waiting per account (stately policy). */
export const accountAvatarJobKey = (job: AccountAvatarJob) => job.accountId

// `org/<id>/accounts/<accountId>/avatar/<hash>.webp` (plan 04, storage keys)
const avatarFolder = (job: AccountAvatarJob) =>
  `org/${job.organizationId}/accounts/${job.accountId}/avatar/`
/** The two files of a picture: `<key>.webp` (256 px) and `<key>-64.webp`. */
const fileOf = (key: string, size: 256 | 64) => `${key}${size === 64 ? '-64' : ''}.webp`

async function removeFiles(storage: Storage, key: string): Promise<void> {
  await storage.delete(fileOf(key, 256))
  await storage.delete(fileOf(key, 64))
}

/** Queues the picture of each account; a failure is logged, the caller's work stays done. */
export async function queueAccountAvatars(
  deps: { queue: Pick<JobQueue, 'send'>; logger: Logger },
  organizationId: string,
  accountIds: readonly string[],
): Promise<void> {
  for (const accountId of accountIds) {
    const job = { organizationId, accountId }
    try {
      await deps.queue.send('accounts.avatar', job, { singletonKey: accountAvatarJobKey(job) })
    } catch (error) {
      // the next sync queues it again
      deps.logger.error({ err: error, accountId }, 'account picture not queued')
    }
  }
}

/**
 * `accounts.avatar`: the account's picture, from the address Meta gave at the last import or
 * sync, becomes Feedway's own copy; the previous copy is removed. A picture that cannot be read
 * leaves the previous one; one that may come back later (Meta down, slow) fails the job, so the
 * queue retries it.
 */
export async function refreshAccountAvatar(
  deps: AccountAvatarDeps,
  job: AccountAvatarJob,
): Promise<AccountAvatarOutcome> {
  if (!isUuid(job.organizationId)) throw new Error('account picture job without organizationId')
  if (!isUuid(job.accountId)) throw new Error('account picture job without accountId')
  const { organizationId, accountId } = job
  const scope = { organizationId, userId: null }
  const found = await deps.uow.run(scope, async (tx) => {
    const organization = await tx.organizations.findById(organizationId)
    if (organization?.status !== 'active') return null
    const account = await tx.accounts.findById(organizationId, accountId)
    if (account?.active !== true || account.avatarUrl === null) return null
    const connection = await tx.connections.findById(organizationId, account.connectionId)
    return connection === null
      ? null
      : { url: account.avatarUrl, kind: connection.kind, key: account.avatarKey }
  })
  if (found === null) return { outcome: 'skipped' }
  const connector = deps.connectors[found.kind]
  if (!connector) throw new Error(`no platform connector for ${found.kind}`)

  // outside the transaction: the platform may take seconds
  const download = await connector.fetchPicture(found.url)
  if (!download.ok) {
    if (download.reason === 'unavailable') throw new Error('account picture unavailable')
    deps.logger.warn({ accountId, why: download.reason }, 'account picture not downloaded')
    return { outcome: 'kept', why: download.reason }
  }
  let files: { 256: Buffer; 64: Buffer; hash: string }
  try {
    const { webp, width, height } = await deps.images.normalize(download.bytes, {
      minSide: ACCOUNT_AVATAR_MIN_SIDE,
    })
    const size = Math.min(width, height)
    files = await deps.images.crop(webp, {
      x: Math.floor((width - size) / 2),
      y: Math.floor((height - size) / 2),
      size,
    })
  } catch (error) {
    // a busy processor is retried; bytes that are no image (or too large, broken) are dropped
    if (error instanceof DomainError && error.code !== 'RATE_LIMITED') {
      deps.logger.warn({ accountId, code: error.code }, 'account picture is not an image')
      return { outcome: 'kept', why: 'not_an_image' }
    }
    throw error
  }

  const key = `${avatarFolder(job)}${files.hash}`
  await deps.storage.put(fileOf(key, 256), files[256], { contentType: 'image/webp' })
  await deps.storage.put(fileOf(key, 64), files[64], { contentType: 'image/webp' })
  // one job per account runs at a time: these files are no other's, unless they are the picture
  // the account already had
  const dropNew = () => (found.key === key ? Promise.resolve() : removeFiles(deps.storage, key))
  let set: { previous: string | null } | null
  try {
    set = await deps.uow.run(scope, (tx) =>
      tx.accounts.setAvatarKey(organizationId, accountId, key),
    )
  } catch (error) {
    await dropNew().catch(() => undefined)
    throw error
  }
  if (set === null) {
    await dropNew()
    return { outcome: 'skipped' }
  }
  const { previous } = set
  if (previous !== null && previous !== key) await removeFiles(deps.storage, previous)
  return { outcome: 'stored', changed: previous !== key }
}

/**
 * The stored picture of an account, for whoever sees it: Owner and Admin every account of the
 * agency, the others only those assigned to a workspace where they have a role. Anything else
 * is null, like an account with no picture: the route answers 404 either way.
 */
export async function readAccountAvatar(
  deps: Pick<AccountAvatarDeps, 'uow' | 'storage'>,
  actor: OrgActor,
  input: { accountId: string; size: 256 | 64 },
): Promise<{ object: StoredObject; hash: string } | null> {
  if (!isUuid(input.accountId)) return null
  const { organizationId } = actor
  const key = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    const account = await tx.accounts.findById(organizationId, input.accountId)
    if (account?.avatarKey == null) return null
    if (seesAllWorkspaces(current)) return account.avatarKey
    const assigned = await tx.workspaceAccounts.listForAccounts(organizationId, [account.id])
    return assigned.some((a) => current.memberships.has(a.workspaceId)) ? account.avatarKey : null
  })
  if (key === null) return null
  const object = await deps.storage.get(fileOf(key, input.size))
  return object ? { object, hash: key.slice(key.lastIndexOf('/') + 1) } : null
}

/**
 * The picture of each workspace the actor sees, for the switcher: that of its first profile
 * (§3) with one, as the profiles of the workspace list them, Instagram first. Workspaces without
 * a stored picture are left out.
 */
export async function workspacePhotos(
  deps: Pick<AccountAvatarDeps, 'uow'>,
  actor: OrgActor,
): Promise<Map<string, { accountId: string; avatarKey: string }>> {
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const current = await currentActor(tx, actor)
    const seesAll = seesAllWorkspaces(current)
    const accounts = await tx.accounts.list(
      organizationId,
      seesAll ? {} : { workspaceIds: [...current.memberships.keys()] },
    )
    const byWorkspace = new Map<string, Set<string>>()
    for (const { accountId, workspaceId } of await tx.workspaceAccounts.listForAccounts(
      organizationId,
      accounts.map((a) => a.id),
    ))
      if (seesAll || current.memberships.has(workspaceId))
        byWorkspace.set(workspaceId, (byWorkspace.get(workspaceId) ?? new Set()).add(accountId))
    const photos = new Map<string, { accountId: string; avatarKey: string }>()
    for (const [workspaceId, ids] of byWorkspace) {
      const photo = formProfiles(accounts.filter((a) => ids.has(a.id)))
        .map((p) => profilePhotoAccount(p.accounts))
        .find((a) => a !== null)
      if (photo?.avatarKey != null)
        photos.set(workspaceId, { accountId: photo.id, avatarKey: photo.avatarKey })
    }
    return photos
  })
}
