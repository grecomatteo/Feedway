import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'

// The media tables (plan 04 Task 8): row level security and the composite keys that keep a
// file, its copies, its folder and its upload inside one agency and one workspace.

const TABLES = ['media', 'media_variants', 'library_folders', 'library_items', 'upload_sessions']

let tdb: TestDatabase
let orgA: string, orgB: string, wsA: string, wsA2: string, userA: string
let mediaA: string, folderA: string

type Fn<T> = (c: pg.Client) => Promise<T>
const inOrg = <T>(organizationId: string, fn: Fn<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'organization', organizationId }, fn)
const asSystem = <T>(fn: Fn<T>) => withScope(tdb.runtimeUrl, { kind: 'system' }, fn)

const insertMedia = (
  c: pg.Client,
  organizationId: string,
  workspaceId: string,
  id = randomUUID(),
) =>
  c.query(
    `insert into media (id, organization_id, workspace_id, uploaded_by, kind, original_name, mime,
                        size_bytes)
     values ($1, $2, $3, $4, 'image', 'foto.jpg', 'image/jpeg', 10)`,
    [id, organizationId, workspaceId, userA],
  )
const insertVariant = (c: pg.Client, organizationId: string, mediaId: string, over = {}) => {
  const v = { purpose: 'ig_feed', token: null as string | null, ...over }
  return c.query(
    `insert into media_variants (id, organization_id, media_id, purpose, storage_key, public_token,
                                 mime, size_bytes)
     values ($1, $2, $3, $4, 'org/x/media/y/ig_feed.jpg', $5, 'image/jpeg', 10)`,
    [randomUUID(), organizationId, mediaId, v.purpose, v.token],
  )
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  ;({ orgA, orgB, wsA, wsA2, userA, mediaA, folderA } = await seed(tdb.runtimeUrl, async (s) => {
    const orgA = await s.organization()
    const orgB = await s.organization()
    const userA = await s.user()
    await s.member(orgA, userA, 'member')
    const wsA = await s.workspace(orgA)
    const wsA2 = await s.workspace(orgA)
    await s.workspace(orgB)
    const mediaA = await s.media(orgA, wsA, {
      uploadedBy: userA,
      variants: [
        { purpose: 'preview', storageKey: 'org/a/preview.mp4', mime: 'video/mp4', sizeBytes: 5 },
      ],
    })
    return { orgA, orgB, wsA, wsA2, userA, mediaA, folderA: randomUUID() }
  }))
  await asSystem(async (c) => {
    await c.query(
      `insert into library_folders (id, organization_id, workspace_id, name)
       values ($1, $2, $3, 'Estate')`,
      [folderA, orgA, wsA],
    )
    await c.query(
      `insert into upload_sessions (id, organization_id, workspace_id, user_id, original_name, mime,
                                    size_bytes, first_part_sha256, expires_at)
       values ($1, $2, $3, $4, 'clip.mov', 'video/quicktime', 100, repeat('a', 64),
               now() + interval '1 day')`,
      [randomUUID(), orgA, wsA, userA],
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
    expect((await inOrg(orgA, (c) => c.query(`select * from ${t}`))).rowCount, t).toBe(1)
})

test('agency B cannot write rows that name agency A, nor A move its rows into B', async () => {
  await expect(inOrg(orgB, (c) => insertMedia(c, orgA, wsA))).rejects.toThrow(/row-level security/)
  await expect(inOrg(orgB, (c) => insertVariant(c, orgA, mediaA))).rejects.toThrow(
    /row-level security/,
  )
  for (const t of TABLES)
    await expect(
      inOrg(orgA, (c) => c.query(`update ${t} set organization_id = $1`, [orgB])),
      t,
    ).rejects.toThrow(/row-level security|foreign key/)
})

test('a file, its folder and its library entry stay in one workspace', async () => {
  // a file in a workspace of another agency
  const wsB = await asSystem(
    async (c) =>
      (
        await c.query<{ id: string }>('select id from workspaces where organization_id = $1', [
          orgB,
        ])
      ).rows[0]?.id ?? '',
  )
  await expect(asSystem((c) => insertMedia(c, orgA, wsB))).rejects.toThrow(/media_workspace_fk/)
  // the library entry of A's file, put in another workspace of A, or in a folder of another one
  const other = randomUUID()
  await asSystem((c) => insertMedia(c, orgA, wsA2, other))
  await expect(
    asSystem((c) =>
      c.query(
        'insert into library_items (organization_id, workspace_id, media_id) values ($1, $2, $3)',
        [orgA, wsA, other],
      ),
    ),
  ).rejects.toThrow(/library_items_media_fk/)
  await expect(
    asSystem((c) =>
      c.query(
        `insert into library_items (organization_id, workspace_id, media_id, folder_id)
         values ($1, $2, $3, $4)`,
        [orgA, wsA2, other, folderA],
      ),
    ),
  ).rejects.toThrow(/library_items_folder_fk/)
  // a sub-folder under a folder of another workspace
  await expect(
    asSystem((c) =>
      c.query(
        `insert into library_folders (id, organization_id, workspace_id, name, parent_id)
         values ($1, $2, $3, 'Sotto', $4)`,
        [randomUUID(), orgA, wsA2, folderA],
      ),
    ),
  ).rejects.toThrow(/library_folders_parent_fk/)
})

test('the preview is never public, and a public token is unique and 32 characters', async () => {
  const token = 'aB3-_'.repeat(6) + 'xY'
  await expect(
    asSystem((c) => insertVariant(c, orgA, mediaA, { purpose: 'cover', token: 'corto' })),
  ).rejects.toThrow(/media_variants_public_token/)
  // mediaA has its preview already: a second one is refused too
  await expect(
    asSystem((c) =>
      insertVariant(c, orgA, mediaA, { purpose: 'thumbnail', token: 'x'.repeat(33) }),
    ),
  ).rejects.toThrow(/media_variants_public_token/)
  const media2 = randomUUID()
  await asSystem((c) => insertMedia(c, orgA, wsA, media2))
  await expect(
    asSystem((c) => insertVariant(c, orgA, media2, { purpose: 'preview', token })),
  ).rejects.toThrow(/media_variants_preview_private/)
  await asSystem((c) => insertVariant(c, orgA, media2, { purpose: 'ig_feed', token }))
  await expect(
    asSystem((c) => insertVariant(c, orgA, mediaA, { purpose: 'ig_feed', token })),
  ).rejects.toThrow(/media_variants_token_unique/)
  // one variant per purpose
  await expect(
    asSystem((c) => insertVariant(c, orgA, media2, { purpose: 'ig_feed' })),
  ).rejects.toThrow(/media_variants_one_per_purpose/)
})

test('a deleted file has its time, and only a deleted file has one', async () => {
  await expect(
    asSystem((c) => c.query(`update media set status = 'deleted' where id = $1`, [mediaA])),
  ).rejects.toThrow(/media_deleted/)
  await expect(
    asSystem((c) => c.query(`update media set deleted_at = now() where id = $1`, [mediaA])),
  ).rejects.toThrow(/media_deleted/)
})
