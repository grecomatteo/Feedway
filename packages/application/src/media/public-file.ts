import { PUBLIC_TOKEN_LENGTH } from '@app/domain'
import type { Storage } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { readCopy } from './library.js'
import type { ByteRange, MediaFile } from './library.js'

// The one read of the public host (`/m/*`, spec §16.1, ADR 021): a token names a copy in any
// agency, so it is looked up in the system scope, and only the copy's file comes back. Listed
// in the ESLint rule on `runAsSystem`.

/** What `/m/*` serves, by extension: JPEG and MP4 only (§15.4). */
const PUBLIC_TYPES: Readonly<Record<string, string>> = { jpg: 'image/jpeg', mp4: 'video/mp4' }

const PUBLIC_NAME = new RegExp(`^([A-Za-z0-9_-]{${String(PUBLIC_TOKEN_LENGTH)}})\\.(jpg|mp4)$`)

/** Whether a name has the form of a public copy's: only those ask the database. */
export const isPublicMediaName = (name: string) => PUBLIC_NAME.test(name)

/**
 * The copy named `{token}.{jpg|mp4}`, whole or a byte range of it. null: not found, the same
 * answer for a name of the wrong form (the database is not asked), an unknown token, a file not
 * `ready` or deleted, and an extension that does not match the copy's type.
 */
export async function readPublicMediaFile(
  deps: { uow: UnitOfWork; storage: Storage },
  input: { name: string; range: ByteRange | null },
): Promise<MediaFile | null> {
  const match = PUBLIC_NAME.exec(input.name)
  if (!match) return null
  const [, token = '', ext = ''] = match
  const variant = await deps.uow.runAsSystem(
    'public host: copy by token',
    (tx) => tx.media.findPublicVariant(token),
    { routine: true },
  )
  if (!variant || variant.mime !== PUBLIC_TYPES[ext]) return null
  return readCopy(deps.storage, variant, input.range)
}
