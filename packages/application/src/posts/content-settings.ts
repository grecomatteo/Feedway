import { DomainError, can, type OrgActor } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import { openPosts } from './common.js'

// What labels, caption templates and account groups share (spec §11.7, plan 06 Task 7): every
// member of the workspace reads them (`workspace.view`, the editor uses them), only who manages
// the client's content changes them (`workspace.content_settings.manage`, Manager and above).

/** As many of each as a workspace may keep: enough for any client, a ceiling for a script. */
export const CONTENT_SETTINGS_MAX = 100

export async function openContentSettings(
  tx: Tx,
  actor: OrgActor,
  workspaceId: string,
  opts: { write: boolean },
): Promise<{ current: OrgActor; scope: PostScope }> {
  const { current, scope } = await openPosts(tx, actor, workspaceId, opts)
  if (opts.write && !can(current, 'workspace.content_settings.manage', scope))
    throw new DomainError(
      'FORBIDDEN',
      'Etichette, modelli e gruppi di questo cliente li cambia solo chi gestisce i suoi contenuti',
    )
  return { current, scope }
}

/** An id of the path that is not a uuid is not found, as one of another workspace. */
export function knownId(id: string, notFound: () => DomainError): string {
  if (!isUuid(id)) throw notFound()
  return id
}

export const tooMany = (what: string) =>
  new DomainError(
    'CONFLICT',
    `Un cliente può avere al massimo ${String(CONTENT_SETTINGS_MAX)} ${what}`,
  )
