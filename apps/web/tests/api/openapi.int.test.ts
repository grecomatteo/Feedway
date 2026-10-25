import { readdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { apiRoutes } from '@app/contracts'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { panelClient, sessionCookieOf, startWeb } from './helpers.js'
import type { RunningWeb } from './helpers.js'

const PANEL = 'https://pannello.example.ts.net'
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const API_DIR = fileURLToPath(new URL('../../server/api/v1/', import.meta.url))

let tdb: TestDatabase
let web: RunningWeb
let admin: DbHandle

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = createDb(tdb.adminUrl, { max: 2, applicationName: 'openapi-web-test' })
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: PANEL,
  })
}, 300_000)

afterAll(async () => {
  await web.stop()
  await admin.close()
  await tdb.stop()
})

/** `METHOD /api/v1/…/{param}` for every route file, as Nitro maps file names to routes. */
function routesFromFilesystem(dir: string, prefix = '/api/v1'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const segment = entry.name.replace(/^\[(\w+)\]$/, '{$1}')
    if (entry.isDirectory())
      return routesFromFilesystem(`${dir}/${entry.name}`, `${prefix}/${segment}`)
    const match = /^(.+)\.(get|post|put|patch|delete)\.ts$/.exec(entry.name)
    if (!match) throw new Error(`route file without a method: ${prefix}/${entry.name}`)
    const [, name = '', method = ''] = match
    const path = name === 'index' ? prefix : `${prefix}/${name.replace(/^\[(\w+)\]$/, '{$1}')}`
    return [`${method.toUpperCase()} ${path}`]
  })
}

const registeredRoutes = () => apiRoutes.map((r) => `${r.method} ${r.path}`)

interface OpenApiDoc {
  openapi?: unknown
  info?: { title?: unknown; version?: unknown }
  paths?: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> }
}
interface Operation {
  operationId?: unknown
  summary?: unknown
  parameters?: { name?: unknown; in?: unknown; required?: unknown; schema?: unknown }[]
  requestBody?: { content?: Record<string, { schema?: unknown }> }
  responses?: Record<string, unknown>
  security?: Record<string, unknown>[]
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

/**
 * The OpenAPI 3.1 rules a client relies on, checked without a validator package (one would
 * need an ADR): version, info, operations with ids and responses, path parameters declared
 * and required, references that resolve, JSON Schemas without `$schema`.
 */
function validateOpenApi(doc: OpenApiDoc): string[] {
  const problems: string[] = []
  if (doc.openapi !== '3.1.0') problems.push('openapi is not 3.1.0')
  if (typeof doc.info?.title !== 'string' || typeof doc.info.version !== 'string')
    problems.push('info needs title and version')
  const ids = new Set<string>()
  const text = JSON.stringify(doc)
  for (const ref of text.matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)) {
    const [, kind = '', name = ''] = ref
    if (!(doc.components as Record<string, Record<string, unknown>> | undefined)?.[kind]?.[name])
      problems.push(`unresolved $ref ${kind}/${name}`)
  }
  if (text.includes('"$schema"')) problems.push('a schema carries $schema')
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!path.startsWith('/')) problems.push(`${path}: does not start with /`)
    const templated = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    for (const [method, op] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`
      if (!METHODS.has(method)) problems.push(`${where}: unknown method`)
      if (typeof op.operationId !== 'string') problems.push(`${where}: no operationId`)
      else if (ids.has(op.operationId)) problems.push(`${where}: duplicate operationId`)
      else ids.add(op.operationId)
      if (!op.responses || Object.keys(op.responses).length === 0)
        problems.push(`${where}: no responses`)
      const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path')
      for (const name of templated)
        if (!pathParams.some((p) => p.name === name && p.required === true))
          problems.push(`${where}: path parameter ${String(name)} not declared as required`)
      for (const p of op.parameters ?? [])
        if (
          typeof p.name !== 'string' ||
          !['path', 'query', 'header', 'cookie'].includes(String(p.in)) ||
          p.schema === undefined
        )
          problems.push(`${where}: malformed parameter`)
      for (const [type, media] of Object.entries(op.requestBody?.content ?? {}))
        if (typeof media.schema !== 'object') problems.push(`${where}: body ${type} without schema`)
    }
  }
  return problems
}

async function signedInCookie(): Promise<string> {
  const email = `openapi-${randomUUID().slice(0, 8)}@example.test`
  const userId = await seed(tdb.runtimeUrl, (s) => s.user({ email }))
  await admin.pool.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
    [randomUUID(), userId, await createPasswordHasher().hash(PASSWORD)],
  )
  const r = await panelClient(web, PANEL)('POST', '/api/auth/sign-in/email', {
    email,
    password: PASSWORD,
  })
  return sessionCookieOf(r) ?? ''
}

test('every api file is registered', () => {
  expect(routesFromFilesystem(API_DIR).sort()).toEqual(registeredRoutes().sort())
})

test('openapi document is valid 3.1', async () => {
  const r = await fetch(web.url('/api/v1/openapi.json'), {
    headers: { cookie: await signedInCookie() },
  })
  expect(r.status).toBe(200)
  const doc = (await r.json()) as OpenApiDoc
  expect(validateOpenApi(doc)).toEqual([])
  expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(0)
})

test('the document needs a session', async () => {
  expect((await fetch(web.url('/api/v1/openapi.json'))).status).toBe(401)
})
