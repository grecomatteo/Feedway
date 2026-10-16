import { expect, test } from 'vitest'
import { DomainError } from './errors.js'

test('DomainError carries code', () => {
  expect(new DomainError('NOT_FOUND', 'x').code).toBe('NOT_FOUND')
})

test('DomainError carries structured details and is an Error', () => {
  const e = new DomainError('CONFLICT', 'dup', { field: 'email' })
  expect(e).toBeInstanceOf(Error)
  expect(e.details).toEqual({ field: 'email' })
})
