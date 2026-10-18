import type { CDPSession, Page } from '@playwright/test'

/** CTAP2 platform authenticator with resident keys and user verification, via Chromium's DevTools protocol. */
export async function addVirtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })
  return cdp
}
