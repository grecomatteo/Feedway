import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'
import {
  LocalDate,
  LocalTime,
  POST_CHECK_LIMITS,
  POST_CHECK_TYPES,
  PostCaptionBody,
  InstagramCollaboratorsBody,
  PostCoverBody,
  RuleChoiceBody,
} from './rules.js'

// The posts of a workspace (plan 06 Task 4, spec §11.2, §11.9). Every member of the workspace
// sees them, the Viewer included (`workspace.view`, §10.2); writing takes `post.draft` (one's
// own drafts), `post.manage_others` (anyone's) or `post.publish` (schedule, back to draft,
// cancel). A post that is seen but not to be touched is 403, one of another workspace 404.
// A write carries the `version` it read: someone saved in between, 409 with the reason
// `post_version_conflict` (§11.9).

/** As the checks take them (`POST_CHECK_LIMITS`): what a post holds, the checks can read. */
export const POST_LIMITS = POST_CHECK_LIMITS

/**
 * The states of a post, with those of the publishing (plan 07, Scelta 3): the worker moves a
 * post past `scheduled`, and its reads must still answer. Their labels in the panel come with
 * Task 9. As `PUBLISHING_POST_STATUSES` of @app/domain (contracts depend on zod only).
 */
export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'partial',
  'failed',
  'problem',
  'published',
  'paused',
  'cancelled',
] as const

/** The states of a destination (§9.3), as `TARGET_STATUSES` of @app/domain. */
export const TARGET_STATUSES = [
  'draft',
  'scheduled',
  'preparing',
  'ready',
  'publishing',
  'retrying',
  'unknown',
  'published',
  'verifying',
  'confirmed',
  'problem',
  'failed',
  'paused',
  'cancelled',
] as const

/** A day and a time in the post's time zone; null: no date yet. */
const PostWhenBody = z.strictObject({ localDate: LocalDate, localTime: LocalTime }).nullable()

/** What the editor saves; a field left out of a save stays as it is. */
const content = {
  mediaIds: z.array(Id).max(POST_LIMITS.media),
  cover: PostCoverBody.nullable(),
  caption: PostCaptionBody,
  destinations: z.array(z.strictObject({ accountId: Id })).max(POST_LIMITS.destinations),
  when: PostWhenBody,
  /** a reel also in the feed */
  shareToFeed: z.boolean(),
  /**
   * Instagram's invited collaborators (D-125), as typed: a draft saves with any name, the checks
   * block a wrong one, a repeated one or more than 3
   */
  instagramCollaborators: InstagramCollaboratorsBody,
  /** the answers to the warnings, saved with the post (P5) */
  choices: z
    .array(RuleChoiceBody)
    .max(POST_LIMITS.choices)
    .refine((choices) => new Set(choices.map((c) => c.key)).size === choices.length, {
      message: 'one choice per warning',
    }),
  /** every label of the post (§11.7): one of another client is not found */
  labelIds: z.array(Id).max(100),
}

/** A new draft: the type, and whatever else the editor already has. */
export const CreatePostRequest = z.strictObject({
  type: z.enum(POST_CHECK_TYPES),
  mediaIds: content.mediaIds.optional(),
  cover: content.cover.optional(),
  caption: content.caption.optional(),
  destinations: content.destinations.optional(),
  when: content.when.optional(),
  shareToFeed: content.shareToFeed.optional(),
  instagramCollaborators: content.instagramCollaborators.optional(),
  choices: content.choices.optional(),
  labelIds: content.labelIds.optional(),
})
export type CreatePostRequest = z.infer<typeof CreatePostRequest>

export const UpdatePostRequest = z.strictObject({
  /** the version read: another save in between is a 409 */
  version: z.number().int().min(1),
  type: z.enum(POST_CHECK_TYPES).optional(),
  mediaIds: content.mediaIds.optional(),
  cover: content.cover.optional(),
  caption: content.caption.optional(),
  destinations: content.destinations.optional(),
  when: content.when.optional(),
  shareToFeed: content.shareToFeed.optional(),
  instagramCollaborators: content.instagramCollaborators.optional(),
  choices: content.choices.optional(),
  labelIds: content.labelIds.optional(),
})
export type UpdatePostRequest = z.infer<typeof UpdatePostRequest>

