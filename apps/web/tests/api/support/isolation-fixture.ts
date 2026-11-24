import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { apiRoutes } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import { createLocalDiskStorage } from '@app/infrastructure'
import { seed, transparentLogoPng } from '@app/infrastructure/testing'
import { META_MOCK } from '@app/meta-mock'
import { PASSWORD, startApiEnv } from '../identity-env.js'
import type { ApiEnv, Person } from '../identity-env.js'

// The isolation battery (Task 21): two agencies, the people of the matrix and the samples that
// turn every route of the registry into a request. Everything is keyed by `METHOD path` of the
// registry: a route added later without a sample makes the battery fail, never skip.

export const ACTOR_ROLES = ['owner', 'admin', 'manager', 'publisher', 'editor', 'viewer'] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]
const WORKSPACE_ROLES = ['manager', 'publisher', 'editor', 'viewer'] as const

export const routeKey = (route: Pick<ApiContract, 'method' | 'path'>) =>
  `${route.method} ${route.path}`

export function routeByKey(key: string): ApiContract {
  const route = apiRoutes.find((r) => routeKey(r) === key)
  if (!route) throw new Error(`no route ${key} in the registry`)
  return route
}

/** The ids a request of the battery may need, all of one agency. */
export interface SampleIds {
  org: string
  /** a workspace of the agency */
  workspace: string
  /** a Member of the agency with a role in `workspace` (and one more workspace) */
  target: string
  /** a Member of the agency in no workspace of the case */
  newcomer: string
  /** an active Admin of the agency with a passkey */
  admin: string
  /** an email nobody uses */
  email: string
  /** an open invite of the agency into `workspace`, sent by A's Manager (B's Owner in B) */
  invite: string
  /** the agency's system user connection, on the fake Graph API */
  connection: string
  /** an active social account of the agency, of `connection`, in no workspace */
  account: string
  /** a ready video of `workspace`, in its library, with its `preview` stored */
  media: string
  /** an open upload into `workspace` of the agency's Owner, nothing received yet */
  upload: string
  /** an empty folder of `workspace`'s library */
  folder: string
  /** a draft of `workspace` written by `target`, with nothing in it yet, at version 1 */
  post: string
  /** a label of `workspace`, on no post */
  label: string
  /** a caption template of `workspace` */
  template: string
  /** an account group of `workspace`, with `account` in it */
  group: string
  /** a note of `target` on `post` */
  note: string
}

/** The file of every upload route: a small logo, which the Owner's upload accepts. */
const SAMPLE_UPLOAD = await transparentLogoPng(120, 40)

/** The bytes of every case's video preview (not a real video: nothing decodes it). */
export const SAMPLE_PREVIEW = Buffer.from('\0\0\0\x18ftypmp42anteprima della batteria')

/** The one piece of every upload of the battery: the start of an MP4, so it is taken. */
export const SAMPLE_PART = Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0mp42isompezzo della batteria')
const SAMPLE_PART_SHA256 = createHash('sha256').update(SAMPLE_PART).digest('hex')

/** The headers a piece goes with: its sha-256 (RFC 9530). */
export const SAMPLE_PART_HEADERS = {
  'content-digest': `sha-256=:${createHash('sha256').update(SAMPLE_PART).digest('base64')}:`,
}

/** The body that starts an upload of SAMPLE_PART. */
export const sampleUploadStart = () => ({
  name: 'video della batteria.mp4',
  type: 'video/mp4',
  sizeBytes: SAMPLE_PART.length,
  firstPartSha256: SAMPLE_PART_SHA256,
  folderId: null,
})

/** A multipart body with one file, as the panel sends it. */
export function uploadForm(bytes: Buffer = SAMPLE_UPLOAD, name = 'logo.png'): FormData {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), name)
  return form
}

