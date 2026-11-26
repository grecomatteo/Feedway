import { z } from 'zod'
import { Id, OrgParams, OrgSlug, Timestamp } from './common.js'
import { defineContract, FileResponse } from './define.js'
import { POST_CHECK_TYPES } from './rules.js'
import { POST_STATUSES } from './posts.js'

// The calendar (spec §11.4, plan 09 Task 2, P1): one read for a period of at most 42 days, the
// posts of the clients the person sees and the entries of the modules the agency uses, with the
// days in the agency's zone (D-58). `workspaceId` is a client's calendar; a client the person
// does not see is 404. The list view adds the drafts without a date.

const Platform = z.enum(['instagram', 'facebook'])
/** `YYYY-MM-DD`, a day of the agency's calendar; the use case checks it is a real one. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const LocalTime = z.string().regex(/^\d{2}:\d{2}$/)

/** A filter of many values, in the query as `a,b,c`; at most 50. */
const listOf = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .string()
    .max(2000)
    .transform((v) => v.split(',').filter((x) => x !== ''))
    .pipe(z.array(item).max(50))
    .optional()

const CalendarFilterQuery = {
  workspaceId: Id.optional(),
  /** narrows «Tutti i clienti» to these; ignored with `workspaceId` */
  workspaceIds: listOf(Id),
  accountIds: listOf(Id),
  platforms: listOf(Platform),
  types: listOf(z.enum(POST_CHECK_TYPES)),
  statuses: listOf(z.enum(POST_STATUSES)),
  authorIds: listOf(Id),
  labelIds: listOf(Id),
}

const Thumbnail = z.object({ mediaId: Id, variant: z.enum(['thumbnail', 'ig_feed']) }).nullable()

export const CalendarPost = z.object({
  id: Id,
  workspaceId: Id,
  type: z.enum(POST_CHECK_TYPES),
  status: z.enum(POST_STATUSES),
  /** null: a draft without a date */
  scheduledAt: Timestamp.nullable(),
  /** IANA, the post's own (D-58) */
  timezone: z.string(),
  /** where the calendar puts it, in the agency's zone */
  localDate: LocalDate.nullable(),
  localTime: LocalTime.nullable(),
  /** the start of the text on one line, '' when there is none */
  text: z.string(),
  /** the first file's name without its extension, for a post without text (D-120.7) */
  firstFile: z.string().nullable(),
  mediaCount: z.number().int(),
  /** null for the Viewer (D-72) */
  thumbnail: Thumbnail,
  accounts: z.array(z.object({ id: Id, platform: Platform })),
  labelIds: z.array(Id),
  createdBy: Id,
  missing: z.array(z.enum(['media', 'text', 'accounts'])),
  /** no text, files, accounts or date: «Elimina le bozze vuote» takes it */
  empty: z.boolean(),
  notOut: z.number().int(),
  version: z.number().int(),
  updatedAt: Timestamp,
})
export type CalendarPost = z.infer<typeof CalendarPost>

/** A day's entry of a module (`plan` for the dashed cards); `data` is declared by the module. */
export const CalendarEntry = z.object({
  source: z.string(),
  id: z.string(),
  workspaceId: Id,
  localDate: LocalDate,
  localTime: LocalTime.nullable(),
  title: z.string(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
})
export type CalendarEntry = z.infer<typeof CalendarEntry>

export const calendarRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/calendar',
  summary:
    'Il calendario di un periodo (al massimo 42 giorni): i post dei clienti che la persona vede e le voci dei moduli',
  request: {
    params: OrgParams,
    query: z.strictObject({
      /** the first and last day, both counted; the week of today without them */
      from: LocalDate.optional(),
      to: LocalDate.optional(),
      ...CalendarFilterQuery,
      quick: z
        .enum(['to_publish', 'published', 'with_problem', 'to_prepare', 'today', 'this_week'])
        .optional(),
      show: z.enum(['posts', 'plan', 'both']).optional(),
    }),
  },
  response: z.object({
    /** the agency's zone, the one the days are counted in */
    timeZone: z.string(),
    /** the days read: those asked, within a quick filter's */
    from: LocalDate,
    to: LocalDate,
    posts: z.array(CalendarPost.extend({ marks: z.array(z.string()) })),
    entries: z.array(CalendarEntry),
    /** more than 2.000: the rest is left out */
    truncated: z.boolean(),
  }),
  auth: 'session',
  scope: 'organization',
})