/** Schedule, back to draft, cancel: only the version read. */
export const PostVersionRequest = z.strictObject({ version: z.number().int().min(1) })

/** A file of the post as the workspace has it now; a file deleted since says only its id. */
const PostMediaDto = z.object({
  id: Id,
  status: z.enum(['uploading', 'processing', 'ready', 'failed', 'deleted']),
  kind: z.enum(['image', 'video']).nullable(),
  originalName: z.string().nullable(),
  /** of the original as uploaded (D-98) */
  sizeBytes: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  /** of the copy that is published: the frames of the reel's cover (D-60) */
  fps: z.number().nullable(),
  /** the copies the panel can show (`thumbnail`, `preview`…) */
  variants: z.array(z.string()),
})

export const PostResponse = z.object({
  id: Id,
  workspaceId: Id,
  type: z.enum(POST_CHECK_TYPES),
  status: z.enum(POST_STATUSES),
  version: z.number().int(),
  /** in the order of the post */
  media: z.array(PostMediaDto),
  cover: PostCoverBody.nullable(),
  caption: z.object({
    common: z.string(),
    instagram: z.string().optional(),
    facebook: z.string().optional(),
  }),
  destinations: z.array(
    z.object({
      accountId: Id,
      status: z.enum(TARGET_STATUSES),
      /** cancelled by a person on the page of the outcome: the editor leaves it out */
      cancelledInPanel: z.boolean(),
    }),
  ),
  /** the date and time in the post's time zone; null: no date yet */
  when: z.object({ localDate: z.string(), localTime: z.string() }).nullable(),
  scheduledAt: Timestamp.nullable(),
  /** IANA, the agency's when the post was created (D-58) */
  timezone: z.string(),
  shareToFeed: z.boolean(),
  instagramCollaborators: z.array(z.string()),
  choices: z.array(
    z.object({
      key: z.string(),
      option: z.string(),
      crop: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .optional(),
    }),
  ),
  labelIds: z.array(Id),
  createdBy: Id,
  /** who scheduled it last; null while it never was */
  scheduledBy: Id.nullable(),
  updatedBy: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** in «Eliminati» since (plan 09 Scelta 12); null: not there */
  trashedAt: Timestamp.nullable(),
})
export type PostResponse = z.infer<typeof PostResponse>

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const PostParams = z.strictObject({ org: OrgSlug, id: Id, postId: Id })

// three texts of up to 70,000 characters: the limit of every body (03.request-body.ts)
const POST_BODY_BYTES = 1024 * 1024

export const listPostsRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts',
  summary: 'I post del cliente, dal più recente, con il filtro per stato',
  request: {
    params: WorkspaceParams,
    query: z.strictObject({
      status: z.enum(POST_STATUSES).optional(),
      before: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  response: z.object({ items: z.array(PostResponse), next: Id.nullable() }),
  auth: 'session',
  scope: 'organization',
})

export const createPostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts',
  summary: 'Crea una bozza: si salva con qualunque problema',
  request: { params: WorkspaceParams, body: CreatePostRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
  maxBodyBytes: POST_BODY_BYTES,
})

export const getPostRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}',
  summary: 'Un post del cliente, con i suoi file, le destinazioni e le scelte',
  request: { params: PostParams },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const updatePostRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}',
  summary:
    'Salva un post con la versione letta: una bozza così com’è, un programmato solo se i controlli passano',
  request: { params: PostParams, body: UpdatePostRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
  maxBodyBytes: POST_BODY_BYTES,
})

