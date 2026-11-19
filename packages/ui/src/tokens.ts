// Values come from the new direction of the panel (D-81, design/esplorazioni/2026-11-19-nuova-direzione/base.css). Status colours carry their meaning independently of the palette and
// are always paired with an icon and text in the UI. The error red is a cool crimson, so it never
// passes for an orange accent (D-25).

export const statusTokens = [
  'status-draft',
  'status-scheduled',
  'status-publishing',
  'status-verifying',
  'status-confirmed',
  'status-problem',
  'status-paused',
] as const

export const tokenNames = [
  'bg',
  'surface',
  'surface-sunken',
  'nav-bg',
  // the hover of a row and the active item of the menu: a quiet step, never the accent
  'nav-hover',
  'text',
  'text-muted',
  'border',
  'border-strong',
  // the outline of inputs and selects: the only thing that shows the field, so 3:1 (WCAG 1.4.11)
  'field-border',
  'brand',
  'on-brand',
  'brand-hover',
  'brand-soft',
  'focus',
  'success',
  'success-soft',
  'warning',
  'warning-soft',
  // the dot of «Da ricollegare» and of a warning: brighter than the warning's text
  'warning-dot',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
  // the dot of a draft and of what is paused
  'neutral-dot',
  // the confirmation at the bottom of the page: charcoal on light, the other way round on dark
  'toast',
  'on-toast',
  // the hairline around a picture, so a white photo does not melt into a white surface
  'img-outline',
  ...statusTokens,
] as const

export type TokenName = (typeof tokenNames)[number]
export type Theme = Record<TokenName, string>

/** The colour themes a person can choose (Impostazioni → Profilo e preferenze). */
export const paletteIds = ['feedway', 'blu', 'verde', 'viola', 'grafite'] as const
export type PaletteId = (typeof paletteIds)[number]
export const DEFAULT_PALETTE: PaletteId = 'feedway'

const states = {
  light: {
    success: '#17693F',
    'success-soft': '#E3F3EA',
    warning: '#8A5200',
    'warning-soft': '#FFF4DC',
    'warning-dot': '#D98A00',
    danger: '#B5174B',
    'danger-soft': '#FCE8EC',
    info: '#1F5AA6',
    'info-soft': '#E7EFFA',
    'neutral-dot': '#A39E95',
    toast: '#242321',
    'on-toast': '#FFFFFF',
    'img-outline': 'rgb(0 0 0 / 0.1)',
    'status-draft': '#7A756D',
    'status-scheduled': '#1F5AA6',
    'status-publishing': '#2F57C2',
    'status-verifying': '#1B7A9E',
    'status-confirmed': '#17693F',
    'status-problem': '#B5174B',
    'status-paused': '#8A5200',
  },
  dark: {
    success: '#6FD39C',
    'success-soft': '#173326',
    warning: '#F2B860',
    'warning-soft': '#3A2C12',
    'warning-dot': '#F2B860',
    danger: '#FF94AE',
    'danger-soft': '#3D1A24',
    info: '#8CB8F2',
    'info-soft': '#18273B',
    'neutral-dot': '#7D7972',
    toast: '#F4F2EE',
    'on-toast': '#242321',
    'img-outline': 'rgb(255 255 255 / 0.1)',
    'status-draft': '#9B958B',
    'status-scheduled': '#8CB8F2',
    'status-publishing': '#7FA5F5',
    'status-verifying': '#6CC4E0',
    'status-confirmed': '#6FD39C',
    'status-problem': '#FF94AE',
    'status-paused': '#F2B860',
  },
} as const

type Surface = Omit<Theme, keyof (typeof states)['light']>
type Palette = { light: Theme; dark: Theme }
const palette = (light: Surface, dark: Surface): Palette => ({
  light: { ...light, ...states.light },
  dark: { ...dark, ...states.dark },
})

// Feedway: a warm white page, white surfaces and the brand kit's orange, which marks one action per
// screen (D-81). The other palettes keep the lightness of
// every Feedway surface and tint it with their own hue; their accent is light with a dark label
// where the states are dark (light mode) and the other way round, so it never passes for a state.
const feedway = palette(
  {
    bg: '#FBFAF8',
    surface: '#FFFFFF',
    'surface-sunken': '#F4F2EE',
    'nav-bg': '#F6F4F0',
    'nav-hover': '#EFECE6',
    text: '#242321',
    'text-muted': '#625E58',
    border: '#E7E3DC',
    'border-strong': '#D5D0C7',
    'field-border': '#8A857D',
    brand: '#FF762E',
    'on-brand': '#242321',
    'brand-hover': '#FF8A4C',
    'brand-soft': '#FFEFE5',
    focus: '#242321',
  },
  {
    bg: '#171615',
    surface: '#1F1E1C',
    'surface-sunken': '#1A1918',
    'nav-bg': '#131211',
    'nav-hover': '#2A2826',
    text: '#F4F2EE',
    'text-muted': '#B4AFA7',
    border: '#32302D',
    'border-strong': '#46433F',
    'field-border': '#827E77',
    brand: '#FF762E',
    'on-brand': '#242321',
    'brand-hover': '#FF8A4C',
    'brand-soft': '#3A281D',
    focus: '#FF762E',
  },
)

