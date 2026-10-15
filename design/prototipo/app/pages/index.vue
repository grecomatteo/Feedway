<script setup lang="ts">
import { INITIAL_POSTS, MEDIA, WORKSPACES } from '~/fixtures/scenario'
import { TYPE_LABEL, hhmm, postStatus, workspace } from '~/utils/format'

useHead({ title: 'Feedway · il tuo piano social, una direzione chiara' })

// Same fictional data as the demo, read from the fixture (never from a session).
const heroDays = [
  { label: 'Gio 15', today: true, id: 'post-01' },
  { label: 'Ven 16', id: 'post-04' },
  { label: 'Sab 17', id: 'post-07' },
  { label: 'Dom 18', id: 'post-10' },
].map(d => ({ ...d, post: INITIAL_POSTS.find(p => p.id === d.id)! }))

const menuOpen = ref(false)
const menuBtn = ref<HTMLButtonElement>()
function closeMenu(focusBack = false) {
  menuOpen.value = false
  if (focusBack) nextTick(() => menuBtn.value?.focus())
}
onMounted(() => window.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen.value) closeMenu(true) }))

const tabs = [
  { id: 'settimana', label: 'Settimana', icon: 'i-lucide-calendar-days', text: 'Tutta la settimana di tutti i clienti, con miniature grandi e l’esito di ogni post.' },
  { id: 'griglia', label: 'Griglia Instagram', icon: 'i-lucide-grid-3x3', text: 'Un account alla volta. I programmati restano distinti dai pubblicati e il riordino mostra quali date cambiano.' },
  { id: 'elenco', label: 'Elenco', icon: 'i-lucide-list', text: 'Le giornate dense diventano un elenco leggibile, anche dal telefono.' },
] as const
const tab = ref<(typeof tabs)[number]['id']>('settimana')
const tabRefs = ref<HTMLButtonElement[]>([])
function onTabKey(e: KeyboardEvent, i: number) {
  const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!n) return
  const next = (i + n + tabs.length) % tabs.length
  tab.value = tabs[next]!.id
  tabRefs.value[next]?.focus()
}
const weekPosts = INITIAL_POSTS.filter(p => p.scheduledAt.startsWith('2026-10-15') || p.scheduledAt.startsWith('2026-10-16'))
const grid = ['forno-pane', 'forno-lab', 'forno-cornetti', 'forno-lab', 'forno-pane', 'forno-cornetti', 'forno-cornetti', 'forno-pane', 'forno-lab']

const faq = [
  ['Per quali social è pensato?', 'Instagram e Facebook nella prima versione prevista.'],
  ['Posso organizzare più clienti?', 'Sì: ogni cliente ha uno spazio di lavoro distinto, con i propri contenuti e i propri account.'],
  ['Il cliente può vedere il calendario?', 'È prevista una vista condivisa in sola lettura.'],
  ['Posso preparare più post insieme?', 'È previsto un percorso di importazione e revisione in blocco, con gli errori indicati riga per riga.'],
  ['Posso usarlo dal telefono?', 'L’esperienza dà priorità al computer; i compiti essenziali sono progettati anche per il telefono.'],
]
const nav = [['#prodotto', 'Prodotto'], ['#come-funziona', 'Come funziona'], ['#per-chi', 'Per chi è'], ['#domande', 'Domande']]
const outcomePost = INITIAL_POSTS.find(p => p.id === 'post-partial')!
</script>

