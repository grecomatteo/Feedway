import { readFileSync } from 'node:fs'

/** A Graph API node as Meta returns it. `{ ref }` values point to another node. */
export type GraphObject = Record<string, unknown> & { id: string }

/** An edge item: a node id, a node id with fields of the edge itself, or an inline object. */
export type EdgeItem =
  string | (Record<string, unknown> & { ref: string }) | Record<string, unknown>

export interface DebugData {
  app_id: string
  type: string
  application: string
  expires_at: number
  data_access_expires_at: number
  is_valid: boolean
  issued_at: number
  scopes: string[]
  granular_scopes: { scope: string; target_ids?: string[] }[]
  user_id: string
}

export interface TokenFixture {
  /** The node that `me` resolves to. */
  subject: string
  /** The business whose use case limits apply (X-Business-Use-Case-Usage key). */
  business: string
  /** Nodes this token can read; any other id answers 100/33. */
  visible: string[]
  /** `debug_token` data; tokens without it (page tokens) are not debugged by Feedway. */
  debug?: DebugData
}

export interface Fixtures {
  app: { id: string; secret: string; configId: string; name: string }
  tokens: Record<string, TokenFixture>
  objects: Record<string, GraphObject>
  edges: Record<string, EdgeItem[]>
  logins: Record<string, { token: string }>
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

/** Fresh copy on every call: a scenario may change the data of one mock only. */
export function loadFixtures(): Fixtures {
  // Files written by us (or recorded and redacted in Task 13): shape trusted, not validated
  return {
    app: read('app') as Fixtures['app'],
    tokens: read('tokens') as Fixtures['tokens'],
    objects: read('objects') as Fixtures['objects'],
    edges: read('edges') as Fixtures['edges'],
    logins: read('logins') as Fixtures['logins'],
  }
}
