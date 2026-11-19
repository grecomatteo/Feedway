import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { libraryFile } from './media.ts'
import { connectedAgency, newWorkspace } from './meta.ts'
import { adminQuery, addPerson, newPerson, signInWithTotp, type E2ePerson } from './people.ts'

// The agency of the design references (D-81, design/esplorazioni/2026-11-19-nuova-direzione):
// Studio Riva, Giulia Ferri Owner, five clients and an archived one, their profiles, the posts
// of the week of Thursday 19 November 2026 and the three photos of design/feedway-ui-assets.
// Everything goes straight into the test database, so posts can sit in the past; the fidelity
// shots freeze the browser at that Thursday 10:00 in Rome (DESIGN_NOW).

/** The moment of the references: Thursday 19 November 2026, 10:00 in Rome. */
export const DESIGN_NOW = new Date('2026-11-19T09:00:00Z')

const photo = (name: string) =>
  readFile(new URL(`../../../../../design/feedway-ui-assets/${name}`, import.meta.url))
const PHOTOS = {
  pane: 'adbaa4719c5d6833.jpg',
  banco: '85eaab7ce7e4bb91.jpg',
  impasto: '47a5e2c5a89af42c.jpg',
} as const
type Photo = keyof typeof PHOTOS

type Platform = 'instagram' | 'facebook'
interface ProfileSeed {
  platform: Platform
  name: string
  username?: string
  /** «Da ricollegare» */
  broken?: boolean
}
interface ClientSeed {
  name: string
  profiles: ProfileSeed[]
  archived?: boolean
}

export const SAMPLE_CLIENTS: ClientSeed[] = [
  {
    name: 'Forno Luce',
    profiles: [
      { platform: 'instagram', name: 'Forno Luce', username: 'fornoluce' },
      { platform: 'facebook', name: 'Forno Luce' },
      { platform: 'facebook', name: 'Forno Luce Bistrot', broken: true },
    ],
  },
  {
    name: 'Osteria Bruna',
    profiles: [
      { platform: 'instagram', name: 'Osteria Bruna', username: 'osteriabruna' },
      { platform: 'facebook', name: 'Osteria Bruna' },
    ],
  },
  {
    name: 'Gelateria Polo',
    profiles: [
      { platform: 'instagram', name: 'Gelateria Polo', username: 'gelateriapolo' },
      { platform: 'facebook', name: 'Gelateria Polo' },
    ],
  },
  {
    name: 'Ottica Venti',
    profiles: [{ platform: 'instagram', name: 'Ottica Venti', username: 'otticaventi' }],
  },
  {
    name: 'Palestra Arco',
    profiles: [
      { platform: 'instagram', name: 'Palestra Arco', username: 'palestra.arco' },
      { platform: 'facebook', name: 'Palestra Arco' },
    ],
  },
  { name: 'Cantina Monteverde', profiles: [], archived: true },
]

/** The profiles in no client of screens 14 and 15: an Instagram and a Page that Meta does not pair. */
const ORPHANS: (ProfileSeed & { externalId: string })[] = [
  {
    platform: 'instagram',
    name: 'Bar Centrale',
    username: 'barcentrale.bo',
    externalId: '9100000001',
  },
  { platform: 'facebook', name: 'Bar Centrale Bologna', externalId: '9100000002' },
]

interface PostSeed {
  client: string
  type: 'photo' | 'carousel' | 'reel'
  caption: string
  photos: Photo[]
  /** Rome time; none for a draft without a date */
  at?: string
  scheduled: boolean
  /** the profiles it goes to: by platform, on the client's first profile of that platform */
  platforms: Platform[]
}

