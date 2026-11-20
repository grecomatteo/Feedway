// A line of the activity log (screen 26, review of fidelity B9): the action's sentence with
// what the entry kept, «ha programmato un post per ven 20 nov, 8:00», «ha invitato una persona
// come Editor», «ha creato un'etichetta». The log keeps no names or texts: only moments,
// roles and kinds, so nothing here can name someone outside the agency.

export interface AuditLineInput {
  action: string
  entity: string | null
  data: Record<string, unknown> | null
}

export interface AuditLineTools {
  t: (key: string, values?: Record<string, string>) => string
  /** whether it.json has the text */
  has: (key: string) => boolean
  /** an instant as the panel writes it, «ven 20 nov, 8:00» */
  when: (at: string) => string
}

const ROLES = new Set(['owner', 'admin', 'member', 'manager', 'publisher', 'editor', 'viewer'])
const SETTINGS = new Set(['label', 'caption_template', 'account_group'])
const CHANGES = new Set(['created', 'updated', 'deleted'])

const text = (v: unknown) => (typeof v === 'string' ? v : null)

/** The role given to whoever was invited: the agency's, else the one role of every client. */
function invitedRole(data: Record<string, unknown>): string | null {
  const org = text(data.orgRole)
  if (org && org !== 'member') return org
  const list = Array.isArray(data.memberships) ? (data.memberships as { role?: unknown }[]) : []
  const roles = new Set(list.map((m) => text(m.role)))
  return roles.size === 1 ? ([...roles][0] ?? null) : null
}

export function auditLine(item: AuditLineInput, tools: AuditLineTools): string {
  const { t, has, when } = tools
  const data = item.data ?? {}
  const key = item.action.replaceAll('.', '_')
  const role = (r: string | null) => (r && ROLES.has(r) ? t(`roles.${r}`) : null)
  const detailed = (name: string, values: Record<string, string>) =>
    t(`audit.detailed.${name}`, values)

  if (item.action === 'post.scheduled' && text(data.scheduledAt))
    return detailed('post_scheduled', { when: when(text(data.scheduledAt) ?? '') })
  if (item.action === 'user.invited') {
    const r = role(invitedRole(data))
    if (r) return detailed('user_invited', { role: r })
  }
  if (item.action === 'member.added') {
    const r = role(text(data.role))
    if (r) return detailed('member_added', { role: r })
  }
  if (item.action === 'member.role_changed' || item.action === 'user.role_changed') {
    const r = role(text(data.to))
    if (r) return detailed(key, { role: r })
  }
  if (
    item.action === 'workspace.settings_changed' &&
    item.entity &&
    SETTINGS.has(item.entity) &&
    CHANGES.has(text(data.change) ?? '')
  )
    return t(`audit.settings.${item.entity}.${text(data.change) ?? ''}`)
  return has(`audit.actions.${key}`) ? t(`audit.actions.${key}`) : item.action
}
