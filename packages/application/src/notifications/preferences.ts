import {
  CHANNELS,
  DIGEST_CHANNELS,
  DomainError,
  type Channel,
  type Level,
  type NotificationSettings,
  type OutboxEventType,
  type RecipientRule,
} from '@app/domain'
import type { NotificationKind } from '../module-definition.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// «Profilo e preferenze» → Notifiche (plan 08 Task 6, §12.3, P4): the channels of each kind the
// person can get, and the settings for every kind. A kind back to its defaults loses its row, so
// the defaults keep changing with the code.

export interface PreferencesDeps {
  uow: UnitOfWork
  kinds: ReadonlyMap<OutboxEventType, NotificationKind>
}

export interface KindPreference {
  kind: OutboxEventType
  level: Level
  defaultChannels: readonly Channel[]
  channels: readonly Channel[]
  /** The person changed it: «Torna alle predefinite» */
  changed: boolean
  /** D-74: who scheduled the post gets the email whatever they choose */
  alwaysEmailToScheduler: boolean
}

export interface MyNotificationPreferences {
  settings: NotificationSettings
  kinds: KindPreference[]
}

const ADMIN_ROLES = new Set(['owner', 'admin'])
const notFound = () => new DomainError('NOT_FOUND', 'Tipo di notifica non trovato')

/** The rules the person can be reached by now: the kinds they never get are not shown. */
async function reachableRules(tx: Tx, userId: string): Promise<Set<RecipientRule>> {
  const user = await tx.users.findById(userId)
  if (user?.status !== 'active' || user.anonymizedAt !== null)
    throw new DomainError('NOT_FOUND', 'Persona non trovata')
  const members = (await tx.orgMembers.listForUser(userId)).filter((m) => m.status === 'active')
  const rules = new Set<RecipientRule>()
  if (members.length > 0) {
    rules.add('scheduler')
    rules.add('workspace_managers')
    rules.add('workspace_preparers')
    rules.add('initiator')
  }
  if (members.some((m) => ADMIN_ROLES.has(m.role))) rules.add('org_admins')
  if (user.platformRole === 'admin') rules.add('platform_admins')
  return rules
}

const sameChannels = (a: readonly Channel[], b: readonly Channel[]) =>
  a.length === b.length && a.every((c) => b.includes(c))

async function read(
  deps: PreferencesDeps,
  tx: Tx,
  userId: string,
): Promise<MyNotificationPreferences> {
  const rules = await reachableRules(tx, userId)
  const prefs = await tx.notificationPrefs.listPrefs(userId)
  const kinds = [...deps.kinds.values()]
    .filter((k) => k.recipients.some((r) => rules.has(r)))
    .map((k) => {
      const pref = prefs.get(k.type)
      return {
        kind: k.type,
        level: k.level,
        defaultChannels: k.defaultChannels,
        channels: CHANNELS.filter((c) => (pref?.channels ?? k.defaultChannels).includes(c)),
        changed: pref !== undefined,
        alwaysEmailToScheduler: k.alwaysEmail === 'scheduler',
      }
    })
  return { settings: await tx.notificationPrefs.getSettings(userId), kinds }
}

export function getMyNotificationPreferences(
  deps: PreferencesDeps,
  userId: string,
): Promise<MyNotificationPreferences> {
  return deps.uow.run({ userId }, (tx) => read(deps, tx, userId))
}

/** The same order and no double: `HH:MM` times are checked by the contract. */
function normalized(settings: NotificationSettings): NotificationSettings {
  const days = [...new Set(settings.digest.days)].sort((a, b) => a - b)
  if (settings.digest.enabled && days.length === 0)
    throw new DomainError('VALIDATION', 'Scegli almeno un giorno per il riepilogo', {
      field: 'digest.days',
    })
  const quiet = settings.quietHours
  if (quiet && quiet.start === quiet.end)
    throw new DomainError(
      'VALIDATION',
      "Le ore di silenzio devono iniziare e finire a un'ora diversa",
      {
        field: 'quietHours',
      },
    )
  // the order of DIGEST_CHANNELS and no double; the contract asks for one at least
  const channels = DIGEST_CHANNELS.filter((c) => settings.digest.channels.includes(c))
  if (channels.length === 0)
    throw new DomainError('VALIDATION', 'Scegli almeno un canale per il riepilogo', {
      field: 'digest.channels',
    })
  return { ...settings, digest: { ...settings.digest, days, channels } }
}

export function saveMyNotificationSettings(
  deps: PreferencesDeps,
  userId: string,
  settings: NotificationSettings,
): Promise<MyNotificationPreferences> {
  const clean = normalized(settings)
  return deps.uow.run({ userId }, async (tx) => {
    await reachableRules(tx, userId)
    await tx.notificationPrefs.saveSettings(userId, clean)
    return read(deps, tx, userId)
  })
}

/**
 * The channels of one kind; null, or the kind's own defaults, removes the row (P4). No channel
 * turns the kind off (§12.3).
 */
export function setMyNotificationKind(
  deps: PreferencesDeps,
  userId: string,
  type: OutboxEventType,
  channels: readonly Channel[] | null,
): Promise<MyNotificationPreferences> {
  return deps.uow.run({ userId }, async (tx) => {
    const kind = deps.kinds.get(type)
    const rules = await reachableRules(tx, userId)
    if (!kind || !kind.recipients.some((r) => rules.has(r))) throw notFound()
    const chosen = channels === null ? null : CHANNELS.filter((c) => channels.includes(c))
    const pref =
      chosen === null || sameChannels(chosen, kind.defaultChannels) ? null : { channels: chosen }
    await tx.notificationPrefs.setPref(userId, type, pref)
    return read(deps, tx, userId)
  })
}
