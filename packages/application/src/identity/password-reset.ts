import { DomainError, type OrgActor } from '@app/domain'
import type { Auth, AuthSessionInfo } from '../ports/auth.js'
import type { PasswordResetEmailData } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { Mailer } from '../ports/mailer.js'
import type { Translate } from '../ports/translator.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { IdentityDeps } from './identity-deps.js'
import { assertActorSession, assertManagesUsers, targetMember } from './member-rules.js'
import { assertRecentReauth } from './reauth.js'
import {
  dayAndTime,
  emailFrame,
  isSameDay,
  oneLine,
  renderEmail,
  usableTimeZone,
} from '../mail/index.js'
import type { Clock } from '../ports/clock.js'

/**
 * A reset link for a person of this agency, to copy from the panel (spec §10.4). Only for
 * someone who works for this agency alone (checked again when the link is used, auth-hooks.ts): the identity is one across agencies, so another
 * agency's Owner must not be able to take it over. `organization_count` sees the memberships row
 * level security hides, disabled ones and suspended agencies included.
 */
export async function createPasswordResetLink(
  deps: Pick<IdentityDeps, 'uow' | 'clock'> & { auth: Pick<Auth, 'passwordResetUrl'> },
  actor: OrgActor,
  session: AuthSessionInfo,
  userId: string,
  request: { ip: string | null },
): Promise<{ url: string }> {
  assertActorSession(actor, session)
  assertManagesUsers(actor)
  assertRecentReauth(session, deps.clock.now())
  const { organizationId } = actor
  return deps.uow.run({ organizationId, userId: actor.userId }, async (tx) => {
    const member = await targetMember(tx, actor, userId)
    if (member.status !== 'active')
      throw new DomainError('CONFLICT', 'L’utente è disattivato: riattivalo prima')
    if ((await tx.orgMembers.organizationCount(userId)) !== 1)
      throw new DomainError(
        'FORBIDDEN',
        'Questo utente lavora anche con altre agenzie: può reimpostare la password da solo',
      )
    const user = await tx.users.findById(userId)
    // the platform administrator's identity is never in an agency's hands
    if (user?.platformRole === 'admin')
      throw new DomainError('FORBIDDEN', 'Non puoi creare un link di reset per questo utente')
    if (!user || user.status !== 'active' || user.anonymizedAt !== null)
      throw new DomainError('CONFLICT', 'Questo account non è attivo')
    // Better Auth writes the token with its own connection: if this transaction then fails, an
    // unreturned link expires on its own within the hour.
    const url = await deps.auth.passwordResetUrl(user.email)
    if (url === null) throw new Error('no reset link for an existing account')
    await tx.audit.record({
      organizationId,
      actorId: actor.userId,
      source: 'panel',
      action: 'user.password_reset_link',
      entity: 'user',
      entityId: userId,
      workspaceId: null,
      ip: request.ip,
    })
    return { url }
  })
}

/** For jobs without dates: the reset link Better Auth makes lasts an hour (better-auth.ts). */
const PASSWORD_RESET_FALLBACK_TTL_MS = 3600_000

export interface PasswordResetEmailDeps {
  uow: UnitOfWork
  mailer: Mailer
  translate: Translate
  logger: Logger
  clock: Clock
  panelUrl: URL
  productName: string
  /** Used when the person has not chosen a time zone. */
  defaultTimezone: string
}

/**
 * Job `identity.password_reset_email` ("Password dimenticata"). Without email configured the
 * job completes and nothing is sent: the browser got the same answer either way. The link is
 * never logged.
 */
export async function sendPasswordResetEmail(
  deps: PasswordResetEmailDeps,
  job: PasswordResetEmailData & { userId: string },
): Promise<void> {
  const user = await deps.uow.run({ userId: job.userId }, (tx) => tx.users.findById(job.userId))
  if (user === null || user.status !== 'active' || user.anonymizedAt !== null) {
    deps.logger.info({}, 'password reset email skipped: account not active')
    return
  }
  const now = deps.clock.now()
  // jobs queued before the dates were part of them: Better Auth's link lasts an hour
  const expiresAt =
    job.requestedAt && job.expiresAt
      ? new Date(job.expiresAt)
      : new Date(now.getTime() + PASSWORD_RESET_FALLBACK_TTL_MS)
  const minutesLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000)
  if (!(minutesLeft > 0)) {
    deps.logger.info({}, 'password reset email skipped: link expired')
    return
  }
  const minutes = String(minutesLeft)
  const t = deps.translate
  const timeZone = usableTimeZone(user.timezone ?? deps.defaultTimezone, 'Europe/Rome')
  const { time } = dayAndTime(expiresAt, timeZone)
  const today = isSameDay(now, expiresAt, timeZone)
  const values = { product: deps.productName, minutes, time }
  const { html, text } = renderEmail({
    ...emailFrame(t, deps.panelUrl, deps.productName),
    preheader: t('email.passwordReset.preheader', values),
    title: t('email.passwordReset.title', values),
    blocks: [
      { kind: 'paragraph', text: t('email.passwordReset.intro', values) },
      { kind: 'button', label: t('email.passwordReset.button'), url: job.url, tone: 'primary' },
      {
        kind: 'box',
        title: t('email.passwordReset.expiryTitle', values),
        text: t(`email.passwordReset.${today ? 'expiryToday' : 'expiryTomorrow'}`, values),
      },
      {
        kind: 'lead',
        lead: t('email.passwordReset.notMe.lead'),
        text: t('email.passwordReset.notMe.text'),
      },
    ],
    footerReason: t('email.passwordReset.footer', values),
  })
  const result = await deps.mailer.send({
    to: user.email,
    subject: oneLine(t('email.passwordReset.subject', values)),
    text,
    html,
  })
  if (result === 'not_configured')
    deps.logger.info({}, 'password reset email not sent: not_configured')
}
