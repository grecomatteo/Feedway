import {
  can,
  DomainError,
  LOGO_MAX_BYTES,
  LOGO_MIN_SIDE,
  logoUrl,
  type OrgActor,
} from '@app/domain'
import { assertRecentReauth } from '../identity/index.js'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { AvatarProcessor } from '../ports/avatar-processor.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { Storage, StoredObject } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface LogoDeps {
  uow: UnitOfWork
  storage: Storage
  /** The profile photo's processor: the logo is fitted, never cropped (plan 04, choice 8). */
  images: AvatarProcessor
  ids: IdGenerator
  clock: Clock
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// `org/<id>/logo/<hash>.webp` (plan 04, storage keys); the preview waits in `staging/`
const logoFolder = (organizationId: string) => `org/${organizationId}/logo/`
const stagingFolder = (organizationId: string) => `${logoFolder(organizationId)}staging/`
const stagingKey = (organizationId: string, stagingId: string) =>
  `${stagingFolder(organizationId)}${stagingId}.webp`
/** The two files of a logo: `<key>.webp` (256 px) and `<key>-64.webp`. */
const fileOf = (key: string, size: 256 | 64) => `${key}${size === 64 ? '-64' : ''}.webp`

const ownerOnly = () =>
  new DomainError('FORBIDDEN', 'Solo l’Owner può cambiare il logo dell’agenzia')

/** The Owner, with a recent reauth, as for the other settings of the agency (spec §15.2). */
function assertCanChange(
  deps: Pick<LogoDeps, 'clock'>,
  actor: OrgActor,
  session: AuthSessionInfo,
): void {
  if (session.userId !== actor.userId)
    throw new DomainError('UNAUTHENTICATED', 'Sessione scaduta: accedi di nuovo')
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw ownerOnly()
  assertRecentReauth(session, deps.clock.now())
}

/** Inside the transaction: the role read again, the agency locked and still active. */
async function lockForChange(tx: Tx, actor: OrgActor): Promise<void> {
  const { organizationId } = actor
  const membership = await tx.orgMembers.find(organizationId, actor.userId)
  if (
    membership?.status !== 'active' ||
    !can({ ...actor, orgRole: membership.role }, 'organization.settings.manage', {
      organizationId,
    })
  )
    throw ownerOnly()
  // the row lock orders two changes at once: each removes the files the other replaced
  const organization = await tx.organizations.findByIdForUpdate(organizationId)
  if (!organization) throw new DomainError('NOT_FOUND', 'Agenzia non trovata')
  if (organization.status !== 'active')
    throw new DomainError('ORGANIZATION_SUSPENDED', 'Questa agenzia è sospesa')
}

async function readAll(object: StoredObject): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of object.body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function removeFiles(storage: Storage, key: string): Promise<void> {
  await storage.delete(fileOf(key, 256))
  await storage.delete(fileOf(key, 64))
}

/**
 * The image chosen as logo, normalized (WebP, no metadata, upright, transparency kept) and kept
 * until it is confirmed. One preview per agency: each upload replaces the previous one.
 * Not counted in `storage_bytes`: it is small and belongs to the agency, not to a client.
 */
export async function uploadLogoSource(
  deps: LogoDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: { bytes: Buffer },
): Promise<{ stagingId: string; width: number; height: number }> {
  assertCanChange(deps, actor, session)
  if (input.bytes.length > LOGO_MAX_BYTES)
    throw new DomainError('FILE_TOO_LARGE', 'Il logo può pesare al massimo 5 MB', {
      field: 'file',
    })
  const { webp, width, height } = await deps.images.normalize(input.bytes, {
    minSide: LOGO_MIN_SIDE,
  })
  const stagingId = deps.ids.newId()
  await deps.storage.deletePrefix(stagingFolder(actor.organizationId))
  await deps.storage.put(stagingKey(actor.organizationId, stagingId), webp, {
    contentType: 'image/webp',
  })
  return { stagingId, width, height }
}