export const deletePostRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}',
  summary:
    'Elimina per sempre un post negli «Eliminati», o una bozza vuota (409 per ogni altra: va prima negli «Eliminati»)',
  request: { params: PostParams },
  response: z.object({ deleted: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const schedulePostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/schedule',
  summary: 'Programma una bozza: i controlli si rifanno sul post salvato (422 con il loro esito)',
  request: { params: PostParams, body: PostVersionRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const unschedulePostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/unschedule',
  summary: 'Riporta in bozza un post programmato',
  request: { params: PostParams, body: PostVersionRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const cancelPostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/cancel',
  summary: 'Annulla un post programmato: non esce su nessun account',
  request: { params: PostParams, body: PostVersionRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const publishNowRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/publish-now',
  summary:
    'Pubblica subito una bozza: i controlli del salvataggio, senza quello della data (422 con il loro esito)',
  request: { params: PostParams, body: PostVersionRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

/** From 1 to 100 posts of the client, each once (plan 09 Scelta 12). */
const PostBatch = z.strictObject({ postIds: z.array(Id).min(1).max(100) })
const PostBatchResponse = z.object({ postIds: z.array(Id) })

export const trashPostsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/trash',
  summary:
    '«Elimina»: bozze e post annullati negli «Eliminati» del cliente, fino a 100, tutti o nessuno (409 se uno è in un altro stato); risponde quelli spostati',
  request: { params: WorkspaceParams, body: PostBatch },
  response: PostBatchResponse,
  auth: 'session',
  scope: 'organization',
})

export const restorePostsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/restore',
  summary:
    '«Ripristina» (e «Annulla» dopo «Elimina»): i post tornano dagli «Eliminati» com’erano, fino a 100, tutti o nessuno',
  request: { params: WorkspaceParams, body: PostBatch },
  response: PostBatchResponse,
  auth: 'session',
  scope: 'organization',
})

export const purgePostsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/purge',
  summary:
    '«Elimina per sempre» dei post scelti, già negli «Eliminati» (409 altrimenti), o con `all` «Svuota»: tutti quelli che la persona può eliminare',
  request: {
    params: WorkspaceParams,
    body: z
      .strictObject({ postIds: z.array(Id).min(1).max(100), all: z.literal(true) })
      .partial()
      .refine((b) => (b.postIds === undefined) !== (b.all === undefined), {
        message: 'postIds oppure all',
      }),
  },
  response: z.object({ deleted: z.number().int() }),
  auth: 'session',
  scope: 'organization',
})

/** What the page of the outcome tells (plan 07 Scelta 6), as `ACTIVITY_KINDS` of the posts. */
export const POST_ACTIVITY_KINDS = [
  'post.created',
  'post.updated',
  'post.scheduled',
  'post.published_now',
  'post.unscheduled',
  'post.cancelled',
  'post.retried',
  'post.verified_manually',
  'post.target_cancelled',
  'post.resumed',
  'post.target_failed',
  'target.published',
  'target.failed',
  'target.uncertain',
] as const

/** A file as the account received it: the copy published, or the original once it is gone. */
const OutcomeFile = z.object({
  mediaId: Id,
  kind: z.enum(['image', 'video']),
  copyId: Id.nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
})

