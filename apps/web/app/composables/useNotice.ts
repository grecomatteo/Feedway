/**
 * The confirmation at the bottom of the page that outlives a change of page (screen 12): the
 * editor sets it and goes back to the client's posts, where the shell shows it («Programmato per
 * ven 20 nov alle 8:00 · Apri»). With `action` it carries a button instead of the link, such as
 * «Annulla» after «Elimina» (plan 09 Scelta 12).
 */
export interface Notice {
  message: string
  linkLabel?: string
  to?: string
  actionLabel?: string
  action?: () => unknown
  /** something did not happen: the alert's icon */
  failed?: boolean
}

export function useNotice() {
  const notice = useState<Notice | null>('notice', () => null)
  const open = useState('notice-open', () => false)
  function show(next: Notice) {
    // closed first, so a second notice starts its five seconds again
    open.value = false
    notice.value = next
    void nextTick(() => (open.value = true))
  }
  /** the button of the notice: it runs once, and the notice closes */
  function act() {
    const run = notice.value?.action
    if (notice.value) notice.value = { ...notice.value, action: undefined }
    open.value = false
    void run?.()
  }
  return { notice, open, show, act }
}
