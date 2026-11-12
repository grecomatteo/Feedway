import { expect, test } from 'vitest'
import { ConfigError, loadConfig } from './env.js'

const validWebEnv: Record<string, string | undefined> = {
  DATABASE_URL: 'postgres://app_runtime:p@postgres:5432/app',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PANEL_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: Buffer.alloc(32, 9).toString('base64'),
}

function catchConfigError(fn: () => unknown): ConfigError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ConfigError) return e
    throw e
  }
  throw new Error('expected ConfigError')
}

const issuesOf = (env: Record<string, string | undefined>) =>
  catchConfigError(() => loadConfig('web', env)).issues

test('valid web env parses with defaults', () => {
  const c = loadConfig('web', validWebEnv)
  expect(c.metaMode).toBe('live')
  expect(c.defaultTimezone).toBe('Europe/Rome')
  expect(c.mediaRetentionDays).toBe(7)
  expect(c.metaGraphVersion).toBe('v25.0')
  expect(c.metaGraphVersionSunset).toBe('2028-07-29')
  expect(c.encryptionKey).toHaveLength(32)
})

test('reports every missing variable at once', () => {
  const err = catchConfigError(() => loadConfig('web', {}))
  expect(err.issues.map((i) => i.variable)).toEqual(
    expect.arrayContaining(['DATABASE_URL', 'APP_ENCRYPTION_KEY', 'PANEL_URL']),
  )
})

test('reads _FILE variants and trims trailing newline', () => {
  const c = loadConfig(
    'web',
    { ...validWebEnv, DATABASE_URL: undefined, DATABASE_URL_FILE: '/run/secrets/db' },
    () => 'postgres://u:p@h/app\n',
  )
  expect(c.databaseUrl).toBe('postgres://u:p@h/app')
})

test('rejects both VAR and VAR_FILE', () => {
  expect(issuesOf({ ...validWebEnv, DATABASE_URL_FILE: '/x' })).toContainEqual({
    variable: 'DATABASE_URL',
    problem: 'impostata sia direttamente sia come file',
  })
})

test('rejects encryption key that is not 32 bytes and never echoes it', () => {
  const err = catchConfigError(() =>
    loadConfig('web', { ...validWebEnv, APP_ENCRYPTION_KEY: 'c2hvcnQ=' }),
  )
  expect(err.issues).toContainEqual({
    variable: 'APP_ENCRYPTION_KEY',
    problem: 'deve essere di 32 byte in base64',
  })
  expect(err.message).not.toContain('c2hvcnQ=')
})

test('trims the newline an editor adds to the encryption key file', () => {
  const c = loadConfig(
    'web',
    { ...validWebEnv, APP_ENCRYPTION_KEY: undefined, APP_ENCRYPTION_KEY_FILE: '/k' },
    () => `${Buffer.alloc(32, 1).toString('base64')}\n`,
  )
  expect(c.encryptionKey).toHaveLength(32)
})

test('requires https panel url in production except localhost', () => {
  expect(
    issuesOf({ ...validWebEnv, NODE_ENV: 'production', PANEL_URL: 'http://pannello.example' }),
  ).toContainEqual(expect.objectContaining({ variable: 'PANEL_URL' }))
  expect(() =>
    loadConfig('web', {
      ...validWebEnv,
      NODE_ENV: 'production',
      PANEL_URL: 'http://localhost:3000',
    }),
  ).not.toThrow()
  expect(() =>
    loadConfig('web', {
      ...validWebEnv,
      NODE_ENV: 'production',
      PANEL_URL: 'http://app.feedway.localhost:3000',
    }),
  ).not.toThrow()
})

test('rejects unknown timezone', () => {
  expect(issuesOf({ ...validWebEnv, TZ_DEFAULT: 'Europe/Roma' })).toContainEqual(
    expect.objectContaining({ variable: 'TZ_DEFAULT' }),
  )
})

test('rejects media retention out of range', () => {
  expect(issuesOf({ ...validWebEnv, MEDIA_RETENTION_DAYS: '400' })).toContainEqual(
    expect.objectContaining({ variable: 'MEDIA_RETENTION_DAYS' }),
  )
})

