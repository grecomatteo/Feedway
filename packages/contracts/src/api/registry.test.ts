import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { ApiErrorBody } from './define.js'
import { apiRoutes, openApiDocument } from './registry.js'

const templateParams = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

const shapeKeys = (schema: z.ZodType | undefined) =>
  schema instanceof z.ZodObject ? Object.keys(schema.shape).sort() : []

/** A z.strictObject rejects keys it does not know; a plain z.object would drop them silently. */
const isStrict = (schema: z.ZodType) =>
  schema instanceof z.ZodObject &&
  (schema
    .safeParse({ __unknown_key__: 1 })
    .error?.issues.some((i) => i.code === 'unrecognized_keys') ??
    false)

describe.each(apiRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))('%s', (_, route) => {
  test('lives under /api/v1 and has a summary', () => {
    // lower case, except the names of path parameters (`{userId}`)
    expect(route.path).toMatch(/^\/api\/v1\/([a-z0-9/._-]|\{[a-zA-Z]+\})+$/)
    expect(route.summary.length).toBeGreaterThan(3)
  })

  test('declares exactly the parameters of its path', () => {
    expect(shapeKeys(route.request.params)).toEqual(templateParams(route.path))
  })

  test('an agency route is under /orgs/{org} and needs an active session, and only those', () => {
    const underOrg = route.path.startsWith('/api/v1/orgs/{org}/')
    expect(route.scope === 'organization').toBe(underOrg)
    if (underOrg) expect(route.auth).toBe('session')
  })

  test('a platform route is under /platform and needs an active session, and only those', () => {
    const underPlatform = route.path.startsWith('/api/v1/platform/')
    expect(route.scope === 'platform').toBe(underPlatform)
    if (underPlatform) expect(route.auth).toBe('session')
  })

  test('a personal route needs a session', () => {
    if (route.scope === 'personal') expect(route.auth).not.toBe('public')
  })

  test('bodies and queries reject unknown keys', () => {
    for (const schema of [route.request.body, route.request.query, route.request.params])
      if (schema) expect(isStrict(schema)).toBe(true)
  })

  test('only methods that change something have a body', () => {
    if (route.method === 'GET') expect(route.request.body).toBeUndefined()
  })
})

test('method and path are unique', () => {
  const keys = apiRoutes.map((r) => `${r.method} ${r.path}`)
  expect(new Set(keys).size).toBe(keys.length)
})

test('the document is OpenAPI 3.1 with one operation per route and no app version', () => {
  const doc = openApiDocument()
  expect(doc.openapi).toBe('3.1.0')
  expect(doc).not.toHaveProperty('servers')
  const operations = Object.values(doc.paths).flatMap((p) => Object.keys(p))
  expect(operations).toHaveLength(apiRoutes.length)
  expect(JSON.stringify(doc)).not.toContain('"$schema"')
})

test('every operation documents its success and the shared error body', () => {
  const doc = openApiDocument()
  for (const item of Object.values(doc.paths))
    for (const op of Object.values(item)) {
      expect(op.responses).toHaveProperty('200')
      expect(op.responses).toHaveProperty('default')
    }
  expect(doc.components.schemas).toHaveProperty('ApiErrorBody')
})

test('mutations document the request header the CSRF check needs', () => {
  const doc = openApiDocument()
  for (const route of apiRoutes) {
    const op = doc.paths[route.path]?.[route.method.toLowerCase()]
    const headers = (op?.parameters ?? []).filter((p) => p.in === 'header').map((p) => p.name)
    expect(headers.includes('X-App-Request')).toBe(route.method !== 'GET')
  }
})

test('the error body has the documented shape', () => {
  expect(
    ApiErrorBody.parse({
      error: {
        code: 'VALIDATION',
        message: 'x',
        requestId: 'r',
        issues: [{ path: ['a'], message: 'm' }],
      },
    }),
  ).toBeTruthy()
})
