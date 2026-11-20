import type { AgendaIssue } from '@app/contracts'
import { formatDate, formatRelative, formatTime } from './format-date.ts'

// The posts of «Da sistemare» (plan 07 Scelta 8, screens 02, 04 and 14): what «Oggi», the dot of
// the client selector and the column «Collegamento» of «Clienti» say about them. Red when a post
// did not go out, amber when it is paused or Meta does not confirm it.

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string
type PostIssue = AgendaIssue & { kind: 'post' }
type StatusTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

const PLATFORM_NAME = { instagram: 'Instagram', facebook: 'Facebook' } as const
/** The types whose name is feminine in Italian: «la foto non uscita», «la storia non uscita». */
const FEMININE = new Set<PostIssue['type']>(['photo', 'story'])

/** «Instagram e Facebook»; «Meta» when no account is known any more (taken off the client). */
const whereOf = (i: PostIssue) =>
  i.platforms.length === 0 ? 'Meta' : i.platforms.map((p) => PLATFORM_NAME[p]).join(' e ')

/**
 * «delle 9:30» for a post of today, «del 12 novembre» for another day, in the post's own zone
 * (D-58), with the article elided before one, eight and eleven: «dell’1:15», «dell’8 novembre».
 */
function whenOf(i: PostIssue, now: Date): string {
  const options = { timeZone: i.timezone, now }
  if (formatRelative(i.scheduledAt, { ...options, time: false }) === 'oggi') {
    const time = formatTime(i.scheduledAt, options)
    return time.startsWith('1:') ? `dell’${time}` : `delle ${time}`
  }
  const day = formatDate(i.scheduledAt, options)
  return /^(1|8|11) /.test(day) ? `dell’${day}` : `del ${day}`
}

/** «Reel delle 9:30 non uscito su Facebook», «Foto del 12 novembre in pausa». */
export function postIssueTitle(i: PostIssue, t: Translate, now = new Date()): string {
  const named = { type: t(`posts.type.${i.type}`), when: whenOf(i, now), where: whereOf(i) }
  if (i.status === 'failed' || i.status === 'partial')
    return t(`today.issues.post.failed.${FEMININE.has(i.type) ? 'f' : 'm'}`, named)
  return t(`today.issues.post.${i.status}`, named)
}

/** Why, in a few words («il file non va bene per Facebook»); the post says the rest. */
export function postIssueReason(i: PostIssue, t: Translate, te: (key: string) => boolean): string {
  const key = `today.issues.post.reason.${i.reason ?? ''}`
  return i.reason && te(key)
    ? t(key, { platform: whereOf(i) })
    : t('today.issues.post.reason.other')
}

export const postIssueTone = (status: PostIssue['status']): StatusTone =>
  status === 'failed' || status === 'partial' ? 'danger' : 'warning'

/**
 * The worst of a client's posts: how many did not go out, else how many are paused, else how
 * many have a problem; null when none needs a hand.
 */
export function clientPostTrouble(
  items: readonly AgendaIssue[],
  workspaceId: string,
): { status: 'notOut' | 'paused' | 'problem'; count: number } | null {
  const own = items.filter(
    (i): i is PostIssue => i.kind === 'post' && i.workspaceId === workspaceId,
  )
  const count = (wanted: readonly PostIssue['status'][]) =>
    own.filter((i) => wanted.includes(i.status)).length
  const notOut = count(['failed', 'partial'])
  if (notOut > 0) return { status: 'notOut', count: notOut }
  const paused = count(['paused'])
  if (paused > 0) return { status: 'paused', count: paused }
  const problem = count(['problem'])
  return problem > 0 ? { status: 'problem', count: problem } : null
}
