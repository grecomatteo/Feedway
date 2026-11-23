import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** A bot the mock knows: its token and what `getMe` answers. */
export interface MockBot {
  token: string
  id: number
  username: string
  firstName: string
}

export interface TelegramMockCall {
  method: string
  /** The bot's username, or null for a token the mock does not know. Never the token itself. */
  bot: string | null
  params: Record<string, unknown>
}

export interface SentMessage {
  bot: string
  chatId: number
  text: string
  params: Record<string, unknown>
}

export interface TelegramMock {
  /** The Bot API is at `<url>/bot<token>/<method>`, as on api.telegram.org. */
  url: string
  /** A person writes to the bot from their private chat: an update for `getUpdates`. */
  userWrites(token: string, message: { chatId: number; text: string; firstName?: string }): void
  /** The person blocked the bot: `sendMessage` to that chat answers 403. */
  block(chatId: number): void
  /** The token was revoked with @BotFather: every call with it answers 401. */
  revoke(token: string): void
  /** The next `times` calls of `method` (any by default) answer 429 with `retry_after`. */
  rateLimit(options: { retryAfter: number; times?: number; method?: string }): void
  /** The next `times` calls answer 502, as when Telegram is down. */
  unavailable(options?: { times?: number; method?: string }): void
  sent(): SentMessage[]
  calls(): TelegramMockCall[]
  /** Back to the initial bots, no updates, no messages, no failures. */
  reset(): void
  stop(): Promise<void>
}

interface Failure {
  method: string | null
  times: number
  answer: () => { status: number; body: object }
}

interface Update {
  update_id: number
  message: {
    message_id: number
    date: number
    chat: { id: number; type: 'private'; first_name: string }
    from: { id: number; is_bot: false; first_name: string }
    text: string
  }
}

const PATH = /^\/bot([^/]+)\/([A-Za-z]+)$/
/** The longest wait of a long poll: Telegram's own limit is 50 seconds. */
const MAX_TIMEOUT_S = 50
const MAX_BODY = 1024 * 1024

const error = (status: number, description: string, parameters?: object) => ({
  status,
  body: { ok: false, error_code: status, description, ...(parameters && { parameters }) },
})

async function readParams(req: IncomingMessage, url: URL): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = Object.fromEntries(url.searchParams)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return params
  const raw = Buffer.concat(chunks).toString('utf8')
  const type = req.headers['content-type'] ?? ''
  if (type.includes('application/json')) Object.assign(params, JSON.parse(raw) as object)
  else Object.assign(params, Object.fromEntries(new URLSearchParams(raw)))
  return params
}

