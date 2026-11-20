import { expect, test } from 'vitest'
import { PUBLISH_ERROR_CODES, publishErrorMessage } from '@app/domain'
import { message } from './rules-table.ts'

// Codes, not texts (plan 07, Task 2): every reason a destination did not come out has its
// words, and every text its code.
test('every publishing error has its text, and every text its code', () => {
  for (const code of PUBLISH_ERROR_CODES)
    expect(message(publishErrorMessage(code)), code).toEqual(expect.any(String))
  expect(Object.keys(message('publishing.errors') as object).sort()).toEqual(
    [...PUBLISH_ERROR_CODES].sort(),
  )
})
