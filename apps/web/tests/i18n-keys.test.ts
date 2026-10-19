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
const SECURITY_EMAIL_VALUES = new Set(['product', 'device', 'ip', 'when', 'lockUrl'])

test.each(SECURITY_EMAIL_KINDS)('security email %s has a subject and a text', (kind) => {
  for (const part of ['subject', 'text']) {
    const text = get(it, `email.security.${kind}.${part}`)
    expect(text).toEqual(expect.any(String))
    const placeholders = [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    for (const name of placeholders) expect(SECURITY_EMAIL_VALUES).toContain(name)
  }
  expect(get(it, `email.security.${kind}.text`)).toContain('{lockUrl}')
})

test('the unknown address has a text', () => {
  expect(get(it, 'email.security.unknownIp')).toEqual(expect.any(String))
})
