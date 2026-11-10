import type {
  AccountListing,
  IntegrationStore,
  MetaAppCredentials,
  PermissionCheck,
  PlatformAccount,
  PlatformConnector,
  TokenCheck,
} from '@app/application'
import { META_REQUIRED_PERMISSIONS } from '@app/domain/platforms/meta'
import { createMetaAppConnector } from './app-connector.js'
import { MetaError, type MetaErrorReason } from './errors.js'
import type {
  MetaFacebookPage,
  MetaGraphClient,
  MetaInstagramAccount,
  MetaPage,
  MetaResult,
  MetaTokenCredentials,
} from './graph-client.js'

// The system user of the agency's Business Manager (spec §8.1, plan 03 Task 6): a pasted token
// that does not expire. The listing is shared with the unified login (Task 7).

/** The agency's app as the Meta connectors carry it, opaque to the accounts module. */
export interface MetaConnectorApp extends MetaAppCredentials {
  /** The Business Manager whose pages and profiles the system user lists; null: only its own. */
  businessId: string | null
}

/** At most this many requests for one listing: 50 items each, far more than an agency holds. */
export const MAX_LIST_REQUESTS = 40

/** The listing cannot go on: too many pages, or Meta sent a page already seen. */
export class MetaListingError extends Error {
  constructor(readonly why: 'too_many_requests' | 'repeated_page') {
    super(`Meta account listing stopped: ${why}`)
    this.name = 'MetaListingError'
  }
}

// Meta's answer says the token (or what it may see) is refused; the others say nothing about it.
const REFUSED: ReadonlySet<MetaErrorReason> = new Set([
  'token_invalid',
  'token_revoked',
  'checkpoint',
  'page_role_missing',
  'permission_missing',
  'not_found_or_forbidden',
  'rejected',
])

/**
 * Every page of one edge. The client follows only the cursor, on its own Graph address: Meta's
 * `paging.next` is never fetched, so no other host is ever reached. A cursor seen twice, or
 * more requests than `budget` allows, stops the listing.
 */
async function readAll<T>(
  read: (after: string | undefined) => Promise<MetaResult<MetaPage<T>>>,
  budget: { left: number },
): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let after: string | undefined
  for (;;) {
    if (budget.left <= 0) throw new MetaListingError('too_many_requests')
    budget.left -= 1
    const { data } = await read(after)
    items.push(...data.items)
    if (data.nextCursor === null) return items
    if (seen.has(data.nextCursor)) throw new MetaListingError('repeated_page')
    seen.add(data.nextCursor)
    after = data.nextCursor
  }
}

const instagramOf = (ig: MetaInstagramAccount, pageId: string | null): PlatformAccount => ({
  platform: 'instagram',
  externalId: ig.id,
  name: ig.name ?? ig.username ?? ig.id,
  username: ig.username,
  avatarUrl: ig.profilePictureUrl,
  pageId,
  problem: null,
})

/**
 * Pages and Instagram profiles a Meta token sees, without doubles. `me/accounts` gives the
 * pages the user has a role on, each with its page token; the business edges add the pages of
 * the portfolio and of the clients who gave access as partners (`client_pages`), and the
 * profiles with no page. A page that arrives with no token anywhere cannot be published to:
 * "role missing". Not verified on real Meta (docs/platforms/meta.md, end of Task 7).
 */
