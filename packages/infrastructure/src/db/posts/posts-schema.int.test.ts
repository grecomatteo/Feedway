import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'

// The tables of the posts (plan 06 Task 3): row level security, and the composite keys that keep
// a post, its files, its labels and its notes inside one workspace, and its accounts inside the
// agency.

const TABLES = [
  'posts',
  'post_media',
  'post_targets',
  'labels',
  'post_labels',
  'post_notes',
  'caption_templates',
  'account_groups',
]

let tdb: TestDatabase
let orgA: string, orgB: string, wsA: string, wsA2: string, userA: string
let mediaA: string, mediaA2: string, accountA: string, accountB: string, postA: string
const labelA2: string = randomUUID()

type Fn<T> = (c: pg.Client) => Promise<T>
const inOrg = <T>(organizationId: string, fn: Fn<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'organization', organizationId }, fn)
const asSystem = <T>(fn: Fn<T>) => withScope(tdb.runtimeUrl, { kind: 'system' }, fn)

const insertPost = (
  c: pg.Client,
  organizationId: string,
  workspaceId: string,
  id: string = randomUUID(),
) =>
  c.query(
    `insert into posts (id, organization_id, workspace_id, type, options, created_by, updated_by)
     values ($1, $2, $3, 'photo', '{"shareToFeed":true,"choices":[]}', $4, $4)`,
    [id, organizationId, workspaceId, userA],
  )

beforeAll(async () => {
  tdb = await startTestDatabase()
  ;({ orgA, orgB, wsA, wsA2, userA, mediaA, mediaA2, accountA, accountB } = await seed(
    tdb.runtimeUrl,
    async (s) => {
      const orgA = await s.organization()
      const orgB = await s.organization()
      const userA = await s.user()
      await s.member(orgA, userA, 'member')
      const wsA = await s.workspace(orgA)
      const wsA2 = await s.workspace(orgA)
      const wsB = await s.workspace(orgB)
      return {
        orgA,
        orgB,
        wsA,
        wsA2,
        userA,
        mediaA: await s.media(orgA, wsA, { uploadedBy: userA, kind: 'image' }),
        mediaA2: await s.media(orgA, wsA2, { uploadedBy: userA, kind: 'image' }),
        accountA: await s.account(orgA, { workspaceIds: [wsA] }),
        accountB: await s.account(orgB, { workspaceIds: [wsB] }),
      }
    },
  ))
  postA = randomUUID()

  await asSystem(async (c) => {
    await insertPost(c, orgA, wsA, postA)
    const labelA = randomUUID()
    await c.query(
      `insert into post_media (organization_id, workspace_id, post_id, position, media_id)
       values ($1, $2, $3, 0, $4)`,
      [orgA, wsA, postA, mediaA],
    )
    await c.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), orgA, wsA, postA, accountA],
    )
    await c.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, 'Promo', 'verde'), ($4, $2, $5, 'Altro', 'blu')`,
      [labelA, orgA, wsA, labelA2, wsA2],
    )
    await c.query(
      `insert into post_labels (organization_id, workspace_id, post_id, label_id)
       values ($1, $2, $3, $4)`,
      [orgA, wsA, postA, labelA],
    )
    await c.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       values ($1, $2, $3, $4, $5, 'Controllare il prezzo')`,
      [randomUUID(), orgA, wsA, postA, userA],
    )
    await c.query(
      `insert into caption_templates (id, organization_id, workspace_id, kind, name, body)
       values ($1, $2, $3, 'signature', 'Firma', '— Il forno')`,
      [randomUUID(), orgA, wsA],
    )
    await c.query(
      `insert into account_groups (id, organization_id, workspace_id, name, account_ids)
       values ($1, $2, $3, 'Solo IG', array[$4]::uuid[])`,
      [randomUUID(), orgA, wsA, accountA],
    )
  })
}, 120_000)

afterAll(async () => {
  await tdb.stop()
})

test('the rows of agency A are out of reach from agency B, from a person and without context', async () => {
  const scopes: ((fn: Fn<pg.QueryResult>) => Promise<pg.QueryResult>)[] = [
    (fn) => inOrg(orgB, fn),
    (fn) => withScope(tdb.runtimeUrl, { kind: 'user', userId: userA }, fn),
    (fn) => withScope(tdb.runtimeUrl, { kind: 'none' }, fn),
  ]
  for (const scope of scopes)
    for (const t of TABLES) {
      expect((await scope((c) => c.query(`select * from ${t}`))).rowCount, t).toBe(0)
      expect((await scope((c) => c.query(`update ${t} set updated_at = now()`))).rowCount, t).toBe(
        0,
      )
      expect((await scope((c) => c.query(`delete from ${t}`))).rowCount, t).toBe(0)
    }
  for (const t of TABLES)
    expect(
      (await inOrg(orgA, (c) => c.query(`select * from ${t}`))).rowCount,
      t,
    ).toBeGreaterThanOrEqual(1)
})

