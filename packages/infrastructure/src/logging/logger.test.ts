import { Writable } from 'node:stream'
import { expect, test } from 'vitest'
import type { Logger } from '@app/application'
import { createLogger } from './logger.js'

function captureLog(fn: (logger: Logger) => void): string {
  let out = ''
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString()
      cb()
    },
  })
  fn(createLogger({ service: 'web', level: 'debug', destination }))
  return out
}

test('redacts secret-looking keys at any depth', () => {
  const out = captureLog((l) => {
    l.info({
      token: 'abc',
      nested: { appSecret: 'x', password: 'p' },
      authorization: 'Bearer z',
      cookie: 'c',
    })
  })
  for (const v of ['abc', '"x"', '"p"', 'Bearer z', '"c"']) expect(out).not.toContain(v)
  expect(out).toContain('[REDACTED]')
})

test('scrubs access tokens and url credentials inside strings and errors', () => {
  const out = captureLog((l) => {
    l.error({
      err: new Error('GET /me?access_token=EAAB123&appsecret_proof=PROOF-Zz9 failed'),
      url: 'postgres://app_runtime:s3cret@postgres/app',
    })
  })
  expect(out).not.toContain('EAAB123')
  expect(out).not.toContain('PROOF-Zz9')
  expect(out).not.toContain('s3cret')
})

test('the token of an activation link never reaches the log', () => {
  const out = captureLog((l) => {
    l.info({ path: '/api/v1/links/tok3n-abc_9/activate' }, 'request')
    l.info({ path: '/attiva/tok3n-def' }, 'request')
    l.warn({}, 'opened https://pannello.example/attiva/tok3n-ghi')
  })
  for (const v of ['tok3n-abc_9', 'tok3n-def', 'tok3n-ghi']) expect(out).not.toContain(v)
  expect(out).toContain('/api/v1/links/[REDACTED]/activate')
})

test('the token of a password reset link never reaches the log', () => {
  const out = captureLog((l) => {
    // Better Auth's own reset tokens are 24 letters and digits: shorter than pathForLog cuts
    l.info({ path: '/api/auth/reset-password/Ab3dEf6hIj9kLm2nOp5qRs8t' }, 'request')
    l.warn({}, 'opened https://pannello.example/reimposta?token=Zy8xWv7uTs6rQp5oNm4lKj3i&x=1')
    // typed by hand: other casing, a double slash, more path after it
    l.info({ path: '/API/AUTH/RESET-PASSWORD//Qw1eRt2yUi3oPa4sDf5gHj6k/x' }, 'request')
    l.warn(
      {},
      'callback?reset_token=resettokenresettoken0001 and id_token%3Didtokenidtokenidtoken002',
    )
    l.error({ err: new Error('lookup of reset-password:storedtokenstoredtoken03 failed') })
  })
  for (const v of [
    'Ab3dEf6hIj9kLm2nOp5qRs8t',
    'Zy8xWv7uTs6rQp5oNm4lKj3i',
    'Qw1eRt2yUi3oPa4sDf5gHj6k',
    'resettokenresettoken0001',
    'idtokenidtokenidtoken002',
    'storedtokenstoredtoken03',
  ]) {
    expect(out).not.toContain(v)
  }
  expect(out).toContain('/api/auth/reset-password/[REDACTED]')
})

test('the parameters of a failed query never reach the log', () => {
  const out = captureLog((l) => {
    l.error({
      err: new Error('Failed query: select 1 where email = $1\nparams: persona@example.test,42'),
    })
  })
  expect(out).not.toContain('persona@example.test')
  expect(out).toContain('params: [REDACTED]')
})

test('scrubs secrets from the message', () => {
  const out = captureLog((l) => {
    l.info({}, 'calling with Bearer abc.def.ghi')
  })
  expect(out).not.toContain('abc.def.ghi')
})

test('child logger keeps service and bindings', () => {
  const out = captureLog((l) => {
    l.child({ requestId: 'r1' }).info({}, 'hi')
  })
  expect(JSON.parse(out)).toMatchObject({ service: 'web', requestId: 'r1', msg: 'hi' })
})