/** A fake Telegram Bot API (plan 08 Task 7): `getMe`, `getUpdates`, `sendMessage` and their errors. */
export async function startTelegramMock(
  options: { port?: number; bots?: readonly MockBot[] } = {},
): Promise<TelegramMock> {
  const initialBots = options.bots ?? []
  let bots = new Map(initialBots.map((b) => [b.token, b]))
  let revoked = new Set<string>()
  let blocked = new Set<number>()
  let failures: Failure[] = []
  let updates = new Map<string, Update[]>()
  let sent: SentMessage[] = []
  let calls: TelegramMockCall[] = []
  let nextUpdateId = 1
  let nextMessageId = 1
  let closing = false
  const waiters = new Set<() => void>()
  const wake = () => {
    for (const w of [...waiters]) w()
  }

  function failureFor(method: string) {
    const failure = failures.find((f) => f.method === null || f.method === method)
    if (!failure) return null
    failure.times -= 1
    if (failure.times <= 0) failures = failures.filter((f) => f !== failure)
    return failure.answer()
  }

  async function waitForUpdates(token: string, offset: number, timeoutS: number) {
    const pending = () => (updates.get(token) ?? []).filter((u) => u.update_id >= offset)
    if (pending().length > 0 || timeoutS <= 0) return pending()
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        waiters.delete(check)
        resolve()
      }
      const check = () => {
        if (pending().length > 0 || closing) done()
      }
      const timer = setTimeout(done, Math.min(timeoutS, MAX_TIMEOUT_S) * 1000)
      waiters.add(check)
    })
    return pending()
  }

  async function answer(token: string, method: string, params: Record<string, unknown>) {
    const bot = bots.get(token)
    calls.push({ method, bot: bot?.username ?? null, params })
    if (!bot || revoked.has(token)) return error(401, 'Unauthorized')
    const failed = failureFor(method)
    if (failed) return failed
    switch (method) {
      case 'getMe':
        return {
          status: 200,
          body: {
            ok: true,
            result: { id: bot.id, is_bot: true, first_name: bot.firstName, username: bot.username },
          },
        }
      case 'getUpdates': {
        const offset = Number(params.offset ?? 0)
        // the updates before the offset are confirmed: Telegram forgets them
        updates.set(
          token,
          (updates.get(token) ?? []).filter((u) => u.update_id >= offset),
        )
        const timeout = Number(params.timeout ?? 0)
        const limit = Math.min(Math.max(Number(params.limit ?? 100), 1), 100)
        const found = await waitForUpdates(token, offset, timeout)
        return { status: 200, body: { ok: true, result: found.slice(0, limit) } }
      }
      case 'sendMessage': {
        const chatId = Number(params.chat_id)
        const text = typeof params.text === 'string' ? params.text : ''
        if (!Number.isSafeInteger(chatId) || chatId === 0)
          return error(400, 'Bad Request: chat not found')
        if (text.trim() === '') return error(400, 'Bad Request: message text is empty')
        if (text.length > 4096) return error(400, 'Bad Request: message is too long')
        if (blocked.has(chatId)) return error(403, 'Forbidden: bot was blocked by the user')
        sent.push({ bot: bot.username, chatId, text, params })
        return {
          status: 200,
          body: {
            ok: true,
            result: {
              message_id: nextMessageId++,
              date: Math.floor(Date.now() / 1000),
              chat: { id: chatId, type: 'private' },
              text,
            },
          },
        }
      }
      default:
        return error(404, 'Not Found')
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock')
    const match = PATH.exec(url.pathname)
    const send = (status: number, body: object) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (!match) {
      send(404, { ok: false, error_code: 404, description: 'Not Found' })
      return
    }
    const [, token = '', method = ''] = match
    readParams(req, url)
      .then((params) => answer(token, method, params))
      .then(({ status, body }) => {
        send(status, body)
      })
      .catch(() => {
        send(400, { ok: false, error_code: 400, description: 'Bad Request' })
      })
  })
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${String(port)}`,
    userWrites(token, message) {
      const firstName = message.firstName ?? 'Persona'
      const list = updates.get(token) ?? []
      list.push({
        update_id: nextUpdateId++,
        message: {
          message_id: nextMessageId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: message.chatId, type: 'private', first_name: firstName },
          from: { id: message.chatId, is_bot: false, first_name: firstName },
          text: message.text,
        },
      })
      updates.set(token, list)
      wake()
    },
    block: (chatId) => void blocked.add(chatId),
    revoke: (token) => void revoked.add(token),
    rateLimit: ({ retryAfter, times = 1, method }) => {
      failures.push({
        method: method ?? null,
        times,
        answer: () =>
          error(429, `Too Many Requests: retry after ${String(retryAfter)}`, {
            retry_after: retryAfter,
          }),
      })
    },
    unavailable: ({ times = 1, method } = {}) => {
      failures.push({ method: method ?? null, times, answer: () => error(502, 'Bad Gateway') })
    },
    sent: () => [...sent],
    calls: () => [...calls],
    reset() {
      bots = new Map(initialBots.map((b) => [b.token, b]))
      revoked = new Set()
      blocked = new Set()
      failures = []
      updates = new Map()
      sent = []
      calls = []
      wake()
    },
    async stop() {
      closing = true
      wake()
      await new Promise<void>((resolve, reject) => {
        server.close((e) => {
          if (e) reject(e)
          else resolve()
        })
      })
    },
  }
}
