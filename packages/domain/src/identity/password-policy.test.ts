import { expect, test, vi } from 'vitest'
import { checkPassword, MIN_PASSWORD_SCORE } from './password-policy.js'

const ctx = { email: 'mario@example.test', name: 'Mario Rossi' }

test('11 chars is too short', () => {
  expect(checkPassword('a'.repeat(11), ctx, () => 4)).toEqual({ ok: false, reason: 'TOO_SHORT' })
})
test('length counts characters, not UTF-16 units', () => {
  expect(checkPassword('😀'.repeat(11), ctx, () => 4)).toEqual({ ok: false, reason: 'TOO_SHORT' })
  expect(checkPassword('😀'.repeat(12), ctx, () => 4)).toEqual({ ok: true })
})
test('more than 128 chars is too long', () => {
  expect(checkPassword('a'.repeat(129), ctx, () => 4)).toEqual({ ok: false, reason: 'TOO_LONG' })
  expect(checkPassword('a'.repeat(128), ctx, () => 4)).toEqual({ ok: true })
})
test('weak password is rejected', () => {
  expect(checkPassword('passwordpassword', ctx, () => 1)).toEqual({ ok: false, reason: 'TOO_WEAK' })
  expect(checkPassword('passwordpassword', ctx, () => MIN_PASSWORD_SCORE)).toEqual({ ok: true })
})
test('email and name are passed to the estimator', () => {
  const spy = vi.fn(() => 4)
  checkPassword('x'.repeat(12), { email: 'mario@x.it', name: 'Mario' }, spy)
  expect(spy).toHaveBeenCalledWith('x'.repeat(12), expect.arrayContaining(['mario@x.it', 'Mario']))
})
