import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'
import { Palette } from './me.js'

// The content settings of a client (spec §11.7, plan 06 Task 7): labels, caption templates and
// account groups. Every member of the workspace reads them (`workspace.view`), only who manages
// its content changes them (`workspace.content_settings.manage`, Manager and above: 403 for the
// others). And the internal notes of a post: whoever writes posts in the workspace adds one,
// its author or a Manager takes it off. Notes never leave the agency (§11.10).

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })

/** The colours of the themes (D-68, provisional): the label is drawn with that theme's accent. */
export const LabelColor = Palette

export const LabelDto = z.object({
  id: Id,
  name: z.string(),
  color: LabelColor,
  /** the posts of the client that carry it */
  postCount: z.number().int(),
})
export type LabelDto = z.infer<typeof LabelDto>

const LabelParams = z.strictObject({ org: OrgSlug, id: Id, labelId: Id })

export const listLabelsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/labels',
  summary: 'Le etichette del cliente, per nome, con quanti post le hanno',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(LabelDto) }),
  auth: 'session',
  scope: 'organization',
})

export const createLabelRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/labels',
  summary: 'Crea un’etichetta (nome da 1 a 40 caratteri, unico nel cliente)',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({ name: z.string().max(200), color: LabelColor }),
  },
  response: LabelDto,
  auth: 'session',
  scope: 'organization',
})

export const updateLabelRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/labels/{labelId}',
  summary: 'Rinomina un’etichetta o ne cambia il colore',
  request: {
    params: LabelParams,
    body: z.strictObject({
      name: z.string().max(200).optional(),
      color: LabelColor.optional(),
    }),
  },
  response: LabelDto,
  auth: 'session',
  scope: 'organization',
})

export const deleteLabelRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/labels/{labelId}',
  summary: 'Elimina un’etichetta: i post che l’avevano la perdono',
  request: { params: LabelParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

const TEMPLATE_KINDS = ['caption', 'signature', 'hashtags'] as const

export const CaptionTemplateDto = z.object({
  id: Id,
  kind: z.enum(TEMPLATE_KINDS),
  name: z.string(),
  body: z.string(),
  updatedAt: Timestamp,
})
export type CaptionTemplateDto = z.infer<typeof CaptionTemplateDto>

const TemplateParams = z.strictObject({ org: OrgSlug, id: Id, templateId: Id })
// 2,200 characters, a few bytes each: well inside the default body limit
const TemplateBody = z.string().max(10_000)

export const listCaptionTemplatesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/caption-templates',
  summary: 'I modelli del cliente (testi, firme, hashtag), per tipo e nome',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(CaptionTemplateDto) }),
  auth: 'session',
  scope: 'organization',
})

export const createCaptionTemplateRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/caption-templates',
  summary: 'Crea un modello: un testo, una firma o degli hashtag (fino a 2.200 caratteri)',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({
      kind: z.enum(TEMPLATE_KINDS),
      name: z.string().max(200),
      body: TemplateBody,
    }),
  },
  response: CaptionTemplateDto,
  auth: 'session',
  scope: 'organization',
})

export const updateCaptionTemplateRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/caption-templates/{templateId}',
  summary: 'Modifica un modello',
  request: {
    params: TemplateParams,
    body: z.strictObject({
      kind: z.enum(TEMPLATE_KINDS).optional(),
      name: z.string().max(200).optional(),
      body: TemplateBody.optional(),
    }),
  },
  response: CaptionTemplateDto,
  auth: 'session',
  scope: 'organization',
})

export const deleteCaptionTemplateRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/caption-templates/{templateId}',
  summary: 'Elimina un modello: i post che l’hanno usato restano come sono',
  request: { params: TemplateParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const AccountGroupDto = z.object({
  id: Id,
  name: z.string(),
  /** as saved, in order */
  accountIds: z.array(Id),
  /** the saved accounts that are no longer the client's: the editor skips them */
  unavailableAccountIds: z.array(Id),
})
export type AccountGroupDto = z.infer<typeof AccountGroupDto>

const GroupParams = z.strictObject({ org: OrgSlug, id: Id, groupId: Id })
const GroupAccounts = z.array(Id).min(1).max(100)

export const listAccountGroupsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/account-groups',
  summary: 'I gruppi di account del cliente, per nome, con gli account che non sono più suoi',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(AccountGroupDto) }),
  auth: 'session',
  scope: 'organization',
})

