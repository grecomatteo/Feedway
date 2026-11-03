import { encode } from 'uqr'
import { expect, test } from 'vitest'
import { qrPath } from '../app/utils/qr-path.ts'

const URI = 'otpauth://totp/Feedway:anna%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Feedway'

test('the path draws one square per dark module, with a quiet zone around the code', () => {
  const { size, d } = qrPath(URI)
  const modules = encode(URI, { ecc: 'M', border: 0 }).data
  const dark = modules.flat().filter(Boolean).length
  expect(size).toBe(modules.length + 8)
  expect(d.match(/M/g)).toHaveLength(dark)
  // first dark module of the finder pattern, after the 4-module quiet zone
  expect(d.startsWith('M4 4h1v1h-1z')).toBe(true)
})

test('the same text always gives the same drawing', () => {
  expect(qrPath(URI)).toEqual(qrPath(URI))
})