test('media root defaults to the volume and must be an absolute path', () => {
  expect(loadConfig('web', validWebEnv).mediaRoot).toBe('/media')
  expect(loadConfig('web', { ...validWebEnv, MEDIA_ROOT: '/tmp/media' }).mediaRoot).toBe(
    '/tmp/media',
  )
  expect(issuesOf({ ...validWebEnv, MEDIA_ROOT: 'media' })).toContainEqual(
    expect.objectContaining({ variable: 'MEDIA_ROOT' }),
  )
})

test('worker accepts a list of known queues and rejects unknown ones', () => {
  const ok = loadConfig('worker', { ...validWebEnv, WORKER_QUEUES: 'system.selftest' })
  expect(ok.workerQueues).toEqual(['system.selftest'])
  expect(loadConfig('worker', validWebEnv).workerQueues).toBe('all')
  const err = catchConfigError(() =>
    loadConfig('worker', { ...validWebEnv, WORKER_QUEUES: 'nope' }),
  )
  expect(err.issues).toContainEqual(expect.objectContaining({ variable: 'WORKER_QUEUES' }))
})

test('migrate role needs only migrator url', () => {
  const c = loadConfig('migrate', { DATABASE_MIGRATOR_URL: 'postgres://m:p@h/app' })
  expect(c.runtimeRole).toBe('app_runtime')
})

test('web needs a 32 byte better auth secret and never echoes it', () => {
  expect(issuesOf({ ...validWebEnv, BETTER_AUTH_SECRET: undefined })).toContainEqual(
    expect.objectContaining({ variable: 'BETTER_AUTH_SECRET' }),
  )
  const err = catchConfigError(() =>
    loadConfig('web', { ...validWebEnv, BETTER_AUTH_SECRET: 'c2hvcnQ=' }),
  )
  expect(err.issues).toContainEqual({
    variable: 'BETTER_AUTH_SECRET',
    problem: 'deve essere di 32 byte in base64',
  })
  expect(err.message).not.toContain('c2hvcnQ=')
})

test('without BETTER_AUTH_SECRETS the secret is the only version', () => {
  const c = loadConfig('web', validWebEnv)
  expect(c.betterAuth.secret).toBe(validWebEnv['BETTER_AUTH_SECRET'])
  expect(c.betterAuth.secrets).toEqual([{ version: 1, value: validWebEnv['BETTER_AUTH_SECRET'] }])
})

test('BETTER_AUTH_SECRETS lists versions, newest first, for rotation', () => {
  const newer = Buffer.alloc(32, 1).toString('base64')
  const older = Buffer.alloc(32, 2).toString('base64')
  const c = loadConfig(
    'web',
    {
      ...validWebEnv,
      BETTER_AUTH_SECRETS_FILE: '/run/secrets/better_auth_secrets',
    },
    () => `2:${newer},1:${older}\n`,
  )
  expect(c.betterAuth.secrets).toEqual([
    { version: 2, value: newer },
    { version: 1, value: older },
  ])
})

test.each(['senza-versione', '2:c2hvcnQ=', '1:x,1:y', '0:' + Buffer.alloc(32).toString('base64')])(
  'rejects BETTER_AUTH_SECRETS %s without echoing it',
  (value) => {
    const err = catchConfigError(() =>
      loadConfig('web', { ...validWebEnv, BETTER_AUTH_SECRETS: value }),
    )
    expect(err.issues).toContainEqual(expect.objectContaining({ variable: 'BETTER_AUTH_SECRETS' }))
    expect(err.message).not.toContain(value)
  },
)

test('the worker does not need the better auth secret', () => {
  expect(
    loadConfig('worker', { ...validWebEnv, BETTER_AUTH_SECRET: undefined }).betterAuth,
  ).toBeNull()
})

test('the first agency is called "La mia agenzia" unless named', () => {
  expect(loadConfig('web', validWebEnv).bootstrapOrganizationName).toBe('La mia agenzia')
  expect(
    loadConfig('web', { ...validWebEnv, BOOTSTRAP_ORGANIZATION_NAME: ' Agenzia Rossi ' })
      .bootstrapOrganizationName,
  ).toBe('Agenzia Rossi')
  expect(issuesOf({ ...validWebEnv, BOOTSTRAP_ORGANIZATION_NAME: 'x'.repeat(81) })).toContainEqual({
    variable: 'BOOTSTRAP_ORGANIZATION_NAME',
    problem: 'da 2 a 80 caratteri',
  })
})