test('agency B cannot write rows that name agency A, nor A move its rows into B', async () => {
  await expect(inOrg(orgB, (c) => insertPost(c, orgA, wsA))).rejects.toThrow(/row-level security/)
  for (const t of TABLES)
    await expect(
      inOrg(orgA, (c) => c.query(`update ${t} set organization_id = $1`, [orgB])),
      t,
    ).rejects.toThrow(/row-level security|foreign key/)
})

test('a post takes only files and labels of its own workspace', async () => {
  const insertFile = (mediaId: string, column = 'media_id') =>
    inOrg(orgA, (c) =>
      c.query(
        `insert into post_media (organization_id, workspace_id, post_id, position, ${column === 'media_id' ? 'media_id' : `media_id, ${column}`})
         values ($1, $2, $3, 5, ${column === 'media_id' ? '$4' : '$5, $4'})`,
        column === 'media_id' ? [orgA, wsA, postA, mediaId] : [orgA, wsA, postA, mediaId, mediaA],
      ),
    )
  // a file of another workspace of the same agency, as a file and as a cover
  await expect(insertFile(mediaA2)).rejects.toThrow(/post_media_media_fk/)
  await expect(insertFile(mediaA2, 'cover_media_id')).rejects.toThrow(/post_media_cover_fk/)
  // a label of another workspace
  await expect(
    inOrg(orgA, (c) =>
      c.query(
        `insert into post_labels (organization_id, workspace_id, post_id, label_id)
         values ($1, $2, $3, $4)`,
        [orgA, wsA, postA, labelA2],
      ),
    ),
  ).rejects.toThrow(/post_labels_label_fk/)
  // a post that claims another workspace than its own files
  await expect(
    inOrg(orgA, (c) =>
      c.query(
        `insert into post_media (organization_id, workspace_id, post_id, position, media_id)
         values ($1, $2, $3, 6, $4)`,
        [orgA, wsA2, postA, mediaA2],
      ),
    ),
  ).rejects.toThrow(/post_media_post_fk/)
})

test('a destination takes any account of the agency, never one of another agency', async () => {
  const insertTarget = (accountId: string) =>
    inOrg(orgA, (c) =>
      c.query(
        `insert into post_targets (id, organization_id, workspace_id, post_id, account_id)
         values ($1, $2, $3, $4, $5)`,
        [randomUUID(), orgA, wsA, postA, accountId],
      ),
    )
  await expect(insertTarget(accountB)).rejects.toThrow(/post_targets_account_fk/)
  // the same account twice on one post
  await expect(insertTarget(accountA)).rejects.toThrow(/post_targets_post_account/)
})

test('the checks keep the values inside their lists', async () => {
  await expect(
    inOrg(orgA, (c) => c.query(`update posts set status = 'published' where id = $1`, [postA])),
  ).rejects.toThrow(/posts_status/)
  // a scheduled post has a date
  await expect(
    inOrg(orgA, (c) => c.query(`update posts set status = 'scheduled' where id = $1`, [postA])),
  ).rejects.toThrow(/posts_scheduled_has_date/)
  await expect(
    inOrg(orgA, (c) =>
      c.query(`update post_targets set fingerprint = 'abc' where post_id = $1`, [postA]),
    ),
  ).rejects.toThrow(/post_targets_fingerprint/)
  await expect(inOrg(orgA, (c) => c.query(`update labels set color = '#ff0000'`))).rejects.toThrow(
    /labels_color/,
  )
  // one name per workspace, whatever its case
  await expect(
    inOrg(orgA, (c) =>
      c.query(
        `insert into labels (id, organization_id, workspace_id, name, color)
         values ($1, $2, $3, 'PROMO', 'blu')`,
        [randomUUID(), orgA, wsA],
      ),
    ),
  ).rejects.toThrow(/labels_workspace_name/)
  await expect(
    inOrg(orgA, (c) => c.query(`update caption_templates set kind = 'emoji'`)),
  ).rejects.toThrow(/caption_templates_kind/)
})

test('deleting a post takes its files, destinations, labels and notes with it', async () => {
  const id = randomUUID()
  await inOrg(orgA, async (c) => {
    await insertPost(c, orgA, wsA, id)
    await c.query(
      `insert into post_media (organization_id, workspace_id, post_id, position, media_id)
       values ($1, $2, $3, 0, $4)`,
      [orgA, wsA, id, mediaA],
    )
    await c.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       values ($1, $2, $3, $4, $5, 'x')`,
      [randomUUID(), orgA, wsA, id, userA],
    )
    await c.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id)
       values ($1, $2, $3, $4, $5)`,
      [randomUUID(), orgA, wsA, id, accountA],
    )
    const label = randomUUID()
    await c.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, 'Da cancellare', 'viola')`,
      [label, orgA, wsA],
    )
    await c.query(
      `insert into post_labels (organization_id, workspace_id, post_id, label_id)
       values ($1, $2, $3, $4)`,
      [orgA, wsA, id, label],
    )
    await c.query('delete from posts where id = $1', [id])
    for (const t of ['post_media', 'post_notes', 'post_targets', 'post_labels'])
      expect((await c.query(`select 1 from ${t} where post_id = $1`, [id])).rowCount, t).toBe(0)
  })
})
