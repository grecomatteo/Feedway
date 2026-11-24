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
      'Le impostazioni dei contenuti di questo cliente le cambia solo chi gestisce i suoi contenuti',
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

/**
 * A change to the client's labels, templates or groups in its activity log (D-76.3, Matteo
 * 18/11): `workspace.settings_changed` with the item as the entity and only what was done,
 * never its name or text. Notes are everyday work and write nothing, as the autosave.
 */
export function recordContentSetting(
  tx: Tx,
  actor: OrgActor,
  scope: PostScope,
  entity: 'label' | 'caption_template' | 'account_group' | 'time_slots',
  entityId: string,
  change: 'created' | 'updated' | 'deleted',
  ip: string | null,
) {
  return tx.audit.record({
    organizationId: scope.organizationId,
    actorId: actor.userId,
    source: 'panel',
    action: 'workspace.settings_changed',
    entity,
    entityId,
    workspaceId: scope.workspaceId,
    ip,
    data: { change },
  })
}