export const calendarDraftsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/calendar/drafts',
  summary: 'Le bozze senza data della vista Elenco, le ultime cambiate prima (al massimo 200)',
  request: { params: OrgParams, query: z.strictObject(CalendarFilterQuery) },
  response: z.object({
    timeZone: z.string(),
    items: z.array(CalendarPost),
    truncated: z.boolean(),
  }),
  auth: 'session',
  scope: 'organization',
})

export const deleteEmptyDraftsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/calendar/drafts/delete-empty',
  summary:
    'Elimina le bozze vuote (senza testo, file, account e data): le proprie, o con `all` di tutti dove si gestiscono i post degli altri',
  request: {
    params: OrgParams,
    body: z.strictObject({ workspaceId: Id.optional(), all: z.boolean().optional() }),
  },
  response: z.object({ deleted: z.number().int() }),
  auth: 'session',
  scope: 'organization',
})

// Instagram's grid (spec §11.5, plan 09 Task 12, P4): one Instagram account of a client, the
// scheduled posts of the next 30 days above the last 30 out, read from Meta at every opening.

/** A post out on Instagram; its picture comes from the grid's `…/media/{igMediaId}/thumbnail`. */
export const GridPublished = z.object({
  /** Instagram's id of the media */
  id: z.string(),
  kind: z.enum(['image', 'video', 'carousel']),
  reel: z.boolean(),
  publishedAt: Timestamp.nullable(),
  permalink: z.string().nullable(),
  hasPicture: z.boolean(),
})
export type GridPublished = z.infer<typeof GridPublished>

export const calendarGridRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/calendar/grid/{accountId}',
  summary:
    'La griglia di Instagram di un account del cliente: i programmati dei prossimi 30 giorni, il più lontano per primo, sopra gli ultimi 30 pubblicati letti da Meta',
  request: {
    params: z.strictObject({ org: OrgSlug, id: Id, accountId: Id }),
  },
  response: z.object({
    account: z.object({
      id: Id,
      platform: z.literal('instagram'),
      name: z.string(),
      username: z.string().nullable(),
      avatarKey: z.string().nullable(),
    }),
    timeZone: z.string(),
    scheduled: z.array(CalendarPost),
    /** `unreachable`: the connection does not work; `rejected`: Meta refused the token */
    published: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), items: z.array(GridPublished) }),
      z.object({
        ok: z.literal(false),
        reason: z.enum(['unreachable', 'rejected', 'unavailable']),
      }),
    ]),
  }),
  auth: 'session',
  scope: 'organization',
})

export const calendarGridThumbnailRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/calendar/grid/{accountId}/media/{igMediaId}/thumbnail',
  summary:
    'La foto di un post pubblicato della griglia, scaricata da Meta a ogni richiesta (non conservata): solo dagli host di Meta, solo immagini, al massimo 5 MB',
  request: {
    params: z.strictObject({
      org: OrgSlug,
      id: Id,
      accountId: Id,
      igMediaId: z.string().regex(/^[0-9]{1,32}$/),
    }),
  },
  download: { contentType: 'image/jpeg' },
  response: FileResponse,
  auth: 'session',
  scope: 'organization',
})

const SwapSide = z.strictObject({ postId: Id, version: z.number().int().nonnegative() })

export const calendarGridSwapRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/calendar/grid/swap',
  summary:
    'Scambia gli orari di due post programmati della griglia, con le versioni lette: si spostano tutti e due con i controlli di «Programma», o nessuno (409 se uno è cambiato)',
  request: {
    params: z.strictObject({ org: OrgSlug, id: Id }),
    body: z.strictObject({ accountId: Id, a: SwapSide, b: SwapSide }),
  },
  response: z.object({
    posts: z.array(z.object({ id: Id, version: z.number().int(), scheduledAt: Timestamp })),
  }),
  auth: 'session',
  scope: 'organization',
})

export const calendarRoutes = [
  calendarRoute,
  calendarDraftsRoute,
  deleteEmptyDraftsRoute,
  calendarGridRoute,
  calendarGridThumbnailRoute,
  calendarGridSwapRoute,
]
