import { expect, test } from 'vitest'
import { auditLine } from '../app/utils/audit-line.ts'
import { message, translate } from './rules-table.ts'

// The log says what was done with what it kept (screen 26, review of fidelity B9): the moment of
// a post, the role of a person, the kind of content setting. Never a name or a text.

const has = (key: string) => typeof message(key) === 'string'
const line = (action: string, entity: string | null, data: Record<string, unknown>) =>
  auditLine({ action, entity, data }, { t: translate, has, when: () => 'ven 20 nov, 8:00' })

test('a post scheduled says for when; an older entry without it says what it can', () => {
  expect(line('post.scheduled', 'post', { scheduledAt: '2026-11-20T07:00:00.000Z' })).toBe(
    'ha programmato un post per ven 20 nov, 8:00',
  )
  expect(line('post.scheduled', 'post', {})).toBe('ha programmato un post')
})

test('people: the role they were given', () => {
  expect(line('user.invited', 'invite', { orgRole: 'admin', memberships: [] })).toBe(
    'ha invitato una persona come Admin',
  )
  expect(
    line('user.invited', 'invite', {
      orgRole: 'member',
      memberships: [
        { workspaceId: 'a', role: 'editor' },
        { workspaceId: 'b', role: 'editor' },
      ],
    }),
  ).toBe('ha invitato una persona come Editor')
  expect(
    line('user.invited', 'invite', {
      orgRole: 'member',
      memberships: [
        { workspaceId: 'a', role: 'editor' },
        { workspaceId: 'b', role: 'viewer' },
      ],
    }),
  ).toBe('ha invitato una persona')
  expect(line('member.added', 'user', { role: 'viewer' })).toBe(
    'ha aggiunto una persona al cliente come Viewer',
  )
  expect(line('member.role_changed', 'user', { from: 'viewer', to: 'editor' })).toBe(
    'ha cambiato un ruolo sul cliente in Editor',
  )
  expect(line('user.role_changed', 'user', { from: 'member', to: 'admin' })).toBe(
    'ha cambiato un ruolo in Admin',
  )
})

test('the content settings of a client: what kind, and what happened to it', () => {
  expect(line('workspace.settings_changed', 'label', { change: 'created' })).toBe(
    "ha creato un'etichetta",
  )
  expect(line('workspace.settings_changed', 'caption_template', { change: 'updated' })).toBe(
    'ha modificato un modello di testo',
  )
  expect(line('workspace.settings_changed', 'account_group', { change: 'deleted' })).toBe(
    'ha eliminato un gruppo di account',
  )
})

test('anything else: the sentence of its action, or the action itself', () => {
  expect(line('media.deleted', 'media', {})).toBe('ha eliminato un file della libreria')
  expect(line('something.new', null, {})).toBe('something.new')
})
