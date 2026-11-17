import {
  REEL_MAX_BITRATE,
  REEL_MAX_FPS,
  REEL_MAX_LONG_SIDE,
  REEL_MAX_SHORT_SIDE,
} from '../../../media/reel.js'

// Meta's limits for the checks before scheduling (spec §8.7, §9.2; plan 05), in one place.
// Read on 2026-11-17 in Meta's public documentation only: none is tried on a real account yet
// (stage 7). Where the documentation and the spec disagree the spec's value stays, and D-51
// says why. The limits of the copy for the Reels stay in `media/reel.ts` (D-40): they drive
// the worker's conversion, and are cited here.

export interface MetaLimit {
  value: number
  unit: 'characters' | 'count' | 'bytes' | 'ms' | 'px' | 'ratio' | 'fps' | 'bit/s'
  /** what it limits, in Italian, for the table of the cases (plan 05 Task 2) */
  label: string
  /** the page of the documentation, and what it says */
  source: string
  checkedOn: string
  /** false until stage 7 tries it on Meta */
  verifiedOnMeta: boolean
  note?: string
}

const IG_MEDIA =
  'Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)'
const IG_PUBLISHING =
  'Instagram Platform, «Content Publishing» (developers.facebook.com/docs/instagram-platform/content-publishing)'
const FB_REELS =
  'Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing)'
const FB_STORIES =
  'Video API, «Page Stories API» (developers.facebook.com/documentation/video-api/page-stories-api)'
const FB_PHOTOS =
  'Graph API, «Album Photos» (developers.facebook.com/docs/graph-api/reference/album/photos)'
const CHECKED_ON = '2026-11-17'

const limit = (l: Omit<MetaLimit, 'checkedOn' | 'verifiedOnMeta'>): MetaLimit => ({
  ...l,
  checkedOn: CHECKED_ON,
  verifiedOnMeta: false,
})

