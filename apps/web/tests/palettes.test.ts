import { PALETTES } from '@app/domain'
import { Palette } from '@app/contracts'
import { paletteIds } from '@app/ui'
import { expect, test } from 'vitest'

test('the palettes the profile accepts are the ones the panel can draw', () => {
  expect([...Palette.options]).toEqual([...paletteIds])
  expect([...PALETTES]).toEqual([...paletteIds])
})
