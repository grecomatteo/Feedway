import type { Translate } from '@app/application'

function lookup(messages: unknown, key: string): unknown {
  let node = messages
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/**
 * The panel's texts (`apps/web/i18n/locales/it.json`), for emails written by the web and the
 * worker. `{name}` placeholders only; a missing key or value throws instead of sending a gap.
 */
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