const blu = palette(
  {
    bg: '#F6FAFF',
    surface: '#FFFFFF',
    'surface-sunken': '#ECF3FC',
    'nav-bg': '#EEF5FE',
    'nav-hover': '#E4EDFA',
    text: '#212327',
    'text-muted': '#575F6B',
    border: '#D9E5F3',
    'border-strong': '#C4D2E4',
    'field-border': '#7E8792',
    brand: '#56ACF0',
    'on-brand': '#192029',
    'brand-hover': '#78BFF9',
    'brand-soft': '#E2F2FF',
    focus: '#212429',
  },
  {
    bg: '#141619',
    surface: '#1C1E22',
    'surface-sunken': '#17191D',
    'nav-bg': '#101216',
    'nav-hover': '#26282C',
    text: '#EDF3FA',
    'text-muted': '#A5B1C0',
    border: '#2C3136',
    'border-strong': '#3D444D',
    'field-border': '#767F8A',
    brand: '#3664BE',
    'on-brand': '#FFFFFF',
    'brand-hover': '#2953A5',
    'brand-soft': '#1E2F46',
    focus: '#75AEF5',
  },
)

const verde = palette(
  {
    bg: '#F6FCF8',
    surface: '#FFFFFF',
    'surface-sunken': '#EBF5EE',
    'nav-bg': '#EDF7F0',
    'nav-hover': '#E3F0E7',
    text: '#202421',
    'text-muted': '#556259',
    border: '#D8E8DD',
    'border-strong': '#C2D7C8',
    'field-border': '#7D8981',
    brand: '#63CA84',
    'on-brand': '#18221B',
    'brand-hover': '#82D79A',
    'brand-soft': '#DFF8E6',
    focus: '#202622',
  },
  {
    bg: '#141715',
    surface: '#1B1F1C',
    'surface-sunken': '#161A17',
    'nav-bg': '#0F1310',
    'nav-hover': '#252926',
    text: '#EDF5EF',
    'text-muted': '#A4B5A9',
    border: '#2C322E',
    'border-strong': '#3C473F',
    'field-border': '#758279',
    brand: '#237A57',
    'on-brand': '#FFFFFF',
    'brand-hover': '#196748',
    'brand-soft': '#1B3527',
    focus: '#64C897',
  },
)

const viola = palette(
  {
    bg: '#FBF9FF',
    surface: '#FFFFFF',
    'surface-sunken': '#F4F0FA',
    'nav-bg': '#F6F2FC',
    'nav-hover': '#EFE9F7',
    text: '#242226',
    'text-muted': '#615C69',
    border: '#E7E0F0',
    'border-strong': '#D5CCE1',
    'field-border': '#888390',
    brand: '#BF8AE6',
    'on-brand': '#211D27',
    'brand-hover': '#CFA1F1',
    'brand-soft': '#F6EBFF',
    focus: '#252328',
  },
  {
    bg: '#171618',
    surface: '#1F1D21',
    'surface-sunken': '#1A181C',
    'nav-bg': '#131115',
    'nav-hover': '#29272B',
    text: '#F4F0F9',
    'text-muted': '#B3ACBD',
    border: '#322F35',
    'border-strong': '#46414C',
    'field-border': '#817B88',
    brand: '#7F4BB1',
    'on-brand': '#FFFFFF',
    'brand-hover': '#6C3C9A',
    'brand-soft': '#342843',
    focus: '#C399E8',
  },
)

// Grafite: no hue at all, the accent is the text colour itself.
const grafite = palette(
  {
    bg: '#F9FAFC',
    surface: '#FFFFFF',
    'surface-sunken': '#F0F2F5',
    'nav-bg': '#F2F4F7',
    'nav-hover': '#E9EDF0',
    text: '#222324',
    'text-muted': '#5C5F62',
    border: '#E0E4E8',
    'border-strong': '#CCD1D6',
    'field-border': '#82868A',
    brand: '#292E34',
    'on-brand': '#FFFFFF',
    'brand-hover': '#3E4349',
    'brand-soft': '#E7EAED',
    focus: '#292E34',
  },
  {
    bg: '#161617',
    surface: '#1D1E1F',
    'surface-sunken': '#18191A',
    'nav-bg': '#111213',
    'nav-hover': '#272829',
    text: '#F1F2F4',
    'text-muted': '#ACB0B4',
    border: '#2F3032',
    'border-strong': '#414446',
    'field-border': '#7B7F83',
    brand: '#E2E5E8',
    'on-brand': '#191B1D',
    'brand-hover': '#CBCED2',
    'brand-soft': '#33363A',
    focus: '#E2E5E8',
  },
)

export const palettes: Record<PaletteId, Palette> = { feedway, blu, verde, viola, grafite }

/** The Feedway palette: what everyone sees until they choose another one. */
export const themes: Palette = feedway
