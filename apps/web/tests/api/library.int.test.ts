import { afterAll, beforeAll, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The library's folders and tags (plan 04 Task 12): nested folders of one workspace, a folder
// with files deleted only with a confirmation (its content goes up, no file is deleted), tags
// normalised, the filters of the list. Other agencies and every role: the battery and the matrix.

let env: ApiEnv
let org: { id: string; slug: string }
let editor: Person
let cookie = ''
let w1: string, w2: string, archived: string

interface Folder {
  id: string
  name: string
  parentId: string | null
  fileCount: number
}
interface Media {
  id: string
  folderId: string | null
  tags: string[]
}

const ws = (id: string) => `/api/v1/orgs/${org.slug}/workspaces/${id}`
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  env.call(method, path, body, { cookie })
async function json<T>(r: Response, status = 200): Promise<T> {
  const text = await r.text()
  expect(r.status, text).toBe(status)
  return JSON.parse(text) as T
}
const folder = async (workspaceId: string, name: string, parentId: string | null = null) =>
  json<Folder>(await call('POST', `${ws(workspaceId)}/folders`, { name, parentId }))
const file = (workspaceId: string, kind: 'image' | 'video' = 'video') =>
  seed(env.tdb.runtimeUrl, (s) => s.media(org.id, workspaceId, { uploadedBy: editor.userId, kind }))
const list = async (workspaceId: string, query = '') =>
  json<{ items: Media[]; tags: string[] }>(await call('GET', `${ws(workspaceId)}/media${query}`))

beforeAll(async () => {
  env = await startApiEnv('library')
  org = await env.agency()
  editor = await env.person(org.id, 'member')
  ;({ w1, w2, archived } = await seed(env.tdb.runtimeUrl, async (s) => {
    const ids = { w1: await s.workspace(org.id), w2: await s.workspace(org.id) }
    const old = await s.workspace(org.id)
    for (const w of [ids.w1, ids.w2, old])
      await s.workspaceMember(org.id, w, editor.userId, 'editor')
    return { ...ids, archived: old }
  }))
  await env.admin.pool.query('update workspaces set archived_at = now() where id = $1', [archived])
  cookie = await env.signIn(editor)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('folders nest, are listed by name and count the files right inside them', async () => {
  const top = await folder(w1, '  Natale   2026 ')
  expect(top).toMatchObject({ name: 'Natale 2026', parentId: null, fileCount: 0 })
  const inner = await folder(w1, 'Vetrina', top.id)
  const id = await file(w1)
  await json(await call('PATCH', `${ws(w1)}/media/${id}`, { folderId: inner.id }))
  const { items } = await json<{ items: Folder[] }>(await call('GET', `${ws(w1)}/folders`))
  expect(items.find((f) => f.id === inner.id)).toMatchObject({ parentId: top.id, fileCount: 1 })
  expect(items.find((f) => f.id === top.id)?.fileCount).toBe(0)
})

test('two folders side by side never share a name, whatever the case', async () => {
  await folder(w1, 'Doppione')
  const r = await call('POST', `${ws(w1)}/folders`, { name: 'DOPPIONE', parentId: null })
  expect(r.status).toBe(409)
  // inside another folder the same name is fine
  const parent = await folder(w1, 'Contenitore')
  await folder(w1, 'Doppione', parent.id)
})

test('a folder never goes inside itself, nor deeper than five levels', async () => {
  const a = await folder(w2, 'A')
  const b = await folder(w2, 'B', a.id)
  const loop = await call('PATCH', `${ws(w2)}/folders/${a.id}`, { parentId: b.id })
  expect(loop.status).toBe(422)
  let parent = b.id
  for (const name of ['C', 'D', 'E']) parent = (await folder(w2, name, parent)).id
  const sixth = await call('POST', `${ws(w2)}/folders`, { name: 'F', parentId: parent })
  expect(sixth.status).toBe(422)
  // renamed and moved to the top
  const moved = await json<Folder>(
    await call('PATCH', `${ws(w2)}/folders/${b.id}`, { name: 'B spostata', parentId: null }),
  )
  expect(moved).toMatchObject({ name: 'B spostata', parentId: null })
})

test('the folders of another workspace are not used', async () => {
  const other = await folder(w2, 'Di un altro cliente')
  const id = await file(w1)
  const move = await call('PATCH', `${ws(w1)}/media/${id}`, { folderId: other.id })
  expect(move.status).toBe(404)
  const inside = await call('POST', `${ws(w1)}/folders`, { name: 'Dentro', parentId: other.id })
  expect(inside.status).toBe(404)
  expect((await call('PATCH', `${ws(w1)}/folders/${other.id}`, { name: 'X' })).status).toBe(404)
  expect((await call('DELETE', `${ws(w1)}/folders/${other.id}`)).status).toBe(404)
  const listed = await list(w1, `?folder=${other.id}`)
  expect(listed.items).toEqual([])
})

test('a folder with files is not deleted without a confirmation; with it, its content goes up', async () => {
  const parent = await folder(w1, 'Sopra')
  const doomed = await folder(w1, 'Da togliere', parent.id)
  const child = await folder(w1, 'Figlia', doomed.id)
  const id = await file(w1)
  await json(await call('PATCH', `${ws(w1)}/media/${id}`, { folderId: doomed.id }))

  const refused = await call('DELETE', `${ws(w1)}/folders/${doomed.id}`)
  expect(refused.status).toBe(409)

  await json(await call('DELETE', `${ws(w1)}/folders/${doomed.id}?confirm=true`))
  const { items } = await json<{ items: Folder[] }>(await call('GET', `${ws(w1)}/folders`))
  expect(items.some((f) => f.id === doomed.id)).toBe(false)
  expect(items.find((f) => f.id === child.id)?.parentId).toBe(parent.id)
  const moved = await json<Media>(await call('GET', `${ws(w1)}/media/${id}`))
  expect(moved.folderId).toBe(parent.id)
})

test('an empty folder is deleted at once', async () => {
  const empty = await folder(w1, 'Vuota')
  await json(await call('DELETE', `${ws(w1)}/folders/${empty.id}`))
})

test('tags are normalised, and the list filters by tag, kind, folder and name together', async () => {
  const f = await folder(w2, 'Filtri')
  const photo = await file(w2, 'image')
  const clip = await file(w2, 'video')
  const tagged = await json<Media>(
    await call('PATCH', `${ws(w2)}/media/${photo}`, {
      tags: [' Natale ', 'natale', 'Pane  fresco'],
      folderId: f.id,
    }),
  )
  expect(tagged).toMatchObject({ tags: ['natale', 'pane fresco'], folderId: f.id })
  await json(await call('PATCH', `${ws(w2)}/media/${clip}`, { tags: ['natale'] }))

  const byTag = await list(w2, '?tag=Natale')
  expect(byTag.items.map((m) => m.id).sort()).toEqual([photo, clip].sort())
  expect(byTag.tags).toEqual(expect.arrayContaining(['natale', 'pane fresco']))
  expect((await list(w2, '?tag=natale&kind=image')).items.map((m) => m.id)).toEqual([photo])
  expect((await list(w2, `?folder=${f.id}`)).items.map((m) => m.id)).toEqual([photo])
  const none = (await list(w2, '?folder=none&tag=natale')).items.map((m) => m.id)
  expect(none).toEqual([clip])
  // the seeded photo is «foto.heic»; `%` and `_` are taken literally
  expect((await list(w2, '?q=FOTO&tag=natale')).items.map((m) => m.id)).toEqual([photo])
  expect((await list(w2, '?q=%25')).items).toEqual([])
})

test('a file holds at most 20 tags; one with a control character is refused', async () => {
  const id = await file(w1)
  const many = Array.from({ length: 21 }, (_, i) => `t${String(i)}`)
  expect((await call('PATCH', `${ws(w1)}/media/${id}`, { tags: many })).status).toBe(422)
  expect((await call('PATCH', `${ws(w1)}/media/${id}`, { tags: ['a\u0007'] })).status).toBe(422)
})

test("an archived client's library is read only", async () => {
  const r = await call('POST', `${ws(archived)}/folders`, { name: 'No', parentId: null })
  expect(r.status).toBe(409)
  expect((await call('GET', `${ws(archived)}/folders`)).status).toBe(200)
})

test("the agency's settings show the space its files take", async () => {
  const owner = await env.person(org.id, 'owner')
  const ownerCookie = await env.strongSignIn(owner)
  const r = await env.call('GET', `/api/v1/orgs/${org.slug}/settings`, undefined, {
    cookie: ownerCookie,
  })
  const settings = await json<{ storage: { usedBytes: number; limitBytes: number | null } }>(r)
  // the seeded files' originals, 1000 bytes each
  expect(settings.storage.usedBytes).toBeGreaterThanOrEqual(1000)
  expect(settings.storage.limitBytes).toBeNull()
})

test('two moves at once never make a loop', async () => {
  const a = await folder(w2, 'Gara A')
  const b = await folder(w2, 'Gara B')
  const [one, two] = await Promise.all([
    call('PATCH', `${ws(w2)}/folders/${a.id}`, { parentId: b.id }),
    call('PATCH', `${ws(w2)}/folders/${b.id}`, { parentId: a.id }),
  ])
  expect([one.status, two.status].sort()).toEqual([200, 422])
})