export const META_LIMITS = {
  instagramCaptionCharacters: limit({
    value: 2200,
    unit: 'characters',
    label: 'Caption di Instagram',
    source: `${IG_MEDIA}: «Maximum 2200 characters, 30 hashtags, and 20 @ tags»`,
    note: 'Come si contano i caratteri: D-46.',
  }),
  instagramCaptionHashtags: limit({
    value: 30,
    unit: 'count',
    label: 'Hashtag nella caption di Instagram',
    source: IG_MEDIA,
  }),
  instagramCaptionMentions: limit({
    value: 20,
    unit: 'count',
    label: 'Menzioni nella caption di Instagram',
    source: IG_MEDIA,
  }),
  carouselMinItems: limit({
    value: 2,
    unit: 'count',
    label: 'Elementi minimi di un carosello',
    source: 'Specifica §9.1: la documentazione non dice un minimo',
  }),
  instagramCarouselMaxItems: limit({
    value: 10,
    unit: 'count',
    label: 'Elementi massimi di un carosello di Instagram',
    source: `${IG_PUBLISHING}: «Carousels are limited to 10 images, videos, or a mix of the two»`,
    note: '«IG User Media» dice invece fino a 20: resta 10, D-51.',
  }),
  instagramPhotoMaxBytes: limit({
    value: 8_000_000,
    unit: 'bytes',
    label: 'Peso di una foto per Instagram',
    source: `${IG_MEDIA}: «8 MB maximum», letto in megabyte decimali`,
  }),
  instagramFeedMinRatio: limit({
    value: 4 / 5,
    unit: 'ratio',
    label: 'Proporzioni minime di una foto del feed di Instagram (4:5)',
    source: `${IG_MEDIA}: «within a 4:5 to 1.91:1 range»`,
  }),
  instagramFeedMaxRatio: limit({
    value: 1.91,
    unit: 'ratio',
    label: 'Proporzioni massime di una foto del feed di Instagram (1,91:1)',
    source: IG_MEDIA,
  }),
  photoMaxWidth: limit({
    value: 1440,
    unit: 'px',
    label: 'Larghezza di una foto per Instagram',
    source: `${IG_MEDIA}: oltre 1440 px Instagram la riduce (PHOTO_MAX_WIDTH in media/check-file.ts)`,
  }),
  reelMinMs: limit({
    value: 3000,
    unit: 'ms',
    label: 'Durata minima di un reel',
    source: `${IG_MEDIA} («3 seconds minimum») e ${FB_REELS} («3 to 90 seconds»)`,
  }),
  reelMaxMs: limit({
    value: 15 * 60_000,
    unit: 'ms',
    label: 'Durata massima di un reel di Instagram',
    source: `${IG_MEDIA}: «15 minutes maximum»`,
  }),
  facebookReelMaxMs: limit({
    value: 90_000,
    unit: 'ms',
    label: 'Durata massima di un reel di Facebook',
    source: `${FB_REELS}: «3 to 90 seconds»`,
  }),
  facebookReelMinShortSide: limit({
    value: 540,
    unit: 'px',
    label: 'Lato corto minimo di un reel di Facebook',
    source: `${FB_REELS}: «Minimum is 540 x 960 pixels»`,
  }),
  facebookReelMinLongSide: limit({
    value: 960,
    unit: 'px',
    label: 'Lato lungo minimo di un reel di Facebook',
    source: FB_REELS,
  }),
  facebookReelsPer24h: limit({
    value: 30,
    unit: 'count',
    label: 'Reel di Facebook pubblicati con l’API in 24 ore, per Pagina',
    source: `${FB_REELS}: «limited to 30 API-published posts within a 24-hour moving period»`,
  }),
  storyVideoMinMs: limit({
    value: 3000,
    unit: 'ms',
    label: 'Durata minima di una storia video',
    source: `${IG_MEDIA} («3 seconds minimum») e ${FB_STORIES} («3 to 90 seconds»)`,
  }),
  storyVideoMaxMs: limit({
    value: 60_000,
    unit: 'ms',
    label: 'Durata massima di una storia video',
    source: `${IG_MEDIA} («60 seconds maximum») e ${FB_STORIES} («A video story can not exceed 60 seconds»)`,
    note: 'La stessa pagina di Facebook dice anche «3 to 90 seconds»: vale il limite più basso.',
  }),
  storyVideoMaxBytes: limit({
    value: 100_000_000,
    unit: 'bytes',
    label: 'Peso di una storia video',
    source: `${IG_MEDIA}: «100 MB maximum»`,
  }),
  coverMaxBytes: limit({
    value: 8_000_000,
    unit: 'bytes',
    label: 'Peso della copertina di un reel',
    source: `${IG_MEDIA} (cover_url): JPEG, «8 MB maximum», sRGB, 9:16 consigliato`,
  }),
  reelFpsMin: limit({
    value: 23,
    unit: 'fps',
    label: 'Fotogrammi al secondo minimi di un video',
    source: `${IG_MEDIA}: «23-60 FPS»; ${FB_REELS}: «24 to 60» (il controllo dei file usa 23)`,
  }),
  reelFpsMax: limit({
    value: REEL_MAX_FPS,
    unit: 'fps',
    label: 'Fotogrammi al secondo massimi di un video',
    source: `${IG_MEDIA}, ${FB_REELS} (REEL_MAX_FPS in media/reel.ts)`,
  }),
  reelMaxLongSide: limit({
    value: REEL_MAX_LONG_SIDE,
    unit: 'px',
    label: 'Lato lungo della copia per le Reels',
    source: `${IG_MEDIA}: «1920 columns maximum» (REEL_MAX_LONG_SIDE in media/reel.ts, D-40)`,
  }),
  reelMaxShortSide: limit({
    value: REEL_MAX_SHORT_SIDE,
    unit: 'px',
    label: 'Lato corto della copia per le Reels',
    source: `${FB_REELS}: 1080 × 1920 consigliato (REEL_MAX_SHORT_SIDE in media/reel.ts, D-40)`,
  }),
  reelMaxBitrate: limit({
    value: REEL_MAX_BITRATE,
    unit: 'bit/s',
    label: 'Bitrate massimo di un reel',
    source: `${IG_MEDIA}: «VBR, 25 Mbps maximum» (REEL_MAX_BITRATE in media/reel.ts, D-40)`,
  }),
  instagramQuotaLowBelow: limit({
    value: 5,
    unit: 'count',
    label: 'Post rimasti nella quota di Instagram sotto cui Feedway avvisa',
    source: `Specifica §9.2; la quota è letta da Meta (${IG_PUBLISHING}: 100 post in 24 ore, 50 nella sezione dei caroselli)`,
  }),
  facebookCaptionCharacters: limit({
    value: 63_206,
    unit: 'characters',
    label: 'Caption di Facebook',
    source:
      'Non scritto nella documentazione per sviluppatori: il valore noto dei post delle Pagine (D-47)',
  }),
  facebookMultiPhotoMax: limit({
    value: 10,
    unit: 'count',
    label: 'Foto di un post multi-foto di Facebook',
    source: 'Non scritto nella documentazione: come il carosello di Instagram (D-48)',
  }),
  facebookPhotoMaxBytes: limit({
    value: 4_000_000,
    unit: 'bytes',
    label: 'Peso di una foto per Facebook',
    source: `Specifica §9.2; ${FB_PHOTOS} dice «less than 10MB»`,
    note: 'Resta 4 MB: la foto è solo ricompressa di più, D-51.',
  }),
} as const satisfies Record<string, MetaLimit>

export type MetaLimitName = keyof typeof META_LIMITS