/** The posts of the references (screens 02, 13, 17), in Rome time. */
export const SAMPLE_POSTS: PostSeed[] = [
  {
    client: 'Osteria Bruna',
    type: 'photo',
    caption: 'Il pranzo del giovedì: tagliatelle al ragù bianco',
    photos: ['banco'],
    at: '2026-11-19T09:30',
    scheduled: true,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Forno Luce',
    type: 'photo',
    caption: 'Il pane del lunedì è appena uscito dal forno',
    photos: ['pane'],
    at: '2026-11-19T12:00',
    scheduled: true,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Forno Luce',
    type: 'carousel',
    caption: 'Dietro il banco: come nasce la sfoglia',
    photos: ['impasto', 'banco'],
    at: '2026-11-19T18:00',
    scheduled: true,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Gelateria Polo',
    type: 'photo',
    caption: 'Nuovi gusti d’autunno: castagna e cachi',
    photos: ['banco'],
    at: '2026-11-19T19:30',
    scheduled: true,
    platforms: ['instagram'],
  },
  {
    client: 'Forno Luce',
    type: 'carousel',
    caption: 'Le brioche di Natale si prenotano da oggi',
    photos: ['pane', 'banco', 'impasto'],
    at: '2026-11-20T08:00',
    scheduled: true,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Osteria Bruna',
    type: 'photo',
    caption: 'Menu del fine settimana',
    photos: ['banco'],
    at: '2026-11-20T13:00',
    scheduled: true,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Ottica Venti',
    type: 'photo',
    caption: 'Apertura straordinaria dell’8 dicembre',
    photos: ['impasto'],
    at: '2026-11-20T18:00',
    scheduled: true,
    platforms: ['instagram'],
  },
  {
    client: 'Forno Luce',
    type: 'carousel',
    caption: 'Focaccia: la ricetta della nonna',
    photos: ['impasto', 'pane'],
    scheduled: false,
    platforms: ['instagram', 'facebook'],
  },
  {
    client: 'Gelateria Polo',
    type: 'photo',
    caption: 'Il cono del mese',
    photos: [],
    scheduled: false,
    platforms: [],
  },
]

/** The team of screen 21. */
const TEAM = [
  { name: 'Marco Bassi', email: 'marco@studioriva.example', role: 'admin' as const, clients: [] },
  {
    name: 'Sara Leoni',
    email: 'sara@studioriva.example',
    role: 'member' as const,
    clients: [
      ['Forno Luce', 'editor'],
      ['Gelateria Polo', 'editor'],
    ] as const,
  },
  {
    name: 'Davide Conti',
    email: 'davide@studioriva.example',
    role: 'member' as const,
    clients: [['Osteria Bruna', 'editor']] as const,
  },
  {
    name: 'Elena Neri',
    email: 'elena@otticaventi.example',
    role: 'member' as const,
    clients: [['Ottica Venti', 'viewer']] as const,
  },
]

export interface DesignSample {
  owner: E2ePerson
  org: string
  /** client name → its id and slug */
  clients: Record<string, { id: string; slug: string }>
  /** caption → post id */
  posts: Record<string, string>
}

/** Rome wall time («2026-11-19T09:30») as an instant, with the offset of that day in Rome. */
export function romeInstant(wall: string) {
  const asUtc = new Date(`${wall}:00Z`)
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome',
    timeZoneName: 'longOffset',
  })
    .formatToParts(asUtc)
    .find((p) => p.type === 'timeZoneName')?.value // «GMT+01:00»
  const sign = offset?.slice(3) || '+00:00'
  return new Date(`${wall}:00${sign}`).toISOString()
}

async function send(request: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await request.fetch(path, {
    method,
    headers: { origin: new URL(process.env.E2E_BASE_URL ?? '').origin, 'x-app-request': '1' },
    data,
  })
  expect(res.status(), `${method} ${path}`).toBeLessThan(300)
  return (await res.json()) as { id: string; version: number }
}

/**
 * Studio Riva as in the references, signed in as Giulia Ferri on `page`. Unique e-mails: the
 * function runs once per database (the design shots use a single worker).
 */
