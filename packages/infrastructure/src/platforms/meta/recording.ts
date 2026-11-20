const SECRET_KEY = /token|secret|proof/i
const ID_KEY = /^(id|.+_id)$/
const IDS_KEY = /_ids$/
const NAME_KEYS = new Set(['name', 'username', 'application'])
// Meta's free text (errors) may hold ids and never leaves the client
const TEXT_KEYS = new Set(['message', 'error_user_msg', 'error_user_title', 'error_data'])
// the clients' own posts: their text and the links to them stay out of a recording
const POST_KEYS = new Set([
  'caption',
  'permalink',
  'shortcode',
  'description',
  'permalink_url',
  'upload_url',
])
// cursors encode object ids
const CURSOR_KEYS = new Set(['after', 'before'])
// Meta's image hosts (fbcdn, cdninstagram, lookaside on fbsbx) put ids in the file name and signatures in many parameters: never kept
const CDN_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/
const FAKE_PICTURE = 'https://scontent.example.invalid/picture.jpg'
const URL_PARAMS = [
  'oh',
  'oe',
  'access_token',
  'appsecret_proof',
  'input_token',
  'code',
  'after',
  'before',
]

/**
 * Redacts a Graph API answer for META_RECORD_DIR (plan 03, Task 3), so a recording can replace
 * a hand-written fixture of tools/meta-mock: tokens out, image addresses of Meta's CDN replaced whole, ids and
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
      if (CDN_HOST.test(url.hostname)) return FAKE_PICTURE
      for (const param of URL_PARAMS)
        if (url.searchParams.has(param)) url.searchParams.set(param, 'REDACTED')
      url.pathname = url.pathname
        .split('/')
        .map((segment) => (/^\d+$/.test(segment) ? fakeId(segment) : segment))
        .join('/')
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
    if (key !== null && TEXT_KEYS.has(key) && value !== null) return 'REDACTED'
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]))
    // a story's `post_id` may come as a number
    if (typeof value === 'number' && key !== null && ID_KEY.test(key)) return fakeId(String(value))
    if (typeof value !== 'string' || key === null)
      return typeof value === 'string' ? redactString(value) : value
    if (SECRET_KEY.test(key) || TEXT_KEYS.has(key) || CURSOR_KEYS.has(key) || POST_KEYS.has(key))
      return 'REDACTED'
    if (ID_KEY.test(key)) return fakeId(value)
    // a story's link (`url`) is the client's post: Meta's CDN pictures are replaced below
    if (key === 'url' && /^https:\/\/([a-z]+\.)?facebook\.com\//.test(value)) return 'REDACTED'
    if (NAME_KEYS.has(key)) return fakeName(value)
    return redactString(value)
  }

  return (value) => redact(value, null)
}
