import { expect, test } from 'vitest'
import { pathForLog } from '../server/utils/log-path.js'

const TOKEN = `${'a'.repeat(16)}${'B'.repeat(16)}`

test.each([
  [`/m/${TOKEN}.jpg`, '/m/…'],
  [`/m/${TOKEN}.jpg/`, '/m/…'],
  [`/m/${TOKEN}.jpg/x?y=1`, '/m/…'],
  [`/M/${TOKEN}.jpg`, '/m/…'],
  [`//m/${TOKEN}.jpg`, '/m/…'],
  [`/%6D/${TOKEN}.jpg`, '/m/…'],
  [`http://media.example/m/${TOKEN}.jpg`, '/m/…'],
  [`/share/${TOKEN}`, '/share/…'],
  ['/m', '/m/…'],
])('%s is logged as %s', (url, logged) => {
  expect(pathForLog(url)).toBe(logged)
})

test('other paths keep their shape, without anything as long as a token', () => {
  expect(pathForLog('/api/v1/me?x=1')).toBe('/api/v1/me')
  expect(pathForLog(`/attiva/${TOKEN}`)).toBe('/attiva/…')
  expect(pathForLog('/media/foto')).toBe('/media/foto')
  expect(pathForLog(`/x/${'y'.repeat(300)}`)).toBe('/x/…')
})