/** A valid body for every route that takes one; checked against the route's own schema. */
const SAMPLE_BODIES: Record<string, (ids: SampleIds) => unknown> = {
  'POST /api/v1/auth/reauth': () => ({ password: PASSWORD }),
  'POST /api/v1/links/{token}/activate': () => ({ name: 'Persona Nuova', password: null }),
  'POST /api/v1/security/lock': () => ({ token: 'link-non-valido' }),
  'POST /api/v1/email-change/confirm': () => ({ token: 'link-non-valido' }),
  'PATCH /api/v1/me': () => ({ theme: 'dark' }),
  // the notification centre's choices (plan 08 Task 6): the person's own
  'PUT /api/v1/me/notifications/preferences': () => ({
    minLevel: 'warning',
    quietHours: null,
    digest: { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5], channels: ['email'] },
    everythingEverywhere: false,
  }),
  'PUT /api/v1/me/notifications/preferences/kinds': () => ({
    kind: 'post.confirmed',
    channels: ['panel'],
  }),
  'POST /api/v1/me/password': () => ({ password: PASSWORD }),
  // a preview nobody uploaded: the personal battery crops a real one of the caller
  'POST /api/v1/me/avatar/crop': () => ({ stagingId: randomUUID(), x: 0, y: 0, size: 64 }),
  'PATCH /api/v1/orgs/{org}/settings': () => ({ name: 'Agenzia della batteria' }),
  // a preview nobody uploaded: the matrix uploads one for the Owner's case
  'POST /api/v1/orgs/{org}/logo/confirm': () => ({ stagingId: randomUUID() }),
  // the fake Graph API's app (META_MODE=mock): the Owner's save succeeds
  'PUT /api/v1/orgs/{org}/integrations/meta': () => ({
    appId: META_MOCK.app.id,
    appSecret: META_MOCK.app.secret,
  }),
  // the fake Graph API's system user (META_MODE=mock): a fake token, never a real one
  'POST /api/v1/orgs/{org}/connections/system-user': () => ({
    token: META_MOCK.tokens.systemUser,
  }),
  // a page the system user always sees (me/accounts), with or without the business id
  // also into the case's client («Aggiungi a un cliente esistente»): a client of the other agency
  // must not be found
  'POST /api/v1/orgs/{org}/connections/{connectionId}/import': (ids) => ({
    externalIds: [META_MOCK.pages.withInstagram],
    assignTo: [{ workspaceId: ids.workspace, externalIds: [META_MOCK.pages.withInstagram] }],
  }),
  // the case's client and account: the client of the other agency is not found
  'POST /api/v1/orgs/{org}/workspaces/{id}/accounts/replace': (ids) => ({
    remove: [ids.account],
    add: [],
  }),
  // the case's client and account: either one of the other agency is not found
  'POST /api/v1/orgs/{org}/workspaces/import-undo': (ids) => ({
    workspaceIds: [ids.workspace],
    assignments: [{ workspaceId: ids.workspace, accountId: ids.account }],
  }),
  'POST /api/v1/orgs/{org}/invites': (ids) => ({
    email: ids.email,
    orgRole: 'member',
    memberships: [{ workspaceId: ids.workspace, role: 'viewer' }],
  }),
  'PUT /api/v1/orgs/{org}/members/{userId}/role': () => ({ role: 'admin' }),
  'POST /api/v1/orgs/{org}/ownership-transfer': (ids) => ({ userId: ids.admin }),
  'POST /api/v1/orgs/{org}/workspaces': () => ({ name: 'Spazio della batteria' }),
  'PATCH /api/v1/orgs/{org}/workspaces/{id}': () => ({ name: 'Spazio rinominato' }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/members': (ids) => ({
    userId: ids.newcomer,
    role: 'viewer',
  }),
  'PUT /api/v1/orgs/{org}/workspaces/{id}/members/{userId}': () => ({ role: 'editor' }),
  'PUT /api/v1/platform/mail-settings': () => ({
    host: 'smtp.feedway.test',
    port: 587,
    username: 'invii@feedway.test',
    from: 'avvisi@feedway.test',
    password: 'parola-della-batteria',
  }),
  'POST /api/v1/platform/mail-settings/test': () => ({ to: 'prova@feedway.test' }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/uploads': sampleUploadStart,
  // inside the case's folder: a folder of the other agency must not be found
  'POST /api/v1/orgs/{org}/workspaces/{id}/folders': (ids) => ({
    name: `Cartella ${randomUUID().slice(0, 8)}`,
    parentId: ids.folder,
  }),
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/folders/{folderId}': () => ({
    name: `Rinominata ${randomUUID().slice(0, 8)}`,
  }),
  // the case's file and account (the account is in no workspace: «non disponibile»). Ids of
  // the other agency in the body are not a 404 but the same block, with nothing of theirs
  // (cross-organization.int.test.ts, BODY_IDS_AS_OUTCOMES)
  'POST /api/v1/orgs/{org}/workspaces/{id}/post-checks': (ids) => ({
    type: 'reel',
    mediaIds: [ids.media],
    caption: { common: 'Il pane di oggi' },
    destinations: [{ accountId: ids.account }],
    when: { mode: 'now' },
    choices: [],
  }),
  // into the case's folder: a folder of the other agency must not be found
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/media/{mediaId}': (ids) => ({
    folderId: ids.folder,
    tags: ['batteria'],
  }),
  // the case's file: a file of the other agency must not be found
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts': (ids) => ({
    type: 'reel',
    mediaIds: [ids.media],
    caption: { common: 'Il pane di oggi' },
  }),
  // the case's file and label: either one of the other agency must not be found
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}': (ids) => ({
    version: 1,
    mediaIds: [ids.media],
    caption: { common: 'Il pane di domani' },
    labelIds: [ids.label],
  }),
  // the content settings of the client and the notes of a post (plan 06 Task 7)
  'POST /api/v1/orgs/{org}/workspaces/{id}/labels': () => ({
    name: `Etichetta ${randomUUID().slice(0, 8)}`,
    color: 'verde',
  }),
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/labels/{labelId}': () => ({ color: 'viola' }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/caption-templates': () => ({
    kind: 'signature',
    name: 'Firma della batteria',
    body: 'Forno della batteria',
  }),
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/caption-templates/{templateId}': () => ({
    name: 'Firma rinominata',
  }),
  // the case's account is in no workspace: the case puts it in the case's client (PREPARE)
  'POST /api/v1/orgs/{org}/workspaces/{id}/account-groups': (ids) => ({
    name: 'Gruppo della batteria',
    accountIds: [ids.account],
  }),
  'PATCH /api/v1/orgs/{org}/workspaces/{id}/account-groups/{groupId}': () => ({
    name: 'Gruppo rinominato',
  }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/notes': () => ({
    body: 'Nota della batteria',
  }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/schedule': () => ({ version: 1 }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/unschedule': () => ({ version: 1 }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/cancel': () => ({ version: 1 }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/publish-now': () => ({ version: 1 }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/resume': () => ({ version: 1 }),
  'POST /api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/cancel-paused': () => ({ version: 1 }),
}

export function sampleBody(route: ApiContract, ids: SampleIds): unknown {
  // a new form each time: a sent body cannot be read again
  if (route.upload) return uploadForm()
  // the matrix sends it with SAMPLE_PART_HEADERS where the piece must be taken
  if (route.binary) return SAMPLE_PART
  const schema = route.request.body
  if (!schema) return undefined
  const sample = SAMPLE_BODIES[routeKey(route)]
  if (!sample) throw new Error(`no sample body for ${routeKey(route)}: add one to SAMPLE_BODIES`)
  const body = sample(ids)
  // a sample the contract refuses would measure a 422, not the permission
  schema.parse(body)
  return body
}

/** Optional queries that name a workspace: they get their own cases. */
const SAMPLE_QUERIES: Record<string, (ids: SampleIds) => string> = {
  'GET /api/v1/orgs/{org}/audit-log': (ids) => `workspaceId=${ids.workspace}`,
  // «Oggi» narrowed to the selector's client (redesign R3)
  'GET /api/v1/orgs/{org}/agenda': (ids) => `workspaceId=${ids.workspace}`,
  'GET /api/v1/orgs/{org}/agenda/drafts': (ids) => `workspaceId=${ids.workspace}`,
  'GET /api/v1/orgs/{org}/agenda/issues': (ids) => `workspaceId=${ids.workspace}`,
  // «Libreria» narrowed to one client (redesign R6)
  'GET /api/v1/orgs/{org}/media': (ids) => `workspaceId=${ids.workspace}`,
}

export function sampleQuery(route: ApiContract, ids: SampleIds): string | undefined {
  const sample = SAMPLE_QUERIES[routeKey(route)]
  if (sample && !route.request.query) throw new Error(`${routeKey(route)} takes no query`)
  return sample?.(ids)
}

/** Placeholder ids, to tell at collection time which routes carry which ids. */
export const PLACEHOLDER_IDS: SampleIds = {
  org: 'agenzia-segnaposto',
  workspace: randomUUID(),
  target: randomUUID(),
  newcomer: randomUUID(),
  admin: randomUUID(),
  email: 'segnaposto@example.test',
  invite: randomUUID(),
  connection: randomUUID(),
  account: randomUUID(),
  media: randomUUID(),
  upload: randomUUID(),
  folder: randomUUID(),
  post: randomUUID(),
  label: randomUUID(),
  template: randomUUID(),
  group: randomUUID(),
  note: randomUUID(),
}

/**
 * Whether a request to the route names a workspace (path, body or a sample query). An invite
 * names the workspaces it gives roles in: the case's invite is into the case's workspace.
 */
export function namesWorkspace(route: ApiContract): boolean {
  return (
    route.path.includes('{id}') ||
    route.path.includes('{inviteId}') ||
    JSON.stringify(sampleBody(route, PLACEHOLDER_IDS) ?? null).includes(PLACEHOLDER_IDS.workspace)
  )
}

export const ID_KINDS = [
  'workspace',
  'target',
  'newcomer',
  'admin',
  'invite',
  'connection',
  'account',
  'media',
  'upload',
  'folder',
  'post',
  'label',
  'template',
  'group',
  'note',
] as const
export type IdKind = (typeof ID_KINDS)[number]

/** The ids a request to the route carries, in the path, the body or (if asked) the query. */
export function idKindsIn(route: ApiContract, withQuery: boolean): IdKind[] {
  const query = withQuery ? (sampleQuery(route, PLACEHOLDER_IDS) ?? '') : ''
  const request =
    fill(route.path, pathValues(PLACEHOLDER_IDS)) +
    query +
    JSON.stringify(sampleBody(route, PLACEHOLDER_IDS) ?? null)
  return ID_KINDS.filter((kind) => request.includes(PLACEHOLDER_IDS[kind]))
}

// Keys a secret would sit under, in any case; values only a secret would hold: sealed columns,
// and Meta tokens (`EAA…`, and `IGAA…` of the old Instagram login, kept out of caution).
const SECRET_KEY = /"(\w*(?:password|secret|token|backup_?codes)\w*)"\s*:/gi
const SECRET_VALUE = /\$argon2|token_hash|key_enc|secret_enc|token_enc|backup_?codes/i
const META_TOKEN = /\b(?:EAA|IGAA)[A-Za-z0-9]{20,}/

/**
 * What in a response body looks like a secret. `allowedKeys`: exact key names that are known
 * not to hold one (the OpenAPI document names the `password` and `token` request fields).
 */
export function secretsIn(body: string, allowedKeys: readonly string[] = []): string[] {
  const keys = [...body.matchAll(SECRET_KEY)]
    .map((m) => m[1] ?? '')
    .filter((key) => !allowedKeys.includes(key))
  const values = [SECRET_VALUE.exec(body), META_TOKEN.exec(body)].flatMap((m) =>
    m ? [`value ${m[0].slice(0, 6)}`] : [],
  )
  return [...keys.map((k) => `key ${k}`), ...values]
}

/** `{param}` → value; a parameter without a value fails the battery. */
export function fill(path: string, values: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`no value for {${name}} in ${path}`)
    return encodeURIComponent(value)
  })
}

