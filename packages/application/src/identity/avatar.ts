import { AVATAR_MAX_BYTES, avatarUrl, DomainError, validateCrop } from '@app/domain'
import type { AvatarCrop, AvatarProcessor } from '../ports/avatar-processor.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { Storage, StoredObject } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { SessionUser } from './sessions.js'

export interface AvatarDeps {
  uow: UnitOfWork
  storage: Storage
  avatars: AvatarProcessor
  ids: IdGenerator
  /** Origin of the panel: `users.image` is the photo's address there. */
  panelUrl: URL
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const avatarFolder = (userId: string) => `users/${userId}/avatar/`
const stagingFolder = (userId: string) => `${avatarFolder(userId)}staging/`
const stagingKey = (userId: string, stagingId: string) =>
  `${stagingFolder(userId)}${stagingId}.webp`
/** The two files of a photo: `<key>.webp` (256 px) and `<key>-64.webp`. */
const fileOf = (key: string, size: 256 | 64) => `${key}${size === 64 ? '-64' : ''}.webp`

async function readAll(object: StoredObject): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of object.body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/**
 * The photo chosen for the profile, normalized (WebP, no metadata, upright) and kept until it
 * is cropped. Only the latest one is kept: each upload replaces the previous preview.
 */
export async function uploadAvatarSource(
  deps: AvatarDeps,
  user: Pick<SessionUser, 'id'>,
  input: { bytes: Buffer },
): Promise<{ stagingId: string; width: number; height: number }> {
  if (input.bytes.length > AVATAR_MAX_BYTES)
    throw new DomainError('FILE_TOO_LARGE', 'La foto può pesare al massimo 5 MB', {
      field: 'file',
    })
  const { webp, width, height } = await deps.avatars.normalize(input.bytes)
  const stagingId = deps.ids.newId()
  await deps.storage.deletePrefix(stagingFolder(user.id))
  await deps.storage.put(stagingKey(user.id, stagingId), webp, { contentType: 'image/webp' })
  return { stagingId, width, height }
}

/** The preview to crop, only for the person who uploaded it; null when there is none. */
export async function readAvatarStaging(
  deps: Pick<AvatarDeps, 'storage'>,
  user: Pick<SessionUser, 'id'>,
  stagingId: string,
): Promise<StoredObject | null> {
  if (!UUID.test(stagingId)) return null
  return deps.storage.get(stagingKey(user.id, stagingId))
}

/**
 * The square chosen on the preview becomes the photo: 256 and 64 px, named by the hash of the
 * larger one. The previous photo and the preview are removed.
 */
export async function cropAvatar(
  deps: AvatarDeps,
  user: SessionUser,
  input: { stagingId: string } & AvatarCrop,
  request: { ip: string | null },
): Promise<SessionUser> {
  const staged = await readAvatarStaging(deps, user, input.stagingId)
  if (!staged)
    throw new DomainError('NOT_FOUND', 'La foto da ritagliare non c’è più: caricala di nuovo')
  const source = await readAll(staged)
  const crop = { x: input.x, y: input.y, size: input.size }
  if (!validateCrop(crop, await deps.avatars.dimensions(source)))
    throw new DomainError('VALIDATION', 'Il ritaglio deve stare dentro la foto', { field: 'size' })
  const files = await deps.avatars.crop(source, crop)
  const key = `${avatarFolder(user.id)}${files.hash}`
  await deps.storage.put(fileOf(key, 256), files[256], { contentType: 'image/webp' })
  await deps.storage.put(fileOf(key, 64), files[64], { contentType: 'image/webp' })
  const url = avatarUrl(user.id, key) ?? ''
  const previous = await deps.uow.run({ userId: user.id }, async (tx) => {
    // the row lock orders two crops at once: each removes the photo the other replaced
    const current = await tx.users.findByIdForUpdate(user.id)
    await tx.users.setAvatar(user.id, { key, image: new URL(url, deps.panelUrl).toString() })
    await tx.audit.record({
      organizationId: null,
      actorId: user.id,
      source: 'panel',
      action: 'user.avatar_changed',
      entity: 'user',
      entityId: user.id,
      workspaceId: null,
      ip: request.ip,
      data: { removed: false },
    })
    return current?.avatarKey ?? null
  })
  if (previous !== null && previous !== key) await removeFiles(deps.storage, previous)
  // only this preview: one uploaded meanwhile in another tab stays
  await deps.storage.delete(stagingKey(user.id, input.stagingId))
  return { ...user, avatarUrl: url }
}

async function removeFiles(storage: Storage, key: string): Promise<void> {
  await storage.delete(fileOf(key, 256))
  await storage.delete(fileOf(key, 64))
}

/** Back to the initials: the photo's files go too, and any preview. */
export async function removeAvatar(
  deps: Pick<AvatarDeps, 'uow' | 'storage'>,
  user: SessionUser,
  request: { ip: string | null },
): Promise<SessionUser> {
  const removed = await deps.uow.run({ userId: user.id }, async (tx) => {
    const current = await tx.users.findByIdForUpdate(user.id)
    if (current?.avatarKey == null) return null
    await tx.users.setAvatar(user.id, null)
    await tx.audit.record({
      organizationId: null,
      actorId: user.id,
      source: 'panel',
      action: 'user.avatar_changed',
      entity: 'user',
      entityId: user.id,
      workspaceId: null,
      ip: request.ip,
      data: { removed: true },
    })
    return current.avatarKey
  })
  // only the files of the photo removed: a crop running meanwhile writes its own first
  if (removed !== null) await removeFiles(deps.storage, removed)
  await deps.storage.deletePrefix(stagingFolder(user.id))
  return { ...user, avatarUrl: null }
}

/**
 * Someone's photo, for the person asking: their own, or a colleague's in an agency where both
 * are active members. Anyone else gets null (404), as if there were no photo.
 */
export async function readAvatar(
  deps: Pick<AvatarDeps, 'uow' | 'storage'>,
  viewerId: string,
  input: { userId: string; size: 256 | 64 },
): Promise<{ object: StoredObject; hash: string } | null> {
  if (!UUID.test(input.userId)) return null
  const key = await deps.uow.run({ userId: viewerId }, async (tx) => {
    if (input.userId !== viewerId && !(await tx.users.sharesOrganization(viewerId, input.userId)))
      return null
    return tx.users.avatarKeyOf(input.userId)
  })
  if (key === null) return null
  const object = await deps.storage.get(fileOf(key, input.size))
  return object ? { object, hash: key.slice(key.lastIndexOf('/') + 1) } : null
}
