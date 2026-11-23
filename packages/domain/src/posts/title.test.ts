import { expect, test } from 'vitest'
import { fileTitle } from './title.js'

// A post without text is named by its type and its first file: «Storia · IMG_0233» (D-120.7).
test('the name of the file without its extension', () => {
  expect(fileTitle('IMG_0233.HEIC')).toBe('IMG_0233')
  expect(fileTitle('pane caldo.final.jpg')).toBe('pane caldo.final')
  expect(fileTitle('senza estensione')).toBe('senza estensione')
  expect(fileTitle('.nascosto')).toBe('.nascosto')
})

test('no name, or only spaces: none', () => {
  expect(fileTitle(null)).toBeNull()
  expect(fileTitle('   ')).toBeNull()
})
