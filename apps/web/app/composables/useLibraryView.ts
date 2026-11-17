/** How the library shows its files (prova 0.10.0, E-1): a grid of thumbnails or a list. */
export type LibraryLayout = 'grid' | 'list'

/** The thumbnail sizes of the grid, smallest first: the narrowest a column may get. */
export const THUMB_SIZES = ['7.5rem', '10rem', '13.5rem', '18rem'] as const
const DEFAULT_SIZE = 1
const KEY = 'feedway.library.view'

const isLayout = (v: unknown): v is LibraryLayout => v === 'grid' || v === 'list'
const isSize = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < THUMB_SIZES.length

/**
 * Grid or list and the size of the thumbnails, remembered in this browser like Esplora risorse
 * does: a convenience, so a browser that keeps nothing simply starts from the grid.
 */
export function useLibraryView() {
  const view = reactive<{ layout: LibraryLayout; size: number }>({
    layout: 'grid',
    size: DEFAULT_SIZE,
  })
  onMounted(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        const { layout, size } = saved as Record<string, unknown>
        if (isLayout(layout)) view.layout = layout
        if (isSize(size)) view.size = size
      }
    } catch {
      // nothing remembered: the grid
    }
    watch(view, () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(view))
      } catch {
        // storage refused: the choice lasts until the page is left
      }
    })
  })
  const columns = computed(
    () => `repeat(auto-fill, minmax(min(100%, ${THUMB_SIZES[view.size] ?? THUMB_SIZES[1]}), 1fr))`,
  )
  return { view, columns }
}
