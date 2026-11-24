import { describe, expect, test } from 'vitest'
import { isTransientDbError } from './transient-error.js'

const pgError = (code: string) => Object.assign(new Error('a query failed'), { code })
/** As drizzle throws it: its own error, the driver's in `cause`. */
const wrapped = (cause: Error) => new Error('Failed query: select 1', { cause })

describe('isTransientDbError', () => {
  test.each([
    ['no connection free in time', new Error('timeout exceeded when trying to connect')],
    ['a connection lost', new Error('Connection terminated unexpectedly')],
    ['the connect timing out', new Error('Connection terminated due to connection timeout')],
    ['Postgres refusing the socket', Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })],
    ['a socket reset', Object.assign(new Error('read'), { code: 'ECONNRESET' })],
    ['a connection failure', pgError('08006')],
    ['an administrator shutdown', pgError('57P01')],
    ['Postgres starting up', pgError('57P03')],
    ['a serialization failure', pgError('40001')],
    ['a deadlock', pgError('40P01')],
    ['too many connections', pgError('53300')],
    ['a lock not available', pgError('55P03')],
    ['a pg error under drizzle', wrapped(pgError('40P01'))],
    ['a pool timeout under drizzle', wrapped(new Error('timeout exceeded when trying to connect'))],
  ])('%s passes on its own', (_, error) => {
    expect(isTransientDbError(error)).toBe(true)
  })

  test.each([
    ['an invalid uuid', wrapped(pgError('22P02'))],
    ['a unique violation', pgError('23505')],
    ['a check violation', pgError('23514')],
    ['a missing column', pgError('42703')],
    ['a query cancelled by its timeout', pgError('57014')],
    ['an error of the code', new TypeError('cannot read properties of undefined')],
    ['something that is not an error', 'timeout exceeded when trying to connect'],
  ])('%s does not', (_, error) => {
    expect(isTransientDbError(error)).toBe(false)
  })

  test('a cycle of causes ends', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    Object.assign(a, { cause: b })
    expect(isTransientDbError(a)).toBe(false)
  })
})
