/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { CONTRACT_PASSWORD, startContractServer } from '@app/infrastructure/testing'
import type { ContractServer } from '@app/infrastructure/testing'
import { addVirtualAuthenticator } from './support/virtual-authenticator.ts'

// Chromium only: the virtual authenticator is a DevTools feature.
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator needs Chromium')

let started: ContractServer | undefined

test.beforeAll(async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'virtual authenticator needs Chromium')
  const adminUrl = process.env.E2E_ADMIN_URL
  test.skip(!adminUrl, 'admin database url not available')
  started = await startContractServer({ adminUrl: adminUrl!, port: 4300 + testInfo.workerIndex })
})

test.afterAll(async () => {
  await started?.stop()
})

interface Helpers {
  b64: { toBuf: (s: string) => ArrayBuffer; toStr: (b: ArrayBuffer) => string }
  post: (path: string, body: unknown) => Promise<Response>
}

/** Helpers for the WebAuthn ceremony, installed in every page before its own scripts run. */
const browserHelpers = `
  window.__pk = {
    b64: {
      toBuf: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer,
      toStr: (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''),
    },
    post: (path, body) => fetch('/api/auth' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }
`

test('passkey registers and signs in on app.feedway.localhost', async ({ page }) => {
  const server = started!
  await addVirtualAuthenticator(page)
  await page.addInitScript({ content: browserHelpers })
  await page.goto(`${server.origin}/`)

  const signedIn = await page.evaluate(
    async ({ email, password }) => {
      const { post } = (window as unknown as { __pk: Helpers }).__pk
      const res = await post('/sign-in/email', { email, password })
      return res.status
    },
    { email: server.email, password: CONTRACT_PASSWORD },
  )
  expect(signedIn).toBe(200)
  const cookies = await page.context().cookies()
  expect(cookies.some((c) => c.name.includes('session_token') && c.secure)).toBe(true)

  const registered = await page.evaluate(async () => {
    const { b64, post } = (window as unknown as { __pk: Helpers }).__pk
    const opts = await (await fetch('/api/auth/passkey/generate-register-options')).json()
    const cred = (await navigator.credentials.create({
      publicKey: {
        ...opts,
        challenge: b64.toBuf(opts.challenge),
        user: { ...opts.user, id: b64.toBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials ?? []).map((c: any) => ({
          ...c,
          id: b64.toBuf(c.id),
        })),
      },
    })) as PublicKeyCredential
    const r = cred.response as AuthenticatorAttestationResponse
    const res = await post('/passkey/verify-registration', {
      response: {
        id: cred.id,
        rawId: b64.toStr(cred.rawId),
        type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: b64.toStr(r.clientDataJSON),
          attestationObject: b64.toStr(r.attestationObject),
          transports: r.getTransports(),
        },
      },
    })
    return res.status
  })
  expect(registered).toBe(200)

  await page.context().clearCookies()

  const authenticated = await page.evaluate(async () => {
    const { b64, post } = (window as unknown as { __pk: Helpers }).__pk
    const opts = await (await fetch('/api/auth/passkey/generate-authenticate-options')).json()
    const cred = (await navigator.credentials.get({
      publicKey: { ...opts, challenge: b64.toBuf(opts.challenge) },
    })) as PublicKeyCredential
    const r = cred.response as AuthenticatorAssertionResponse
    const res = await post('/passkey/verify-authentication', {
      response: {
        id: cred.id,
        rawId: b64.toStr(cred.rawId),
        type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: b64.toStr(r.clientDataJSON),
          authenticatorData: b64.toStr(r.authenticatorData),
          signature: b64.toStr(r.signature),
          userHandle: r.userHandle ? b64.toStr(r.userHandle) : undefined,
        },
      },
    })
    return res.status
  })
  expect(authenticated).toBe(200)
  expect((await page.context().cookies()).some((c) => c.name.includes('session_token'))).toBe(true)
})
