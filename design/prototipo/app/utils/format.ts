import { DateTime } from 'luxon'
import { SCENARIO_NOW, ZONE, WORKSPACES, type Account, type Post, type Target, type TargetState } from '~/data/scenario'

export const now = () => DateTime.fromISO(SCENARIO_NOW, { zone: ZONE })
export const dt = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).setLocale('it')

export const hhmm = (iso: string) => dt(iso).toFormat('HH:mm')
export const dayLong = (iso: string) => dt(iso).toFormat('cccc d LLLL yyyy')
export const fullWhen = (iso: string) => `${capitalize(dt(iso).toFormat("cccc d LLLL yyyy, HH:mm"))} · ${ZONE}`

export function relative(iso: string) {
  const diff = dt(iso).diff(now(), ['days', 'hours', 'minutes']).toObject()
  const d = Math.floor(diff.days ?? 0)
  const h = Math.floor(diff.hours ?? 0)
  const m = Math.round(diff.minutes ?? 0)
  if (d < 0 || h < 0 || m < 0) return 'nel passato'
  const parts = [d && `${d} ${d === 1 ? 'giorno' : 'giorni'}`, h && `${h} ${h === 1 ? 'ora' : 'ore'}`, !d && m && `${m} min`].filter(Boolean)
  return parts.length ? `fra ${parts.join(' e ')}` : 'adesso'
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const workspace = (id: string) => WORKSPACES.find(w => w.id === id)!
export const account = (id: string) => WORKSPACES.flatMap(w => w.accounts).find(a => a.id === id)!

export const TYPE_LABEL = { reel: 'Reel', photo: 'Foto', carousel: 'Carosello' } as const
export const TYPE_ICON = { reel: 'i-lucide-clapperboard', photo: 'i-lucide-image', carousel: 'i-lucide-gallery-horizontal' } as const

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export interface StatusView { label: string, icon: string, tone: Tone, long?: string }

export const TARGET_VIEW: Record<TargetState, StatusView> = {
  pending: { label: 'Programmato', icon: 'i-lucide-clock-3', tone: 'info' },
  publishing: { label: 'In pubblicazione', icon: 'i-lucide-loader', tone: 'info' },
  verifying: { label: 'In verifica', icon: 'i-lucide-hourglass', tone: 'info' },
  confirmed: { label: 'Confermato', icon: 'i-lucide-circle-check', tone: 'success' },
  retrying: { label: 'Nuovo tentativo previsto', icon: 'i-lucide-rotate-cw', tone: 'info' },
  unknown: { label: 'Da accertare', icon: 'i-lucide-circle-question-mark', tone: 'warning' },
  failed: { label: 'Con problema', icon: 'i-lucide-circle-alert', tone: 'danger' },
}

// Aggregate wording follows brief 03 §F06: never "Fallito" while something is still uncertain.
export function postStatus(p: Post): StatusView {
  if (p.status === 'draft') return { label: 'Bozza', icon: 'i-lucide-pencil-line', tone: 'neutral', long: 'Bozza: non verrà pubblicata da sola' }
  if (p.status === 'scheduled') return { label: 'Programmato', icon: 'i-lucide-clock-3', tone: 'info' }
  if (p.status === 'preparing') return { label: 'In preparazione', icon: 'i-lucide-loader', tone: 'info' }
  const c = (s: TargetState) => p.targets.filter((x: Target) => x.state === s).length
  const total = p.targets.length
  const conf = c('confirmed'), fail = c('failed'), unk = c('unknown')
  const inFlight = total - conf - fail - unk
  if (inFlight > 0) return { label: `${conf} di ${total} confermate · in corso`, icon: 'i-lucide-hourglass', tone: 'info' }
  if (conf === total) return { label: 'Confermato', long: `Confermato su ${total} destinazioni`, icon: 'i-lucide-circle-check', tone: 'success' }
  const bits = [conf && `${conf} confermate`, fail && `${fail} con problema`, unk && `${unk} da accertare`].filter(Boolean)
  return { label: bits.join(' · '), icon: fail ? 'i-lucide-circle-alert' : 'i-lucide-circle-question-mark', tone: fail ? 'danger' : 'warning' }
}

export const TONE_STYLE: Record<Tone, { color: string, bg: string }> = {
  neutral: { color: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  info: { color: 'var(--info)', bg: 'var(--info-soft)' },
  success: { color: 'var(--success)', bg: 'var(--success-soft)' },
  warning: { color: 'var(--warning)', bg: 'var(--warning-soft)' },
  danger: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
}

/**
 * On DST fall-back days a wall-clock time can map to two instants.
 * Returns both candidate instants when the local time is ambiguous, one when it is not.
 */
export function resolveLocal(date: string, time: string): DateTime[] {
  const base = DateTime.fromISO(`${date}T${time}`, { zone: ZONE })
  if (!base.isValid) return []
  const candidates = [base.minus({ hours: 1 }), base, base.plus({ hours: 1 })]
    .map(c => c.setZone(ZONE))
    .filter(c => c.toFormat('yyyy-MM-dd') === date && c.toFormat('HH:mm') === time)
  const unique = candidates.filter((c, i, a) => a.findIndex(o => o.toMillis() === c.toMillis()) === i)
  return unique.sort((a, b) => a.toMillis() - b.toMillis())
}

export interface Profile { id: string, name: string, workspaceId: string, ig?: Account, fb?: Account }

/** Groups a client's accounts into profiles: an IG account and its linked Facebook Page. */
export function profilesOf(workspaceId: string): Profile[] {
  const ws = workspace(workspaceId)
  const out: Profile[] = []
  for (const a of ws.accounts) {
    let p = out.find(x => x.id === a.profileId)
    if (!p) out.push(p = { id: a.profileId, name: a.name, workspaceId })
    if (a.platform === 'instagram') p.ig = a
    else p.fb = a
  }
  return out
}
export const profile = (id: string) => WORKSPACES.flatMap(w => profilesOf(w.id)).find(p => p.id === id)
