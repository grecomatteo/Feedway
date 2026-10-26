import { expect, test } from 'vitest'
import { DOMAIN_ERROR_CODES, DomainError } from './errors.js'

test('DomainError carries code', () => {
  expect(new DomainError('NOT_FOUND', 'x').code).toBe('NOT_FOUND')
})

test('DomainError carries structured details and is an Error', () => {
  const e = new DomainError('CONFLICT', 'dup', { field: 'email' })
  expect(e).toBeInstanceOf(Error)
  expect(e.details).toEqual({ field: 'email' })
})

test('the error codes are listed at run time, once each', () => {
  expect(DOMAIN_ERROR_CODES).toContain('LINK_INVALID')
  expect(DOMAIN_ERROR_CODES).toEqual(
    expect.arrayContaining(['MAIL_NOT_CONFIGURED', 'MAIL_SEND_FAILED']),
  )
  expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length)
})
