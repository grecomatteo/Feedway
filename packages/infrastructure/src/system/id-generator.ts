import { v7 } from 'uuid'
import type { IdGenerator } from '@app/application'

export const uuidV7Generator: IdGenerator = { newId: () => v7() }