export const createAccountGroupRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/account-groups',
  summary: 'Crea un gruppo con account del cliente',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({ name: z.string().max(200), accountIds: GroupAccounts }),
  },
  response: AccountGroupDto,
  auth: 'session',
  scope: 'organization',
})

export const updateAccountGroupRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/account-groups/{groupId}',
  summary: 'Rinomina un gruppo o ne cambia gli account (tutti del cliente)',
  request: {
    params: GroupParams,
    body: z.strictObject({
      name: z.string().max(200).optional(),
      accountIds: GroupAccounts.optional(),
    }),
  },
  response: AccountGroupDto,
  auth: 'session',
  scope: 'organization',
})

export const deleteAccountGroupRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/account-groups/{groupId}',
  summary: 'Elimina un gruppo',
  request: { params: GroupParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const PostNoteDto = z.object({
  id: Id,
  body: z.string(),
  authorId: Id,
  /** the author's name as the agency knows it now */
  authorName: z.string(),
  createdAt: Timestamp,
  /** whether the reader may take it off */
  canDelete: z.boolean(),
})
export type PostNoteDto = z.infer<typeof PostNoteDto>

const PostParams = z.strictObject({ org: OrgSlug, id: Id, postId: Id })
const NoteParams = z.strictObject({ org: OrgSlug, id: Id, postId: Id, noteId: Id })

export const listNotesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/notes',
  summary: 'Le note interne del post, dalla più vecchia: mai visibili ai clienti',
  request: { params: PostParams },
  response: z.object({ items: z.array(PostNoteDto) }),
  auth: 'session',
  scope: 'organization',
})

export const addNoteRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/notes',
  summary: 'Aggiunge una nota interna (fino a 2.000 caratteri), anche al post di un altro',
  request: { params: PostParams, body: z.strictObject({ body: z.string().max(10_000) }) },
  response: PostNoteDto,
  auth: 'session',
  scope: 'organization',
})

export const deleteNoteRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/notes/{noteId}',
  summary: 'Toglie una nota: la propria, o quella di chiunque per chi gestisce il cliente',
  request: { params: NoteParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

// ---- the usual times (spec §11.6, plan 09 Task 9): a weekday (ISO, 1 Monday) and a time of the
// agency's zone; the section saves the whole list

export const TimeSlotDto = z.object({
  weekday: z.number().int().min(1).max(7),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
})
export type TimeSlotDto = z.infer<typeof TimeSlotDto>

export const listTimeSlotsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/time-slots',
  summary: 'Le fasce orarie del cliente, in ordine di giorno e ora (fuso dell’agenzia)',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(TimeSlotDto) }),
  auth: 'session',
  scope: 'organization',
})

export const replaceTimeSlotsRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/workspaces/{id}/time-slots',
  summary: 'Sostituisce le fasce orarie del cliente (al massimo 70; una ripetuta conta una volta)',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({
      slots: z
        .array(z.strictObject({ weekday: z.number(), localTime: z.string().max(10) }))
        .max(200),
    }),
  },
  response: z.object({ items: z.array(TimeSlotDto) }),
  auth: 'session',
  scope: 'organization',
})

export const nextFreeSlotRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/next-free-slot',
  summary:
    'La prossima fascia libera del cliente: la prima dopo adesso (o dopo `after`) senza un post programmato a quell’ora',
  request: {
    params: WorkspaceParams,
    query: z.strictObject({ after: Timestamp.optional() }),
  },
  response: z.object({
    /** null: no slots, or every one taken for the next three months */
    slot: z
      .object({
        at: Timestamp,
        localDate: z.string(),
        localTime: z.string(),
      })
      .nullable(),
  }),
  auth: 'session',
  scope: 'organization',
})

export const contentSettingsRoutes = [
  listTimeSlotsRoute,
  replaceTimeSlotsRoute,
  nextFreeSlotRoute,
  listLabelsRoute,
  createLabelRoute,
  updateLabelRoute,
  deleteLabelRoute,
  listCaptionTemplatesRoute,
  createCaptionTemplateRoute,
  updateCaptionTemplateRoute,
  deleteCaptionTemplateRoute,
  listAccountGroupsRoute,
  createAccountGroupRoute,
  updateAccountGroupRoute,
  deleteAccountGroupRoute,
  listNotesRoute,
  addNoteRoute,
  deleteNoteRoute,
] as const
