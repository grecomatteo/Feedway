import { expect, test } from 'vitest'
import { captionStats, publishedCaption } from './caption.js'

test('characters are Unicode code points (D-46)', () => {
  expect(captionStats('a'.repeat(2200)).characters).toBe(2200)
  expect(captionStats('a'.repeat(2201)).characters).toBe(2201)
  expect(captionStats('ciao 😀').characters).toBe(6)
  // a hand with a skin tone is two code points; a family joined by ZWJ is five
  expect(captionStats('👍🏽').characters).toBe(2)
  expect(captionStats('👨‍👩‍👧').characters).toBe(5)
  expect(captionStats('').characters).toBe(0)
})

test('hashtags count every time, a lone # does not', () => {
  const tags = Array.from({ length: 30 }, (_, i) => `#tag${String(i)}`).join(' ')
  expect(captionStats(tags).hashtags).toBe(30)
  expect(captionStats(`${tags} #uno`).hashtags).toBe(31)
  expect(captionStats('#pizza #pizza #pizza').hashtags).toBe(3)
  expect(captionStats('# niente, #, &#39;').hashtags).toBe(0)
  expect(captionStats('#caffè_al_bar #2026').hashtags).toBe(2)
})

test('mentions are @ and a user name; an email address is not a mention', () => {
  expect(captionStats('grazie @forno.luce e @mario_rossi!').mentions).toBe(2)
  expect(captionStats('scrivi a info@forno.it').mentions).toBe(0)
  expect(captionStats('@ e @@').mentions).toBe(0)
  expect(captionStats(`@${'a'.repeat(30)}`).mentions).toBe(1)
  expect(captionStats(`@${'a'.repeat(31)}`).mentions).toBe(0)
})

const caption = { common: 'Comune', instagram: 'Solo Instagram' }

test('a platform with its own text publishes it, the others the common text', () => {
  expect(publishedCaption({ type: 'photo', caption }, 'instagram')).toBe('Solo Instagram')
  expect(publishedCaption({ type: 'photo', caption }, 'facebook')).toBe('Comune')
})

test('a story publishes no text', () => {
  expect(publishedCaption({ type: 'story', caption }, 'instagram')).toBe('')
})