const PLACEHOLDER_STAGING = randomUUID()
const PLACEHOLDER_COPY = randomUUID()
/** The `preview` copy of each case's video: `{copyId}` follows `{mediaId}`, of A or of B. */
const copyOfMedia = new Map<string, string>()

/** The path values of an agency's case. */
export const pathValues = (ids: SampleIds): Record<string, string> => ({
  org: ids.org,
  id: ids.workspace,
  userId: ids.target,
  inviteId: ids.invite,
  connectionId: ids.connection,
  accountId: ids.account,
  mediaId: ids.media,
  variant: 'preview',
  copyId: copyOfMedia.get(ids.media) ?? PLACEHOLDER_COPY,
  uploadId: ids.upload,
  folderId: ids.folder,
  postId: ids.post,
  labelId: ids.label,
  templateId: ids.template,
  groupId: ids.group,
  noteId: ids.note,
  n: '1',
  size: '256',
  // a preview nobody uploaded: the matrix uploads one for the Owner's case
  stagingId: PLACEHOLDER_STAGING,
})

export interface IsolationFixture {
  env: ApiEnv
  /** A: Owner, Admin and a Member per workspace role in w1; w2 has none of them. */
  a: { id: string; slug: string; w1: string; w2: string; people: Record<ActorRole, Person> }
  /** B: an Owner and a Member (Editor in its workspace). */
  b: { id: string; slug: string; workspace: string; owner: Person; member: Person }
  /** A Member of both A (Viewer in w1) and B. */
  both: Person
  /** Signed in, the second factor satisfied where it is owed. */
  cookies: Record<ActorRole | 'ownerOfB' | 'memberOfB' | 'both', string>
  /** Fresh rows in A (or B) for one case, so no case depends on what another one changed. */
  caseIds(opts: { agency: 'a' | 'b'; actorsInWorkspace: boolean }): Promise<SampleIds>
  /** Every open session counts as confirmed with the password just now. */
  refreshReauth(): Promise<void>
  /** An agency of its own, for an Owner action that signs the Owner out. */
  throwawayAgency(): Promise<{ cookie: string; ids: SampleIds }>
  /** An invite link of A, activated by its new account, waiting for the passkey. */
  reservedLink(): Promise<{ token: string; userId: string }>
  /** An open Admin invite of A into `workspaceId`, sent by A's Owner. */
  adminInvite(workspaceId: string): Promise<string>
  /** An invite link of A nobody has used. */
  openLink(email?: string): Promise<string>
  /** A fingerprint of the rows a request could change: equal before and after = untouched. */
  snapshot(): Promise<Record<string, string>>
}

