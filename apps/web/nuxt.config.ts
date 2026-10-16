import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nuxt-security'],
  css: ['~/assets/main.css'],
  colorMode: {
    preference: 'system',
    fallback: 'light',
    // 'dark' class on <html>, theme kept in a cookie so the server renders the right theme
    classSuffix: '',
    storage: 'cookie',
    storageKey: 'theme',
  },
  i18n: {
    defaultLocale: 'it',
    strategy: 'no_prefix',
    locales: [{ code: 'it', language: 'it-IT', file: 'it.json', name: 'Italiano' }],
  },
  icon: { provider: 'none', clientBundle: { scan: true } },
  telemetry: false,
  nitro: {
    errorHandler: fileURLToPath(new URL('./server/error.ts', import.meta.url)),
    // workspace packages are TypeScript sources: bundle them instead of importing them at runtime
    externals: { inline: [/^@app\//] },
  },
  security: {
    nonce: true,
    // HSTS depends on PANEL_URL, which is only known at runtime: see server/middleware/01.hsts.ts
    strictTransportSecurity: false,
    xFrameOptions: false,
    headers: {
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'font-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': false,
      },
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'same-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    },
    // wide limits for now; the strict ones for login arrive in stage 2
    rateLimiter: { tokensPerInterval: 600, interval: 60_000 },
  },
})
