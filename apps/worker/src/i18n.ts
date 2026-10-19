import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Translate } from '@app/application'

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

function lookup(messages: unknown, key: string): unknown {
  let node = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** `{name}` placeholders only; a missing key or value throws instead of sending a gap. */
export function createTranslate(messages: unknown): Translate {
  return (key, values = {}) => {
    const template = lookup(messages, key)
    if (typeof template !== 'string') throw new Error(`missing text: ${key}`)
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = values[name]
      if (value === undefined) throw new Error(`missing value ${name} for ${key}`)
      return value
    })
  }
}
