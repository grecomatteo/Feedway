import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  checkPost,
  type CheckPostDeps,
  type PostCheckInput,
  type PublishingHistory,
} from '@app/application'
import { DomainError, postFingerprint, type OrgActor, type WorkspaceRole } from '@app/domain'
import { createDb } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { PLATFORM_RULES } from '../runtime.js'
import { emptyPublishingHistory } from '../system/publishing-history.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, type TestDatabase } from '../testing/index.js'

// `checkPost` on the workspace's own rows (plan 05 Task 2): files and accounts read through
// the modules' public functions, the same «non disponibile» for whatever is not the
// workspace's, and nothing written.

const NOW = new Date('2026-11-17T10:00:00Z')
const TOMORROW = { mode: 'at', localDate: '2026-11-18', localTime: '18:00' } as const

let tdb: TestDatabase
let admin: pg.Client
let deps: CheckPostDeps
let org: string, other: string
let forno: string, gino: string, elsewhere: string, archived: string
const people: Record<'editor' | 'viewer' | 'outsider', string> = {
  editor: '',
  viewer: '',
  outsider: '',
}
let ig: string, fb: string, red: string, nearlyFull: string, full: string
let notAssigned: string, ofOther: string
let video: string, processing: string, corrected: string, inGino: string, inOther: string
let deleted: string, failed: string
let ownPost: string, othersPost: string, otherAgencyPost: string

const actor = (userId: string): OrgActor => ({
  userId,
  platformRole: null,
  organizationId: org,
  orgRole: 'member',
  memberships: new Map(),
})

async function connection(organizationId: string, by: string): Promise<string> {
  const id = randomUUID()
  await admin.query(
    `insert into account_connections (id, organization_id, kind, external_user_id, connected_by,
                                      token_enc, key_version, status)
     values ($1, $2, 'meta_system_user', $3, $4, 'v1.sealed', 1, 'active')`,
    [id, organizationId, randomUUID(), by],
  )
  return id
}

