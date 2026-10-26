import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { apiRoutes } from '@app/contracts'
import type { ApiContract } from '@app/contracts'
import { seed } from '@app/infrastructure/testing'
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
}

/** A valid body for every route that takes one; checked against the route's own schema. */
const SAMPLE_BODIES: Record<string, (ids: SampleIds) => unknown> = {
  'POST /api/v1/auth/reauth': () => ({ password: PASSWORD }),
  'POST /api/v1/links/{token}/activate': () => ({ name: 'Persona Nuova', password: null }),
  'POST /api/v1/security/lock': () => ({ token: 'link-non-valido' }),
  'PATCH /api/v1/orgs/{org}/settings': () => ({ name: 'Agenzia della batteria' }),
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
}

export function sampleBody(route: ApiContract, ids: SampleIds): unknown {
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
}

/** Whether a request to the route names a workspace (path, body or a sample query). */
export function namesWorkspace(route: ApiContract): boolean {
  return (
    route.path.includes('{id}') ||
    JSON.stringify(sampleBody(route, PLACEHOLDER_IDS) ?? null).includes(PLACEHOLDER_IDS.workspace)
  )
}

/** Whether a request to the route names a workspace or a person, in the path or the body. */
export function carriesIds(route: ApiContract): boolean {
  const body = JSON.stringify(sampleBody(route, PLACEHOLDER_IDS) ?? null)
  return (
    /\{(id|userId)\}/.test(route.path) ||
    [
      PLACEHOLDER_IDS.workspace,
      PLACEHOLDER_IDS.target,
      PLACEHOLDER_IDS.newcomer,
      PLACEHOLDER_IDS.admin,
    ].some((id) => body.includes(id))
  )
}

/** `{param}` → value; a parameter without a value fails the battery. */
export function fill(path: string, values: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`no value for {${name}} in ${path}`)
    return encodeURIComponent(value)
  })
}

/** The path values of an agency's case. */
export const pathValues = (ids: SampleIds): Record<string, string> => ({
  org: ids.org,
  id: ids.workspace,
  userId: ids.target,
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
  /** An invite link of A nobody has used. */
  openLink(email?: string): Promise<string>
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
      return {
        org: agency === 'a' ? a.slug : b.slug,
        ...ids,
        email: `nuova-${randomUUID().slice(0, 8)}@example.test`,
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
      return {
        cookie,
        ids: { org: agency.slug, ...ids, email: `nuova-${randomUUID().slice(0, 8)}@example.test` },
      }
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
      const { url } = (await r.json()) as { url: string }
      return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
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