test('test-only routes are off by default and allowed only with NODE_ENV=test', () => {
  expect(loadConfig('web', validWebEnv).testRoutes).toBe(false)
  expect(
    loadConfig('web', { ...validWebEnv, NODE_ENV: 'test', APP_TEST_ROUTES: '1' }).testRoutes,
  ).toBe(true)
  for (const NODE_ENV of ['production', 'development', undefined])
    expect(
      issuesOf({
        ...validWebEnv,
        NODE_ENV,
        PANEL_URL: 'https://pannello.example',
        APP_TEST_ROUTES: '1',
      }),
      String(NODE_ENV),
    ).toEqual([expect.objectContaining({ variable: 'APP_TEST_ROUTES' })])
  expect(issuesOf({ ...validWebEnv, NODE_ENV: 'test', APP_TEST_ROUTES: 'yes' })).toEqual([
    expect.objectContaining({ variable: 'APP_TEST_ROUTES' }),
  ])
})

test('takes the sunset of a known Graph API version from the table', () => {
  const c = loadConfig('web', { ...validWebEnv, META_GRAPH_VERSION: 'v24.0' })
  expect(c.metaGraphVersionSunset).toBe('2028-02-18')
})

test('requires the sunset for a Graph API version without a known date', () => {
  expect(issuesOf({ ...validWebEnv, META_GRAPH_VERSION: 'v99.0' })).toContainEqual({
    variable: 'META_GRAPH_VERSION_SUNSET',
    problem: 'obbligatoria per una versione senza data di ritiro nota',
  })
  const c = loadConfig('web', {
    ...validWebEnv,
    META_GRAPH_VERSION: 'v99.0',
    META_GRAPH_VERSION_SUNSET: '2029-01-31',
  })
  expect(c.metaGraphVersionSunset).toBe('2029-01-31')
})

test('an explicit sunset wins over the table, also for a known version', () => {
  const c = loadConfig('web', { ...validWebEnv, META_GRAPH_VERSION_SUNSET: '2028-01-01' })
  expect(c.metaGraphVersionSunset).toBe('2028-01-01')
})

test('rejects a sunset that is not a calendar date', () => {
  expect(issuesOf({ ...validWebEnv, META_GRAPH_VERSION_SUNSET: '2028-02-30' })).toContainEqual({
    variable: 'META_GRAPH_VERSION_SUNSET',
    problem: 'deve essere una data AAAA-MM-GG',
  })
})

test('META_RECORD_DIR reaches web and worker, and empty means off', () => {
  const live = { ...validWebEnv, META_MODE: 'live' }
  for (const role of ['web', 'worker'] as const) {
    expect(loadConfig(role, { ...live, META_RECORD_DIR: '/media/meta-record' }).metaRecordDir).toBe(
      '/media/meta-record',
    )
    // the compose file passes an empty value when the line is not in .env
    expect(loadConfig(role, { ...live, META_RECORD_DIR: '' }).metaRecordDir).toBeNull()
    expect(loadConfig(role, live).metaRecordDir).toBeNull()
  }
})

test('with META_MODE=mock the fake Graph API is on 127.0.0.1:4010 unless told otherwise', () => {
  expect(loadConfig('web', { ...validWebEnv, META_MODE: 'mock' }).metaMockUrl).toBe(
    'http://127.0.0.1:4010',
  )
  expect(
    loadConfig('web', { ...validWebEnv, META_MODE: 'mock', META_MOCK_URL: 'http://127.0.0.1:4999' })
      .metaMockUrl,
  ).toBe('http://127.0.0.1:4999')
  // never used outside mock: no address of a fake reaches the real client
  expect(
    loadConfig('web', { ...validWebEnv, META_MODE: 'live', META_MOCK_URL: 'http://127.0.0.1:4999' })
      .metaMockUrl,
  ).toBeNull()
  expect(
    issuesOf({ ...validWebEnv, META_MODE: 'mock', META_MOCK_URL: 'non-un-indirizzo' }),
  ).toContainEqual({ variable: 'META_MOCK_URL', problem: 'deve essere un indirizzo valido' })
})
