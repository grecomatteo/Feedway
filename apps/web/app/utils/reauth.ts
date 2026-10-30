/** The person closed "Conferma che sei tu" without confirming: nothing ran, nothing to report. */
export class ReauthCancelled extends Error {
  constructor() {
    super('reauth cancelled')
    this.name = 'ReauthCancelled'
  }
}

/** Runs an action that may need a recent confirmation; the password typed there, if any. */
export type WithReauth = (action: (password?: string) => Promise<void>) => Promise<void>
