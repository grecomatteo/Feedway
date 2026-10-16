// Fictional scenario modelled on design/brief-feedway/dati/scenari.json.
// It is a fixture for the prototype, not an API contract.

export const SCENARIO_NOW = '2026-10-15T12:00:00+02:00'
export const ZONE = 'Europe/Rome'

const u = (id: string) =>
  `https://images.unsplash.com/${id}?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=75&w=720`

// Unsplash stock photos used as declared placeholders for fictional clients.
export const MEDIA: Record<string, string> = {
  'forno-pane': u('photo-1780644804493-6ac6238e7ecf'),
  'forno-lab': u('photo-1586414553443-83858a535491'),
  'forno-cornetti': u('photo-1790998593701-55fb7c89951f'),
  'forma-pilates': u('photo-1717500251646-3e661a2ee7e1'),
  'forma-stretch': u('photo-1776090188651-a1ec2cf2bdb0'),
  'orto-verdure': u('photo-1614702897594-d60066634da0'),
  'orto-cucina': u('photo-1559474520-4ad01f41e109'),
  'orto-mercato': u('photo-1604972356809-b930be5504c2'),
}

export type Platform = 'instagram' | 'facebook'
export type Health = 'healthy' | 'needs_reconnect'

export interface Account {
  id: string
  platform: Platform
  name: string
  handle: string
  health: Health
  /** Simulates the IG account ↔ Facebook Page link that Meta itself provides. */
  profileId: string
}

export interface Workspace {
  id: string
  name: string
  short: string
  color: string
  initials: string
  /** Time proposed when scheduling a new post for this client (editable in Clienti). */
  defaultTime: string
  accounts: Account[]
}

export const AGENCY = { id: 'studio-aurora', name: 'Studio Aurora' }

export const WORKSPACES: Workspace[] = [
  {
    id: 'forno-luce', name: 'Forno Luce', short: 'Forno Luce', color: '#E9B44C', initials: 'FL', defaultTime: '18:00',
    accounts: [
      { id: 'fl-instagram-centro', platform: 'instagram', name: 'Forno Luce Centro', handle: '@fornoluce.centro', health: 'healthy', profileId: 'fl-centro' },
      { id: 'fl-facebook-centro', platform: 'facebook', name: 'Forno Luce Centro', handle: 'Pagina Facebook', health: 'healthy', profileId: 'fl-centro' },
      { id: 'fl-instagram-nord', platform: 'instagram', name: 'Forno Luce Nord', handle: '@fornoluce.nord', health: 'healthy', profileId: 'fl-nord' },
      { id: 'fl-facebook-nord', platform: 'facebook', name: 'Forno Luce Nord', handle: 'Pagina Facebook', health: 'healthy', profileId: 'fl-nord' },
      { id: 'fl-instagram-lab', platform: 'instagram', name: 'Forno Luce Lab', handle: '@fornoluce.lab', health: 'healthy', profileId: 'fl-lab' },
      { id: 'fl-facebook-lab', platform: 'facebook', name: 'Forno Luce Lab', handle: 'Pagina Facebook', health: 'needs_reconnect', profileId: 'fl-lab' },
    ],
  },
  {
    id: 'studio-forma', name: 'Studio Forma — Pilates e movimento', short: 'Studio Forma', color: '#7BA7D9', initials: 'SF', defaultTime: '07:30',
    accounts: [
      { id: 'sf-ig', platform: 'instagram', name: 'Studio Forma', handle: '@studioforma', health: 'healthy', profileId: 'sf' },
      { id: 'sf-fb', platform: 'facebook', name: 'Studio Forma', handle: 'Pagina Facebook', health: 'healthy', profileId: 'sf' },
    ],
  },
  {
    id: 'orto-vivo', name: 'Orto Vivo / Mercato e cucina di stagione', short: 'Orto Vivo', color: '#6DBE7B', initials: 'OV', defaultTime: '12:30',
    accounts: [
      { id: 'ov-ig', platform: 'instagram', name: 'Orto Vivo', handle: '@ortovivo', health: 'healthy', profileId: 'ov' },
      { id: 'ov-fb', platform: 'facebook', name: 'Orto Vivo', handle: 'Pagina Facebook', health: 'healthy', profileId: 'ov' },
    ],
  },
]

