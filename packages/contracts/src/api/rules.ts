import { z } from 'zod'
import { Id, OrgSlug, Timestamp } from './common.js'
import { defineContract } from './define.js'

// The checks before scheduling (plan 05 Task 2, spec §9.2). A read: nothing is saved. Editor
// and above (`post.draft`); for a Viewer, as for anyone without a role in the workspace, the
// route answers 404 (spec §10.2). The lists below repeat the domain's (contracts depend on zod
// only): a test compares them.

export const POST_CHECK_TYPES = ['photo', 'carousel', 'reel', 'story'] as const
export const POST_CHECK_OPTIONS = [
  'keep',
  'crop',
  'crop_center',
  'pad',
  'convert',
  'trim_to_60',
  'ignore_caption',
  'accept',
  'photos_only',
  'first_files',
  'publish_as_video',
  'skip_platform',
] as const
const PLATFORMS = ['instagram', 'facebook'] as const

/**
 * Up to 20 files, so a carousel over 10 reaches the rules and gets their message (D-51); up
 * to 100 destinations («seleziona tutti»).
 */
export const POST_CHECK_LIMITS = {
  media: 20,
  destinations: 100,
  captionCharacters: 70_000,
  choices: 50,
} as const

/**
 * Counted in code points, as the rules count (D-46): an emoji is one character, not two. The
 * bound in UTF-16 units comes first, so a huge string is refused before it is walked.
 */
const Caption = z
  .string()
  .max(POST_CHECK_LIMITS.captionCharacters * 2)
  .refine((text) => Array.from(text).length <= POST_CHECK_LIMITS.captionCharacters, {
    message: `at most ${String(POST_CHECK_LIMITS.captionCharacters)} characters`,
  })

/** A whole day of the calendar and a time of it, as Rome's clock shows them. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

const Fraction = z.number().min(0).max(1)

/** The answer to a warning; with `crop`, the box on the original, in fractions (D-61). */
export const RuleChoiceBody = z.strictObject({
  key: z.string().min(1).max(300),
  option: z.enum(POST_CHECK_OPTIONS),
  crop: z.strictObject({ x: Fraction, y: Fraction, width: Fraction, height: Fraction }).optional(),
})

export const PostCheckRequest = z.strictObject({
  type: z.enum(POST_CHECK_TYPES),
  /** the files of the post, in its order */
  mediaIds: z.array(Id).max(POST_CHECK_LIMITS.media),
  /** a reel's cover: a frame of the video (its offset) or a photo of the library */
  cover: z
    .discriminatedUnion('source', [
      z.strictObject({
        source: z.literal('frame'),
        offsetMs: z
          .number()
          .int()
          .min(0)
          .max(15 * 60_000),
      }),
      z.strictObject({ source: z.literal('image'), mediaId: Id }),
    ])
    .optional(),
  /**
   * The common text, and the text of a platform that has its own. A platform's text left
   * empty or blank is no text of its own: the common one goes out there (D-53).
   */
  caption: z.strictObject({
    common: Caption,
    instagram: Caption.optional(),
    facebook: Caption.optional(),
  }),
  destinations: z.array(z.strictObject({ accountId: Id })).max(POST_CHECK_LIMITS.destinations),
  /** «Pubblica ora», or a day and a time in Rome */
  when: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('now') }),
    z.strictObject({ mode: z.literal('at'), localDate: LocalDate, localTime: LocalTime }),
  ]),
  /** a reel also in the feed; true when left out */
  shareToFeed: z.boolean().optional(),
  /** the answers to the warnings, by their key */
  choices: z.array(RuleChoiceBody).max(POST_CHECK_LIMITS.choices),
  /**
   * The saved post this is (D-54): never a duplicate of itself, and only its author or someone
   * who may change it checks it.
   */
  postId: Id.optional(),
})

export type PostCheckRequest = z.infer<typeof PostCheckRequest>

const RuleSubject = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post') }),
  z.object({ kind: z.literal('destination'), accountId: z.string() }),
  /** the file at that index of `mediaIds` */
  z.object({ kind: z.literal('media'), index: z.number().int() }),
  z.object({ kind: z.literal('cover') }),
])

export const RuleOutcome = z.object({
  level: z.enum(['block', 'warning', 'fix']),
  /** the panel's text is `rules.<code>` */
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  subject: RuleSubject,
  platform: z.enum(PLATFORMS).optional(),
  /** what a choice answers */
  key: z.string(),
  options: z.array(z.enum(POST_CHECK_OPTIONS)).optional(),
  recommended: z.enum(POST_CHECK_OPTIONS).optional(),
  chosen: z.enum(POST_CHECK_OPTIONS).optional(),
  /** an action of the editor that removes the block */
  action: z.literal('publish_now').optional(),
  /** with the option `crop`: the box's proportions, width over height (D-61) */
  cropRatio: z.number().optional(),
})

export const DestinationSummary = z.object({
  accountId: z.string(),
  /** null: the account is not available in this client, and nothing else of it is said */
  platform: z.enum(PLATFORMS).nullable(),
  /** what the post becomes on the account (§9.1); null when it cannot go out there */
  format: z.string().nullable(),
  /** the text it will publish */
  caption: z.string(),
  /** the files it will publish, as indices of `mediaIds` */
  media: z.array(z.number().int()),
  /** the keys of the outcomes that touch it: each outcome is once, in `outcomes` */
  outcomeKeys: z.array(z.string()),
})

export const PostCheckResponse = z.object({
  outcomes: z.array(RuleOutcome),
  /** the destinations that will go out, after the choices */
  destinations: z.array(DestinationSummary),
  /** the keys of the outcomes of the post as a whole (not of one destination) */
  postKeys: z.array(z.string()),
  /** the keys of the warnings with no choice yet */
  unresolved: z.array(z.string()),
  /** no block, and a choice for every warning */
  canSchedule: z.boolean(),
  /** null for «Pubblica ora» */
  scheduledAt: Timestamp.nullable(),
  /** how a time the clock change skips or repeats was read */
  adjustment: z.enum(['none', 'skipped_forward', 'ambiguous_first']),
})

export type PostCheckResponse = z.infer<typeof PostCheckResponse>

export const postCheckRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/post-checks',
  summary:
    'Controlla un post prima di programmarlo, sui file e sugli account del cliente, senza salvare nulla',
  request: {
    params: z.strictObject({ org: OrgSlug, id: Id }),
    body: PostCheckRequest,
  },
  response: PostCheckResponse,
  auth: 'session',
  scope: 'organization',
  // three texts of up to 70,000 characters: the limit of every body (03.request-body.ts)
  maxBodyBytes: 1024 * 1024,
})

export const rulesRoutes = [postCheckRoute] as const
