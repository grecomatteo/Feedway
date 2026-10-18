import { expect, test } from 'vitest'
import { passwordStrength } from './password-strength.js'

test('common italian passwords score low', () => {
  expect(passwordStrength('juventus1897', [])).toBeLessThan(3)
  expect(
    passwordStrength('mario.rossi.2026', ['mario.rossi@esempio.it', 'Mario Rossi']),
  ).toBeLessThan(3)
  expect(passwordStrength('passwordpassword', [])).toBeLessThan(3)
})

test('a long random passphrase scores high', () => {
  expect(passwordStrength('tramonto-ciclista-quaderno-41', [])).toBeGreaterThanOrEqual(3)
})

test('score stays in 0..4', () => {
  for (const pw of ['', 'a', 'Xk9#mQ2$vL8!pR4@'.repeat(4)]) {
    const s = passwordStrength(pw, [])
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(4)
  }
})

test('parts of the email and name count as known words', () => {
  const inputs = ['zorzetto.quaglio@vortexa.it', 'Zorzetto Quaglio']
  expect(passwordStrength('quagliovortexa', inputs)).toBeLessThan(3)
  expect(passwordStrength('quagliovortexa', [])).toBeGreaterThanOrEqual(3)
})
