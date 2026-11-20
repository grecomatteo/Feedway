/**
 * The confirmation at the bottom of the page that outlives a change of page (screen 12): the
 * editor sets it and goes back to the client's posts, where the shell shows it («Programmato per
 * ven 20 nov alle 8:00 · Apri»).
 */
export interface Notice {
  message: string
  linkLabel?: string
  to?: string
}

export function useNotice() {
  const notice = useState<Notice | null>('notice', () => null)
  const open = useState('notice-open', () => false)
  function show(next: Notice) {
    notice.value = next
    open.value = true
  }
  return { notice, open, show }
}
