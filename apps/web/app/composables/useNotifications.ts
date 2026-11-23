import type { NotificationItem, NotificationPage } from '@app/contracts'

/** How often the bell asks again while the tab is visible (plan 08, Scelta 5). */
export const BELL_POLL_MS = 30_000

/**
 * The bell's number and the actions on the notifications, shared by the bell, the centre and its
 * page (plan 08 Task 6): no open connection, the count is read every 30 seconds while the tab is
 * visible and at once when it comes back to the front.
 */
export function useNotifications() {
  const { call } = useApi()
  const unread = useState<number | null>('notifications-unread', () => null)
  // a change made here (a row read) tells the lists open elsewhere to read again
  const version = useState('notifications-version', () => 0)

  async function refreshUnread() {
    try {
      unread.value = (
        await call<{ unread: number }>('GET', '/api/v1/me/notifications/unread')
      ).unread
    } catch {
      // the bell keeps its last number: the next round tries again
    }
  }

  async function list(query: Record<string, string | undefined>): Promise<NotificationPage> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value)
    const page = await call<NotificationPage>(
      'GET',
      `/api/v1/me/notifications${params.size > 0 ? `?${params.toString()}` : ''}`,
    )
    unread.value = page.unread
    return page
  }

  async function markRead(item: NotificationItem) {
    if (item.readAt !== null) return
    const r = await call<{ unread: number }>(
      'POST',
      `/api/v1/me/notifications/${encodeURIComponent(item.id)}/read`,
    )
    unread.value = r.unread
    version.value++
  }

  async function markAll() {
    const r = await call<{ unread: number }>('POST', '/api/v1/me/notifications/read-all')
    unread.value = r.unread
    version.value++
  }

  return { unread, version, refreshUnread, list, markRead, markAll }
}

/** Starts the bell's rounds for as long as the component that calls it is mounted. */
export function useBellPolling() {
  const { refreshUnread } = useNotifications()
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }
  const start = () => {
    stop()
    if (document.visibilityState !== 'visible') return
    void refreshUnread()
    timer = setInterval(() => void refreshUnread(), BELL_POLL_MS)
  }
  onMounted(() => {
    start()
    document.addEventListener('visibilitychange', start)
  })
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', start)
  })
}
