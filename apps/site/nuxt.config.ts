// The public site (ADR 013): pages generated at build time, no server, no cookies, no third-party
// requests. It imports only @app/ui (tokens) and @app/config (product name).
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  telemetry: false,
  css: ['~/assets/site.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'it' },
      link: [
        { rel: 'icon', href: '/brand/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'icon', href: '/brand/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/brand/apple-touch-icon.png' },
        {
          rel: 'preload',
          href: '/fonts/Sora-Variable.ttf',
          as: 'font',
          type: 'font/ttf',
          crossorigin: '',
        },
      ],
      meta: [{ name: 'theme-color', content: '#FF762E' }],
    },
  },
  features: { inlineStyles: true },
  experimental: { payloadExtraction: false },
  nitro: {
    prerender: { crawlLinks: true, routes: ['/', '/privacy', '/cancellazione-dati'] },
    externals: { inline: [/^@app\//] },
  },
})
