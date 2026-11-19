import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'
import { POST_CHECK_TYPES } from './rules.js'
import { POST_STATUSES } from './posts.js'

// «Oggi» (redesign R3, screens 02 and 03): reads across the clients the person sees, never the
// hidden ones, not even in a count. `workspaceId` narrows to one client (the selector's), and a
// client the person does not see is 404. An archived client is left out.

const OrgParams = z.strictObject({ org: OrgSlug })
const Platform = z.enum(['instagram', 'facebook'])

/** The copy of the first file that the panel shows; null for the Viewer (D-72). */
const AgendaThumbnail = z
  .object({ mediaId: Id, variant: z.enum(['thumbnail', 'ig_feed']) })
  .nullable()

export const AgendaPost = z.object({
  id: Id,
  workspaceId: Id,
  type: z.enum(POST_CHECK_TYPES),
  status: z.enum(POST_STATUSES),
  scheduledAt: Timestamp,
  /** IANA, the post's own (D-58) */
  timezone: z.string(),
  /** the start of the text on one line, at most 140 characters; '' when there is none */
  text: z.string(),
  platforms: z.array(Platform),
  mediaCount: z.number().int(),
  thumbnail: AgendaThumbnail,
})
export type AgendaPost = z.infer<typeof AgendaPost>

export const agendaRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/agenda',
  summary: 'I post che escono nel periodo (al massimo 42 giorni), dei clienti che la persona vede',
  request: {
    params: OrgParams,
    query: z.strictObject({
      /** from now when left out */
      from: Timestamp.optional(),
      /** seven days after `from` when left out */
      to: Timestamp.optional(),
      workspaceId: Id.optional(),
    }),
  },
  response: z.object({ items: z.array(AgendaPost) }),
  auth: 'session',
  scope: 'organization',
})

export const DraftToFinish = z.object({
  id: Id,
  workspaceId: Id,
  type: z.enum(POST_CHECK_TYPES),
  text: z.string(),
  /** what it lacks before «Programma», read from its fields: none means ready */
  missing: z.array(z.enum(['media', 'text', 'accounts'])),
  updatedAt: Timestamp,
  thumbnail: AgendaThumbnail,
})
export type DraftToFinish = z.infer<typeof DraftToFinish>

export const agendaDraftsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/agenda/drafts',
  summary: 'Le bozze cambiate da poco, con cosa manca, e quante sono in tutto',
  request: {
    params: OrgParams,
    query: z.strictObject({
      limit: z.coerce.number().int().min(1).max(20).optional(),
      workspaceId: Id.optional(),
    }),
  },
  response: z.object({ items: z.array(DraftToFinish), total: z.number().int() }),
  auth: 'session',
  scope: 'organization',
})

export const AgendaIssue = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('profile'),
    workspaceId: Id,
    profileKey: z.string(),
    /** its Facebook Page's name, or its only account's */
    name: z.string(),
    platform: Platform,
    link: z.enum(['reconnect', 'error', 'warning']),
    /** scheduled posts from `from` that go to one of its accounts */
    scheduled: z.number().int(),
  }),
  z.object({
    kind: z.literal('media'),
    workspaceId: Id,
    mediaId: Id,
    name: z.string(),
    failedAt: Timestamp,
    /** «Riprova» can prepare it again */
    retryable: z.boolean(),
  }),
])
export type AgendaIssue = z.infer<typeof AgendaIssue>

export const agendaIssuesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/agenda/issues',
  summary:
    'Da sistemare: profili da ricollegare e file non riusciti (questi solo per chi usa la libreria)',
  request: {
    params: OrgParams,
    query: z.strictObject({
      workspaceId: Id.optional(),
      /** the moment the posts are counted from: the panel's now; the server's when left out */
      from: Timestamp.optional(),
    }),
  },
  response: z.object({ items: z.array(AgendaIssue) }),
  auth: 'session',
  scope: 'organization',
})

export const ClientActivity = z.object({
  workspaceId: Id,
  /** scheduled posts from `from` */
  scheduled: z.number().int(),
  nextAt: Timestamp.nullable(),
  /** the latest change to one of its posts */
  changedAt: Timestamp,
})
export type ClientActivity = z.infer<typeof ClientActivity>

export const agendaClientsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/agenda/clients',
  summary: 'Per ogni cliente con dei post: quanti escono da ora, il prossimo, l’ultima modifica',
  request: {
    params: OrgParams,
    query: z.strictObject({
      /** the moment the posts are counted from: the panel's now; the server's when left out */
      from: Timestamp.optional(),
    }),
  },
  response: z.object({ items: z.array(ClientActivity) }),
  auth: 'session',
  scope: 'organization',
})

export const agendaRoutes = [agendaRoute, agendaDraftsRoute, agendaIssuesRoute, agendaClientsRoute]
