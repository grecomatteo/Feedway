import { INSTAGRAM_RULES, META_RULES } from '../platforms/meta/rules/index.js'
import type { FileAnalysis } from '../media/check-file.js'
import { postFingerprint } from './evaluate-post.js'
import { platformRulesMap } from './platform-rules.js'
import type {
  DraftMedia,
  PostDraft,
  PublishingHistoryFacts,
  RuleAccount,
  RuleContext,
  RuleLevel,
  RuleOption,
} from './types.js'

// The cases of the checks (plan 05, `rules/cases.ts`): data for the tests, never production
// code. Each is a row of spec §9.2 (or of §9.1) told for Matteo; the tests run them, and the
// table `docs/regole/casi-dei-controlli.md` of Task 2 is made from them.

export const NOW = new Date('2026-11-17T10:00:00Z')
export const IG = 'acc-instagram'
export const FB = 'acc-facebook'
export const OTHER = 'acc-other-workspace'

type Image = Extract<FileAnalysis, { kind: 'image' }>
type Video = Extract<FileAnalysis, { kind: 'video' }>

let next = 0
const ready = (analysis: Image | Video): DraftMedia => {
  next += 1
  return {
    mediaId: `media-${String(next)}`,
    status: 'ready',
    kind: analysis.kind,
    analysis,
    checks: { fixes: [], warnings: [] },
    failure: null,
    sha256: `sha-${String(next)}`,
  }
}

/** A JPEG ready to go: 1080×1350 (4:5), 2 MB. */
export const photo = (over: Partial<Image> = {}, media: Partial<DraftMedia> = {}): DraftMedia => ({
  ...ready({
    kind: 'image',
    format: 'jpeg',
    sizeBytes: 2_000_000,
    width: 1080,
    height: 1350,
    colorSpace: 'srgb',
    hasMetadata: false,
    ...over,
  }),
  ...media,
})

/** An MP4 ready to go: 1080×1920 (9:16), 30 fps, H.264 and AAC. */
export const video = (
  durationMs: number,
  over: Partial<Video> = {},
  media: Partial<DraftMedia> = {},
): DraftMedia => ({
  ...ready({
    kind: 'video',
    format: 'mp4',
    sizeBytes: 40_000_000,
    width: 1080,
    height: 1920,
    durationMs,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    faststart: true,
    ...over,
  }),
  ...media,
})

export const chars = (n: number) => 'a'.repeat(n)
const both = [{ accountId: IG }, { accountId: FB }]
const onlyIg = [{ accountId: IG }]
const onlyFb = [{ accountId: FB }]

export function draft(over: Partial<PostDraft> = {}): PostDraft {
  return {
    type: 'photo',
    media: [photo()],
    caption: { common: 'Il pane di oggi' },
    destinations: both,
    when: { mode: 'at', localDate: '2026-11-18', localTime: '18:00' },
    shareToFeed: true,
    choices: [],
    ...over,
  }
}

const EMPTY_HISTORY: PublishingHistoryFacts = {
  recentFingerprints: new Map(),
  reelsLast24h: new Map(),
  scheduledNear: new Map(),
}

const account = (over: Partial<RuleAccount> & Pick<RuleAccount, 'platform'>): RuleAccount => ({
  active: true,
  health: 'ok',
  inWorkspace: true,
  quota: null,
  ...over,
})

export function context(
  over: {
    accounts?: Record<string, RuleAccount>
    history?: Partial<PublishingHistoryFacts>
    purpose?: RuleContext['purpose']
    timeZone?: string
  } = {},
): RuleContext {
  return {
    purpose: over.purpose ?? 'draft',
    now: NOW,
    timeZone: over.timeZone ?? 'Europe/Rome',
    workspaceId: 'workspace-1',
    accounts: new Map(
      Object.entries({
        [IG]: account({
          platform: 'instagram',
          quota: { used: 10, total: 100, checkedAt: NOW },
        }),
        [FB]: account({ platform: 'facebook' }),
        [OTHER]: account({ platform: 'instagram', inWorkspace: false }),
        ...over.accounts,
      }),
    ),
    history: { ...EMPTY_HISTORY, ...over.history },
    platforms: platformRulesMap(META_RULES),
  }
}

