import { storedTimeZone, type OrgActor, type PublishingPostStatus } from '@app/domain'
import { timeOfDay, dayAndTime } from '../mail/index.js'
import {
  agencyDay,
  listAgenda,
  listAgendaIssues,
  untitledPost,
  type AgendaIssueDto,
} from '../posts/index.js'
import type { Clock } from '../ports/clock.js'
import type { TelegramBotOwner } from '../ports/notifications.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import {
  bold,
  fitMessage,
  italic,
  joinHtml,
  link,
  plain,
  shorten,
  type TelegramHtml,
  type TelegramSection,
} from './telegram-format.js'

// The answers of `/oggi` and `/problemi` (plan 08 Task 7): each agency of the bot is read inside
// `uow.run({ organizationId, userId })` of the person linked to the chat, so the person hears
// only of the clients they see in the panel. The platform's bot speaks for the agencies without
// a bot of their own; an agency's bot only for that agency.

export interface TelegramCommandDeps {
  uow: UnitOfWork
  clock: Clock
  t: Translate
  panelUrl: URL
}

/** How many lines an answer lists for each agency: the rest is «e altri N» and the panel. */
export const ANSWER_LINES_MAX = 10

export type TelegramQuery = 'today' | 'issues'

interface Agency {
  actor: OrgActor
  name: string
  slug: string
  timeZone: string
}

/** The person's agencies this bot speaks for, each as the person acts in it now. */
async function agenciesOf(
  deps: TelegramCommandDeps,
  userId: string,
  owner: TelegramBotOwner,
  agencyBots: ReadonlySet<string>,
): Promise<Agency[]> {
  const { user, memberships } = await deps.uow.run({ userId }, async (tx) => ({
    user: await tx.users.findById(userId),
    memberships: await tx.orgMembers.listForUser(userId),
  }))
  if (user?.status !== 'active') return []
  const agencies: Agency[] = []
  for (const m of memberships) {
    if (m.status !== 'active' || m.organizationStatus !== 'active') continue
    if (owner === null ? agencyBots.has(m.organizationId) : m.organizationId !== owner) continue
    // read again inside the agency, with the clients the person works on (as `resolveOrgActor`)
    const inside = await deps.uow.run({ organizationId: m.organizationId, userId }, async (tx) => {
      const current = await tx.orgMembers.find(m.organizationId, userId)
      const organization = await tx.organizations.findById(m.organizationId)
      if (current?.status !== 'active' || organization?.status !== 'active') return null
      return {
        organization,
        orgRole: current.role,
        memberships: await tx.workspaceMembers.rolesOf(m.organizationId, userId),
      }
    })
    if (inside === null) continue
    agencies.push({
      actor: {
        userId,
        platformRole: user.platformRole,
        organizationId: m.organizationId,
        orgRole: inside.orgRole,
        memberships: inside.memberships,
      },
      name: m.name,
      slug: m.slug,
      timeZone: storedTimeZone(inside.organization.settings),
    })
  }
  return agencies
}

const clientNames = async (deps: TelegramCommandDeps, actor: OrgActor) =>
  new Map(
    (
      await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
        tx.workspaces.listVisible(actor),
      )
    ).map((w) => [w.id, w.name]),
  )

/** A mark for each state, so a long list reads at a glance. */
const STATE_MARK: Readonly<Record<PublishingPostStatus, string>> = {
  scheduled: '🕒',
  publishing: '⏳',
  partial: '🟠',
  failed: '🔴',
  problem: '⚠️',
  published: '✅',
  paused: '⏸️',
  draft: '📝',
  cancelled: '🚫',
}

const stateOf = (t: Translate, status: PublishingPostStatus) =>
  `${STATE_MARK[status]} ${t(`notify.telegram.state.${status}`)}`

/** How much of a post's text a line of `/oggi` shows. */
export const ANSWER_TEXT_MAX = 90

