import { createHmac, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseFields, renderObject } from './fields.ts'
import {
  loadFixtures,
  type DebugData,
  type EdgeItem,
  type Fixtures,
  type GraphObject,
  type TokenFixture,
} from './fixtures.ts'
import {
  matches,
  type ActiveScenario,
  type Match,
  type ScenarioArgs,
  type ScenarioName,
  type ScenarioOptions,
} from './scenarios.ts'

export interface MetaMockCall {
  method: string
  version: string
  /** Path without the version: `/me/accounts`, `/oauth/access_token`. */
  path: string
  params: Record<string, string>
  /** Where the access token came from. */
  tokenIn: 'header' | 'query' | 'none'
}

export interface MetaMock {
  /** Base address: the Graph API is at `<url>/<version>/…`, the login dialog at `<url>/<version>/dialog/oauth`. */
  url: string
  scenario<N extends ScenarioName>(name: N, ...args: ScenarioArgs<N>): void
  calls(): MetaMockCall[]
  stop(): Promise<void>
}

interface GraphErrorBody {
  message: string
  type: string
  code: number
  error_subcode?: number
}

interface Usage {
  call_count: number
  total_cputime: number
  total_time: number
}

const NORMAL_USAGE: Usage = { call_count: 4, total_cputime: 2, total_time: 3 }
const FULL_USAGE: Usage = { call_count: 100, total_cputime: 100, total_time: 100 }
const DEFAULT_LIMIT = 25
const VERSIONED = /^\/(v\d+\.\d+)(\/.*)$/

const RATE_LIMIT_MESSAGES: Record<number, string> = {
  4: '(#4) Application request limit reached',
  17: '(#17) User request limit reached',
  32: '(#32) Page request limit reached',
  613: '(#613) Calls to this api have exceeded the rate limit.',
  80001: '(#80001) There have been too many calls to this Page account.',
  80002: '(#80002) There have been too many calls to this Instagram account.',
}

const unsupportedGet = (id: string): GraphErrorBody => ({
  message: `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`,
  type: 'GraphMethodException',
  code: 100,
  error_subcode: 33,
})

const fbtraceId = () => randomBytes(8).toString('base64url')
const cursor = (offset: number) => Buffer.from(String(offset)).toString('base64url')
const offsetOf = (value: string | undefined) =>
  value === undefined ? 0 : Number(Buffer.from(value, 'base64url').toString()) || 0