export async function listMetaAccounts(
  client: Pick<
    MetaGraphClient,
    'listUserPages' | 'listBusinessPages' | 'listBusinessInstagramAccounts'
  >,
  credentials: MetaTokenCredentials,
  businessId: string | null,
): Promise<PlatformAccount[]> {
  const budget = { left: MAX_LIST_REQUESTS }
  const pages: MetaFacebookPage[] = await readAll(
    (after) => client.listUserPages(credentials, after === undefined ? {} : { after }),
    budget,
  )
  const igWithoutPage: MetaInstagramAccount[] = []
  if (businessId !== null) {
    for (const relation of ['owned', 'client'] as const)
      pages.push(
        ...(await readAll(
          (after) =>
            client.listBusinessPages(credentials, {
              businessId,
              relation,
              ...(after === undefined ? {} : { after }),
            }),
          budget,
        )),
      )
    igWithoutPage.push(
      ...(await readAll(
        (after) =>
          client.listBusinessInstagramAccounts(credentials, {
            businessId,
            ...(after === undefined ? {} : { after }),
          }),
        budget,
      )),
    )
  }

  const byPage = new Map<string, MetaFacebookPage & { hasToken: boolean }>()
  for (const page of pages) {
    const before = byPage.get(page.id)
    const hasToken = (before?.hasToken ?? false) || page.accessToken !== null
    byPage.set(page.id, {
      ...page,
      instagramAccount: before?.instagramAccount ?? page.instagramAccount,
      hasToken,
    })
  }
  const accounts: PlatformAccount[] = []
  const seenIg = new Set<string>()
  for (const page of byPage.values()) {
    accounts.push({
      platform: 'facebook',
      externalId: page.id,
      name: page.name ?? page.id,
      username: null,
      avatarUrl: page.pictureUrl,
      pageId: page.id,
      problem: page.hasToken ? null : 'role_missing',
    })
    const ig = page.instagramAccount
    if (ig !== null && !seenIg.has(ig.id)) {
      seenIg.add(ig.id)
      accounts.push(instagramOf(ig, page.id))
    }
  }
  for (const ig of igWithoutPage)
    if (!seenIg.has(ig.id)) {
      seenIg.add(ig.id)
      accounts.push(instagramOf(ig, null))
    }
  return accounts
}

/** The listing as the accounts module takes it: never a Meta error. */
export async function classifiedListing(
  list: () => Promise<PlatformAccount[]>,
): Promise<AccountListing> {
  try {
    return { ok: true, accounts: await list() }
  } catch (error) {
    if (error instanceof MetaListingError) return { ok: false, reason: 'unavailable' }
    if (!(error instanceof MetaError)) throw error
    return { ok: false, reason: REFUSED.has(error.reason) ? 'rejected' : 'unavailable' }
  }
}

export function createMetaSystemUserConnector(deps: {
  client: MetaGraphClient
  integrations: Pick<IntegrationStore, 'credentials'>
}): PlatformConnector<MetaConnectorApp> {
  const { client } = deps
  const app = createMetaAppConnector(client)
  return {
    verifyApp: (credentials) => app.verifyApp(credentials),

    async loadAppCredentials(tx, organizationId) {
      const found = await deps.integrations.credentials(tx, organizationId, 'meta')
      if (found === null) return null
      return {
        appId: found.config.appId,
        appSecret: found.secret,
        businessId: found.config.businessId,
      }
    },

    async connectWithToken(credentials, token): Promise<TokenCheck> {
      let info
      try {
        info = (await client.debugToken(credentials, token)).data
      } catch (error) {
        if (!(error instanceof MetaError)) throw error
        // debug_token authenticates the app: a refusal is about the app, not the token
        return {
          ok: false,
          reason: REFUSED.has(error.reason) ? 'app_rejected' : 'unavailable',
          permissions: [],
        }
      }
      const scopes = new Set(info.scopes)
      const permissions: PermissionCheck[] = META_REQUIRED_PERMISSIONS.map((name) => ({
        name,
        granted: scopes.has(name),
      }))
      // a token of another app would also fail every call, its proof made with our secret
      if (!info.isValid || info.appId !== credentials.appId || info.userId === null)
        return { ok: false, reason: 'rejected', permissions: [] }
      if (permissions.some((p) => !p.granted))
        return { ok: false, reason: 'permissions_missing', permissions }
      return {
        ok: true,
        externalUserId: info.userId,
        // `never`, and `unknown` (no date given): treated as not expiring; a token that stops
        // working is found by the daily health check (Task 10). Not verified on real Meta.
        expiresAt: info.expiresAt instanceof Date ? info.expiresAt : null,
        permissions,
      }
    },

    listAccounts({ app: credentials, token }) {
      return classifiedListing(() =>
        listMetaAccounts(
          client,
          { accessToken: token, appSecret: credentials.appSecret },
          credentials.businessId,
        ),
      )
    },
  }
}
