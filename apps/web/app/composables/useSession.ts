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

  /**
   * The theme saved in the profile wins on every device (the cookie only remembers it locally).
   * A profile that never chose (`system`) takes the light or dark one picked in this browser,
   * even before signing in, instead of undoing it.
   */
  function applyTheme(me: Me) {
    const local = colorMode.preference
    if (me.theme === 'system' && (local === 'light' || local === 'dark')) {
      // only a full session may change the profile: until then the browser keeps the choice
      if (import.meta.client && me.sessionState === 'active') void saveTheme(local)
      return
    }
    if (local !== me.theme) colorMode.preference = me.theme
  }

  const stateNow = (): SessionView['state'] => view.value.state
  /** Each change counts: only the answer to the latest save is kept. */
  const saves = useState('theme-saves', () => 0)
  async function saveTheme(theme: 'light' | 'dark' | 'system') {
    if (view.value.state !== 'active') return
    const mine = ++saves.value
    try {
      const me = await $fetch<Me>('/api/v1/me', {
        method: 'PATCH',
        headers: { 'x-app-request': '1' },
        body: { theme },
      })
      // read again: a sign-out or another load may have landed meanwhile
      if (mine !== saves.value || stateNow() !== 'active') return
      view.value = { state: 'active', me }
      // the account page keeps its own copy of the profile: its preferences follow too
      const page = useNuxtData<Me>('me')
      if (page.data.value) page.data.value = me
    } catch {
      // the cookie still holds the theme on this device
    }
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

  /**
   * Closes the session on the server, then here. Throws when the server did not close it: the
   * cookie only goes away with the server's answer, so leaving the page would only hide it.
   * `stay`: the page goes on without the account (an invite for someone else), keeping its own data.
   */
  async function signOut(opts: { stay?: { keep: string } } = {}) {
    try {
      // Better Auth answers 415 to a POST without a JSON body
      await $fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'x-app-request': '1' },
        body: {},
      })
    } catch (e) {
      const fetchError = e as FetchError
      // already closed (expired, or signed out on another device): nothing left to close
      if ((fetchError.statusCode ?? fetchError.response?.status) !== 401) throw e
    }
    view.value = { state: 'signed_out' }
    const keep = opts.stay?.keep
    if (keep === undefined) {
      clearNuxtData()
      await navigateTo('/accedi')
    } else clearNuxtData((key) => key !== keep)
  }

  /** The server already closed the session (account deleted): forget it here too. */
  function forget() {
    view.value = { state: 'signed_out' }
    clearNuxtData()
  }

  return { view, load, current, home, signOut, forget, applyTheme, saveTheme }
}
