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
      err: new Error('GET /me?access_token=EAAB123&appsecret_proof=f00 failed'),
      url: 'postgres://app_runtime:s3cret@postgres/app',
    })
  })
  expect(out).not.toContain('EAAB123')
  expect(out).not.toContain('f00')
  expect(out).not.toContain('s3cret')
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
