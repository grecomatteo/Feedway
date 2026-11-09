import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { EMAIL_LOGO_PNG } from './email-logo.js'

test('the logo attached to the emails is the one of the brand kit in the web app', () => {
  const file = readFileSync(
    new URL('../../../../apps/web/public/email/feedway-logo@2x.png', import.meta.url),
  )
  expect(EMAIL_LOGO_PNG.equals(file)).toBe(true)
})
