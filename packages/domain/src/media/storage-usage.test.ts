import { expect, test } from 'vitest'
import { checkStorage, mediaPrefix, mediaVariantKey } from './storage-usage.js'

const ORG = '0190aaaa-0000-7000-8000-000000000001'
const MEDIA = '0190aaaa-0000-7000-8000-000000000002'

test('a media file lives under its own folder of the agency', () => {
  expect(mediaPrefix(ORG, MEDIA)).toBe(`org/${ORG}/media/${MEDIA}/`)
  expect(mediaVariantKey(ORG, MEDIA, 'preview', 'mp4')).toBe(
    `org/${ORG}/media/${MEDIA}/preview.mp4`,
  )
})

test('without limits anything fits', () => {
  expect(
    checkStorage({ limits: {}, workspaceMaxBytes: null }, { organization: 10, workspace: 10 }, 5),
  ).toEqual({ ok: true })
})

test("the agency's storage_bytes counts every workspace", () => {
  const limits = { limits: { storage_bytes: 100 }, workspaceMaxBytes: null }
  expect(checkStorage(limits, { organization: 90, workspace: 0 }, 10)).toEqual({ ok: true })
  expect(checkStorage(limits, { organization: 90, workspace: 0 }, 11)).toEqual({
    ok: false,
    scope: 'organization',
    limit: 100,
  })
})

test('the limit of one workspace (MEDIA_WORKSPACE_MAX_BYTES) counts that workspace only', () => {
  const limits = { limits: { storage_bytes: 1000 }, workspaceMaxBytes: 50 }
  expect(checkStorage(limits, { organization: 900, workspace: 40 }, 10)).toEqual({ ok: true })
  expect(checkStorage(limits, { organization: 900, workspace: 40 }, 11)).toEqual({
    ok: false,
    scope: 'workspace',
    limit: 50,
  })
})

test('the agency is checked first: its limit is the one to raise', () => {
  expect(
    checkStorage(
      { limits: { storage_bytes: 10 }, workspaceMaxBytes: 10 },
      { organization: 10, workspace: 10 },
      1,
    ),
  ).toMatchObject({ scope: 'organization' })
})
