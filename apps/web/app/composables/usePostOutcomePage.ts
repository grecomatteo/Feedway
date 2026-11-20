/**
 * The page of a post shows its outcome (plan 07 Scelta 6) rather than the editor: the layout
 * then draws the side bar and its margins, as on screen 13. The page sets it and clears it.
 */
export const usePostOutcomePage = () => useState<boolean>('post-outcome-page', () => false)