export const PostOutcomeResponse = z.object({
  /** the post as each account received it (plan 08 Task 10); null: read from the post */
  preview: z
    .object({
      /** some copy published is gone: the files are the originals */
      originals: z.boolean(),
      versions: z.array(
        z.object({
          accountId: Id,
          platform: z.enum(['instagram', 'facebook']),
          format: z.string(),
          caption: z.string(),
          files: z.array(OutcomeFile),
          /** the reel's cover as the account shows it; null: the platform's own */
          cover: z
            .object({
              /** the file the cover's copy is made of: the image chosen, or the video */
              mediaId: Id,
              copyId: Id.nullable(),
              offsetMs: z.number().int().nullable(),
            })
            .nullable(),
        }),
      ),
    })
    .nullable(),
  destinations: z.array(
    z.object({
      accountId: Id,
      status: z.enum(TARGET_STATUSES),
      permalink: z.string().nullable(),
      publishedAt: Timestamp.nullable(),
      verifiedAt: Timestamp.nullable(),
      /** Feedway's code of the last error, never Meta's message */
      errorCode: z.string().nullable(),
      /** why Meta does not confirm a post it has: `not_found`, `failed`, `wrong_type`… */
      problem: z.string().nullable(),
      nextAttemptAt: Timestamp.nullable(),
      /**
       * The reel's cover sent after the post (Facebook, D-120.9): `done`, `failed`,
       * `no_permission`; null: none chosen or not sent
       */
      cover: z.enum(['done', 'failed', 'no_permission']).nullable(),
      /**
       * Instagram's invitations sent with the post (D-125); null: none. `not_sent`: Meta
       * refused them and the post went out without; `waiting`: not read yet; `unknown`: Meta
       * does not list the name (it lists only who has the collaboration tags on)
       */
      collaborators: z
        .object({
          people: z.array(
            z.object({
              username: z.string(),
              status: z.enum(['pending', 'accepted', 'declined', 'not_sent', 'waiting', 'unknown']),
            }),
          ),
          /** Meta's code when it refused the invitations, never its message */
          notSentCode: z.string().nullable(),
          /** when the worker last read the answers */
          readAt: Timestamp.nullable(),
        })
        .nullable(),
    }),
  ),
  /** the latest first */
  activity: z.array(
    z.object({
      at: Timestamp,
      kind: z.enum(POST_ACTIVITY_KINDS),
      /** null: the worker */
      actorName: z.string().nullable(),
      accountId: Id.nullable(),
      errorCode: z.string().nullable(),
    }),
  ),
})
export type PostOutcomeResponse = z.infer<typeof PostOutcomeResponse>

export const getPostOutcomeRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/outcome',
  summary: 'L’esito di ogni destinazione di un post e la sua attività',
  request: {
    params: PostParams,
    // `preview=0`: without the versions, for the page's own reads while something moves
    query: z.strictObject({ preview: z.enum(['0', '1']).optional() }),
  },
  response: PostOutcomeResponse,
  auth: 'session',
  scope: 'organization',
})

// «Aggiorna» of the invitations (plan 09 Task 15): the web asks the worker, never Meta
export const refreshCollaboratorsRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/collaborators/refresh',
  summary:
    'Chiede di rileggere da Instagram le risposte dei collaboratori invitati (409 se nessun invito è uscito)',
  request: { params: PostParams },
  response: z.object({ queued: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

const DestinationParams = z.strictObject({ org: OrgSlug, id: Id, postId: Id, accountId: Id })

// After the worker (plan 07 Task 8): a destination is named by its account, one per post
export const retryTargetRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/destinations/{accountId}/retry',
  summary: 'Riprova una destinazione non uscita o con un problema',
  request: { params: DestinationParams },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const markVerifiedRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/destinations/{accountId}/verified',
  summary: 'Segna come verificata una destinazione con un problema',
  request: { params: DestinationParams },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const cancelTargetRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/destinations/{accountId}/cancel',
  summary: 'Annulla una destinazione non ancora uscita',
  request: { params: DestinationParams },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const ResumePostRequest = z.strictObject({
  version: z.number().int().min(1),
  when: PostWhenBody.optional(),
})

export const resumePostRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/resume',
  summary: 'Riprende un post in pausa, a nome di chi lo riprende',
  request: { params: PostParams, body: ResumePostRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const cancelPausedRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/posts/{postId}/cancel-paused',
  summary: 'Annulla le destinazioni in pausa di un post',
  request: { params: PostParams, body: PostVersionRequest },
  response: PostResponse,
  auth: 'session',
  scope: 'organization',
})

export const postRoutes = [
  listPostsRoute,
  createPostRoute,
  getPostRoute,
  updatePostRoute,
  deletePostRoute,
  trashPostsRoute,
  restorePostsRoute,
  purgePostsRoute,
  schedulePostRoute,
  unschedulePostRoute,
  cancelPostRoute,
  publishNowRoute,
  getPostOutcomeRoute,
  refreshCollaboratorsRoute,
  retryTargetRoute,
  markVerifiedRoute,
  cancelTargetRoute,
  resumePostRoute,
  cancelPausedRoute,
] as const
