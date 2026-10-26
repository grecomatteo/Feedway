import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The panel's Italian texts. The image holds only `dist/`, so build.mjs copies the file to
 * `dist/locales/it.json`; from the sources (tests) it is read from apps/web.
 */
const CANDIDATES = [
  new URL('./locales/it.json', import.meta.url),
  new URL('../../web/i18n/locales/it.json', import.meta.url),
]

export function loadItalianMessages(): unknown {
  const found = CANDIDATES.find((url) => existsSync(fileURLToPath(url)))
  if (found === undefined) throw new Error('it.json not found next to the worker')
  return JSON.parse(readFileSync(found, 'utf8'))
}

/** Pure, shared with the web: it lives with the other adapters. */
export { createTranslate } from '@app/infrastructure'
