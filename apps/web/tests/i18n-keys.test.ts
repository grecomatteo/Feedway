import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { SECURITY_EMAIL_KINDS } from '@app/application'

const it = JSON.parse(
  readFileSync(new URL('../i18n/locales/it.json', import.meta.url), 'utf8'),
) as Record<string, unknown>

function get(messages: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    )
}

// What sendSecurityEmail passes: any other placeholder would make the job fail.
const SECURITY_EMAIL_VALUES = new Set(['product', 'device', 'when', 'whenShort'])

test.each(SECURITY_EMAIL_KINDS)('security email %s has all its texts', (kind) => {
  for (const part of ['subject', 'preheader', 'title', 'intro', 'footer']) {
    const text = get(it, `email.security.${kind}.${part}`)
    expect(text).toEqual(expect.any(String))
    const placeholders = [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    for (const name of placeholders) expect(SECURITY_EMAIL_VALUES).toContain(name)
  }
})

test('the shared texts of the emails are there', () => {
  for (const key of [
    'email.layout.buttonFallback',
    'email.layout.serviceNotice',
    'email.security.unknownIp',
    'email.security.lockExplain',
    'email.security.lockLinkValidity',
    'email.security.lockButton',
    'email.security.cannotDisable',
  ])
    expect(get(it, key), key).toEqual(expect.any(String))
})

test('the lock text and the validity of its link are separate texts', () => {
  expect(get(it, 'email.security.lockExplain')).not.toContain('7 giorni')
  expect(get(it, 'email.security.lockLinkValidity')).toContain('7 giorni')
})