async function todayOf(deps: TelegramCommandDeps, agency: Agency): Promise<TelegramHtml[]> {
  const { t } = deps
  const day = agencyDay(deps.clock.now(), agency.timeZone)
  const { items } = await listAgenda(deps, agency.actor, {
    from: day.from.toISOString(),
    to: day.to.toISOString(),
  })
  const names = await clientNames(deps, agency.actor)
  return items.map((p) =>
    joinHtml([
      joinHtml(
        [
          bold(timeOfDay(new Date(p.scheduledAt), agency.timeZone)),
          plain(names.get(p.workspaceId) ?? ''),
          plain(stateOf(t, p.status)),
        ],
        ' · ',
      ),
      italic(
        p.text === ''
          ? untitledPost(t, p.type, p.firstFile)
          : `«${shorten(p.text, ANSWER_TEXT_MAX)}»`,
      ),
    ]),
  )
}

function issueLine(t: Translate, item: AgendaIssueDto, timeZone: string): string {
  switch (item.kind) {
    case 'post': {
      const { day, time } = dayAndTime(new Date(item.scheduledAt), timeZone)
      return t('notify.telegram.issues.post', {
        state: stateOf(t, item.status),
        when: `${day}, ${time}`,
      })
    }
    case 'profile':
      return t('notify.telegram.issues.profile', {
        name: item.name,
        what: t(`notify.telegram.issues.link.${item.link}`),
      })
    case 'media':
      return t('notify.telegram.issues.media', { name: item.name })
  }
}

async function issuesOf(deps: TelegramCommandDeps, agency: Agency): Promise<TelegramHtml[]> {
  const { items } = await listAgendaIssues(deps, agency.actor, {})
  const names = await clientNames(deps, agency.actor)
  return items.map((item) =>
    joinHtml(
      [
        bold(`• ${names.get(item.workspaceId) ?? ''}`),
        plain(issueLine(deps.t, item, agency.timeZone)),
      ],
      ' · ',
    ),
  )
}

/**
 * The answer to `/oggi` or `/problemi` for the person linked to the chat (parse_mode HTML): one
 * section per agency (its name when there are more), each with a link to its «Oggi», within
 * Telegram's limit.
 */
export async function answerTelegramQuery(
  deps: TelegramCommandDeps,
  input: {
    userId: string
    owner: TelegramBotOwner
    /** The agencies with a bot of their own: the platform's bot does not speak for them */
    agencyBots: ReadonlySet<string>
    query: TelegramQuery
  },
): Promise<TelegramHtml> {
  const { t } = deps
  const agencies = await agenciesOf(deps, input.userId, input.owner, input.agencyBots)
  if (agencies.length === 0) return plain(t('notify.telegram.noAgency'))
  const today = input.query === 'today'
  const sections: TelegramSection[] = []
  let total = 0
  for (const agency of agencies) {
    const lines = today ? await todayOf(deps, agency) : await issuesOf(deps, agency)
    total += lines.length
    const shown = lines.slice(0, ANSWER_LINES_MAX)
    sections.push({
      ...(agencies.length > 1 ? { title: bold(`🏢 ${agency.name}`) } : {}),
      lines:
        lines.length === 0
          ? [plain(t(today ? 'notify.telegram.today.none' : 'notify.telegram.issues.none'))]
          : shown,
      hidden: lines.length - shown.length,
      spaced: today,
      footer: link(
        new URL(agency.slug, deps.panelUrl).toString(),
        t(today ? 'notify.telegram.today.open' : 'notify.telegram.issues.open'),
      ),
    })
  }
  // the day of the first agency: the person's agencies are, nearly always, in one time zone
  const first = agencies[0]
  const heading = today
    ? joinHtml([
        bold(
          `📅 ${t('notify.telegram.today.title', {
            day: dayAndTime(deps.clock.now(), first?.timeZone ?? 'Europe/Rome').day,
          })}`,
        ),
        ...(total > 0 ? [plain(t('notify.telegram.today.count', { n: String(total) }))] : []),
      ])
    : bold(`⚠️ ${t('notify.telegram.issues.title')}`)
  return fitMessage({
    head: [heading],
    sections,
    more: (n) => italic(t('notify.telegram.more', { n: String(n) })),
  })
}
