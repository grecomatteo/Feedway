import { test } from '@playwright/test'
import { moreAgencyBot, type MockBot } from '@app/telegram-mock'
import { adminQuery } from './people.ts'

// One bot serves one agency only (migration 0026): the four projects run side by side, each
// with an agency of its own, so each spec and project takes a fake bot of its own.

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light', 'mobile-dark']

/** The fake agency bot of this spec (0 or 1) and project, freed of a run before (a retry). */
export async function agencyBotFor(spec: 0 | 1): Promise<MockBot> {
  const project = Math.max(PROJECTS.indexOf(test.info().project.name), 0)
  const bot = moreAgencyBot(spec * PROJECTS.length + project)
  await adminQuery("delete from integrations where kind = 'telegram' and config->>'botId' = $1", [
    String(bot.id),
  ])
  return bot
}
