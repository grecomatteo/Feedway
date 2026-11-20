import type { PostResponse } from '@app/contracts'

// The states of a post and of its destinations as the panel says them (plan 07 Scelte 3, 6, 8;
// DESIGN.md, the colours of the states): red where something did not go out, amber where someone
// has to look, blue while it is on its way, green once out.

/** As `StatusTone` of `StatusDot`: a plain module cannot read the type out of a .vue file. */
type StatusTone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

export type PostStatus = PostResponse['status']
export type TargetStatus = PostResponse['destinations'][number]['status']

/** A post past «Programmato»: it opens on the page of the outcome, not in the editor (Scelta 6). */
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

/** «Bozza», «Programmato», «1 non uscito», «Pubblicato»… with the tone of its dot. */
export function postStateOf(
  post: Pick<PostResponse, 'status' | 'destinations'>,
  t: Translate,
): { label: string; tone: StatusTone } {
  if (post.status === 'partial') {
    const n = post.destinations.filter((d) => d.status === 'failed').length
    return { label: t('posts.state.partial', { n }, n), tone: POST_TONE.partial }
  }
  return { label: t(`posts.state.${post.status}`), tone: POST_TONE[post.status] }
}

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
