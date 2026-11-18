import { DomainError, can, displayName, validateNoteBody, type OrgActor } from '@app/domain'
import type { IdGenerator } from '../ports/id-generator.js'
import type { PostNoteRecord, PostScope } from '../ports/posts.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { openPosts, postNotFound } from './common.js'
import { knownId } from './content-settings.js'

// The internal notes of a post (spec §11.7, §10.2 «note»; plan 06 Task 7): whoever writes posts
// in the workspace (`post.draft`) adds one to any post, someone else's too; a note is taken off
// by its author, or by whoever may change anyone's post (`post.manage_others`, Manager and
// above). Every member of the workspace reads them. Notes never leave the agency: no answer
// meant for a client carries them (§11.10).

export interface PostNoteDto {
  id: string
  body: string
  authorId: string
  /** the author's name as the agency knows it now */
  authorName: string
  createdAt: string
  /** whether the reader may take it off */
  canDelete: boolean
}

export const noteNotFound = () => new DomainError('NOT_FOUND', 'Nota non trovata')

const mayDelete = (actor: OrgActor, scope: PostScope, note: PostNoteRecord) =>
  note.authorId === actor.userId
    ? can(actor, 'post.draft', scope)
    : can(actor, 'post.manage_others', scope)

async function toDtos(
  tx: Tx,
  actor: OrgActor,
  scope: PostScope,
  notes: readonly PostNoteRecord[],
): Promise<PostNoteDto[]> {
  // the authors are or were people of the agency: they wrote on its post
  const people = new Map(
    (await tx.users.summaries([...new Set(notes.map((n) => n.authorId))])).map((u) => [
      u.id,
      displayName(u),
    ]),
  )
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    authorId: n.authorId,
    authorName: people.get(n.authorId) ?? '',
    createdAt: n.createdAt.toISOString(),
    canDelete: mayDelete(actor, scope, n),
  }))
}

async function postOf(tx: Tx, scope: PostScope, postId: string) {
  const post = await tx.posts.find(scope, knownId(postId, postNotFound))
  if (!post) throw postNotFound()
  return post
}

export async function listNotes(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; postId: string },
): Promise<{ items: PostNoteDto[] }> {
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: false })
      const post = await postOf(tx, scope, input.postId)
      return { items: await toDtos(tx, current, scope, await tx.posts.listNotes(scope, post.id)) }
    },
  )
}

export async function addNote(
  deps: { uow: UnitOfWork; ids: IdGenerator },
  actor: OrgActor,
  input: { workspaceId: string; postId: string; body: string },
): Promise<PostNoteDto> {
  const body = validateNoteBody(input.body)
  if (body === null)
    throw new DomainError('VALIDATION', 'La nota va da 1 a 2.000 caratteri', { field: 'body' })
  return deps.uow.run(
    { organizationId: actor.organizationId, userId: actor.userId },
    async (tx) => {
      const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
      // on the workspace, not on the post: an Editor notes someone else's post too (§10.2)
      if (!can(current, 'post.draft', scope))
        throw new DomainError('FORBIDDEN', 'Non puoi scrivere note sui post di questo cliente')
      const post = await postOf(tx, scope, input.postId)
      const note = await tx.posts.insertNote(scope, {
        id: deps.ids.newId(),
        postId: post.id,
        authorId: current.userId,
        body,
      })
      const [dto] = await toDtos(tx, current, scope, [note])
      if (!dto) throw noteNotFound()
      return dto
    },
  )
}

export async function deleteNote(
  deps: { uow: UnitOfWork },
  actor: OrgActor,
  input: { workspaceId: string; postId: string; noteId: string },
): Promise<void> {
  await deps.uow.run({ organizationId: actor.organizationId, userId: actor.userId }, async (tx) => {
    const { current, scope } = await openPosts(tx, actor, input.workspaceId, { write: true })
    const post = await postOf(tx, scope, input.postId)
    const note = await tx.posts.findNote(scope, post.id, knownId(input.noteId, noteNotFound))
    if (!note) throw noteNotFound()
    if (!mayDelete(current, scope, note))
      throw new DomainError(
        'FORBIDDEN',
        note.authorId === current.userId
          ? 'Non puoi togliere note sui post di questo cliente'
          : 'Questa nota è di un’altra persona: può toglierla solo lei o chi gestisce il cliente',
      )
    if (!(await tx.posts.deleteNote(scope, post.id, note.id))) throw noteNotFound()
  })
}
