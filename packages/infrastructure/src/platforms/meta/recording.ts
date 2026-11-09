const SECRET_KEY = /token|secret|proof/i
const ID_KEY = /^(id|.+_id)$/
const IDS_KEY = /_ids$/
const NAME_KEYS = new Set(['name', 'username', 'application'])
const SIGNED_URL_PARAMS = ['oh', 'oe', 'access_token', 'appsecret_proof', 'input_token', 'code']

/**
 * Redacts a Graph API answer for META_RECORD_DIR (plan 03, Task 3), so a recording can replace
 * a hand-written fixture of tools/meta-mock: tokens out, signed image addresses out, ids and
 * names replaced by stable values (the same real id gives the same fake id across one session).
 */
export function createRecordingRedactor(): (value: unknown) => unknown {
  const ids = new Map<string, string>()
  const names = new Map<string, string>()
  const fakeId = (id: string) => {
    let fake = ids.get(id)
    if (fake === undefined) {
      fake = String(9_000_000_000_000_001 + ids.size)
      ids.set(id, fake)
    }
    return fake
  }
  const fakeName = (name: string) => {
    let fake = names.get(name)
    if (fake === undefined) {
      fake = `name-${String(names.size + 1)}`
      names.set(name, fake)
    }
    return fake
  }

  const redactString = (text: string): string => {
    if (!/^https?:\/\//.test(text)) return text
    try {
      const url = new URL(text)
      for (const param of SIGNED_URL_PARAMS)
        if (url.searchParams.has(param)) url.searchParams.set(param, 'REDACTED')
      return url.toString()
    } catch {
      return text
    }
  }

  const redact = (value: unknown, key: string | null): unknown => {
    if (Array.isArray(value))
      return value.map((item) =>
        key !== null && IDS_KEY.test(key) && typeof item === 'string'
          ? fakeId(item)
          : redact(item, null),
      )
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
    if (typeof value !== 'string' || key === null)
      return typeof value === 'string' ? redactString(value) : value
    if (SECRET_KEY.test(key)) return 'REDACTED'
    if (ID_KEY.test(key)) return fakeId(value)
    if (NAME_KEYS.has(key)) return fakeName(value)
    return redactString(value)
  }

  return (value) => redact(value, null)
}
