// Column helpers shared by every module's schema.ts.
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { customType, timestamp } from 'drizzle-orm/pg-core'

export const citext = customType<{ data: string }>({ dataType: () => 'citext' })
export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const tz = (name: string) => timestamp(name, { withTimezone: true })
export const createdAt = () => tz('created_at').defaultNow().notNull()
export const updatedAt = () =>
  tz('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

/** `column in ('a', 'b')` for check constraints; values are code constants, never input. */
export const inList = (column: string, values: readonly string[]): SQL =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`)
