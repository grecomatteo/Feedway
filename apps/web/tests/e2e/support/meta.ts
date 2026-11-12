import { randomInt } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { META_MOCK } from '@app/meta-mock'
import { E2E_PASSWORD, addDataKey } from './people.ts'

function headers() {
  const baseURL = process.env.E2E_BASE_URL
  if (!baseURL) throw new Error('e2e server not available')
  return {
    origin: new URL(baseURL).origin,
    'x-app-request': '1',
    'x-forwarded-for': `10.63.${String(randomInt(250))}.${String(randomInt(250))}`,
  }
}

async function send(request: APIRequestContext, method: 'POST' | 'PUT', path: string, data = {}) {
  const res = await request.fetch(path, { method, headers: headers(), data })
  expect(res.status(), `${method} ${path}`).toBe(200)
  return (await res.json()) as unknown
}

/**
 * The agency's Meta app saved through the API of a signed-in Owner, with a recent reauth: what
 * Impostazioni → Integrazioni leaves behind.
 */
export async function metaApp(
  request: APIRequestContext,
  org: string,
  opts: { dataUseCheckupDueOn?: string; businessId?: string } = {},
): Promise<void> {
  await addDataKey(org)
  await send(request, 'POST', '/api/v1/auth/reauth', { password: E2E_PASSWORD })
  await send(request, 'PUT', `/api/v1/orgs/${org}/integrations/meta`, {
    appId: META_MOCK.app.id,
    appSecret: META_MOCK.app.secret,
    ...(opts.dataUseCheckupDueOn && { dataUseCheckupDueOn: opts.dataUseCheckupDueOn }),
    ...(opts.businessId && { businessId: opts.businessId }),
  })
}

/**
 * What «Aggiungi account» leaves behind, through the API of a signed-in Owner: the agency's app,
 * the system user connected with the fake Graph API and every account it sees imported.
 */
export async function connectedAgency(
  request: APIRequestContext,
  org: string,
  opts: { dataUseCheckupDueOn?: string } = {},
): Promise<{ connectionId: string }> {
  await metaApp(request, org, opts)
  const api = `/api/v1/orgs/${org}`
  const connected = (await send(request, 'POST', `${api}/connections/system-user`, {
    token: META_MOCK.tokens.systemUser,
  })) as {
    connection: { id: string }
    accounts: { externalId: string; state: string }[]
  }
  const externalIds = connected.accounts
    .filter((a) => a.state === 'to_import')
    .map((a) => a.externalId)
  await send(request, 'POST', `${api}/connections/${connected.connection.id}/import`, {
    externalIds,
  })
  return { connectionId: connected.connection.id }
}
