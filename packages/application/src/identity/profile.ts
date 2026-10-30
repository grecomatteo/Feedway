import { displayName, DomainError, isValidTimeZone, validateNickname } from '@app/domain'
import type { ProfileFields } from '../ports/repositories.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { NAME_MAX_LENGTH } from './activation.js'
import type { SessionUser } from './sessions.js'

export interface ProfileInput {
  name?: string
  /** null or an empty string removes it. */
  nickname?: string | null
  theme?: 'light' | 'dark' | 'system'
  /** null: the agency's time zone, or the installation's. */
  timezone?: string | null
}

const THEMES: ReadonlySet<string> = new Set(['light', 'dark', 'system'])

function checked(input: ProfileInput): ProfileFields {
  const fields: ProfileFields = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name === '' || Array.from(name).length > NAME_MAX_LENGTH)
      throw new DomainError('VALIDATION', 'Scrivi nome e cognome (al massimo 100 caratteri)', {
        field: 'name',
      })
    fields.name = name
  }
  if (input.nickname !== undefined) {
    const nickname = validateNickname(input.nickname)
    if (!nickname.ok)
      throw new DomainError(
        'VALIDATION',
        nickname.reason === 'TOO_LONG'
          ? 'Il soprannome può avere al massimo 30 caratteri'
          : 'Il soprannome non può contenere link o caratteri speciali',
        { field: 'nickname' },
      )
    fields.nickname = nickname.value
  }
  if (input.theme !== undefined) {
    if (!THEMES.has(input.theme))
      throw new DomainError('VALIDATION', 'Tema non valido', { field: 'theme' })
    fields.theme = input.theme
  }
  if (input.timezone !== undefined) {
    if (input.timezone !== null && !isValidTimeZone(input.timezone))
      throw new DomainError('VALIDATION', 'Scegli un fuso orario dall’elenco', {
        field: 'timezone',
      })
    fields.timezone = input.timezone
  }
  return fields
}

/**
 * "Il mio account": name, nickname, theme and time zone. Only what changed is written; the
 * personal activity log names the fields, never their values.
 */
export async function updateProfile(
  deps: { uow: UnitOfWork },
  user: SessionUser,
  input: ProfileInput,
  request: { ip: string | null },
): Promise<SessionUser> {
  const fields = checked(input)
  const changed = (Object.keys(fields) as (keyof ProfileFields)[]).filter(
    (key) => fields[key] !== user[key],
  )
  if (changed.length === 0) return user
  const update: ProfileFields = Object.fromEntries(changed.map((key) => [key, fields[key]]))
  await deps.uow.run({ userId: user.id }, async (tx) => {
    await tx.users.updateProfile(user.id, update)
    await tx.audit.record({
      organizationId: null,
      actorId: user.id,
      source: 'panel',
      action: 'user.profile_updated',
      entity: 'user',
      entityId: user.id,
      workspaceId: null,
      ip: request.ip,
      data: { fields: changed.sort() },
    })
  })
  const next = { ...user, ...update }
  return { ...next, displayName: displayName(next) }
}
