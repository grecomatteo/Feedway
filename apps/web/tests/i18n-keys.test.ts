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

// What sendAccountLockedNotice and sendAccountRecoveryEmail pass to their texts.
const NOTICE_VALUES = new Set(['product', 'name'])
const RECOVERY_VALUES = new Set(['product', 'minutes', 'time'])

test.each([
  [
    'email.lockNotice',
    NOTICE_VALUES,
    [
      'subject',
      'preheader',
      'title',
      'intro',
      'doneTitle',
      'doneText',
      'caution',
      'labels.person',
      'labels.email',
      'labels.organizations',
      'admin.lead',
      'admin.text',
      'admin.footer',
      'owner.lead',
      'owner.text',
      'owner.footer',
    ],
  ],
  [
    'email.accountRecovery',
    RECOVERY_VALUES,
    [
      'subject',
      'preheader',
      'title',
      'intro',
      'button',
      'expiryTitle',
      'expiryToday',
      'expiryTomorrow',
      'secondFactor',
      'notMe',
      'footer',
    ],
  ],
] as const)('%s has all its texts, with known placeholders only', (base, values, parts) => {
  for (const part of parts) {
    const text = get(it, `${base}.${part}`)
    expect(text, `${base}.${part}`).toEqual(expect.any(String))
    for (const m of String(text).matchAll(/\{(\w+)\}/g)) expect(values).toContain(m[1])
  }
})
