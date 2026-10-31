/**
 * "Conferma che sei tu" for a page: `withReauth` runs an action and, when the server asks for a
 * recent confirmation (REAUTH_REQUIRED), opens the dialog and runs it again. It settles only once
 * the action has really run, failed, or the person closed the dialog (ReauthCancelled).
 */
export function useReauth() {
  const { failure } = useApi()
  const open = ref(false)
  let pending: {
    action: (password?: string) => Promise<void>
    resolve: () => void
    reject: (e: unknown) => void
  } | null = null

  const withReauth: WithReauth = async (action) => {
    try {
      await action()
    } catch (e) {
      if (failure(e).code !== 'REAUTH_REQUIRED') throw e
      pending?.reject(new ReauthCancelled())
      await new Promise<void>((resolve, reject) => {
        pending = { action, resolve, reject }
        open.value = true
      })
    }
  }

  /** The dialog confirmed: the action runs again, with the password typed there if any. */
  async function done(password: string | null) {
    const p = pending
    pending = null
    if (!p) return
    try {
      await p.action(password ?? undefined)
      p.resolve()
    } catch (e) {
      p.reject(e)
    }
  }

  watch(open, (value) => {
    if (value || !pending) return
    // closed without confirming
    pending.reject(new ReauthCancelled())
    pending = null
  })

  return { open, withReauth, done }
}