export const ACCOUNT_GROUP = {
  name: 'Campagna cinque destinazioni',
  workspaceId: 'forno-luce',
  targetIds: ['fl-instagram-centro', 'fl-facebook-centro', 'fl-instagram-nord', 'fl-facebook-nord', 'fl-instagram-lab'],
}

export type PostType = 'reel' | 'photo' | 'carousel'
export type PostStatus = 'draft' | 'scheduled' | 'preparing' | 'publishing' | 'done'
export type TargetState = 'pending' | 'publishing' | 'verifying' | 'confirmed' | 'retrying' | 'unknown' | 'failed'

export interface Target {
  accountId: string
  state: TargetState
  updatedAt?: string
  nextCheck?: string
  error?: string
}

export interface Note {
  id: string
  author: string
  body: string
  /** personal: only the author; team: whoever works on the client. Never visible to the client. */
  visibility: 'personal' | 'team'
  at: string
}

export interface Post {
  id: string
  workspaceId: string
  type: PostType
  caption: string
  scheduledAt: string
  media: string
  /** Reel cover chosen in the editor (data URL kept in this browser only). */
  cover?: string
  notes?: Note[]
  status: PostStatus
  targets: Target[]
  createdBy: string
}

const t = (ids: string[], state: TargetState, updatedAt?: string): Target[] =>
  ids.map(accountId => ({ accountId, state, updatedAt }))

const FL2 = ['fl-instagram-centro', 'fl-facebook-centro']
const SF = ['sf-ig', 'sf-fb']
const OV = ['ov-ig', 'ov-fb']
const CAP = {
  forno: 'Il laboratorio apre le porte: prepariamo insieme il pane di domani. Sabato dalle 9 alle 12, via Roma 14. #fornoluce #panefresco',
  forma: 'Venti minuti per ritrovare il movimento, un passo alla volta.',
  orto: 'I colori di ottobre, dal mercato alla nostra cucina.',
}

