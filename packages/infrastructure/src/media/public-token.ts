import { randomBytes } from 'node:crypto'
import { PUBLIC_TOKEN_LENGTH } from '@app/domain'

/** The address of a copy on the public host (§16.1): 32 characters, 192 random bits. */
export const newPublicToken = (): string =>
  randomBytes((PUBLIC_TOKEN_LENGTH * 3) / 4).toString('base64url')
