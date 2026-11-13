import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nuxt-security'],
  css: ['~/assets/main.css'],
  // on every page, the error page included (it replaces app.vue)
  app: {
    head: {
      htmlAttrs: { lang: 'it' },
      // the brand kit's icons (04-Web/head-snippet.html)
      link: [
        { rel: 'icon', href: '/brand/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'icon', href: '/brand/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/brand/apple-touch-icon.png' },
        { rel: 'manifest', href: '/brand/site.webmanifest' },
      ],
      meta: [{ name: 'theme-color', content: '#FF762E' }],
    },
  },
  colorMode: {
    preference: 'system',
    fallback: 'light',
    // 'dark' class on <html>, theme kept in a cookie so the server renders the right theme
    classSuffix: '',
    storage: 'cookie',
    storageKey: 'theme',
    // THEME_COOKIE_MAX_AGE_SECONDS: the privacy notice states this duration
    cookieAttrs: { 'max-age': '31536000', path: '/' },
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
    externals: {
      inline: [/^@app\//],
      // the HEIC decoder is loaded by path inside a worker thread: the tracer cannot see it
      traceInclude: [
        createRequire(new URL('../../packages/infrastructure/', import.meta.url)).resolve(
          'libheif-js/wasm-bundle.js',
        ),
      ],
    },
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
        // nothing from Meta: the clients' pictures are Feedway's own copies (plan 04 Task 4)
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