export const INITIAL_POSTS: Post[] = [
  { id: 'post-a1', workspaceId: 'orto-vivo', type: 'carousel', caption: CAP.orto, scheduledAt: '2026-10-12T09:30:00+02:00', media: 'orto-mercato', status: 'done', targets: t(OV, 'confirmed', '2026-10-12T09:30:40+02:00'), createdBy: 'Giulia R.' },
  { id: 'post-a2', workspaceId: 'forno-luce', type: 'photo', caption: 'Cornetti appena sfornati, ogni mattina dalle 7.', scheduledAt: '2026-10-12T18:00:00+02:00', media: 'forno-cornetti', status: 'done', targets: t(FL2, 'confirmed', '2026-10-12T18:00:35+02:00'), createdBy: 'Giulia R.' },
  { id: 'post-a3', workspaceId: 'studio-forma', type: 'photo', caption: CAP.forma, scheduledAt: '2026-10-13T08:00:00+02:00', media: 'forma-stretch', status: 'done', targets: t(SF, 'confirmed', '2026-10-13T08:00:31+02:00'), createdBy: 'Marco T.' },
  {
    id: 'post-uncertain', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-13T18:00:00+02:00', media: 'forno-lab', status: 'done', createdBy: 'Giulia R.',
    targets: [
      ...t(ACCOUNT_GROUP.targetIds.slice(0, 4), 'confirmed', '2026-10-13T18:00:52+02:00'),
      { accountId: 'fl-instagram-lab', state: 'unknown', updatedAt: '2026-10-13T18:00:10+02:00', nextCheck: '2026-10-15T12:14:00+02:00' },
    ],
  },
  { id: 'post-a4', workspaceId: 'orto-vivo', type: 'carousel', caption: CAP.orto, scheduledAt: '2026-10-14T12:00:00+02:00', media: 'orto-verdure', status: 'done', targets: t(OV, 'confirmed', '2026-10-14T12:00:44+02:00'), createdBy: 'Marco T.' },
  {
    id: 'post-partial', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-14T18:00:00+02:00', media: 'forno-pane', status: 'done', createdBy: 'Giulia R.',
    notes: [{ id: 'n1', author: 'Marco T.', body: 'Il cliente vuole il reel anche sul profilo Lab appena ricollegato.', visibility: 'team', at: '2026-10-14T19:05:00+02:00' },
      { id: 'n2', author: 'Giulia R.', body: 'Ricordarmi di sentire Marco per la nuova copertina.', visibility: 'personal', at: '2026-10-14T19:20:00+02:00' },
      { id: 'n3', author: 'Sara L.', body: 'Nota personale di Sara: non deve vederla nessun altro.', visibility: 'personal', at: '2026-10-14T19:30:00+02:00' }],
    targets: [
      ...t(ACCOUNT_GROUP.targetIds.slice(0, 4), 'confirmed', '2026-10-14T18:00:41+02:00'),
      { accountId: 'fl-instagram-lab', state: 'failed', updatedAt: '2026-10-14T18:00:12+02:00', error: 'Permesso di pubblicazione revocato dopo la programmazione.' },
    ],
  },
  { id: 'post-01', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-15T12:00:00+02:00', media: 'forno-lab', status: 'draft', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-02', workspaceId: 'studio-forma', type: 'photo', caption: CAP.forma, scheduledAt: '2026-10-15T15:00:00+02:00', media: 'forma-pilates', status: 'scheduled', targets: t(SF, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-03', workspaceId: 'orto-vivo', type: 'carousel', caption: CAP.orto, scheduledAt: '2026-10-15T18:00:00+02:00', media: 'orto-cucina', status: 'scheduled', targets: t(OV, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-04', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-16T12:00:00+02:00', media: 'forno-pane', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-05', workspaceId: 'studio-forma', type: 'photo', caption: CAP.forma, scheduledAt: '2026-10-16T15:00:00+02:00', media: 'forma-stretch', status: 'scheduled', targets: t(SF, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-06', workspaceId: 'orto-vivo', type: 'carousel', caption: CAP.orto, scheduledAt: '2026-10-16T18:00:00+02:00', media: 'orto-verdure', status: 'scheduled', targets: t(OV, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-07', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-17T12:00:00+02:00', media: 'forno-cornetti', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-08', workspaceId: 'studio-forma', type: 'photo', caption: CAP.forma, scheduledAt: '2026-10-17T15:00:00+02:00', media: 'forma-pilates', status: 'draft', targets: t(SF, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-09', workspaceId: 'orto-vivo', type: 'carousel', caption: CAP.orto, scheduledAt: '2026-10-17T18:00:00+02:00', media: 'orto-mercato', status: 'scheduled', targets: t(OV, 'pending'), createdBy: 'Marco T.' },
  { id: 'post-10', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-10-18T12:00:00+02:00', media: 'forno-lab', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-11', workspaceId: 'forno-luce', type: 'carousel', caption: 'Novembre in forno: le nuove pagnotte d’autunno.', scheduledAt: '2026-11-03T12:00:00+01:00', media: 'forno-cornetti', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-12', workspaceId: 'forno-luce', type: 'reel', caption: CAP.forno, scheduledAt: '2026-11-10T18:00:00+01:00', media: 'forno-lab', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Giulia R.' },
  { id: 'post-13', workspaceId: 'forno-luce', type: 'photo', caption: 'San Martino: il pane delle feste è in vetrina.', scheduledAt: '2026-11-11T09:30:00+01:00', media: 'forno-pane', status: 'scheduled', targets: t(FL2, 'pending'), createdBy: 'Marco T.' },
  // Dense day: twelve posts on 22 October.
  ...Array.from({ length: 12 }, (_, i): Post => {
    const ws = ['forno-luce', 'studio-forma', 'orto-vivo'][i % 3]!
    const key = (['forno', 'forma', 'orto'] as const)[i % 3]!
    const media = { forno: ['forno-pane', 'forno-lab', 'forno-cornetti'], forma: ['forma-pilates', 'forma-stretch'], orto: ['orto-verdure', 'orto-cucina', 'orto-mercato'] }[key]
    const h = String(8 + i).padStart(2, '0')
    return {
      id: `post-d${i + 1}`, workspaceId: ws, type: (['reel', 'photo', 'carousel'] as const)[i % 3]!, caption: CAP[key],
      scheduledAt: `2026-10-22T${h}:00:00+02:00`, media: media[i % media.length]!, status: 'scheduled',
      targets: t(ws === 'forno-luce' ? FL2 : ws === 'studio-forma' ? SF : OV, 'pending'), createdBy: 'Marco T.',
    }
  }),
]

export interface BulkRow {
  row: number
  caption: string
  filename: string
  scheduledAt: string
  status: 'ready' | 'blocked'
  error?: string
}

export const BULK_ROWS: BulkRow[] = Array.from({ length: 20 }, (_, i) => {
  const day = 16 + i
  const date = day <= 31 ? `2026-10-${String(day).padStart(2, '0')}` : `2026-11-${String(day - 31).padStart(2, '0')}`
  const row: BulkRow = { row: i + 1, caption: `Dal forno, una storia per il giorno ${i + 1}.`, filename: `forno-${String(i + 1).padStart(2, '0')}.jpg`, scheduledAt: `${date}T18:00:00`, status: 'ready' }
  if (i === 6) Object.assign(row, { status: 'blocked', filename: 'forno-07.heic', error: 'File non abbinato: forno-07.heic non è tra i file caricati.' })
  if (i === 13) Object.assign(row, { status: 'blocked', error: 'Caption oltre il limite di 2.200 caratteri (2.318).' })
  return row
})

export type ShareLinkState = 'active' | 'protected' | 'expired' | 'revoked' | 'empty'
export const SHARE_LINKS: Record<string, { state: ShareLinkState, workspaceId: string, expires?: string }> = {
  'forno-ottobre': { state: 'active', workspaceId: 'forno-luce', expires: '2026-10-31' },
  'forma-protetto': { state: 'protected', workspaceId: 'studio-forma', expires: '2026-11-15' },
  'orto-settembre': { state: 'expired', workspaceId: 'orto-vivo', expires: '2026-09-30' },
  'forno-vecchio': { state: 'revoked', workspaceId: 'forno-luce' },
  'orto-novembre': { state: 'empty', workspaceId: 'orto-vivo', expires: '2026-11-30' },
}

/** Editorial plan: what must be prepared, before the post exists. */
export interface PlanItem {
  id: string
  workspaceId: string
  date: string
  time?: string
  type: PostType
  title: string
  note?: string
  /** Set when someone prepares the content: the plan item then shows as the real post. */
  postId?: string
  createdBy: string
}

export const INITIAL_PLAN: PlanItem[] = [
  { id: 'plan-1', workspaceId: 'forno-luce', date: '2026-10-16', time: '09:00', type: 'reel', title: 'VIDEO 2 · impasto a mano', note: 'Girare in laboratorio, luce del mattino.', createdBy: 'Marco T.' },
  { id: 'plan-2', workspaceId: 'forno-luce', date: '2026-10-20', time: '18:00', type: 'reel', title: 'VIDEO 1 · porte aperte', note: 'Montaggio verticale, 30 secondi.', createdBy: 'Marco T.' },
  { id: 'plan-3', workspaceId: 'forno-luce', date: '2026-10-21', time: '12:30', type: 'carousel', title: 'Carosello · menu d’autunno', createdBy: 'Marco T.' },
  { id: 'plan-4', workspaceId: 'orto-vivo', date: '2026-10-19', type: 'carousel', title: 'Ricette con la zucca', note: '5 foto, ultima con la ricetta scritta.', createdBy: 'Giulia R.' },
  { id: 'plan-5', workspaceId: 'studio-forma', date: '2026-10-23', time: '07:30', type: 'reel', title: 'Lezione di prova', createdBy: 'Giulia R.' },
  { id: 'plan-6', workspaceId: 'forno-luce', date: '2026-11-04', type: 'photo', title: 'Foto · pane di San Martino', createdBy: 'Marco T.' },
]