export async function designSample(page: Page): Promise<DesignSample> {
  const owner = await newPerson('Giulia Ferri', 'owner')
  const org = owner.organizationSlug
  await adminQuery("update organizations set name = 'Studio Riva' where id = $1", [org])
  await adminQuery('update users set email = $2 where id = $1', [
    owner.userId,
    'giulia@studioriva.example',
  ])
  owner.email = 'giulia@studioriva.example'
  // a second agency, as screen 06 shows «Cambia agenzia»
  const other = randomUUID()
  await adminQuery(
    "insert into organizations (id, name, slug, status) values ($1::uuid, 'Studio Nord', $1::text, 'active')",
    [other],
  )
  await adminQuery(
    "insert into organization_members (organization_id, user_id, role, status) values ($1, $2, 'member', 'active')",
    [other, owner.userId],
  )
  await signInWithTotp(page.request, owner)

  // the agency's Meta app and its system user, with the sample's profiles in place of the fake
  // Graph API's ones
  const { connectionId } = await connectedAgency(page.request, org, { importAccounts: false })
  // «Da ricollegare»: a profile whose connection stopped working (the agency's own still works)
  let expired: string | undefined
  const expiredConnection = async () => {
    expired ??= randomUUID()
    await adminQuery(
      `insert into account_connections (id, organization_id, kind, external_user_id, connected_by,
                                        token_enc, key_version, status)
       select $2::uuid, organization_id, kind, 'expired-' || $2::text, connected_by, token_enc,
              key_version,
              'expired'
         from account_connections where id = $1
       on conflict do nothing`,
      [connectionId, expired],
    )
    return expired
  }
  const clients: DesignSample['clients'] = {}
  const accounts: Record<string, Partial<Record<Platform, string>>> = {}
  for (const c of SAMPLE_CLIENTS) {
    const ws = await newWorkspace(page.request, org, c.name)
    clients[c.name] = ws
    const mine: Partial<Record<Platform, string>> = {}
    accounts[c.name] = mine
    for (const p of c.profiles) {
      const id = randomUUID()
      const externalId = String(Math.floor(Math.random() * 1e15))
      await adminQuery(
        `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                      page_id, connection_id, health, health_message, last_synced_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          org,
          p.platform,
          externalId,
          p.name,
          p.username ?? null,
          p.platform === 'facebook' ? externalId : null,
          p.broken ? await expiredConnection() : connectionId,
          'ok',
          null,
          DESIGN_NOW.toISOString(),
        ],
      )
      await adminQuery(
        'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
        [org, ws.id, id],
      )
      mine[p.platform] ??= id
    }
  }

  // two profiles found on Meta and in no client yet (screens 14 and 15)
  for (const o of ORPHANS)
    await adminQuery(
      `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                    page_id, connection_id, health, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'ok', $9)`,
      [
        randomUUID(),
        org,
        o.platform,
        o.externalId,
        o.name,
        o.username ?? null,
        o.platform === 'facebook' ? o.externalId : null,
        connectionId,
        DESIGN_NOW.toISOString(),
      ],
    )

  // the three photos, in every client that has a post with them
  const files: Record<string, Partial<Record<Photo, string>>> = {}
  const fileOf = async (client: string, name: Photo) => {
    files[client] ??= {}
    const known = files[client][name]
    if (known) return known
    const id = await libraryFile(org, clients[client]?.id ?? '', owner.userId, {
      kind: 'image',
      name: `${name}.jpg`,
      image: await photo(PHOTOS[name]),
    })
    await adminQuery('update media set width = 1080, height = 1350 where id = $1', [id])
    files[client][name] = id
    return id
  }

  const posts: DesignSample['posts'] = {}
  for (const p of SAMPLE_POSTS) {
    const ws = clients[p.client]
    if (!ws) continue
    const mediaIds = []
    for (const name of p.photos) mediaIds.push(await fileOf(p.client, name))
    const destinations = p.platforms
      .map((pl) => accounts[p.client]?.[pl])
      .filter((id): id is string => Boolean(id))
      .map((accountId) => ({ accountId }))
    const created = await send(
      page.request,
      'POST',
      `/api/v1/orgs/${org}/workspaces/${ws.id}/posts`,
      {
        type: p.type,
        caption: { common: p.caption },
        mediaIds,
        destinations,
        ...(p.at && {
          when: { localDate: p.at.slice(0, 10), localTime: p.at.slice(11, 16) },
        }),
      },
    )
    posts[p.caption] = created.id
    if (p.at) {
      // in place of «Programma», which refuses a time already gone: the post is scheduled
      await adminQuery('update posts set scheduled_at = $2 where id = $1', [
        created.id,
        romeInstant(p.at),
      ])
    }
    if (p.scheduled) {
      await adminQuery(
        "update posts set status = 'scheduled', scheduled_by = created_by where id = $1",
        [created.id],
      )
      await adminQuery("update post_targets set status = 'scheduled' where post_id = $1", [
        created.id,
      ])
    }
  }

  for (const m of TEAM) {
    const person = await addPerson(
      org,
      m.name,
      m.role,
      m.clients.map(([name, role]) => ({ workspaceId: clients[name]?.id ?? '', role })),
    )
    await adminQuery('update users set email = $2 where id = $1', [person.userId, m.email])
  }

  for (const c of SAMPLE_CLIENTS.filter((x) => x.archived))
    await adminQuery('update workspaces set archived_at = $2 where id = $1', [
      clients[c.name]?.id,
      DESIGN_NOW.toISOString(),
    ])

  return { owner, org, clients, posts }
}
