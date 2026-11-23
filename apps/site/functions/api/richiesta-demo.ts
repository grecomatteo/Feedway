// Cloudflare Pages Function for POST /api/richiesta-demo (ADR 016). It checks the form and sends
// one email to Matteo through Email Routing; it stores nothing and sets no cookie.
// Bindings, set in the Cloudflare dashboard (docs/runbooks/sito-pubblico.md):
//   DEMO_MAIL  send_email binding whose destination is Matteo's verified address
//   DEMO_FROM  sender on the site's domain, e.g. demo@<dominio>
//   DEMO_TO    Matteo's verified address (a secret, never in the repository)
// @ts-expect-error: module provided by the Workers runtime
import { EmailMessage as UntypedEmailMessage } from 'cloudflare:email'
import { buildDemoEmail, parseDemoRequest } from '../../shared/demo-request.ts'

// The runtime class, typed by hand: (from, to, raw RFC 5322 message).
const EmailMessage = UntypedEmailMessage as new (from: string, to: string, raw: string) => unknown

interface Env {
  DEMO_MAIL: { send(message: unknown): Promise<void> }
  DEMO_FROM: string
  DEMO_TO: string
}

interface Context {
  request: Request
  env: Env
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json')
  let input: Record<string, unknown>
  try {
    // the form is urlencoded, both from the browser (no JS) and from the page's fetch
    input = Object.fromEntries(new URLSearchParams(await request.text()))
  } catch {
    return reply(wantsJson, 400, { ok: false, reason: 'invalid', errors: {} })
  }

  const parsed = parseDemoRequest(input, Date.now())
  // a bot gets the same answer as a person, so it learns nothing
  if (!parsed.ok && parsed.reason === 'spam') return reply(wantsJson, 200, { ok: true })
  if (!parsed.ok) return reply(wantsJson, 422, parsed)

  const host = env.DEMO_FROM.split('@')[1] ?? 'feedway'
  const raw = buildDemoEmail(parsed.request, {
    from: env.DEMO_FROM,
    to: env.DEMO_TO,
    date: new Date(),
    messageId: `<${crypto.randomUUID()}@${host}>`,
  })
  try {
    await env.DEMO_MAIL.send(new EmailMessage(env.DEMO_FROM, env.DEMO_TO, raw))
  } catch {
    return reply(wantsJson, 502, { ok: false, reason: 'unavailable' })
  }
  return reply(wantsJson, 200, { ok: true })
}

/** With JavaScript the page reads JSON; without it, the browser follows a redirect. */
function reply(
  json: boolean,
  status: number,
  body: { ok: boolean; reason?: string; errors?: unknown },
): Response {
  if (json) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const target = body.ok
    ? '/richiedi-una-demo/inviata'
    : body.reason === 'unavailable'
      ? '/richiedi-una-demo/non-inviata'
      : '/richiedi-una-demo/da-correggere'
  return new Response(null, {
    status: 303,
    headers: { location: target, 'cache-control': 'no-store' },
  })
}
