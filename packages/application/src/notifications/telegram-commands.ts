import { storedTimeZone, type OrgActor, type PublishingPostStatus } from '@app/domain'
import { timeOfDay, dayAndTime, capitalize } from '../mail/index.js'
import { agencyDay, listAgenda, listAgendaIssues, type AgendaIssueDto } from '../posts/index.js'
import type { Clock } from '../ports/clock.js'
import type { TelegramBotOwner } from '../ports/notifications.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

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
    const organization = await deps.uow.run({ organizationId: m.organizationId, userId }, (tx) =>
      tx.organizations.findById(m.organizationId),
    )
    if (organization?.status !== 'active') continue
    agencies.push({
      actor: {
        userId,
        platformRole: user.platformRole,
        organizationId: m.organizationId,
        orgRole: m.role,
        memberships: new Map(),
      },
      name: m.name,
      slug: m.slug,
      timeZone: storedTimeZone(organization.settings),
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

function limited(t: Translate, lines: string[]): string[] {
  if (lines.length <= ANSWER_LINES_MAX) return lines
  return [
    ...lines.slice(0, ANSWER_LINES_MAX),
    t('notify.telegram.more', { n: String(lines.length - ANSWER_LINES_MAX) }),
  ]
}

const stateOf = (t: Translate, status: PublishingPostStatus) => t(`notify.telegram.state.${status}`)

async function todayOf(deps: TelegramCommandDeps, agency: Agency): Promise<string[]> {
  const { t } = deps
  const day = agencyDay(deps.clock.now(), agency.timeZone)
  const { items } = await listAgenda(deps, agency.actor, {
    from: day.from.toISOString(),
    to: day.to.toISOString(),
  })
  const names = await clientNames(deps, agency.actor)
  return items.map((p) =>
    t('notify.telegram.today.line', {
      time: timeOfDay(new Date(p.scheduledAt), agency.timeZone),
      client: names.get(p.workspaceId) ?? '',
      state: stateOf(t, p.status),
      text: p.text === '' ? t('notify.post.noText') : p.text,
    }),
  )
}

function issueLine(t: Translate, item: AgendaIssueDto, client: string, timeZone: string): string {
  switch (item.kind) {
    case 'post': {
      const { day, time } = dayAndTime(new Date(item.scheduledAt), timeZone)
      return t('notify.telegram.issues.post', {
        client,
        state: stateOf(t, item.status),
        when: `${day} ${time}`,
      })
    }
    case 'profile':
      return t('notify.telegram.issues.profile', {
        client,
        name: item.name,
        what: t(`notify.telegram.issues.link.${item.link}`),
      })
    case 'media':
      return t('notify.telegram.issues.media', { client, name: item.name })
  }
}

async function issuesOf(deps: TelegramCommandDeps, agency: Agency): Promise<string[]> {
  const { items } = await listAgendaIssues(deps, agency.actor, {})
  const names = await clientNames(deps, agency.actor)
  return items.map((item) =>
    issueLine(deps.t, item, names.get(item.workspaceId) ?? '', agency.timeZone),
  )
}

/**
 * The answer to `/oggi` or `/problemi` for the person linked to the chat: one block per agency
 * (its name when there are more), each with a link to its «Oggi».
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
): Promise<string> {
  const { t } = deps
  const agencies = await agenciesOf(deps, input.userId, input.owner, input.agencyBots)
  if (agencies.length === 0) return t('notify.telegram.noAgency')
  const first = agencies[0]
  const heading =
    input.query === 'today'
      ? t('notify.telegram.today.title', {
          day: capitalize(dayAndTime(deps.clock.now(), first?.timeZone ?? 'Europe/Rome').day),
        })
      : t('notify.telegram.issues.title')
  const blocks: string[] = [heading]
  for (const agency of agencies) {
    const lines =
      input.query === 'today' ? await todayOf(deps, agency) : await issuesOf(deps, agency)
    const link = new URL(agency.slug, deps.panelUrl).toString()
    const body =
      lines.length === 0
        ? [
            t(
              input.query === 'today'
                ? 'notify.telegram.today.none'
                : 'notify.telegram.issues.none',
            ),
          ]
        : limited(t, lines)
    blocks.push(
      [
        ...(agencies.length > 1 ? [agency.name] : []),
        ...body,
        t('notify.telegram.open', { url: link }),
      ].join('\n'),
    )
  }
  return blocks.join('\n\n')
}
