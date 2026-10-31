import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nuxt-security'],
  css: ['~/assets/main.css'],
  // on every page, the error page included (it replaces app.vue)
  app: { head: { htmlAttrs: { lang: 'it' } } },
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
  icon: {
    provider: 'none',
    // composables name icons too (the agency menu), so they are scanned with the components
    clientBundle: {
      scan: {
        globInclude: ['app/**/*.{vue,ts}'],
        globExclude: ['node_modules', 'dist', '.output', '.nuxt', 'tests'],
      },
    },
  },
  telemetry: false,
  nitro: {
    errorHandler: fileURLToPath(new URL('./server/error.ts', import.meta.url)),
    // workspace packages are TypeScript sources: bundle them instead of importing them at runtime
    externals: { inline: [/^@app\//] },
  },
  security: {
    nonce: true,
    // same origin only: no cross-origin reader is ever allowed (the default allowed the build
    // machine's dev URL)
    corsHandler: false,
    headers: {
      // HSTS depends on PANEL_URL, which is only known at runtime: see server/middleware/01.hsts.ts
      strictTransportSecurity: false,
      xFrameOptions: 'DENY',
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
    // Off: it counts in memory per process and trusts the first X-Forwarded-For entry, which the
    // client writes. Our database-backed limits (PgRateLimiter) guard login and public routes.
    rateLimiter: false,
    // Off (ADR 018): it refused valid input that looks like HTML (a sender "Name <address>", a
    // password with angle brackets) and protects nothing that output encoding does not.
    xssValidator: false,
  },
})
