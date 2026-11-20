import type { PostResponse } from '@app/contracts'

// The states of a post and of its destinations as the panel says them (plan 07 Scelte 3, 6, 8;
// DESIGN.md, the colours of the states): red where something did not go out, amber where someone
// has to look, blue while it is on its way, green once out.

/** As `StatusTone` of `StatusDot`: a plain module cannot read the type out of a .vue file. */
type StatusTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

export type PostStatus = PostResponse['status']
export type TargetStatus = PostResponse['destinations'][number]['status']

/** Scheduled for a time already here: «Pubblica subito», or a post the worker has not taken yet. */
export const isDue = (post: Pick<PostResponse, 'status' | 'scheduledAt'>, now = Date.now()) =>
  post.status === 'scheduled' &&
  post.scheduledAt !== null &&
  new Date(post.scheduledAt).getTime() <= now

/**
 * A post past «Programmato», or scheduled for a time already here: it opens on the page of the
 * outcome, not in the editor (Scelta 6), so «Pubblica subito» is never undone from the editor.
 */
export const opensOnOutcome = (post: Pick<PostResponse, 'status' | 'scheduledAt'>) =>
  isOutcomeStatus(post.status) || isDue(post)

/** A post past «Programmato» (Scelta 6). */
export const isOutcomeStatus = (status: PostStatus) =>
  status === 'publishing' ||
  status === 'partial' ||
  status === 'failed' ||
  status === 'problem' ||
  status === 'published' ||
  status === 'paused'

const POST_TONE: Record<PostStatus, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  publishing: 'info',
  partial: 'danger',
  failed: 'danger',
  problem: 'warning',
  published: 'success',
  paused: 'warning',
  cancelled: 'neutral',
}

/** The tone of a post's state: the colour of its dot, and of its bar in the week of «Oggi». */
export const postToneOf = (status: PostStatus): StatusTone => POST_TONE[status]

/**
 * «Bozza», «Programmato», «1 non uscito», «Pubblicato»… with the tone of its dot, from the state
 * and how many destinations did not go out (as the agenda counts them, `notOut`).
 */
export function postStateLabel(
  post: { status: PostStatus; notOut: number },
  t: Translate,
): { label: string; tone: StatusTone } {
  if (post.status === 'partial') {
    const n = post.notOut
    return { label: t('posts.state.partial', { n }, n), tone: POST_TONE.partial }
  }
  return { label: t(`posts.state.${post.status}`), tone: POST_TONE[post.status] }
}

/** The same for a post read whole, counting its destinations. */
export const postStateOf = (post: Pick<PostResponse, 'status' | 'destinations'>, t: Translate) =>
  postStateLabel(
    {
      status: post.status,
      notOut: post.destinations.filter((d) => d.status === 'failed').length,
    },
    t,
  )

const TARGET_TONE: Record<TargetStatus, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  preparing: 'info',
  ready: 'info',
  publishing: 'info',
  retrying: 'info',
  unknown: 'warning',
  published: 'success',
  verifying: 'success',
  confirmed: 'success',
  problem: 'warning',
  failed: 'danger',
  paused: 'warning',
  cancelled: 'neutral',
}

/** One destination on the page of the outcome: «In preparazione», «Pubblicato», «Non uscito». */
export function targetStateOf(
  status: TargetStatus,
  t: Translate,
): { label: string; tone: StatusTone } {
  return { label: t(`posts.outcome.state.${status}`), tone: TARGET_TONE[status] }
}

/** A destination still on its way: the page reads itself again every 10 seconds (Scelta 6). */
export const isTargetMoving = (status: TargetStatus) =>
  status === 'scheduled' ||
  status === 'preparing' ||
  status === 'ready' ||
  status === 'publishing' ||
  status === 'retrying' ||
  status === 'unknown' ||
  status === 'published' ||
  status === 'verifying'
