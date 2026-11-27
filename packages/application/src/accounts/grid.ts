import type { Platform, UsageReading } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { ConnectionTokens } from '../ports/connection-tokens.js'
import type {
  ConnectionCredentials,
  PlatformConnector,
  PlatformConnectors,
} from '../ports/platform-connector.js'
import type { PlatformLoad } from '../ports/platform-publisher.js'
import type { Tx } from '../ports/tx.js'

// The account of Instagram's grid (plan 09 Task 12, P4), for the `calendar` module: the only
// reading of the platform the panel makes. The token is opened in the caller's transaction and
// used outside it; it never leaves the server.

export interface GridAccountView {
  id: string
  platform: Platform
  externalId: string
  name: string
  username: string | null
  avatarKey: string | null
}

/** A connector that reads Instagram's grid. */
export type GridConnector = PlatformConnector & Required<Pick<PlatformConnector, 'listGridMedia'>>

const readsGrid = (c: PlatformConnector | undefined): c is GridConnector =>
  c?.listGridMedia !== undefined

/**
 * `unreachable`: the account is there but cannot be read now (its connection does not work,
 * the agency has no app, or no connector can read a grid).
 */
export type OpenedGridAccount =
  | {
      reachable: true
      account: GridAccountView
      connector: GridConnector
      credentials: ConnectionCredentials
    }
  | { reachable: false; account: GridAccountView }

type GridScope = { organizationId: string; workspaceId: string }

/** The client's Instagram account, and the connection that reads it when it works now. */
async function findGridAccount(
  tx: Tx,
  connectors: PlatformConnectors,
  scope: GridScope,
  accountId: string,
) {
  if (!isUuid(accountId)) return null
  const { organizationId } = scope
  const records = await tx.accounts.list(organizationId, { workspaceIds: [scope.workspaceId] })
  const record = records.find((r) => r.id === accountId)
  if (record?.platform !== 'instagram') return null
  const account: GridAccountView = {
    id: record.id,
    platform: record.platform,
    externalId: record.externalId,
    name: record.name,
    username: record.username,
    avatarKey: record.avatarKey,
  }
  if (!record.active) return { account, reader: null }
  const connection = await tx.connections.findWithToken(organizationId, record.connectionId)
  if (!connection || (connection.status !== 'active' && connection.status !== 'pending'))
    return { account, reader: null }
  const connector = connectors[connection.kind]
  return { account, reader: readsGrid(connector) ? { connection, connector } : null }
}

/**
 * An Instagram account assigned to the client, with what reads its grid; null when the id is
 * not one of the client's Instagram accounts (another agency's, another client's, a Page).
 * The client is visible to the person, already checked. Public, for `calendar`.
 */
export async function openGridAccount(
  tx: Tx,
  deps: { connectors: PlatformConnectors; tokens: ConnectionTokens },
  scope: GridScope,
  accountId: string,
): Promise<OpenedGridAccount | null> {
  const found = await findGridAccount(tx, deps.connectors, scope, accountId)
  if (!found) return null
  const { account, reader } = found
  if (!reader) return { reachable: false, account }
  const { connection, connector } = reader
  const app = await connector.loadAppCredentials(tx, scope.organizationId)
  if (app === null) return { reachable: false, account }
  const token = await deps.tokens.open(tx, {
    organizationId: scope.organizationId,
    id: connection.id,
    tokenEnc: connection.tokenEnc,
  })
  return { reachable: true, account, connector, credentials: { app, token } }
}

/**
 * What downloads the pictures of the grid of the client's Instagram account (P4): the account
 * as `openGridAccount` finds it, without opening its token, since a picture's address needs
 * none. null: not one of the client's Instagram accounts, or not readable now. Public, for
 * `calendar`.
 */
export async function openGridPictures(
  tx: Tx,
  deps: { connectors: PlatformConnectors },
  scope: GridScope,
  accountId: string,
): Promise<Pick<PlatformConnector, 'fetchPicture'> | null> {
  const found = await findGridAccount(tx, deps.connectors, scope, accountId)
  return found?.reader?.connector ?? null
}

/**
 * What the platform's answer said of its limits, kept on the account as the publishing keeps
 * it (§8.6, D-111): the worker slows down when the panel's readings used the allowance up.
 */
export async function recordGridLoad(
  tx: Tx,
  organizationId: string,
  accountId: string,
  load: PlatformLoad | null,
  at: Date,
): Promise<void> {
  if (!load || (load.accountPercent === null && load.appPercent === null)) return
  const reading: UsageReading = { ...load, readAt: at }
  await tx.accounts.recordUsageReading(organizationId, accountId, reading)
}