export { account as ruleAccount }

/** A table of §9.2 (`file`, `proportions`, `post`), or §9.1 for what a post becomes. */
export type CaseSection = 'file' | 'proportions' | 'post'

export interface ExpectedOutcome {
  level: RuleLevel
  code: string
  /** `post`, `cover`, `media:<index>`, `destination:<account id>` */
  subject: string
  platform?: 'instagram' | 'facebook'
  /** the option taken, for a warning answered in `draft.choices` */
  chosen?: RuleOption
}

/** What a destination will publish, for the cases where a choice changes it. */
export interface ExpectedDestination {
  accountId: string
  format: string | null
  media: number[]
}

export interface RuleCase {
  id: string
  section: CaseSection
  /** one line in Italian, for the table of Task 2 */
  scenario: string
  draft: PostDraft
  context: RuleContext
  /** every outcome, none left out */
  expected: ExpectedOutcome[]
  /** every destination that goes out, when the case is about a choice */
  destinations?: ExpectedDestination[]
}

const o =
  (level: RuleLevel) =>
  (code: string, subject: string, platform?: 'instagram' | 'facebook'): ExpectedOutcome => ({
    level,
    code,
    subject,
    ...(platform ? { platform } : {}),
  })
const block = o('block')
const warning = o('warning')
const fix = o('fix')

const ctx = context()
const c = (
  id: string,
  section: CaseSection,
  scenario: string,
  d: PostDraft,
  expected: ExpectedOutcome[],
  cx: RuleContext = ctx,
  destinations?: ExpectedDestination[],
): RuleCase => ({
  id,
  section,
  scenario,
  draft: d,
  context: cx,
  expected,
  ...(destinations ? { destinations } : {}),
})

const chose = (e: ExpectedOutcome, chosen: RuleOption): ExpectedOutcome => ({ ...e, chosen })
const TODAY_EVENING = { mode: 'at', localDate: '2026-11-17', localTime: '18:00' } as const

const reel = (durationMs: number, over: Partial<Video> = {}, rest: Partial<PostDraft> = {}) =>
  draft({ type: 'reel', media: [video(durationMs, over)], ...rest })
const story = (media: DraftMedia, rest: Partial<PostDraft> = {}) =>
  draft({ type: 'story', media: [media], caption: { common: '' }, ...rest })
const carousel = (media: DraftMedia[], rest: Partial<PostDraft> = {}) =>
  draft({ type: 'carousel', media, ...rest })
const photos = (n: number) => Array.from({ length: n }, () => photo())

// a choice is keyed by the file's id (plan 06, Scelta 1)
const longReelVideo = video(120_000)
const longReel = draft({
  type: 'reel',
  media: [longReelVideo],
  choices: [
    {
      key: `reel_too_long_for_facebook:media:${longReelVideo.mediaId}:facebook`,
      option: 'publish_as_video',
    },
  ],
})

/** A 1000×2000 photo on Instagram only, its proportions answered with a crop box. */
function cropped(crop: { x: number; y: number; width: number; height: number }) {
  const tall = photo({ width: 1000, height: 2000 })
  return draft({
    media: [tall],
    destinations: onlyIg,
    choices: [{ key: `photo_aspect_ratio:media:${tall.mediaId}:instagram`, option: 'crop', crop }],
  })
}

const duplicate = draft({ destinations: onlyFb })
const duplicateSeen = postFingerprint(
  FB,
  duplicate.media.map((m) => m.sha256 ?? ''),
  duplicate.caption.common,
)

const failed = (base: DraftMedia, failure: NonNullable<DraftMedia['failure']>): DraftMedia => ({
  ...base,
  status: 'failed',
  analysis: null,
  checks: null,
  failure,
})

