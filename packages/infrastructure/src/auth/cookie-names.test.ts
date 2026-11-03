import { expect, test } from 'vitest'
import { COOKIE_NAMES, DEVICE_COOKIE, PANEL_COOKIES, THEME_COOKIE } from './cookie-names.js'

// a cookie added to the panel without a line in the privacy notice fails here
test('the privacy notice lists exactly the cookies the panel sets', () => {
  expect(PANEL_COOKIES.map((c) => c.name).sort()).toEqual(
    [...Object.values(COOKIE_NAMES).map((c) => c.name), DEVICE_COOKIE, THEME_COOKIE].sort(),
  )
})