const SNAPSHOT_QUERIES: Record<string, string> = {
  organizations: 'select id, name, slug, status, limits from organizations',
  organization_members: 'select * from organization_members',
  workspaces: 'select * from workspaces',
  workspace_members: 'select * from workspace_members',
  invites: 'select id, organization_id, email, reserved_user_id, used_at from invites',
  users: 'select id, email, name, status, platform_role from users',
  sessions: 'select id, user_id from sessions',
  audit_log: 'select id from audit_log',
  integrations: 'select organization_id, kind, config, secret_enc, verified_at from integrations',
  account_connections: 'select * from account_connections',
  social_accounts: 'select * from social_accounts',
  workspace_accounts: 'select * from workspace_accounts',
  connection_attempts: 'select * from connection_attempts',
  media: 'select * from media',
  media_variants: 'select * from media_variants',
  library_folders: 'select * from library_folders',
  library_items: 'select * from library_items',
  upload_sessions: 'select * from upload_sessions',
  posts: 'select * from posts',
  post_media: 'select * from post_media',
  post_targets: 'select * from post_targets',
  // what the worker and the events write: a route of the other agency must not touch them either
  target_attempts: 'select * from target_attempts',
  outbox_events: 'select * from outbox_events',
  post_labels: 'select * from post_labels',
  post_notes: 'select * from post_notes',
  labels: 'select * from labels',
  caption_templates: 'select * from caption_templates',
  account_groups: 'select * from account_groups',
}

