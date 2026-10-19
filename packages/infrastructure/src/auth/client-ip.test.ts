import { expect, test } from 'vitest'
import { clientIp } from './client-ip.js'

test('the last X-Forwarded-For entry is the one our proxy appended', () => {
  expect(clientIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }), '10.0.0.2')).toBe(
    '9.9.9.9',
  )
})

test('without X-Forwarded-For the connection address counts', () => {
  expect(clientIp(new Headers(), '203.0.113.5')).toBe('203.0.113.5')
})

test('blank entries are skipped and spaces trimmed', () => {
  expect(clientIp(new Headers({ 'x-forwarded-for': '1.1.1.1 ,  9.9.9.9 , ' }), undefined)).toBe(
    '9.9.9.9',
  )
})

test('an IPv4-mapped IPv6 connection address is written as IPv4', () => {
  expect(clientIp(new Headers(), '::ffff:203.0.113.5')).toBe('203.0.113.5')
})

test('no address at all gives null', () => {
  expect(clientIp(new Headers(), undefined)).toBeNull()
})

test('the header we set ourselves is never trusted on the way in', () => {
  expect(clientIp(new Headers({ 'x-app-client-ip': '6.6.6.6' }), '203.0.113.5')).toBe('203.0.113.5')
})

test('a forwarded value that is not an address gives null', () => {
  expect(clientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }), '203.0.113.5')).toBeNull()
})
