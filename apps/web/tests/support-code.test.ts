import { expect, test } from 'vitest'
import { withSupportCode } from '../app/utils/support-code.ts'

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'

test('an unexpected error shows the request id the message asks for', () => {
  expect(withSupportCode('Riprova; se continua, comunica questo codice.', 'INTERNAL', ID)).toBe(
    `Riprova; se continua, comunica questo codice. Codice: ${ID}`,
  )
})

test('other errors and missing or malformed ids leave the message alone', () => {
  expect(withSupportCode('Troppi tentativi.', 'RATE_LIMITED', ID)).toBe('Troppi tentativi.')
  expect(withSupportCode('Errore.', 'INTERNAL', undefined)).toBe('Errore.')
  expect(withSupportCode('Errore.', 'INTERNAL', '<script>')).toBe('Errore.')
})
