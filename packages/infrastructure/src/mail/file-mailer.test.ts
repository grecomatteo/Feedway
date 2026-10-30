import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PLATFORM_SENDER } from '@app/application'
import { uuidV7Generator } from '../system/id-generator.js'
import { createFileMailer, readFileMailbox } from './file-mailer.js'
import { createMemoryMailer } from './memory-mailer.js'
import { notConfiguredMailer } from './not-configured-mailer.js'

const message = (n: number) => ({
  to: `p${String(n)}@example.test`,
  subject: 's',
  text: 't',
  html: 'h',
})
let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
})

test('file mailer writes messages that another process reads in order', async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'mailer-')), 'box')
  const mailer = createFileMailer({ dir, ids: uuidV7Generator })
  expect(await readFileMailbox(dir)).toEqual([])
  for (const n of [1, 2, 3]) expect(await mailer.send(message(n), PLATFORM_SENDER)).toBe('sent')
  expect((await readFileMailbox(dir)).map((m) => m.to)).toEqual([
    'p1@example.test',
    'p2@example.test',
    'p3@example.test',
  ])
})

test('memory mailer keeps what it sends', async () => {
  const mailer = createMemoryMailer()
  await mailer.send(message(1), { organizationId: 'org-1' })
  await mailer.send(message(2), PLATFORM_SENDER)
  expect(mailer.sent).toEqual([message(1), message(2)])
  expect(mailer.senders).toEqual([{ organizationId: 'org-1' }, { organizationId: null }])
  expect(await mailer.isConfigured(null)).toBe(true)
})

test('not configured mailer drops the message and says so', async () => {
  expect(await notConfiguredMailer.isConfigured(null)).toBe(false)
  expect(await notConfiguredMailer.isConfigured('org-1')).toBe(false)
  expect(await notConfiguredMailer.send(message(1), PLATFORM_SENDER)).toBe('not_configured')
})