/** One case for every reason a file fails (§9.2 «File»): the table shows each text. */
const FAILED_FILES: [string, string, DraftMedia][] = [
  [
    'file-failed-type',
    'File che non è una foto né un video (tipo letto dai byte, non dal nome)',
    failed(photo(), { code: 'unsupported_type' }),
  ],
  [
    'file-failed-pixels',
    'Foto oltre 50 megapixel',
    failed(photo(), { code: 'too_many_pixels', limit: 50_000_000 }),
  ],
  [
    'file-failed-video-large',
    'Video oltre 300 MB',
    failed(video(20_000), { code: 'too_large', limit: 300_000_000 }),
  ],
  [
    'file-failed-video-long',
    'Video oltre la durata massima di caricamento',
    failed(video(20_000), { code: 'too_long', limitSeconds: 900 }),
  ],
  [
    'file-failed-unreadable',
    'File rovinato, che non si legge',
    failed(photo(), { code: 'unreadable' }),
  ],
  [
    'file-failed-timeout',
    'Video 4K a 60 fps la cui preparazione è durata troppo',
    failed(video(20_000), { code: 'timeout' }),
  ],
  [
    'file-failed-storage',
    'Spazio del cliente pieno durante la preparazione',
    failed(photo(), { code: 'storage_full', scope: 'workspace', limit: 10_000_000_000 }),
  ],
  [
    'file-failed-attempts',
    'Preparazione non riuscita dopo vari tentativi',
    failed(photo(), { code: 'processing_failed' }),
  ],
]

