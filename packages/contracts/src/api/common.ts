import { z } from 'zod'

// Shared pieces of the /api/v1 contracts. Lengths are generous: the use cases check the exact
// rules and answer with their own Italian messages; these limits only keep junk out.

/** The agency in the path: compared only with the slugs of the person's memberships. */
export const OrgSlug = z.string().min(1).max(100)
export const Id = z.uuid()

export const OrgParams = z.strictObject({ org: OrgSlug })

/** Dates leave as ISO 8601 strings. */
export const Timestamp = z.iso.datetime()

export const OrgRole = z.enum(['owner', 'admin', 'member'])
export const WorkspaceRole = z.enum(['manager', 'publisher', 'editor', 'viewer'])
export const TwoFactorPolicy = z.enum(['admins', 'all'])
