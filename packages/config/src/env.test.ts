import { expect, test } from 'vitest'
import { ConfigError, loadConfig } from './env.js'

const validWebEnv: Record<string, string | undefined> = {
  DATABASE_URL: 'postgres://app_runtime:p@postgres:5432/app',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PANEL_URL: 'http://localhost:3000',
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
  expect(c.metaGraphVersion).toBe('v24.0')
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
