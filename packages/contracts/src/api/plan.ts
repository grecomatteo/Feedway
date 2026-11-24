import { z } from 'zod'
import { Id, OrgParams, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'

// The editorial plan (spec §11.12, plan 09 Task 6): contents of a client to prepare, before any
// post exists. Who sees the client reads the plan, note included (`plan.view`); Publisher and
// above write it (`plan.edit`); Editor and above prepare a post from it (`plan.prepare`). With
// the module off for the agency every route answers 404.

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const LocalTime = z.string().regex(/^\d{2}:\d{2}$/)
const PlanItemType = z.enum(['photo', 'carousel', 'reel', 'story'])

export const PlanItemDto = z.object({
  id: Id,
  workspaceId: Id,
  localDate: LocalDate,
  localTime: LocalTime.nullable(),
  type: PlanItemType,
  title: z.string(),
  /** for who prepares it: only in the plan, never in the calendar or anywhere else */
  note: z.string(),
  /** the post that prepares it; a cancelled one gives the content back («to_prepare») */
  postId: Id.nullable(),
  state: z.enum(['to_prepare', 'due_soon', 'late', 'prepared']),
  /** the instant «In ritardo» and «Mancano meno di 36 ore» count from */
  dueAt: Timestamp,
  version: z.number().int(),
})
export type PlanItemDto = z.infer<typeof PlanItemDto>

const ItemParams = z.strictObject({ org: OrgSlug, itemId: Id })

export const listPlanRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/plan',
  summary: 'Il piano editoriale di un cliente in un periodo (al massimo 42 giorni), nota compresa',
  request: {
    params: OrgParams,
    query: z.strictObject({ workspaceId: Id, from: LocalDate, to: LocalDate }),
  },
  response: z.object({ timeZone: z.string(), items: z.array(PlanItemDto) }),
  auth: 'session',
  scope: 'organization',
})

export const createPlanItemRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/plan',
  summary: 'Aggiunge un contenuto al piano: giorno, tipo e titolo; ora e nota facoltative',
  request: {
    params: OrgParams,
    body: z.strictObject({
      workspaceId: Id,
      localDate: z.string().max(20),
      localTime: z.string().max(10).nullable().optional(),
      type: z.string().max(20),
      title: z.string().max(400),
      note: z.string().max(10_000).optional(),
    }),
  },
  response: PlanItemDto,
  auth: 'session',
  scope: 'organization',
})

export const updatePlanItemRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/plan/{itemId}',
  summary:
    'Cambia o sposta un contenuto del piano, con la versione letta (409 se un’altra persona l’ha cambiato)',
  request: {
    params: ItemParams,
    body: z.strictObject({
      version: z.number().int().min(1),
      localDate: z.string().max(20).optional(),
      localTime: z.string().max(10).nullable().optional(),
      type: z.string().max(20).optional(),
      title: z.string().max(400).optional(),
      note: z.string().max(10_000).optional(),
    }),
  },
  response: PlanItemDto,
  auth: 'session',
  scope: 'organization',
})

export const deletePlanItemRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/plan/{itemId}',
  summary: 'Toglie un contenuto dal piano: il post che è diventato resta com’è',
  request: { params: ItemParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const preparePlanItemRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/plan/{itemId}/prepare',
  summary:
    'Prepara il contenuto: una bozza del cliente con tipo, giorno e ora; se è già preparato risponde con il suo post',
  request: { params: ItemParams },
  response: z.object({ postId: Id, created: z.boolean() }),
  auth: 'session',
  scope: 'organization',
})

export const planRoutes = [
  listPlanRoute,
  createPlanItemRoute,
  updatePlanItemRoute,
  deletePlanItemRoute,
  preparePlanItemRoute,
] as const