<template>
  <div class="bg-[var(--fw-carta)] text-[var(--fw-carbone)]">
    <a href="#principale" class="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-white px-3 py-2">Vai al contenuto</a>

    <!-- L01 -->
    <header class="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--fw-carta)]/95 backdrop-blur">
      <div class="mx-auto flex max-w-[1440px] items-center gap-8 px-5 py-2.5 lg:px-20 lg:py-3">
        <NuxtLink to="/" aria-label="Feedway, inizio pagina"><FwLogo :width="150" /></NuxtLink>
        <nav aria-label="Sezioni" class="flex items-center gap-7 max-lg:hidden">
          <a v-for="[h, l] in nav" :key="h" :href="h" class="text-[15px] font-medium hover:underline">{{ l }}</a>
        </nav>
        <span class="flex-1" />
        <NuxtLink to="/accedi" class="text-[15px] font-semibold underline underline-offset-4 max-lg:hidden">Accedi</NuxtLink>
        <NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary max-lg:hidden"><UIcon name="i-lucide-monitor-play" class="size-[18px]" aria-hidden="true" />Esplora la demo</NuxtLink>
        <button ref="menuBtn" type="button" class="fw-btn !p-2.5 lg:hidden" :aria-expanded="menuOpen" aria-controls="menu-mobile" :aria-label="menuOpen ? 'Chiudi il menu' : 'Apri il menu'" @click="menuOpen = !menuOpen">
          <UIcon :name="menuOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="size-5" aria-hidden="true" />
        </button>
      </div>
      <nav v-if="menuOpen" id="menu-mobile" aria-label="Menu" class="border-t border-[var(--border)] px-5 pb-5 lg:hidden">
        <a v-for="[h, l] in nav" :key="h" :href="h" class="fw-title block border-b border-[var(--border)] py-4 text-xl" @click="closeMenu()">{{ l }}</a>
        <NuxtLink to="/accedi" class="fw-title block border-b border-[var(--border)] py-4 text-xl">Accedi</NuxtLink>
        <NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary fw-btn--lg mt-4 w-full"><UIcon name="i-lucide-monitor-play" class="size-5" aria-hidden="true" />Esplora la demo</NuxtLink>
      </nav>
    </header>

    <main id="principale">
      <!-- L02 -->
      <section class="mx-auto flex max-w-[1440px] flex-col items-center gap-10 px-5 pb-16 pt-10 lg:flex-row lg:gap-14 lg:px-20 lg:pb-24 lg:pt-16">
        <div class="flex w-full flex-col gap-6 lg:w-[500px] lg:shrink-0">
          <p class="text-sm font-semibold text-[var(--text-muted)]">Per chi gestisce Instagram e Facebook di più clienti</p>
          <h1 class="fw-title text-[36px] leading-[1.1] lg:text-[56px] lg:leading-[1.08] lg:tracking-[-0.02em]">Il tuo piano social, una direzione chiara.</h1>
          <p class="text-base leading-relaxed lg:text-[19px]">Organizza i contenuti Instagram e Facebook dei tuoi clienti, prepara i post e segui ogni pubblicazione da un unico spazio di lavoro.</p>
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary fw-btn--lg"><UIcon name="i-lucide-monitor-play" class="size-5" aria-hidden="true" />Esplora la demo</NuxtLink>
            <a href="#come-funziona" class="inline-flex min-h-11 items-center justify-center gap-1.5 px-2 text-base font-semibold underline underline-offset-4">Guarda come funziona<UIcon name="i-lucide-arrow-down" class="size-[18px]" aria-hidden="true" /></a>
          </div>
          <p class="text-[13px] text-[var(--text-muted)]">Demo con dati fittizi, senza registrazione.</p>
        </div>
        <figure class="w-full min-w-0 flex-1">
          <div class="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_24px_48px_#2423211f]" aria-hidden="true">
            <div class="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
              <span class="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[13px] font-bold"><span class="size-2.5 rounded-full bg-[#E9B44C]" />Forno Luce</span>
              <span class="text-[13px] font-semibold">15 – 18 ottobre 2026</span>
            </div>
            <div class="grid grid-cols-2 gap-3 bg-[var(--fw-carta)] p-4 sm:grid-cols-4">
              <div v-for="d in heroDays" :key="d.label" class="flex min-w-0 flex-col gap-2.5" :class="d.label === 'Dom 18' || d.label === 'Sab 17' ? 'max-sm:hidden' : ''">
                <span class="rounded-md px-2 py-1 text-[13px] font-bold" :class="d.today ? 'bg-[var(--fw-carbone)] text-white' : ''">{{ d.label }}</span>
                <div class="fw-card p-2">
                  <p class="tabular px-0.5 pb-2 text-sm font-bold">{{ hhmm(d.post.scheduledAt) }} <span class="font-normal text-[var(--text-muted)]">{{ TYPE_LABEL[d.post.type] }}</span></p>
                  <img :src="MEDIA[d.post.media]" alt="" class="h-[190px] w-full rounded-lg object-cover">
                  <p class="mt-2 line-clamp-2 px-0.5 text-[13px]">{{ d.post.caption }}</p>
                  <p class="mt-2 px-0.5 text-xs text-[var(--text-muted)]">{{ d.post.targets.length }} destinazioni</p>
                  <StatusBadge :status="postStatus(d.post)" plain class="mt-1.5 px-0.5" />
                </div>
              </div>
            </div>
          </div>
          <figcaption class="mt-3 text-[13px] text-[var(--text-muted)]">Calendario di Forno Luce, cliente fittizio: quattro giorni con orari, miniature e stato di ogni post.</figcaption>
        </figure>
      </section>

      <!-- L03 -->
      <section id="prodotto" class="bg-white px-5 py-16 lg:px-20 lg:py-24" aria-labelledby="h-prodotto">
        <div class="mx-auto max-w-[1280px]">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-12">
            <h2 id="h-prodotto" class="fw-title text-[28px] leading-tight lg:w-[560px] lg:text-[40px]">Il piano completo. Il dettaglio quando serve.</h2>
            <p class="flex-1 text-[17px] leading-relaxed">Settimana, griglia ed elenco mostrano gli stessi contenuti: scegli la vista adatta al lavoro che stai facendo.</p>
          </div>
          <div role="tablist" aria-label="Viste del prodotto" class="mt-7 inline-flex flex-wrap gap-1 rounded-[10px] bg-[var(--surface-sunken)] p-1">
            <button v-for="(t, i) in tabs" :id="`tab-${t.id}`" :key="t.id" ref="tabRefs" type="button" role="tab" :aria-selected="tab === t.id" :aria-controls="`panel-${t.id}`" :tabindex="tab === t.id ? 0 : -1" class="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold" :class="tab === t.id ? 'bg-[var(--fw-carbone)] text-white' : ''" @click="tab = t.id" @keydown="onTabKey($event, i)">
              <UIcon :name="t.icon" class="size-4" aria-hidden="true" />{{ t.label }}
            </button>
          </div>
          <div v-for="t in tabs" v-show="tab === t.id" :id="`panel-${t.id}`" :key="t.id" role="tabpanel" :aria-labelledby="`tab-${t.id}`" tabindex="0" class="mt-5 flex flex-col gap-8 rounded-[20px] border border-[var(--border)] bg-[var(--fw-carta)] p-5 lg:flex-row lg:items-center lg:gap-12 lg:p-8">
            <div class="w-full lg:w-[440px] lg:shrink-0">
              <div v-if="t.id === 'griglia'" class="grid grid-cols-3 gap-1">
                <div v-for="(g, i) in grid" :key="i" class="relative aspect-[4/5]">
                  <img :src="MEDIA[g]" alt="" class="size-full object-cover" loading="lazy">
                  <span v-if="i < 3" class="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-bold text-[var(--info)]"><UIcon name="i-lucide-clock-3" class="size-3" aria-hidden="true" />{{ ['sab 18:00', 'ven 18:00', 'ven 12:00'][i] }}</span>
                </div>
              </div>
              <div v-else-if="t.id === 'settimana'" class="grid grid-cols-2 gap-3">
                <PostCard v-for="p in weekPosts.slice(0, 4)" :key="p.id" :post="p" :thumb="150" />
              </div>
              <ul v-else class="flex flex-col gap-2">
                <li v-for="p in weekPosts.slice(0, 4)" :key="p.id" class="fw-card flex items-center gap-3 p-2.5">
                  <img :src="MEDIA[p.media]" alt="" class="h-[72px] w-14 rounded-md object-cover" loading="lazy">
                  <span><span class="tabular block font-bold">{{ hhmm(p.scheduledAt) }} · {{ workspace(p.workspaceId).short }}</span><StatusBadge :status="postStatus(p)" plain /></span>
                </li>
              </ul>
            </div>
            <div class="flex flex-col gap-3.5">
              <h3 class="fw-title text-2xl">{{ t.label }}</h3>
              <p class="text-[17px] leading-relaxed">{{ t.text }}</p>
              <p class="text-[13px] text-[var(--text-muted)]">Schermata del prototipo Feedway con dati fittizi.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- L04 -->
      <section id="come-funziona" class="px-5 py-16 lg:px-20 lg:py-24" aria-labelledby="h-come">
        <div class="mx-auto flex max-w-[1280px] flex-col gap-12">
          <h2 id="h-come" class="fw-title text-[28px] leading-tight lg:max-w-[640px] lg:text-[40px]">Tre passaggi, sempre nello stesso ordine.</h2>
          <ol class="flex flex-col gap-12 lg:gap-16">
            <li v-for="(s, i) in [
              ['Scegli il cliente.', 'Spazio, contenuti e destinazioni riconoscibili. Gli account di un cliente non si mescolano con quelli di un altro.'],
              ['Prepara il contenuto.', 'Media, caption e controlli accanto all’anteprima. Una sola caption per Instagram e Facebook.'],
              ['Programma e segui l’esito.', 'Data, orario con fuso e risultato di ogni singola destinazione.'],
            ]" :key="i" class="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-16" :class="i === 1 ? 'lg:flex-row-reverse' : ''">
              <div class="flex flex-col gap-3.5 lg:w-[440px] lg:shrink-0">
                <span class="tabular grid size-11 place-items-center rounded-full border-[1.5px] border-[var(--fw-carbone)] bg-[var(--fw-arancio)] text-[17px] font-bold" aria-hidden="true">{{ i + 1 }}</span>
                <h3 class="fw-title text-[26px]">{{ s[0] }}</h3>
                <p class="text-[17px] leading-relaxed">{{ s[1] }}</p>
              </div>
              <div class="fw-card flex-1 bg-white p-6" aria-hidden="true">
                <div v-if="i === 0" class="grid gap-2 sm:grid-cols-3">
                  <div v-for="w in WORKSPACES" :key="w.id" class="flex items-center gap-2.5 rounded-lg border border-[var(--border)] p-3" :class="w.id === 'forno-luce' ? 'border-[var(--fw-carbone)] bg-[var(--brand-soft)]' : ''">
                    <span class="grid size-8 place-items-center rounded-md text-xs font-bold text-white" :style="{ background: w.color }">{{ w.initials }}</span>
                    <span><span class="block text-sm font-semibold">{{ w.short }}</span><span class="text-xs text-[var(--text-muted)]">{{ w.accounts.length }} account</span></span>
                  </div>
                </div>
                <div v-else-if="i === 1" class="flex gap-4">
                  <img :src="MEDIA['forno-lab']" alt="" class="h-40 w-24 rounded-lg object-cover" loading="lazy">
                  <div class="flex flex-1 flex-col gap-2 text-sm">
                    <p class="rounded-lg border border-[var(--border-strong)] p-3">Il laboratorio apre le porte: prepariamo insieme il pane di domani.</p>
                    <p class="rounded-lg bg-[var(--warning-soft)] p-2.5 text-[13px] font-semibold text-[var(--warning)]">Avviso · copertina ritagliata nella griglia</p>
                    <p class="rounded-lg bg-[var(--success-soft)] p-2.5 text-[13px] font-semibold text-[var(--success)]">Formato, durata e account: controlli superati</p>
                  </div>
                </div>
                <div v-else class="flex flex-col gap-2 text-sm">
                  <p class="rounded-lg border border-[var(--fw-carbone)] bg-[var(--brand-soft)] p-3 font-semibold">Venerdì 16 ottobre 2026, 18:00 · Europe/Rome</p>
                  <p class="text-[13px] text-[var(--text-muted)]">Programma su 5 account · Forno Luce Centro, Nord e Lab</p>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <!-- L05 -->
      <section class="bg-[var(--fw-carbone)] px-5 py-16 text-white lg:px-20 lg:py-24" aria-labelledby="h-esiti">
        <div class="mx-auto flex max-w-[1280px] flex-col gap-10 lg:flex-row lg:items-center lg:gap-16">
          <div class="flex flex-col gap-4 lg:w-[420px] lg:shrink-0">
            <h2 id="h-esiti" class="fw-title text-[28px] leading-tight lg:text-[40px]">Sai cosa è uscito. E cosa richiede attenzione.</h2>
            <p class="text-[17px] leading-relaxed text-[#E9E6E0]">Feedway mostra lo stato di ogni destinazione e indica come recuperare: riprovi solo dove serve, senza ripubblicare ciò che è già uscito.</p>
            <p class="text-[17px] leading-relaxed text-[#E9E6E0]">Quando un esito non è ancora certo, lo dice: «da accertare», non «fallito».</p>
          </div>
          <div class="flex-1 rounded-2xl bg-[var(--fw-carta)] p-5 text-[var(--fw-carbone)]">
            <StatusBadge :status="postStatus(outcomePost)" />
            <ul class="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-white">
              <li v-for="t in outcomePost.targets" :key="t.accountId" class="flex items-center gap-3 px-4 py-3 text-sm" :class="t.state === 'failed' ? 'bg-[var(--danger-soft)]' : ''">
                <UIcon :name="t.accountId.includes('instagram') ? 'i-lucide-instagram' : 'i-lucide-facebook'" class="size-[18px]" :aria-label="t.accountId.includes('instagram') ? 'Instagram' : 'Facebook'" />
                <span class="flex-1 font-semibold">{{ WORKSPACES[0]!.accounts.find(a => a.id === t.accountId)!.name }}</span>
                <StatusBadge :status="t.state === 'failed' ? { label: 'Con problema', icon: 'i-lucide-circle-alert', tone: 'danger' } : { label: 'Confermato', icon: 'i-lucide-circle-check', tone: 'success' }" />
              </li>
            </ul>
            <p class="mt-3 text-[13px]">Forno Luce Lab: permesso revocato dopo la programmazione. <strong>Riprova solo su questo account</strong> dopo averlo ricollegato.</p>
          </div>
        </div>
      </section>

      <!-- L06 -->
      <section id="per-chi" class="bg-[var(--fw-arancio)] px-5 py-16 lg:px-20 lg:py-24" aria-labelledby="h-clienti">
        <div class="mx-auto flex max-w-[1280px] flex-col gap-10">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-12">
            <h2 id="h-clienti" class="fw-title text-[28px] leading-tight lg:w-[520px] lg:text-[40px]">Ogni cliente ha il suo spazio.</h2>
            <p class="flex-1 text-[17px] leading-relaxed">Contenuti, libreria e account restano separati per cliente. Al cliente puoi condividere un calendario in sola lettura: vede il piano, non le note interne.</p>
          </div>
          <ul class="grid gap-5 md:grid-cols-3">
            <li v-for="(w, i) in WORKSPACES" :key="w.id" class="overflow-hidden rounded-2xl border-[1.5px] border-[var(--fw-carbone)] bg-white">
              <img :src="MEDIA[['forno-pane', 'forma-pilates', 'orto-verdure'][i]!]" alt="" class="h-52 w-full object-cover" loading="lazy">
              <div class="p-5"><p class="fw-title flex items-center gap-2 text-xl"><span class="size-2.5 rounded-full" :style="{ background: w.color }" />{{ w.short }}</p><p class="mt-1 text-sm">{{ w.accounts.length }} account · Instagram e Facebook</p></div>
            </li>
          </ul>
          <p class="inline-flex items-center gap-2.5 self-start rounded-[10px] border-[1.5px] border-[var(--fw-carbone)] bg-[var(--fw-carta)] px-4 py-3 text-[15px] font-semibold"><UIcon name="i-lucide-link" class="size-[18px]" aria-hidden="true" />Calendario cliente in sola lettura · con scadenza, password facoltativa e revoca</p>
        </div>
      </section>

      <!-- L07 -->
      <section id="domande" class="px-5 py-16 lg:px-20 lg:py-24" aria-labelledby="h-faq">
        <div class="mx-auto flex max-w-[1280px] flex-col gap-8 lg:flex-row lg:gap-20">
          <h2 id="h-faq" class="fw-title text-[28px] lg:w-[360px] lg:text-[40px]">Domande frequenti</h2>
          <div class="flex-1">
            <details v-for="([q, a], i) in faq" :key="q" class="group border-b border-[var(--border-strong)] py-5" :open="i === 0">
              <summary class="fw-title flex cursor-pointer list-none items-center gap-3 text-[19px]">
                <span class="flex-1">{{ q }}</span>
                <UIcon name="i-lucide-plus" class="size-5 group-open:hidden" aria-hidden="true" /><UIcon name="i-lucide-minus" class="hidden size-5 group-open:block" aria-hidden="true" />
              </summary>
              <p class="mt-2.5 text-[17px] leading-relaxed">{{ a }}</p>
            </details>
          </div>
        </div>
      </section>
    </main>

    <!-- L08 -->
    <footer class="bg-[var(--fw-carbone)] px-5 pb-10 pt-16 text-white lg:px-20 lg:pt-24">
      <div class="mx-auto flex max-w-[1280px] flex-col gap-16">
        <div class="flex flex-col items-center gap-7 text-center">
          <p class="fw-title max-w-[760px] text-[30px] leading-tight lg:text-[48px]">Dai una direzione al prossimo contenuto.</p>
          <NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary fw-btn--lg !border-white"><UIcon name="i-lucide-monitor-play" class="size-5" aria-hidden="true" />Esplora la demo</NuxtLink>
        </div>
        <div class="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-white/20 pt-6">
          <FwLogo variant="arancio" :width="150" />
          <a v-for="[h, l] in nav.slice(0, 2).concat([['#domande', 'Domande']])" :key="h" :href="h" class="text-sm hover:underline">{{ l }}</a>
          <NuxtLink to="/accedi" class="text-sm hover:underline">Accedi</NuxtLink>
          <span class="flex-1" />
          <span class="text-[13px] text-[#C9C5BD]">Note legali e privacy: da redigere prima del lancio</span>
        </div>
      </div>
    </footer>
  </div>
</template>