/** The preview of the logo, for the Owner only (a read: no reauth); null when there is none. */
export async function readLogoStaging(
  deps: Pick<LogoDeps, 'storage'>,
  actor: OrgActor,
  stagingId: string,
): Promise<StoredObject | null> {
  const { organizationId } = actor
  if (!can(actor, 'organization.settings.manage', { organizationId })) throw ownerOnly()
  if (!UUID.test(stagingId)) return null
  return deps.storage.get(stagingKey(organizationId, stagingId))
}

/**
 * The preview becomes the logo: fitted whole inside 256 and 64 px transparent squares, named by
 * the hash of the larger one. The previous logo and the preview are removed.
 */
export async function confirmLogo(
  deps: LogoDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  input: { stagingId: string; slug: string },
  request: { ip: string | null },
): Promise<{ logoUrl: string | null }> {
  assertCanChange(deps, actor, session)
  const { organizationId } = actor
  const staged = await readLogoStaging(deps, actor, input.stagingId)
  if (!staged)
    throw new DomainError('NOT_FOUND', 'Il logo da salvare non c’è più: caricalo di nuovo')
  const files = await deps.images.fitSquare(await readAll(staged))
  const key = `${logoFolder(organizationId)}${files.hash}`
  // the files are written under the row lock: a removal running meanwhile (which deletes its
  // files under the same lock) can never delete the ones this logo points to
  const previous = await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    await lockForChange(tx, actor)
    const current = await tx.branding.logoKey(organizationId)
    await deps.storage.put(fileOf(key, 256), files[256], { contentType: 'image/webp' })
    await deps.storage.put(fileOf(key, 64), files[64], { contentType: 'image/webp' })
    try {
      await tx.branding.setLogo(organizationId, { logoKey: key, updatedBy: actor.userId })
      await tx.audit.record({
        organizationId,
        actorId: actor.userId,
        source: 'panel',
        action: 'organization.logo_changed',
        entity: 'organization',
        entityId: organizationId,
        workspaceId: null,
        ip: request.ip,
        data: { removed: false },
      })
    } catch (error) {
      // the same logo may already be the agency's: its files stay
      if (current !== key) await removeFiles(deps.storage, key).catch(() => undefined)
      throw error
    }
    return current
  })
  if (previous !== null && previous !== key) await removeFiles(deps.storage, previous)
  // only this preview: one uploaded meanwhile in another tab stays
  await deps.storage.delete(stagingKey(organizationId, input.stagingId))
  return { logoUrl: logoUrl(input.slug, key) }
}

/** Back to the initials: the logo's files go too, and any preview. */
export async function removeLogo(
  deps: LogoDeps,
  actor: OrgActor,
  session: AuthSessionInfo,
  request: { ip: string | null },
): Promise<{ logoUrl: null }> {
  assertCanChange(deps, actor, session)
  const { organizationId } = actor
  await deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    await lockForChange(tx, actor)
    const current = await tx.branding.logoKey(organizationId)
    if (current === null) return
    await tx.branding.setLogo(organizationId, { logoKey: null, updatedBy: actor.userId })
    await tx.audit.record({
      organizationId,
      actorId: actor.userId,
      source: 'panel',
      action: 'organization.logo_changed',
      entity: 'organization',
      entityId: organizationId,
      workspaceId: null,
      ip: request.ip,
      data: { removed: true },
    })
    // under the row lock, as a confirm writes its files: a confirm of this same logo waiting
    // for the lock writes them again afterwards
    await removeFiles(deps.storage, current)
  })
  await deps.storage.deletePrefix(stagingFolder(organizationId))
  return { logoUrl: null }
}

/** The logo for any active member of the agency (the actor is one); null without a logo. */
export async function readLogo(
  deps: Pick<LogoDeps, 'uow' | 'storage'>,
  actor: OrgActor,
  input: { size: 256 | 64 },
): Promise<{ object: StoredObject; hash: string } | null> {
  const { organizationId } = actor
  const key = await deps.uow.run({ organizationId, userId: actor.userId }, (tx) =>
    tx.branding.logoKey(organizationId),
  )
  if (key === null) return null
  const object = await deps.storage.get(fileOf(key, input.size))
  return object ? { object, hash: key.slice(key.lastIndexOf('/') + 1) } : null
}