export const RULE_CASES: RuleCase[] = [
  // — File (§9.2): the worker's analysis and checks, read again (R5)
  c('ok-photo', 'post', 'Foto 4:5 su Instagram e Facebook, tutto in regola', draft(), []),
  c(
    'file-failed',
    'file',
    'File non riuscito (oltre i limiti di caricamento)',
    draft({
      media: [
        photo(
          {},
          { status: 'failed', failure: { code: 'too_large', limit: 50_000_000 }, checks: null },
        ),
      ],
    }),
    [block('media_failed', 'media:0')],
  ),
  ...FAILED_FILES.map(([id, scenario, media]) =>
    c(
      id,
      'file',
      scenario,
      draft({ type: media.kind === 'video' ? 'reel' : 'photo', media: [media] }),
      [block('media_failed', 'media:0')],
    ),
  ),
  c(
    'file-processing',
    'file',
    'File ancora in elaborazione',
    draft({ media: [photo({}, { status: 'processing', analysis: null, checks: null })] }),
    [block('media_processing', 'media:0')],
  ),
  c(
    'file-deleted',
    'file',
    'File eliminato dalla libreria',
    draft({ media: [photo({}, { status: 'deleted' })] }),
    [block('media_unavailable', 'media:0')],
  ),
  c(
    'file-converted',
    'file',
    'Foto HEIC con profilo colore non sRGB, metadati e 6000 px di larghezza',
    draft({
      media: [
        photo(
          {},
          {
            checks: {
              fixes: [
                { code: 'convert_to_jpeg' },
                { code: 'convert_to_srgb' },
                { code: 'strip_metadata' },
                { code: 'resize', width: 1440 },
              ],
              warnings: [],
            },
          },
        ),
      ],
    }),
    [
      fix('file_convert_to_jpeg', 'media:0'),
      fix('file_convert_to_srgb', 'media:0'),
      fix('file_strip_metadata', 'media:0'),
      fix('file_resize', 'media:0'),
    ],
  ),
  c(
    'file-recompress-both',
    'file',
    'Foto di 9 MB su Instagram e Facebook',
    draft({
      media: [
        photo(
          { sizeBytes: 9_000_000 },
          {
            checks: {
              fixes: [
                { code: 'recompress', platform: 'instagram', limit: 8_000_000 },
                { code: 'recompress', platform: 'facebook', limit: 4_000_000 },
              ],
              warnings: [],
            },
          },
        ),
      ],
    }),
    [fix('file_recompress', 'media:0', 'instagram'), fix('file_recompress', 'media:0', 'facebook')],
  ),
  c(
    'file-recompress-only-ig',
    'file',
    'Foto di 5 MB solo su Instagram: la ricompressione per Facebook non si dice',
    draft({
      destinations: onlyIg,
      media: [
        photo(
          { sizeBytes: 5_000_000 },
          {
            checks: {
              fixes: [{ code: 'recompress', platform: 'facebook', limit: 4_000_000 }],
              warnings: [],
            },
          },
        ),
      ],
    }),
    [],
  ),
  c(
    'file-video-codec-fps',
    'file',
    'Video in VP9 a 120 fps, con i dati non all’inizio del file',
    reel(
      20_000,
      {},
      {
        media: [
          video(
            20_000,
            { videoCodec: 'vp9', fps: 120 },
            {
              checks: {
                fixes: [{ code: 'faststart' }],
                warnings: [{ code: 'convert_codec' }, { code: 'convert_fps', fps: 30 }],
              },
            },
          ),
        ],
      },
    ),
    [
      fix('file_faststart', 'media:0'),
      warning('file_convert_codec', 'media:0'),
      warning('file_convert_fps', 'media:0'),
    ],
  ),
  c(
    'file-reel-copy',
    'file',
    'Video 4K a 25 Mbit/s con audio a 44,1 kHz mono per un reel',
    reel(
      20_000,
      { width: 2160, height: 3840 },
      {
        media: [
          video(
            20_000,
            { width: 2160, height: 3840 },
            {
              checks: {
                fixes: [{ code: 'convert_for_reels', width: 1080 }],
                warnings: [],
              },
            },
          ),
        ],
      },
    ),
    [fix('file_convert_for_reels', 'media:0')],
  ),
  c(
    'file-reel-audio',
    'file',
    'Video di un reel con l’audio a 44,1 kHz mono e il video già nei limiti',
    reel(
      20_000,
      {},
      {
        media: [
          video(
            20_000,
            {},
            { checks: { fixes: [{ code: 'convert_audio_for_reels' }], warnings: [] } },
          ),
        ],
      },
    ),
    [fix('file_convert_audio_for_reels', 'media:0')],
  ),

  // — Proporzioni e durata (§9.2)
  c(
    'feed-photo-ratio',
    'proportions',
    'Foto verticale 9:16 nel feed di Instagram (fuori da 4:5–1,91:1)',
    draft({ media: [photo({ width: 1080, height: 1920 })] }),
    [warning('photo_aspect_ratio', 'media:0', 'instagram')],
  ),
  c(
    'feed-photo-ratio-edges',
    'proportions',
    'Foto esattamente 4:5 e 1,91:1: nessun avviso',
    carousel([photo({ width: 1080, height: 1350 }), photo({ width: 1910, height: 1000 })], {
      destinations: onlyFb,
    }),
    [],
  ),
  c(
    'carousel-ratios',
    'proportions',
    'Carosello con una foto 4:5 e una quadrata',
    carousel([photo(), photo({ width: 1080, height: 1080 })]),
    [warning('carousel_mixed_ratios', 'post', 'instagram')],
  ),
  c('reel-ratio', 'proportions', 'Reel quadrato', reel(20_000, { width: 1080, height: 1080 }), [
    warning('reel_aspect_ratio', 'media:0'),
  ]),
  c('reel-too-short', 'proportions', 'Reel di 2,9 secondi', reel(2_900), [
    block('reel_too_short', 'media:0'),
  ]),
  c('reel-2-96s', 'proportions', 'Reel di 2,96 secondi: il testo dice 2,9, non 3', reel(2_960), [
    block('reel_too_short', 'media:0'),
  ]),
  c('reel-3s', 'proportions', 'Reel di esattamente 3 secondi', reel(3_000), []),
  c(
    'reel-15min',
    'proportions',
    'Reel di esattamente 15 minuti, solo su Instagram',
    reel(900_000, {}, { destinations: onlyIg }),
    [],
  ),
  c('reel-too-long', 'proportions', 'Reel di 15 minuti e 1 secondo', reel(901_000), [
    block('reel_too_long', 'media:0'),
  ]),
  c('reel-90s-fb', 'proportions', 'Reel di esattamente 90 secondi con Facebook', reel(90_000), []),
  c('reel-long-fb', 'proportions', 'Reel di 91 secondi con Facebook', reel(91_000), [
    warning('reel_too_long_for_facebook', 'media:0', 'facebook'),
  ]),
  c('story-too-short', 'proportions', 'Storia video di 2,9 secondi', story(video(2_900)), [
    block('story_too_short', 'media:0'),
  ]),
  c('story-3s', 'proportions', 'Storia video di esattamente 3 secondi', story(video(3_000)), []),
  c('story-too-long', 'proportions', 'Storia video di 61 secondi', story(video(61_000)), [
    warning('story_too_long', 'media:0'),
  ]),
  c(
    'story-heavy',
    'proportions',
    'Storia video di 30 secondi e 120 MB',
    story(video(30_000, { sizeBytes: 120_000_000 })),
    [fix('story_recompressed', 'media:0')],
  ),
  c(
    'reel-low-res-fb',
    'proportions',
    'Reel 480×854 con Facebook (sotto 540×960)',
    reel(20_000, { width: 480, height: 854 }),
    [warning('reel_resolution_low_for_facebook', 'media:0', 'facebook')],
  ),
  c(
    'cover-ratio',
    'proportions',
    'Copertina del reel quadrata, solo Instagram',
    reel(
      20_000,
      {},
      {
        destinations: onlyIg,
        cover: { source: 'image', media: photo({ width: 1080, height: 1080 }) },
      },
    ),
    [warning('cover_aspect_ratio', 'cover', 'instagram')],
  ),
  c(
    'cover-converted',
    'proportions',
    'Copertina del reel in PNG 9:16 di 9 MB, solo Instagram',
    reel(
      20_000,
      {},
      {
        destinations: onlyIg,
        cover: {
          source: 'image',
          media: photo({ format: 'png', width: 1080, height: 1920, sizeBytes: 9_000_000 }),
        },
      },
    ),
    [fix('cover_converted', 'cover', 'instagram')],
  ),
  c(
    'cover-not-image',
    'proportions',
    'Copertina del reel caricata, ma è un video, solo Instagram',
    reel(20_000, {}, { destinations: onlyIg, cover: { source: 'image', media: video(5_000) } }),
    [block('cover_not_image', 'cover')],
  ),
  c(
    'cover-frame-end',
    'proportions',
    'Fotogramma della copertina all’ultimo istante di un reel di 20 secondi, solo Instagram',
    reel(20_000, {}, { destinations: onlyIg, cover: { source: 'frame', offsetMs: 20_000 } }),
    [],
  ),
  c(
    'cover-frame-out',
    'proportions',
    'Fotogramma della copertina a 25 secondi in un reel di 20, solo Instagram',
    reel(20_000, {}, { destinations: onlyIg, cover: { source: 'frame', offsetMs: 25_000 } }),
    [block('cover_frame_out_of_range', 'cover')],
  ),
  c(
    'cover-fb',
    'proportions',
    'Reel con un fotogramma scelto come copertina, anche su Facebook',
    reel(20_000, {}, { cover: { source: 'frame', offsetMs: 4_000 } }),
    [warning('cover_on_facebook', 'cover', 'facebook')],
  ),

  // — Post (§9.2)
  c(
    'caption-2200',
    'post',
    'Caption di 2.200 caratteri su Instagram',
    draft({ caption: { common: chars(2200) } }),
    [],
  ),
  c(
    'caption-2201',
    'post',
    'Caption di 2.201 caratteri: blocca Instagram, non Facebook',
    draft({ caption: { common: chars(2201) } }),
    [block('caption_too_long', 'post', 'instagram')],
  ),
  c(
    'caption-ig-only-text',
    'post',
    'Testo solo per Instagram di 2.300 caratteri, testo comune corto',
    draft({ caption: { common: 'Corto', instagram: chars(2300) } }),
    [block('caption_too_long', 'post', 'instagram')],
  ),
  c(
    'caption-ig-empty',
    'post',
    'Testo per Instagram lasciato vuoto: vale il testo comune, e si controlla quello',
    draft({ caption: { common: chars(2201), instagram: '' } }),
    [block('caption_too_long', 'post', 'instagram')],
  ),
  c(
    'hashtags-31',
    'post',
    'Caption con 31 hashtag',
    draft({
      caption: { common: Array.from({ length: 31 }, (_, i) => `#h${String(i)}`).join(' ') },
    }),
    [block('too_many_hashtags', 'post', 'instagram')],
  ),
  c(
    'hashtags-30',
    'post',
    'Caption con 30 hashtag',
    draft({
      caption: { common: Array.from({ length: 30 }, (_, i) => `#h${String(i)}`).join(' ') },
    }),
    [],
  ),
  c(
    'mentions-21',
    'post',
    'Caption con 21 menzioni',
    draft({
      caption: { common: Array.from({ length: 21 }, (_, i) => `@utente${String(i)}`).join(' ') },
    }),
    [block('too_many_mentions', 'post', 'instagram')],
  ),
  c(
    'caption-fb',
    'post',
    'Testo solo per Facebook di 63.207 caratteri',
    draft({ caption: { common: 'Corto', facebook: chars(63_207) } }),
    [block('caption_too_long', 'post', 'facebook')],
  ),
  c('carousel-one', 'post', 'Carosello con una foto sola', carousel([photo()]), [
    block('carousel_too_few', 'post'),
  ]),
  c(
    'carousel-11',
    'post',
    'Carosello di 11 foto solo su Instagram',
    carousel(photos(11), { destinations: onlyIg }),
    [block('carousel_too_many', 'post', 'instagram')],
  ),
  c(
    'carousel-10',
    'post',
    'Carosello di 10 foto su Instagram e Facebook',
    carousel(photos(10)),
    [],
  ),
  c(
    'carousel-mixed-fb',
    'post',
    'Carosello con foto e video, anche su Facebook',
    carousel([photo(), video(10_000, { width: 1080, height: 1350 })]),
    [warning('carousel_mixed_with_facebook', 'post', 'facebook')],
  ),
  c(
    'carousel-mixed-ig',
    'post',
    'Carosello con foto e video solo su Instagram',
    carousel([photo(), video(10_000, { width: 1080, height: 1350 })], { destinations: onlyIg }),
    [],
  ),
  c(
    'fb-multi-photo-12',
    'post',
    'Post di 12 foto solo su Facebook',
    carousel(photos(12), { destinations: onlyFb }),
    [warning('facebook_too_many_photos', 'post', 'facebook')],
  ),
  c('type-mismatch', 'post', 'Tipo «foto» con un video', draft({ media: [video(10_000)] }), [
    block('media_not_matching_type', 'post'),
  ]),
  c('no-media', 'post', 'Post senza file', draft({ media: [] }), [block('no_media', 'post')]),
  c('no-destinations', 'post', 'Nessun account scelto', draft({ destinations: [] }), [
    block('no_destinations', 'post'),
  ]),
  c(
    'account-other-workspace',
    'post',
    'Account di un altro cliente',
    draft({ destinations: [{ accountId: OTHER }] }),
    [block('account_unavailable', `destination:${OTHER}`)],
  ),
  c(
    'account-unknown',
    'post',
    'Account che non esiste o di un’altra agenzia: lo stesso esito',
    draft({ destinations: [{ accountId: 'acc-unknown' }] }),
    [block('account_unavailable', 'destination:acc-unknown')],
  ),
  c(
    'platform-without-rules',
    'post',
    'Account di una piattaforma di cui l’installazione non ha le regole (qui Facebook)',
    draft(),
    [block('platform_unsupported', `destination:${FB}`)],
    { ...ctx, platforms: platformRulesMap([INSTAGRAM_RULES]) },
  ),
  c(
    'account-red',
    'post',
    'Account Instagram da ricollegare (salute in rosso)',
    draft({ destinations: onlyIg }),
    [block('account_unhealthy', `destination:${IG}`)],
    context({ accounts: { [IG]: account({ platform: 'instagram', health: 'error' }) } }),
  ),
  c(
    'account-inactive',
    'post',
    'Account Facebook disattivato',
    draft({ destinations: onlyFb }),
    [block('account_unhealthy', `destination:${FB}`)],
    context({ accounts: { [FB]: account({ platform: 'facebook', active: false }) } }),
  ),
  c(
    'past',
    'post',
    'Data nel passato (ieri alle 18:00)',
    draft({ when: { mode: 'at', localDate: '2026-11-16', localTime: '18:00' } }),
    [block('scheduled_in_past', 'post')],
  ),
  c(
    'past-publish',
    'post',
    'Data nel passato controllata dal worker al momento di pubblicare (D-54)',
    draft({ when: { mode: 'at', localDate: '2026-11-16', localTime: '18:00' } }),
    [],
    context({ purpose: 'publish' }),
  ),
  c(
    'past-this-minute',
    'post',
    'Programmato per il minuto in corso (11:00 a Roma alle 11:00:30)',
    draft({ when: { mode: 'at', localDate: '2026-11-17', localTime: '11:00' } }),
    [block('scheduled_in_past', 'post')],
    { ...ctx, now: new Date('2026-11-17T10:00:30Z') },
  ),
  c(
    'publish-now',
    'post',
    '«Pubblica ora»: la regola della data non vale',
    draft({ when: { mode: 'now' } }),
    [],
  ),
  c(
    'dst-skipped',
    'post',
    'Alle 02:30 del 28 marzo 2027, ora che non esiste',
    draft({ when: { mode: 'at', localDate: '2027-03-28', localTime: '02:30' } }),
    [warning('time_skipped', 'post')],
  ),
  c(
    'dst-ambiguous',
    'post',
    'Alle 02:30 del 25 ottobre 2026, ora che c’è due volte',
    draft({ when: { mode: 'at', localDate: '2026-10-25', localTime: '02:30' } }),
    [warning('time_ambiguous', 'post')],
    { ...ctx, now: new Date('2026-10-01T10:00:00Z') },
  ),
  c(
    'quota-low',
    'post',
    'Quota di Instagram: 96 post su 100 nelle 24 ore',
    draft({ destinations: onlyIg, when: TODAY_EVENING }),
    [warning('quota_low', `destination:${IG}`, 'instagram')],
    context({
      accounts: {
        [IG]: account({ platform: 'instagram', quota: { used: 96, total: 100, checkedAt: NOW } }),
      },
    }),
  ),
  c(
    'quota-scheduled',
    'post',
    'Quota di Instagram: 90 usati e 6 già programmati in quelle 24 ore',
    draft({ destinations: onlyIg, when: TODAY_EVENING }),
    [warning('quota_low', `destination:${IG}`, 'instagram')],
    context({
      accounts: {
        [IG]: account({ platform: 'instagram', quota: { used: 90, total: 100, checkedAt: NOW } }),
      },
      history: { scheduledNear: new Map([[IG, 6]]) },
    }),
  ),
  c(
    'quota-exhausted',
    'post',
    'Quota di Instagram esaurita: 100 su 100',
    draft({ destinations: onlyIg, when: TODAY_EVENING }),
    [block('quota_exhausted', `destination:${IG}`, 'instagram')],
    context({
      accounts: {
        [IG]: account({ platform: 'instagram', quota: { used: 100, total: 100, checkedAt: NOW } }),
      },
    }),
  ),
  c(
    'fb-reels-limit',
    'post',
    'Pagina Facebook con già 30 reel nelle 24 ore',
    reel(20_000, {}, { destinations: onlyFb }),
    [block('facebook_reels_limit', `destination:${FB}`, 'facebook')],
    context({ history: { reelsLast24h: new Map([[FB, 30]]) } }),
  ),
  c(
    'fb-reels-29',
    'post',
    'Pagina Facebook con 29 reel nelle 24 ore',
    reel(20_000, {}, { destinations: onlyFb }),
    [],
    context({ history: { reelsLast24h: new Map([[FB, 29]]) } }),
  ),
  c(
    'story-caption',
    'post',
    'Storia con una caption',
    story(photo({ width: 1080, height: 1920 }), { caption: { common: 'Non uscirà' } }),
    [warning('story_caption_ignored', 'post')],
  ),
  c(
    'story-long-caption',
    'post',
    'Storia con una caption di 3.000 caratteri: i caratteri non si contano',
    story(photo({ width: 1080, height: 1920 }), { caption: { common: chars(3000) } }),
    [warning('story_caption_ignored', 'post')],
  ),
  c(
    'duplicate',
    'post',
    'Stessa foto e stesso testo sulla stessa Pagina negli ultimi 7 giorni',
    duplicate,
    [warning('duplicate_post', `destination:${FB}`, 'facebook')],
    context({ history: { recentFingerprints: new Map([[FB, new Set([duplicateSeen])]]) } }),
  ),
  c(
    'quota-full-today-later',
    'post',
    'Quota di Instagram piena oggi, post fra 3 giorni: quei post non contano più',
    draft({
      destinations: onlyIg,
      when: { mode: 'at', localDate: '2026-11-20', localTime: '18:00' },
    }),
    [],
    context({
      accounts: {
        [IG]: account({ platform: 'instagram', quota: { used: 100, total: 100, checkedAt: NOW } }),
      },
    }),
  ),
  c(
    'carousel-videos-fb',
    'post',
    'Carosello di soli video, anche su Facebook',
    carousel([video(10_000), video(10_000)]),
    [warning('carousel_videos_with_facebook', 'post', 'facebook')],
  ),

  // — Choices that change the post (plan 05, «Avvisi con scelta»)
  c(
    'choice-photos-only',
    'post',
    'Carosello con foto e video: «solo le foto» su Facebook',
    carousel([photo(), video(10_000, { width: 1080, height: 1350 }), photo()], {
      choices: [{ key: 'carousel_mixed_with_facebook:post:facebook', option: 'photos_only' }],
    }),
    [chose(warning('carousel_mixed_with_facebook', 'post', 'facebook'), 'photos_only')],
    ctx,
    [
      { accountId: IG, format: 'carousel', media: [0, 1, 2] },
      { accountId: FB, format: 'multi_photo', media: [0, 2] },
    ],
  ),
  c(
    'choice-skip-facebook',
    'post',
    'Carosello con foto e video: «salta Facebook»',
    carousel([photo(), video(10_000, { width: 1080, height: 1350 })], {
      choices: [{ key: 'carousel_mixed_with_facebook:post:facebook', option: 'skip_platform' }],
    }),
    [chose(warning('carousel_mixed_with_facebook', 'post', 'facebook'), 'skip_platform')],
    ctx,
    [{ accountId: IG, format: 'carousel', media: [0, 1] }],
  ),
  c(
    'choice-first-10',
    'post',
    'Post di 12 foto su Facebook: «solo le prime 10»',
    carousel(photos(12), {
      destinations: onlyFb,
      choices: [{ key: 'facebook_too_many_photos:post:facebook', option: 'first_files' }],
    }),
    // D-56: the two photos nobody publishes block, to be taken out
    [
      chose(warning('facebook_too_many_photos', 'post', 'facebook'), 'first_files'),
      block('media_unused', 'media:10'),
      block('media_unused', 'media:11'),
    ],
    ctx,
    [{ accountId: FB, format: 'multi_photo', media: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }],
  ),
  c(
    'choice-fb-video',
    'post',
    'Reel di 2 minuti: su Facebook «come video normale»',
    longReel,
    [chose(warning('reel_too_long_for_facebook', 'media:0', 'facebook'), 'publish_as_video')],
    ctx,
    [
      { accountId: IG, format: 'reel', media: [0] },
      { accountId: FB, format: 'video', media: [0] },
    ],
  ),
  c(
    'choice-crop-box',
    'proportions',
    'Foto 1:2 su Instagram ritagliata a 4:5 spostando il riquadro (D-61)',
    cropped({ x: 0, y: 0.2, width: 1, height: 0.625 }),
    [chose(warning('photo_aspect_ratio', 'media:0', 'instagram'), 'crop')],
  ),
  c(
    'choice-crop-outside',
    'proportions',
    'Foto 1:2 con il riquadro fuori dalla foto: la scelta non vale e l’avviso resta (D-61)',
    cropped({ x: 0, y: 0.5, width: 1, height: 0.625 }),
    [warning('photo_aspect_ratio', 'media:0', 'instagram')],
  ),
  c(
    'media-unused',
    'post',
    'Carosello con un video non riuscito, solo su Facebook con «solo le foto»: il video blocca lo stesso (D-56)',
    carousel(
      [
        photo(),
        video(
          10_000,
          { width: 1080, height: 1350 },
          { status: 'failed', failure: { code: 'unreadable' } as never },
        ),
        photo(),
      ],
      {
        destinations: onlyFb,
        choices: [{ key: 'carousel_mixed_with_facebook:post:facebook', option: 'photos_only' }],
      },
    ),
    [
      chose(warning('carousel_mixed_with_facebook', 'post', 'facebook'), 'photos_only'),
      block('media_failed', 'media:1'),
      block('media_unused', 'media:1'),
    ],
    ctx,
    [{ accountId: FB, format: 'multi_photo', media: [0, 2] }],
  ),
]