async function account(
  organizationId: string,
  connectionId: string,
  opts: {
    platform: 'instagram' | 'facebook'
    name: string
    health?: 'ok' | 'error'
    quota?: [number, number]
    workspace?: string
  },
): Promise<string> {
  const id = randomUUID()
  // a Page is its own pair (social_accounts_facebook_page)
  const externalId = randomUUID()
  await admin.query(
    `insert into social_accounts (id, organization_id, platform, external_id, page_id, name,
                                  connection_id, health, quota_used, quota_total, quota_checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      organizationId,
      opts.platform,
      externalId,
      opts.platform === 'facebook' ? externalId : null,
      opts.name,
      connectionId,
      opts.health ?? 'ok',
      opts.quota?.[0] ?? null,
      opts.quota?.[1] ?? null,
      opts.quota ? NOW : null,
    ],
  )
  if (opts.workspace)
    await admin.query(
      'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
      [organizationId, opts.workspace, id],
    )
  return id
}

const READY_VIDEO = {
  kind: 'video',
  format: 'mp4',
  sizeBytes: 40_000_000,
  width: 1080,
  height: 1920,
  durationMs: 20_000,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  faststart: true,
}

/** The worker's results on a seeded file. */
async function processed(
  mediaId: string,
  facts: { analysis?: unknown; checks?: unknown; sha256?: string },
) {
  await admin.query('update media set analysis = $2, checks = $3, sha256 = $4 where id = $1', [
    mediaId,
    JSON.stringify(facts.analysis ?? READY_VIDEO),
    JSON.stringify(facts.checks ?? { fixes: [], warnings: [] }),
    facts.sha256 ?? randomBytes(32).toString('hex'),
  ])
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  const db = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'check-post-test' }).db
  const logger = createLogger({ service: 'web', level: 'error' })
  deps = {
    uow: createUnitOfWork({ db, ids: uuidV7Generator, logger }),
    clock: fixedClock(NOW),
    platformRules: PLATFORM_RULES,
    publishingHistory: emptyPublishingHistory,
  }
  ;({ org, other, forno, gino, elsewhere, archived } = await seed(tdb.runtimeUrl, async (s) => {
    const o = await s.organization()
    const x = await s.organization()
    const f = await s.workspace(o, { name: 'Forno Luce' })
    const g = await s.workspace(o, { name: 'Pizzeria Da Gino' })
    const e = await s.workspace(x, { name: 'Bottega di un’altra agenzia' })
    const a = await s.workspace(o, { name: 'Vecchio cliente', archived: true })
    const roles: [keyof typeof people, WorkspaceRole | null][] = [
      ['editor', 'editor'],
      ['viewer', 'viewer'],
      ['outsider', null],
    ]
    for (const [key, role] of roles) {
      const user = await s.user()
      await s.member(o, user, 'member')
      if (role) await s.workspaceMember(o, f, user, role)
      if (role) await s.workspaceMember(o, a, user, role)
      people[key] = user
    }
    return { org: o, other: x, forno: f, gino: g, elsewhere: e, archived: a }
  }))
  const otherOwner = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user()
    await s.member(other, user, 'owner')
    return user
  })
  const post = async (
    organizationId: string,
    workspaceId: string,
    by: string,
    timezone = 'Europe/Rome',
  ) => {
    const id = randomUUID()
    await admin.query(
      `insert into posts (id, organization_id, workspace_id, type, options, timezone,
                          created_by, updated_by)
       values ($1, $2, $3, 'reel', '{"shareToFeed":true,"choices":[]}', $4, $5, $5)`,
      [id, organizationId, workspaceId, timezone, by],
    )
    return id
  }
  ownPost = await post(org, forno, people.editor, 'America/New_York')
  othersPost = await post(org, forno, people.viewer)
  otherAgencyPost = await post(other, elsewhere, otherOwner)
  const conn = await connection(org, people.editor)
  ig = await account(org, conn, { platform: 'instagram', name: 'forno.luce', workspace: forno })
  fb = await account(org, conn, { platform: 'facebook', name: 'Forno Luce', workspace: forno })
  red = await account(org, conn, {
    platform: 'instagram',
    name: 'forno.rosso',
    health: 'error',
    workspace: forno,
  })
  nearlyFull = await account(org, conn, {
    platform: 'instagram',
    name: 'forno.quasi',
    quota: [96, 100],
    workspace: forno,
  })
  full = await account(org, conn, {
    platform: 'instagram',
    name: 'forno.pieno',
    quota: [100, 100],
    workspace: forno,
  })
  notAssigned = await account(org, conn, {
    platform: 'instagram',
    name: 'pizzeria.gino',
    workspace: gino,
  })
  ofOther = await account(other, await connection(other, otherOwner), {
    platform: 'facebook',
    name: 'Bottega Segreta',
    workspace: elsewhere,
  })
  ;({ video, processing, corrected, inGino, inOther } = await seed(tdb.runtimeUrl, async (s) => {
    const by = people.editor
    return {
      video: await s.media(org, forno, { uploadedBy: by }),
      processing: await s.media(org, forno, { uploadedBy: by, status: 'processing' }),
      corrected: await s.media(org, forno, { uploadedBy: by }),
      inGino: await s.media(org, gino, { uploadedBy: by }),
      inOther: await s.media(other, elsewhere, { uploadedBy: otherOwner }),
    }
  }))
  await processed(video, { sha256: 'a'.repeat(64) })
  await processed(corrected, {
    checks: {
      fixes: [{ code: 'faststart' }],
      warnings: [{ code: 'convert_fps', fps: 30 }],
    },
  })
  await processed(inGino, {})
  await processed(inOther, {})
  deleted = await seed(tdb.runtimeUrl, (s) =>
    s.media(org, forno, { uploadedBy: people.editor, kind: 'image', status: 'deleted' }),
  )
  failed = await seed(tdb.runtimeUrl, (s) => s.media(org, forno, { uploadedBy: people.editor }))
  await admin.query(
    `update media set status = 'failed', failure = '{"code":"unreadable"}' where id = $1`,
    [failed],
  )
  // a tall photo: were it read, the feed's proportions would say its size
  await processed(deleted, {
    analysis: {
      kind: 'image',
      format: 'jpeg',
      sizeBytes: 2_000_000,
      width: 1080,
      height: 1920,
      colorSpace: 'srgb',
      hasMetadata: false,
    },
  })
}, 300_000)

afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

const reel = (over: Partial<PostCheckInput> = {}): PostCheckInput => ({
  workspaceId: forno,
  type: 'reel',
  mediaIds: [video],
  caption: { common: 'Il pane di oggi' },
  destinations: [{ accountId: ig }, { accountId: fb }],
  when: TOMORROW,
  shareToFeed: true,
  choices: [],
  ...over,
})

const codes = (report: Awaited<ReturnType<typeof checkPost>>) =>
  report.outcomes.map((o) => `${o.level} ${o.code} ${o.key}`).sort()

describe('who may check', () => {
  test('an Editor gets the summary of the post on the workspace’s accounts', async () => {
    const report = await checkPost(deps, actor(people.editor), reel())
    expect(report.outcomes).toEqual([])
    expect(report.canSchedule).toBe(true)
    expect(report.scheduledAt?.toISOString()).toBe('2026-11-18T17:00:00.000Z')
    expect(report.destinations).toEqual([
      expect.objectContaining({ accountId: ig, platform: 'instagram', format: 'reel', media: [0] }),
      expect.objectContaining({ accountId: fb, platform: 'facebook', format: 'reel', media: [0] }),
    ])
  })

  test.each([
    ['a Viewer', () => actor(people.viewer)],
    ['a member with no role in the workspace', () => actor(people.outsider)],
  ])('%s finds no workspace (404)', async (_who, who) => {
    await expect(checkPost(deps, who(), reel())).rejects.toMatchObject(
      new DomainError('NOT_FOUND', 'Spazio non trovato'),
    )
  })

  test('an archived client takes no post', async () => {
    await expect(
      checkPost(deps, actor(people.editor), reel({ workspaceId: archived })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  test('a workspace id that is not one is not found either', async () => {
    await expect(
      checkPost(deps, actor(people.editor), reel({ workspaceId: 'forno' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('what is not the workspace’s', () => {
  test.each([
    ['of another workspace', () => inGino],
    ['of another agency', () => inOther],
    ['that does not exist', () => randomUUID()],
  ])('a file %s is «non disponibile», with nothing of it', async (_where, id) => {
    const asked = id()
    const report = await checkPost(deps, actor(people.editor), reel({ mediaIds: [asked] }))
    expect(codes(report)).toEqual([`block media_unavailable media_unavailable:media:${asked}`])
    // the key repeats the id the caller sent, and nothing else tells it from a missing file
    const missing = randomUUID()
    const unknown = await checkPost(deps, actor(people.editor), reel({ mediaIds: [missing] }))
    expect(JSON.stringify(report).replaceAll(asked, '?')).toBe(
      JSON.stringify(unknown).replaceAll(missing, '?'),
    )
  })

  test('a file deleted from this workspace says no more than one of another agency', async () => {
    const report = await checkPost(
      deps,
      actor(people.editor),
      reel({ type: 'photo', mediaIds: [deleted], destinations: [{ accountId: ig }] }),
    )
    expect(codes(report)).toEqual([`block media_unavailable media_unavailable:media:${deleted}`])
    // ids may hold «1920» by chance: only the file's measures must not show
    const ids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    expect(JSON.stringify(report).replace(ids, '?')).not.toContain('1920')
  })

  test('an account of another workspace or agency: the same block, no platform nor name', async () => {
    const report = await checkPost(
      deps,
      actor(people.editor),
      reel({ destinations: [{ accountId: notAssigned }, { accountId: ofOther }] }),
    )
    expect(codes(report)).toEqual(
      [notAssigned, ofOther]
        .map((id) => `block account_unavailable account_unavailable:destination:${id}`)
        .sort(),
    )
    expect(report.destinations).toEqual([
      {
        accountId: notAssigned,
        platform: null,
        format: null,
        caption: '',
        media: [],
        fingerprint: null,
        outcomeKeys: [`account_unavailable:destination:${notAssigned}`],
      },
      {
        accountId: ofOther,
        platform: null,
        format: null,
        caption: '',
        media: [],
        fingerprint: null,
        outcomeKeys: [`account_unavailable:destination:${ofOther}`],
      },
    ])
    const text = JSON.stringify(report)
    for (const name of ['pizzeria.gino', 'Bottega Segreta', 'instagram', 'facebook'])
      expect(text).not.toContain(name)
  })
})

describe('the accounts', () => {
  test('a red account blocks; 96 of 100 posts warns; 100 of 100 blocks', async () => {
    const report = await checkPost(
      deps,
      actor(people.editor),
      // this evening: the quota Meta counted this morning still holds
      reel({
        destinations: [{ accountId: red }, { accountId: nearlyFull }, { accountId: full }],
        when: { mode: 'at', localDate: '2026-11-17', localTime: '18:00' },
      }),
    )
    expect(codes(report)).toEqual(
      [
        `block account_unhealthy account_unhealthy:destination:${red}`,
        `block quota_exhausted quota_exhausted:destination:${full}:instagram`,
        `warning quota_low quota_low:destination:${nearlyFull}:instagram`,
      ].sort(),
    )
    expect(report.outcomes.find((o) => o.code === 'quota_low')?.params).toEqual({
      left: 4,
      total: 100,
    })
  })
})

describe('the files', () => {
  test('a failed file blocks, with its reason', async () => {
    const report = await checkPost(deps, actor(people.editor), reel({ mediaIds: [failed] }))
    expect(codes(report)).toEqual([`block media_failed media_failed:media:${failed}`])
    expect(report.outcomes[0]?.params).toEqual({ reason: 'unreadable' })
  })

  test('a cover photo of another agency is «non disponibile», with nothing of it', async () => {
    const report = await checkPost(
      deps,
      actor(people.editor),
      reel({ cover: { source: 'image', mediaId: inOther }, destinations: [{ accountId: ig }] }),
    )
    expect(codes(report)).toEqual(['block media_unavailable media_unavailable:cover'])
    expect(JSON.stringify(report)).not.toContain(inOther)
  })

  test('a video of the workspace as the cover photo blocks, and nothing else of it is said', async () => {
    const report = await checkPost(
      deps,
      actor(people.editor),
      reel({ cover: { source: 'image', mediaId: corrected }, destinations: [{ accountId: ig }] }),
    )
    expect(codes(report)).toEqual(['block cover_not_image cover_not_image:cover'])
  })

  test('a file still being prepared blocks', async () => {
    const report = await checkPost(deps, actor(people.editor), reel({ mediaIds: [processing] }))
    expect(codes(report)).toEqual([`block media_processing media_processing:media:${processing}`])
  })

  test('the worker’s corrections and warnings of a ready file are reported', async () => {
    const report = await checkPost(deps, actor(people.editor), reel({ mediaIds: [corrected] }))
    expect(codes(report)).toEqual([
      `fix file_faststart file_faststart:media:${corrected}`,
      `warning file_convert_fps file_convert_fps:media:${corrected}`,
    ])
  })
})

describe('the history of the accounts', () => {
  test('a duplicate warns and the 30 reels of a Page block, on the workspace’s accounts only', async () => {
    const asked: { accountIds: readonly string[]; at: Date }[] = []
    const history: PublishingHistory = {
      forDestinations: (_tx, query) => {
        asked.push({ accountIds: query.accountIds, at: query.at })
        return Promise.resolve({
          recentFingerprints: new Map([
            [ig, new Set([postFingerprint(ig, ['a'.repeat(64)], 'Il pane di oggi')])],
          ]),
          reelsLast24h: new Map([[fb, 30]]),
          scheduledNear: new Map(),
        })
      },
    }
    const report = await checkPost(
      { ...deps, publishingHistory: history },
      actor(people.editor),
      reel({ destinations: [{ accountId: ig }, { accountId: fb }, { accountId: ofOther }] }),
    )
    expect(codes(report)).toEqual(
      [
        `block account_unavailable account_unavailable:destination:${ofOther}`,
        `block facebook_reels_limit facebook_reels_limit:destination:${fb}:facebook`,
        `warning duplicate_post duplicate_post:destination:${ig}:instagram`,
      ].sort(),
    )
    expect(asked.map((q) => ({ ...q, accountIds: [...q.accountIds].sort() }))).toEqual([
      { accountIds: [ig, fb].sort(), at: new Date('2026-11-18T17:00:00Z') },
    ])
  })
})

test('a saved choice its warning no longer offers is left out, not an error (D-54)', async () => {
  const key = `file_convert_fps:media:${corrected}`
  const report = await checkPost(
    deps,
    actor(people.editor),
    reel({ mediaIds: [corrected], choices: [{ key, option: 'skip_platform' }] }),
  )
  expect(report.invalidChoices).toEqual([{ key, option: 'skip_platform' }])
  expect(report.unresolved).toEqual([key])
})

test('a check writes nothing, not even the activity log', async () => {
  const count = async () =>
    (await admin.query<{ n: string }>('select count(*)::text as n from audit_log')).rows[0]?.n
  const before = await count()
  await checkPost(deps, actor(people.editor), reel())
  expect(await count()).toBe(before)
})

describe('a saved post (plan 06 Task 4)', () => {
  test('an Editor may not check the draft of another person (403)', async () => {
    await expect(
      checkPost(deps, actor(people.editor), reel({ postId: othersPost })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test.each([
    ['of another agency', () => otherAgencyPost],
    ['that does not exist', () => randomUUID()],
    ['whose id is not one', () => 'post'],
  ])('a post %s is not found (404)', async (_what, id) => {
    await expect(
      checkPost(deps, actor(people.editor), reel({ postId: id() })),
    ).rejects.toMatchObject(new DomainError('NOT_FOUND', 'Post non trovato'))
  })

  test('its own post: its time zone, and left out of its own history', async () => {
    const asked: (string | undefined)[] = []
    const history: PublishingHistory = {
      forDestinations: (tx, query) => {
        asked.push(query.excludePostId)
        return emptyPublishingHistory.forDestinations(tx, query)
      },
    }
    const report = await checkPost(
      { ...deps, publishingHistory: history },
      actor(people.editor),
      reel({ postId: ownPost }),
    )
    // 18:00 in New York, not in Rome
    expect(report.scheduledAt?.toISOString()).toBe('2026-11-18T23:00:00.000Z')
    expect(asked).toEqual([ownPost])
  })

  test('a past date blocks the editor, not the worker that publishes (purpose publish)', async () => {
    const past = { mode: 'at', localDate: '2026-11-16', localTime: '18:00' } as const
    const forEditor = await checkPost(deps, actor(people.editor), reel({ when: past }))
    expect(forEditor.outcomes.map((o) => o.code)).toContain('scheduled_in_past')
    const forWorker = await checkPost(
      deps,
      actor(people.editor),
      reel({ when: past, purpose: 'publish', postId: ownPost }),
    )
    expect(forWorker.outcomes.map((o) => o.code)).not.toContain('scheduled_in_past')
    expect(forWorker.canSchedule).toBe(true)
  })
})
