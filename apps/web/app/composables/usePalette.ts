import type { Palette } from '@app/contracts'

/**
 * The colour palette on <html> (`data-palette`, see app.vue): the profile's, set with the session,
 * so the server already renders it. Feedway, the default, needs no attribute.
 */
export function usePalette() {
  return useState<Palette>('palette', () => 'feedway')
}