export async function startMetaMock(opts: { port?: number } = {}): Promise<MetaMock> {
  let data: Fixtures = loadFixtures()
  let active: ActiveScenario[] = []
  let calls: MetaMockCall[] = []
  const codes = new Map<string, { redirectUri: string; token: string; used: boolean }>()
  const timers = new Set<NodeJS.Timeout>()
  const removed = new Set<string>()

  const scenariosNamed = <N extends ScenarioName>(name: N) =>
    active.filter((s): s is Extract<ActiveScenario, { name: N }> => s.name === name)
  const has = (name: ScenarioName) => active.some((s) => s.name === name)

  function send(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...headers })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  function sendError(
    res: ServerResponse,
    error: GraphErrorBody,
    status = 400,
    headers: Record<string, string> = {},
  ): void {
    send(res, status, { error: { ...error, fbtrace_id: fbtraceId() } }, headers)
  }

  function usageHeaders(token: TokenFixture | undefined, full: boolean, minutes = 0) {
    const usage = full ? FULL_USAGE : NORMAL_USAGE
    const headers: Record<string, string> = { 'x-app-usage': JSON.stringify(usage) }
    if (token !== undefined)
      headers['x-business-use-case-usage'] = JSON.stringify({
        [token.business]: [
          { type: 'instagram', ...usage, estimated_time_to_regain_access: full ? minutes : 0 },
        ],
      })
    return headers
  }

  /** Infrastructure faults: they replace the answer before Meta looks at the request. */
  function fault(path: string, res: ServerResponse, carryOn: () => void): boolean {
    const hit = active.find(
      (s) =>
        ['rate_limited', 'transient_error', 'error', 'timeout', 'malformed', 'html_5xx'].includes(
          s.name,
        ) &&
        s.remaining > 0 &&
        matches(s.opts as Match, path),
    )
    if (hit === undefined) return false
    hit.remaining -= 1
    const retryAfter = (value: number | undefined): Record<string, string> =>
      value === undefined ? {} : { 'retry-after': String(value) }
    switch (hit.name) {
      case 'rate_limited': {
        const code = hit.opts.code ?? 80002
        sendError(
          res,
          { message: RATE_LIMIT_MESSAGES[code] ?? 'Rate limit', type: 'OAuthException', code },
          400,
          usageHeaders(undefined, true),
        )
        return true
      }
      case 'transient_error':
        sendError(
          res,
          {
            message: 'An unexpected error has occurred. Please retry your request later.',
            type: 'OAuthException',
            code: hit.opts.code ?? 2,
          },
          hit.opts.status ?? 500,
          retryAfter(hit.opts.retryAfter),
        )
        return true
      case 'error':
        sendError(
          res,
          {
            message: `(#${String(hit.opts.code)}) Error written by meta-mock`,
            type: hit.opts.type ?? 'OAuthException',
            code: hit.opts.code,
            ...(hit.opts.subcode === undefined ? {} : { error_subcode: hit.opts.subcode }),
          },
          hit.opts.status ?? 400,
          retryAfter(hit.opts.retryAfter),
        )
        return true
      case 'timeout': {
        const timer = setTimeout(() => {
          timers.delete(timer)
          carryOn()
        }, hit.opts.delayMs ?? 15_000)
        timers.add(timer)
        return true
      }
      case 'malformed':
        send(res, 200, hit.opts.body ?? '{"data":[{"id":"5000000000000001","name":')
        return true
      case 'html_5xx':
        res.writeHead(hit.opts.status ?? 502, {
          'content-type': 'text/html; charset=utf-8',
          ...retryAfter(hit.opts.retryAfter),
        })
        res.end(
          '<!DOCTYPE html><html><head><title>Error</title></head><body>Sorry, something went wrong.</body></html>',
        )
        return true
      default:
        return false
    }
  }

  function debugDataFor(input: string, token: TokenFixture | undefined): Record<string, unknown> {
    if (token?.debug === undefined)
      return {
        is_valid: false,
        scopes: [],
        error: { code: 190, message: 'Invalid OAuth access token.' },
      }
    const debug: DebugData = structuredClone(token.debug)
    for (const s of scenariosNamed('permission_missing')) {
      if (s.opts.token !== undefined && s.opts.token !== input) continue
      const permission = s.opts.permission ?? 'instagram_content_publish'
      debug.scopes = debug.scopes.filter((p) => p !== permission)
      debug.granular_scopes = debug.granular_scopes.filter((g) => g.scope !== permission)
    }
    if (isExpired(input))
      return {
        ...debug,
        is_valid: false,
        expires_at: debug.issued_at + 3600,
        error: { code: 190, subcode: 463, message: 'Session has expired.' },
      }
    return { ...debug }
  }

  const isExpired = (token: string) =>
    scenariosNamed('token_expired').some(
      (s) => s.opts.token === undefined || s.opts.token === token,
    )

  function dialog(params: URLSearchParams, res: ServerResponse): void {
    const redirectUri = params.get('redirect_uri')
    const state = params.get('state')
    if (
      params.get('client_id') !== data.app.id ||
      params.get('config_id') !== data.app.configId ||
      redirectUri === null ||
      state === null
    ) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!DOCTYPE html><html><body>Invalid login request.</body></html>')
      return
    }
    const back = new URL(redirectUri)
    if (has('access_denied')) {
      back.searchParams.set('error', 'access_denied')
      back.searchParams.set('error_code', '200')
      back.searchParams.set('error_description', 'Permissions error')
      back.searchParams.set('error_reason', 'user_denied')
    } else {
      const login = data.logins[has('personal_ig_profile') ? 'personal_ig' : 'client']
      const code = `mock-code-${randomBytes(12).toString('hex')}`
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- both logins are in the fixtures
      codes.set(code, { redirectUri, token: login!.token, used: false })
      back.searchParams.set('code', code)
    }
    back.searchParams.set('state', state)
    res.writeHead(302, { location: back.toString() })
    res.end()
  }

  function exchange(params: URLSearchParams, res: ServerResponse): void {
    if (
      params.get('client_id') !== data.app.id ||
      params.get('client_secret') !== data.app.secret
    ) {
      sendError(res, {
        message: 'Error validating application.',
        type: 'OAuthException',
        code: 101,
      })
      return
    }
    const issued = codes.get(params.get('code') ?? '')
    if (issued === undefined) {
      sendError(res, {
        message: 'Invalid verification code format.',
        type: 'OAuthException',
        code: 100,
        error_subcode: 36007,
      })
      return
    }
    if (issued.used) {
      sendError(res, {
        message: 'This authorization code has been used.',
        type: 'OAuthException',
        code: 100,
        error_subcode: 36009,
      })
      return
    }
    if (params.get('redirect_uri') !== issued.redirectUri) {
      sendError(res, {
        message:
          'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request',
        type: 'OAuthException',
        code: 100,
        error_subcode: 36008,
      })
      return
    }
    issued.used = true
    send(res, 200, { access_token: issued.token, token_type: 'bearer' })
  }

  function debugToken(params: URLSearchParams, appToken: string | undefined, res: ServerResponse) {
    if (appToken !== `${data.app.id}|${data.app.secret}`) {
      sendError(res, {
        message: 'Invalid OAuth access token - Cannot parse access token',
        type: 'OAuthException',
        code: 190,
      })
      return
    }
    const input = params.get('input_token')
    if (input === null) {
      sendError(res, {
        message: '(#100) The parameter input_token is required',
        type: 'OAuthException',
        code: 100,
      })
      return
    }
    send(
      res,
      200,
      { data: debugDataFor(input, data.tokens[input]) },
      usageHeaders(undefined, false),
    )
  }

  function graph(
    method: string,
    path: string,
    params: URLSearchParams,
    tokenValue: string | undefined,
    res: ServerResponse,
    self: string,
  ): void {
    if (tokenValue === undefined) {
      sendError(res, {
        message: 'An access token is required to request this resource.',
        type: 'OAuthException',
        code: 104,
      })
      return
    }
    const token = data.tokens[tokenValue]
    if (token === undefined) {
      sendError(res, {
        message: 'Invalid OAuth access token - Cannot parse access token',
        type: 'OAuthException',
        code: 190,
      })
      return
    }
    const proof = params.get('appsecret_proof')
    if (proof === null) {
      sendError(res, {
        message: 'API calls from the server require an appsecret_proof argument',
        type: 'GraphMethodException',
        code: 100,
      })
      return
    }
    if (proof !== createHmac('sha256', data.app.secret).update(tokenValue).digest('hex')) {
      sendError(res, {
        message: 'Invalid appsecret_proof provided in the API argument',
        type: 'GraphMethodException',
        code: 100,
      })
      return
    }
    const headers = usageHeaders(token, false)
    if (isExpired(tokenValue)) {
      sendError(
        res,
        {
          message: 'Error validating access token: Session has expired.',
          type: 'OAuthException',
          code: 190,
          error_subcode: 463,
        },
        400,
        headers,
      )
      return
    }
    const denied = scenariosNamed('permission_missing').find(
      (s) =>
        s.opts.path !== undefined &&
        matches(s.opts, path) &&
        (s.opts.token === undefined || s.opts.token === tokenValue),
    )
    if (denied !== undefined) {
      const code = denied.opts.code ?? 10
      sendError(
        res,
        {
          message: `(#${String(code)}) Application does not have permission for this action`,
          type: 'OAuthException',
          code,
        },
        403,
        headers,
      )
      return
    }
    if (method !== 'GET') {
      sendError(
        res,
        {
          message: `Unsupported ${method.toLowerCase()} request.`,
          type: 'GraphMethodException',
          code: 100,
        },
        400,
        headers,
      )
      return
    }

    const [first = '', edge, ...rest] = path.slice(1).split('/')
    const id = first === 'me' ? token.subject : first
    const canSee = (nodeId: string) => token.visible.includes(nodeId) && !removed.has(nodeId)
    if (!canSee(id) || rest.length > 0) {
      sendError(res, unsupportedGet(id), 400, headers)
      return
    }
    const lookup = (nodeId: string) => (canSee(nodeId) ? data.objects[nodeId] : undefined)
    const fields = params.has('fields') ? parseFields(params.get('fields') ?? '') : null

    if (edge === undefined) {
      const node = data.objects[id]
      if (node === undefined) sendError(res, unsupportedGet(id), 400, headers)
      else send(res, 200, renderObject(node, fields, lookup), headers)
      return
    }

    if (edge === 'permissions' && first === 'me') {
      const debug = debugDataFor(tokenValue, token) as { scopes?: string[] }
      const granted = new Set(debug.scopes ?? [])
      const all = token.debug?.scopes ?? []
      send(
        res,
        200,
        {
          data: all.map((p) => ({
            permission: p,
            status: granted.has(p) ? 'granted' : 'declined',
          })),
        },
        headers,
      )
      return
    }

    const items = data.edges[`${id}/${edge}`]
    if (items === undefined) {
      sendError(
        res,
        {
          message: `(#100) Tried accessing nonexisting field (${edge})`,
          type: 'OAuthException',
          code: 100,
        },
        400,
        headers,
      )
      return
    }
    sendEdge(res, headers, { id, edge, items, fields, lookup, params, self })
  }

  function sendEdge(
    res: ServerResponse,
    headers: Record<string, string>,
    e: {
      id: string
      edge: string
      items: EdgeItem[]
      fields: ReturnType<typeof parseFields> | null
      lookup: (id: string) => GraphObject | undefined
      params: URLSearchParams
      self: string
    },
  ) {
    const withoutToken = new Set(
      e.edge === 'accounts'
        ? scenariosNamed('page_without_token').map((s) => s.opts.pageId ?? '5000000000000002')
        : [],
    )
    const exhausted =
      e.edge === 'content_publishing_limit' &&
      scenariosNamed('quota_exhausted').some((s) => (s.opts.igUserId ?? e.id) === e.id)

    const rows: Record<string, unknown>[] = []
    let inline = false
    for (const item of e.items) {
      if (typeof item === 'string' || 'ref' in item) {
        const { ref, ...extra } =
          typeof item === 'string' ? { ref: item } : (item as { ref: string })
        const node = e.lookup(ref)
        if (node === undefined) continue
        const row: Record<string, unknown> = { ...node, ...extra }
        if (withoutToken.has(ref)) delete row.access_token
        rows.push(row)
      } else {
        inline = true
        const row = structuredClone(item)
        if (exhausted) {
          const config = row.config as { quota_total?: number } | undefined
          row.quota_usage = config?.quota_total ?? 50
        }
        rows.push(row)
      }
    }
    const rendered = rows.map((row) => renderObject(row, e.fields, e.lookup))
    if (inline) {
      send(res, 200, { data: rendered }, headers)
      return
    }

    const limit = Math.max(1, Number(e.params.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT)
    const start = offsetOf(e.params.get('after') ?? undefined)
    const page = rendered.slice(start, start + limit)
    const body: Record<string, unknown> = { data: page }
    if (page.length > 0) {
      const after = cursor(start + page.length)
      const paging: Record<string, unknown> = { cursors: { before: cursor(start), after } }
      if (start + page.length < rendered.length) {
        const next = new URL(e.self)
        for (const key of ['access_token', 'appsecret_proof']) next.searchParams.delete(key)
        next.searchParams.set('after', after)
        next.searchParams.set('limit', String(limit))
        paging.next = next.toString()
      }
      body.paging = paging
    }
    if (e.params.get('summary') === 'total_count') body.summary = { total_count: rendered.length }
    send(res, 200, body, headers)
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const self = new URL(req.url ?? '/', 'http://meta-mock.invalid')
    const versioned = VERSIONED.exec(self.pathname)
    const header = req.headers.authorization
    const bearer =
      header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : undefined
    const queryToken = self.searchParams.get('access_token') ?? undefined
    const version = versioned?.[1] ?? ''
    const path = versioned?.[2] ?? self.pathname
    calls.push({
      method: req.method ?? 'GET',
      version,
      path,
      params: Object.fromEntries(self.searchParams),
      tokenIn: bearer !== undefined ? 'header' : queryToken !== undefined ? 'query' : 'none',
    })
    if (versioned === null) {
      sendError(
        res,
        { message: 'Unknown path components', type: 'OAuthException', code: 2500 },
        400,
      )
      return
    }
    const params = self.searchParams
    if (path === '/dialog/oauth') {
      dialog(params, res)
      return
    }
    const fullSelf = `http://${req.headers.host ?? 'meta-mock.invalid'}${self.pathname}${self.search}`
    const route = () => {
      if (path === '/oauth/access_token') exchange(params, res)
      else if (path === '/debug_token') debugToken(params, bearer ?? queryToken, res)
      else graph(req.method ?? 'GET', path, params, bearer ?? queryToken, res, fullSelf)
    }
    if (!fault(path, res, route)) route()
  }

  const server = createServer(handle)
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${String(port)}`,
    scenario<N extends ScenarioName>(name: N, ...args: ScenarioArgs<N>) {
      if (name === 'default') {
        data = loadFixtures()
        active = []
        removed.clear()
        return
      }
      const opts = (args[0] ?? {}) as ScenarioOptions[N]
      if (name === 'asset_removed') removed.add((opts as ScenarioOptions['asset_removed']).id)
      const times = (opts as { times?: number }).times
      active.push({ name, opts, remaining: times ?? Infinity } as ActiveScenario)
    },
    calls: () => calls.map((c) => ({ ...c, params: { ...c.params } })),
    async stop() {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      calls = []
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        }),
      )
    },
  }
}
