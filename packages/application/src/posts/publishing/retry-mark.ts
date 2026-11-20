import type { PublishingTargetRecord } from '../../ports/publishing.js'

// «Riprova» from `failed` starts the destination again at once (plan 07, Scelta 1): the 15
// minutes of D-77 (b) count from the «Riprova», not from the post's time, which stays for the
// history. The moment is kept in `post_targets.verification` until the next round writes it.

export const retryMark = (at: Date) => ({ retriedAt: at.toISOString() })

export function retriedAtOf(target: Pick<PublishingTargetRecord, 'verification'>): Date | null {
  const raw = (target.verification as { retriedAt?: unknown } | null)?.retriedAt
  const at = typeof raw === 'string' ? new Date(raw) : null
  return at && Number.isFinite(at.getTime()) ? at : null
}
