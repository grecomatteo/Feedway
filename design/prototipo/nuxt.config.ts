// Throwaway prototype: fictional data only, no backend, no real publishing.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  ui: { fonts: false },
  icon: { mode: 'svg', clientBundle: { scan: true, icons: ['lucide:instagram', 'lucide:facebook', 'lucide:circle-check', 'lucide:clock-3', 'lucide:pencil-line', 'lucide:circle-alert', 'lucide:circle-question-mark', 'lucide:hourglass', 'lucide:loader', 'lucide:rotate-cw'] } },
  routeRules: {
    '/demo/**': { ssr: false },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'it' },
      title: 'Feedway',
      meta: [
        { name: 'theme-color', content: '#FF762E' },
        { name: 'description', content: 'Organizza i contenuti Instagram e Facebook dei tuoi clienti, prepara i post e segui ogni pubblicazione da un unico spazio di lavoro.' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'preload', href: '/fonts/Sora-Variable.ttf', as: 'font', type: 'font/ttf', crossorigin: '' },
      ],
    },
  },
})