export async function startIsolationFixture(name: string): Promise<IsolationFixture> {
  const env = await startApiEnv(name)
  const a = await env.agency()
  const b = await env.agency()
  const [w1, w2, wb] = await seed(env.tdb.runtimeUrl, async (s) => [
    await s.workspace(a.id),
    await s.workspace(a.id),
    await s.workspace(b.id),
  ])
  const people = {
    owner: await env.person(a.id, 'owner'),
    admin: await env.person(a.id, 'admin'),
    manager: await env.person(a.id, 'member'),
    publisher: await env.person(a.id, 'member'),
    editor: await env.person(a.id, 'member'),
    viewer: await env.person(a.id, 'member'),
  } satisfies Record<ActorRole, Person>
  const ownerOfB = await env.person(b.id, 'owner')
  const memberOfB = await env.person(b.id, 'member')
  const both = await env.person(a.id, 'member')
  await seed(env.tdb.runtimeUrl, async (s) => {
    for (const role of WORKSPACE_ROLES) await s.workspaceMember(a.id, w1, people[role].userId, role)
    await s.workspaceMember(b.id, wb, memberOfB.userId, 'editor')
    await s.member(b.id, both.userId, 'member')
    await s.workspaceMember(a.id, w1, both.userId, 'viewer')
    await s.workspaceMember(b.id, wb, both.userId, 'viewer')
  })
  await env.addPasskey(people.owner.userId)
  await env.addPasskey(people.admin.userId)
  await env.addPasskey(ownerOfB.userId)

  const cookies = {
    owner: await env.strongSignIn(people.owner),
    admin: await env.strongSignIn(people.admin),
    manager: await env.signIn(people.manager),
    publisher: await env.signIn(people.publisher),
    editor: await env.signIn(people.editor),
    viewer: await env.signIn(people.viewer),
    ownerOfB: await env.strongSignIn(ownerOfB),
    memberOfB: await env.signIn(memberOfB),
    both: await env.signIn(both),
  }

  const workspaceOf = { a: [a.id, w1, w2], b: [b.id, wb, wb] } as const

  /**
   * The agency's Meta app and its system user, through the routes as an Owner does it. One per
   * agency: the same system user again only replaces its token (plan 03, choice 4).
   */
  async function metaConnection(slug: string, cookie: string): Promise<string> {
    await env.admin.pool.query('update sessions set reauthenticated_at = now()')
    const app = await env.call(
      'PUT',
      `/api/v1/orgs/${slug}/integrations/meta`,
      {
        appId: META_MOCK.app.id,
        appSecret: META_MOCK.app.secret,
        businessId: META_MOCK.businesses.agency,
      },
      { cookie },
    )
    expect(app.status, await app.clone().text()).toBe(200)
    const r = await env.call(
      'POST',
      `/api/v1/orgs/${slug}/connections/system-user`,
      { token: META_MOCK.tokens.systemUser },
      { cookie },
    )
    const text = await r.text()
    expect(r.status, text).toBe(200)
    const id = (JSON.parse(text) as { connection: { id: string } | null }).connection?.id
    if (id === undefined) throw new Error('the system user was not connected')
    return id
  }
  const connectionOf = {
    a: await metaConnection(a.slug, cookies.owner),
    b: await metaConnection(b.slug, cookies.ownerOfB),
  }

  /** An open invite written directly: its link is never needed, only its id. */
  async function openInvite(
    organizationId: string,
    workspaceId: string,
    invitedBy: string,
    orgRole: 'member' | 'admin' = 'member',
  ) {
    const id = randomUUID()
    await env.admin.pool.query(
      `insert into invites (id, organization_id, purpose, email, token_hash, invited_by, org_role,
                            memberships, expires_at)
       values ($1, $2, 'invite', $3, $4, $5, $7, $6, now() + interval '72 hours')`,
      [
        id,
        organizationId,
        `invitato-${randomUUID().slice(0, 8)}@example.test`,
        randomBytes(32),
        invitedBy,
        JSON.stringify([{ workspaceId, role: 'viewer' }]),
        orgRole,
      ],
    )
    return id
  }

  /** The bytes of every case's preview: what the file route must give back. */
  const storage = createLocalDiskStorage({ root: env.web.mediaRoot })

  /** A ready video of the workspace with its preview stored, written directly. */
  async function libraryVideo(organizationId: string, workspaceId: string, uploadedBy: string) {
    const id = await seed(env.tdb.runtimeUrl, (s) =>
      s.media(organizationId, workspaceId, { uploadedBy }),
    )
    const key = `org/${organizationId}/media/${id}/preview.mp4`
    const { size } = await storage.put(key, SAMPLE_PREVIEW, { contentType: 'video/mp4' })
    await env.admin.pool.query(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime,
                                   size_bytes)
       values ($1, $2, $3, 'preview', $4, 'video/mp4', $5)`,
      [randomUUID(), organizationId, id, key, size],
    )
    // a copy made to publish a reel, as the page of the outcome shows it (plan 08 Task 10)
    const copyId = randomUUID()
    const copyKey = `org/${organizationId}/media/${id}/reel-battery.mp4`
    await storage.put(copyKey, SAMPLE_PREVIEW, { contentType: 'video/mp4' })
    await env.admin.pool.query(
      `insert into media_variants (id, organization_id, media_id, purpose, recipe, storage_key,
                                   mime, size_bytes)
       values ($1, $2, $3, 'reel', 'battery', $4, 'video/mp4', $5)`,
      [copyId, organizationId, id, copyKey, size],
    )
    copyOfMedia.set(id, copyId)
    return id
  }

  /** An empty folder of the workspace's library, written directly. */
  async function libraryFolder(organizationId: string, workspaceId: string) {
    const id = randomUUID()
    await env.admin.pool.query(
      `insert into library_folders (id, organization_id, workspace_id, name)
       values ($1, $2, $3, $4)`,
      [id, organizationId, workspaceId, `Cartella della batteria ${id.slice(0, 8)}`],
    )
    return id
  }

  /** An open upload of `userId` into the workspace, written directly. */
  async function openUpload(organizationId: string, workspaceId: string, userId: string) {
    const id = randomUUID()
    await env.admin.pool.query(
      `insert into upload_sessions (id, organization_id, workspace_id, user_id, original_name,
                                    mime, size_bytes, first_part_sha256, expires_at)
       values ($1, $2, $3, $4, 'video della batteria.mp4', 'video/mp4', $5, $6,
               now() + interval '24 hours')`,
      [id, organizationId, workspaceId, userId, SAMPLE_PART.length, SAMPLE_PART_SHA256],
    )
    return id
  }

  /** An empty draft of the workspace by `createdBy`, written directly. */
  async function draftPost(organizationId: string, workspaceId: string, createdBy: string) {
    const id = randomUUID()
    await env.admin.pool.query(
      `insert into posts (id, organization_id, workspace_id, type, options, created_by, updated_by)
       values ($1, $2, $3, 'reel', '{"shareToFeed":true,"choices":[]}', $4, $4)`,
      [id, organizationId, workspaceId, createdBy],
    )
    return id
  }

  /** A label, a template, a group with the account and a note of `authorId`, written directly. */
  async function contentRows(
    organizationId: string,
    workspaceId: string,
    postId: string,
    accountId: string,
    authorId: string,
  ) {
    const [label, template, group, note] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const { pool } = env.admin
    await pool.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, $4, 'blu')`,
      [label, organizationId, workspaceId, `Etichetta ${label.slice(0, 8)}`],
    )
    await pool.query(
      `insert into caption_templates (id, organization_id, workspace_id, kind, name, body)
       values ($1, $2, $3, 'hashtags', 'Hashtag della batteria', '#batteria')`,
      [template, organizationId, workspaceId],
    )
    await pool.query(
      `insert into account_groups (id, organization_id, workspace_id, name, account_ids)
       values ($1, $2, $3, 'Gruppo della batteria', array[$4]::uuid[])`,
      [group, organizationId, workspaceId, accountId],
    )
    await pool.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       values ($1, $2, $3, $4, $5, 'Nota della batteria')`,
      [note, organizationId, workspaceId, postId, authorId],
    )
    return { label, template, group, note }
  }

  /** A fresh imported account of the connection, written directly: no Meta call per case. */
  async function socialAccount(organizationId: string, connectionId: string) {
    const id = randomUUID()
    await env.admin.pool.query(
      `insert into social_accounts (id, organization_id, platform, external_id, name, connection_id)
       values ($1, $2, 'instagram', $3, 'Account della batteria', $4)`,
      [
        id,
        organizationId,
        `1784${String(Date.now()).slice(-8)}${randomUUID().slice(0, 4)}`,
        connectionId,
      ],
    )
    return id
  }

  const fixture: IsolationFixture = {
    env,
    a: { ...a, w1, w2, people },
    b: { ...b, workspace: wb, owner: ownerOfB, member: memberOfB },
    both,
    cookies,
    async caseIds({ agency, actorsInWorkspace }) {
      const [organizationId, , other] = workspaceOf[agency]
      const ids = await seed(env.tdb.runtimeUrl, async (s) => {
        const workspace = await s.workspace(organizationId)
        if (agency === 'a' && actorsInWorkspace)
          for (const role of WORKSPACE_ROLES)
            await s.workspaceMember(organizationId, workspace, people[role].userId, role)
        const target = await s.user()
        await s.member(organizationId, target, 'member')
        await s.workspaceMember(organizationId, workspace, target, 'viewer')
        // so that a Manager may take them out of `workspace` (spec §10.2)
        await s.workspaceMember(organizationId, other, target, 'viewer')
        const newcomer = await s.user()
        await s.member(organizationId, newcomer, 'member')
        const admin = await s.user()
        await s.member(organizationId, admin, 'admin')
        return { workspace, target, newcomer, admin }
      })
      await env.addPasskey(ids.admin)
      const sender = agency === 'a' ? people.manager.userId : ownerOfB.userId
      const account = await socialAccount(organizationId, connectionOf[agency])
      const post = await draftPost(organizationId, ids.workspace, ids.target)
      return {
        org: agency === 'a' ? a.slug : b.slug,
        ...ids,
        email: `nuova-${randomUUID().slice(0, 8)}@example.test`,
        invite: await openInvite(organizationId, ids.workspace, sender),
        connection: connectionOf[agency],
        account,
        media: await libraryVideo(organizationId, ids.workspace, ids.target),
        upload: await openUpload(
          organizationId,
          ids.workspace,
          agency === 'a' ? people.owner.userId : ownerOfB.userId,
        ),
        folder: await libraryFolder(organizationId, ids.workspace),
        post,
        ...(await contentRows(organizationId, ids.workspace, post, account, ids.target)),
      }
    },
    async refreshReauth() {
      // the reauth route itself is covered by the me and users tests (Task 20)
      await env.admin.pool.query('update sessions set reauthenticated_at = now()')
    },
    async throwawayAgency() {
      const agency = await env.agency()
      const owner = await env.person(agency.id, 'owner')
      await env.addPasskey(owner.userId)
      const ids = await seed(env.tdb.runtimeUrl, async (s) => {
        const workspace = await s.workspace(agency.id)
        const target = await s.user()
        await s.member(agency.id, target, 'member')
        const newcomer = await s.user()
        await s.member(agency.id, newcomer, 'member')
        const admin = await s.user()
        await s.member(agency.id, admin, 'admin')
        return { workspace, target, newcomer, admin }
      })
      await env.addPasskey(ids.admin)
      const cookie = await env.strongSignIn(owner)
      await fixture.refreshReauth()
      const connection = await metaConnection(agency.slug, cookie)
      const account = await socialAccount(agency.id, connection)
      const post = await draftPost(agency.id, ids.workspace, ids.target)
      return {
        cookie,
        ids: {
          org: agency.slug,
          ...ids,
          email: `nuova-${randomUUID().slice(0, 8)}@example.test`,
          invite: await openInvite(agency.id, ids.workspace, owner.userId),
          connection,
          account,
          media: await libraryVideo(agency.id, ids.workspace, owner.userId),
          upload: await openUpload(agency.id, ids.workspace, owner.userId),
          folder: await libraryFolder(agency.id, ids.workspace),
          post,
          ...(await contentRows(agency.id, ids.workspace, post, account, ids.target)),
        },
      }
    },
    adminInvite(workspaceId) {
      return openInvite(a.id, workspaceId, people.owner.userId, 'admin')
    },
    async openLink(email = `link-${randomUUID().slice(0, 8)}@example.test`) {
      const r = await env.call(
        'POST',
        `/api/v1/orgs/${a.slug}/invites`,
        {
          email,
          orgRole: 'member',
          memberships: [{ workspaceId: w1, role: 'viewer' }],
        },
        { cookie: cookies.owner },
      )
      expect(r.status).toBe(200)
      return (await env.linkSentTo(email)).token
    },
    async snapshot() {
      const out: Record<string, string> = {}
      for (const [table, query] of Object.entries(SNAPSHOT_QUERIES)) {
        const { rows } = await env.admin.pool.query<{ digest: string | null }>(
          `select md5(string_agg(t::text, '|' order by t::text)) as digest from (${query}) t`,
        )
        out[table] = rows[0]?.digest ?? ''
      }
      return out
    },
    async reservedLink() {
      const email = `attesa-${randomUUID().slice(0, 8)}@example.test`
      const token = await fixture.openLink(email)
      const r = await env.call('POST', `/api/v1/links/${encodeURIComponent(token)}/activate`, {
        name: 'Persona In Attesa',
        password: null,
      })
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ next: 'register_passkey' })
      const { rows } = await env.admin.pool.query<{ reserved_user_id: string | null }>(
        'select reserved_user_id from invites where email = $1',
        [email],
      )
      const userId = rows[0]?.reserved_user_id
      if (!userId) throw new Error('the activation reserved no account')
      return { token, userId }
    },
  }
  return fixture
}
