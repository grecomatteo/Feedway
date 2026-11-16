import type { Palette } from '@app/contracts'

/**
 * The colour palette on <html> (`data-palette`, see app.vue): the profile's, set with the session,
 * so the server already renders it. Feedway, the default, needs no attribute.
 */
export function usePalette() {
  return useState<Palette>('palette', () => 'feedway')
}

/**
 * Puts the palette on <html>. app.vue and error.vue both call it: the error page replaces app.vue,
 * and without it the panel would turn orange on a missing page.
 */
export function useHtmlPalette() {
  const palette = usePalette()
  // only the --app-* variables change (packages/ui/tokens.css): pages and components stay the same
  useHead({
    htmlAttrs: {
      'data-palette': computed(() => (palette.value === 'feedway' ? undefined : palette.value)),
    },
  })
}
