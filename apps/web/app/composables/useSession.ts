import type { Me } from '@app/contracts'
import type { FetchError } from 'ofetch'

/**
 * Who is signed in, as the panel's pages see it:
 * - `signed_out`: no valid session;
 * - `second_factor`: the session still owes the second factor. `me` is there while the person
 *   has none yet (they set one up); with a factor already, `useExisting` asks to sign in with it;
 * - `active`.
 */
export type SessionView =
  | { state: 'unknown' }
  | { state: 'signed_out' }
  | { state: 'second_factor'; me: Me | null; useExisting: boolean }
  | { state: 'active'; me: Me }

export function useSession() {
  const view = useState<SessionView>('session', () => ({ state: 'unknown' }))
  const colorMode = useColorMode()
  // on the server, the browser's cookie goes with the request
  const fetcher = import.meta.server ? useRequestFetch() : $fetch

  function applyTheme(me: Me) {
    // the theme saved in the profile wins on every device (the cookie only remembers it locally)
    if (colorMode.preference !== me.theme) colorMode.preference = me.theme
  }

  async function load(): Promise<SessionView> {
    try {
      const me = await fetcher<Me>('/api/v1/me')
      view.value =
        me.sessionState === 'active'
          ? { state: 'active', me }
          : { state: 'second_factor', me, useExisting: false }
      applyTheme(me)
    } catch (e) {
      // read here, not with useApi: this also runs in the route middleware, outside a component
      const fetchError = e as FetchError<{ error?: { code?: string; reason?: string } }>
      const body = fetchError.data?.error
      const status = fetchError.statusCode ?? fetchError.response?.status ?? 0
      if (body?.code === 'SECOND_FACTOR_REQUIRED')
        view.value = {
          state: 'second_factor',
          me: null,
          useExisting: body.reason === 'use_existing_factor',
        }
      else if (status === 401) view.value = { state: 'signed_out' }
      // anything else is a real failure, not "signed out"
      else throw e
    }
    return view.value
  }

  /** Loaded once per visit; sign-in and sign-out load it again. */
  async function current(): Promise<SessionView> {
    return view.value.state === 'unknown' ? load() : view.value
  }

  /** Where a signed-in person lands: the page they asked for, else their last agency. */
  function home(me: Me, next?: unknown): string {
    const asked = safeNext(next)
    if (asked) return asked
    const slugs = me.organizations.filter((o) => o.status === 'active').map((o) => o.slug)
    const last = me.lastOrganizationSlug
    if (last && slugs.includes(last)) return `/${last}`
    // several agencies and no last one: the person chooses
    if (slugs.length > 1) return '/agenzie'
    return slugs[0] ? `/${slugs[0]}` : '/account'
  }

  async function signOut() {
    try {
      await $fetch('/api/auth/sign-out', { method: 'POST', headers: { 'x-app-request': '1' } })
    } finally {
      view.value = { state: 'signed_out' }
      clearNuxtData()
      await navigateTo('/accedi')
    }
  }

  return { view, load, current, home, signOut }
}
