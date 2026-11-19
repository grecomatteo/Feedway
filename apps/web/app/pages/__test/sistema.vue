<script setup lang="ts">
/**
 * The system of the panel (D-81, screen `00-sistema`): every token and base component in every
 * variant, the ones of stage 7 (outcomes) included. Only for the automated tests and the fidelity
 * shots: the server answers 404 outside them (server/middleware/07.test-pages.ts). Fixed data.
 */
definePageMeta({ layout: false })
useHead({ title: 'Sistema' })

const ready = useHydrated()

const surfaces = [
  { token: 'bg', name: 'Pagina', value: '#FBFAF8' },
  { token: 'surface', name: 'Superficie', value: '#FFFFFF' },
  { token: 'surface-sunken', name: 'Incasso', value: '#F4F2EE' },
  { token: 'nav-bg', name: 'Barra', value: '#F6F4F0' },
  { token: 'border-strong', name: 'Bordo', value: '#D5D0C7' },
  { token: 'text-muted', name: 'Testo secondario', value: '#625E58' },
  { token: 'text', name: 'Carbone', value: '#242321' },
]
const marks = [
  { token: 'brand', name: 'Arancio', value: 'Una sola azione per schermata' },
  { token: 'info', name: 'Programmato', value: '#1F5AA6' },
  { token: 'success', name: 'Pubblicato', value: '#17693F' },
  { token: 'warning-dot', name: 'Da sistemare', value: '#D98A00' },
  { token: 'danger', name: 'Non uscito', value: '#B5174B' },
  { token: 'neutral-dot', name: 'Bozza', value: '#A39E95' },
]
const type = [
  { name: 'Titolo di pagina', spec: 'Sora 600 · 22/28', sample: 'Clienti', class: 'title' },
  {
    name: 'Titolo di sezione',
    spec: 'Sistema 600 · 14/20',
    sample: 'Da sistemare',
    class: 'font-semibold',
  },
  {
    name: 'Testo',
    spec: 'Sistema 400 · 14/20',
    sample: 'Il pane del lunedì è appena uscito dal forno.',
    class: '',
  },
  {
    name: 'Dettaglio',
    spec: 'Sistema 400 · 13/18',
    sample: 'Forno Luce · 2 post in programma su questa Pagina Facebook',
    class: 'text-detail text-(--app-text-muted)',
  },
  {
    name: 'Intestazione di colonna',
    spec: 'Sistema 500 · 12/16',
    sample: 'Prossimo post',
    class: 'text-caption font-medium text-(--app-text-muted)',
  },
]

const filter = ref<'all' | 'drafts' | 'scheduled'>('all')
const filters = [
  { value: 'all' as const, label: 'Tutti', count: 9 },
  { value: 'drafts' as const, label: 'Bozze', count: 2 },
  { value: 'scheduled' as const, label: 'Programmati', count: 3 },
]
const checked = ref(true)
const unchecked = ref(false)
const on = ref(true)
const off = ref(false)
const search = ref('')

const statuses = [
  { status: 'draft' as const, label: 'Bozza' },
  { status: 'scheduled' as const, label: 'Programmato' },
  { status: 'published' as const, label: 'Pubblicato' },
  { status: 'reconnect' as const, label: 'Da ricollegare' },
  { status: 'failed' as const, label: '1 non uscito' },
  { status: 'paused' as const, label: 'In pausa' },
]

const posts = [
  {
    text: 'Le brioche di Natale si prenotano da oggi',
    kind: 'Carosello · 3 file',
    when: formatShort('2026-11-20T07:00:00Z', { timeZone: 'Europe/Rome' }),
    status: 'scheduled' as const,
    label: 'Programmato',
  },
  {
    text: 'Focaccia: la ricetta della nonna',
    kind: 'Carosello · 2 file',
    when: 'Senza data',
    status: 'draft' as const,
    label: 'Bozza',
  },
]
const COLUMNS = 'minmax(0, 1fr) 150px 60px 140px 110px 30px'

const rules = [
  [
    'Un solo arancio per schermata.',
    'È l’azione che fa avanzare il lavoro: «Nuovo post» nel pannello, «Programma» nell’editor.',
  ],
  [
    'Nessun sottotitolo sotto i titoli.',
    'Una frase compare solo quando dice cosa fare, accanto al punto in cui serve.',
  ],
  ['Sora solo nei titoli di pagina.', 'Tutto il resto è il carattere di sistema, a 14 px.'],
  [
    'Una superficie per elenco.',
    'Righe con un filetto, nessuna scatola dentro una scatola, ombre solo su ciò che sta sopra.',
  ],
  ['Spunte, interruttori e voce attiva in carbone.', 'L’arancio non segna più le selezioni.'],
  ['Date e ore all’italiana.', '«ven 20 nov, 18:00», mai 11/20/2026 o 06:00 PM.'],
  ['Raggi 8 e 10.', 'Controlli a 8, superfici a 10, miniature a 6.'],
  [
    'Spazi 4 · 8 · 12 · 16 · 20 · 28 · 32.',
    'Margine di pagina 32 al computer e 16 al telefono; larghezza massima 1200.',
  ],
]

const toast = ref(true)
</script>

<template>
  <main
    id="main"
    class="mx-auto grid max-w-[1440px] grid-cols-12 gap-8 px-12 pt-10 pb-16 max-md:gap-6 max-md:px-4 max-md:pt-5"
    :data-ready="ready || undefined"
    data-system
  >
    <header class="col-span-12 flex items-center gap-4">
      <h1 class="sr-only">Sistema del pannello</h1>
      <BrandLogo size="bar" />
      <span class="flex-1" />
      <span class="text-(--app-text-muted) max-md:hidden"
        >Sistema del pannello · {{ formatDay('2026-11-19') }}</span
      >
    </header>

    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Colore: fondi e testo</h2>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
        <div v-for="s in surfaces" :key="s.token">
          <i
            data-swatch
            class="block h-12 rounded-control border border-(--app-border)"
            :style="{ background: `var(--app-${s.token})` }"
          />
          <b class="mt-1.5 block text-detail font-medium">{{ s.name }}</b>
          <span class="text-caption leading-5 text-(--app-text-muted)">{{ s.value }}</span>
        </div>
      </div>
    </section>
    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Colore: marchio e stati</h2>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
        <div v-for="s in marks" :key="s.token">
          <i
            data-swatch
            class="block h-12 rounded-control border border-(--app-border)"
            :style="{ background: `var(--app-${s.token})` }"
          />
          <b class="mt-1.5 block text-detail font-medium">{{ s.name }}</b>
          <span class="text-caption leading-5 text-(--app-text-muted)">{{ s.value }}</span>
        </div>
      </div>
    </section>

    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Caratteri</h2>
      <div class="grid grid-cols-[150px_1fr] items-baseline gap-x-4 gap-y-3">
        <template v-for="t in type" :key="t.name">
          <span class="text-caption leading-5 text-(--app-text-muted)"
            >{{ t.name }}<br />{{ t.spec }}</span
          >
          <div :class="t.class === 'title' ? 'font-display text-title font-semibold' : t.class">
            {{ t.sample }}
          </div>
        </template>
        <span class="text-caption leading-5 text-(--app-text-muted)"
          >Numeri e orari<br />cifre allineate</span
        >
        <div class="tabular-nums">
          {{ formatTime('09:30') }} &nbsp; {{ formatTime('12:00') }} &nbsp;
          {{ formatTime('18:00') }} &nbsp; 85 / 2.200
        </div>
      </div>
    </section>
    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">
        Pulsanti e campi · 36 px al computer, 44 px al telefono
      </h2>
      <div class="mb-3.5 flex flex-wrap items-center gap-2.5">
        <UButton icon="i-lucide-calendar-check" data-sample="primary">
          Programma su 2 account
        </UButton>
        <UButton icon="i-lucide-plus" color="neutral" variant="outline" data-sample="outline">
          Nuovo cliente
        </UButton>
        <UButton color="neutral" variant="ghost" data-sample="ghost">Annulla</UButton>
        <UButton color="error" variant="ghost" data-sample="danger">
          Annulla programmazione
        </UButton>
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="outline"
          aria-label="Altro"
          data-sample="icon"
        />
      </div>
      <div class="mb-3.5 flex flex-wrap items-center gap-2.5">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Cerca un cliente o un profilo"
          aria-label="Cerca"
          class="w-[280px] max-md:w-full"
          data-sample="field"
        />
        <UInput
          :model-value="formatDay('2026-11-20')"
          icon="i-lucide-calendar"
          aria-label="Giorno"
          readonly
          class="w-[200px]"
        />
        <UInput
          :model-value="formatTime('18:00')"
          icon="i-lucide-clock"
          aria-label="Ora"
          readonly
          class="w-[104px]"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2.5">
        <SegmentedFilter v-model="filter" label="Filtro dei post" :options="filters" />
        <UCheckbox v-model="checked" aria-label="Spunta accesa" />
        <UCheckbox v-model="unchecked" aria-label="Spunta spenta" />
        <USwitch v-model="on" aria-label="Interruttore acceso" />
        <USwitch v-model="off" aria-label="Interruttore spento" />
        <span
          class="inline-flex h-6 items-center gap-1.5 rounded-thumb border border-(--app-border-strong) bg-(--app-surface) px-2 text-detail"
        >
          <i data-swatch class="size-2 rounded-[2px] bg-(--app-warning-dot)" />Prodotto
        </span>
      </div>
    </section>

    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Stati: un pallino e una parola</h2>
      <div class="flex flex-wrap items-center gap-6 max-md:gap-4">
        <StatusDot v-for="s in statuses" :key="s.status" :status="s.status" :label="s.label" />
      </div>
      <p class="mt-3 max-w-[60ch] text-detail text-(--app-text-muted)">
        Il colore pieno va solo dove c’è da agire. Quando è tutto a posto la colonna resta vuota.
      </p>
    </section>
    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">
        Identità: i clienti sono quadrati, le persone sono tonde
      </h2>
      <div class="flex flex-wrap items-center gap-5">
        <span class="inline-flex items-center gap-2.5">
          <Avatar name="Forno Luce" /><b class="font-semibold">Forno Luce</b>
        </span>
        <span class="inline-flex items-center gap-2.5">
          <Avatar name="Giulia Ferri" kind="person" /><b class="font-semibold">Giulia Ferri</b>
        </span>
        <span class="inline-flex items-center gap-2.5">
          <Avatar name="Studio Riva" kind="agency" /><b class="font-semibold">Studio Riva</b>
        </span>
        <PlatformIcons :platforms="['instagram']" label="@fornoluce" />
        <PlatformIcons :platforms="['facebook']" label="Forno Luce" />
      </div>
      <p class="mt-3 max-w-[60ch] text-detail text-(--app-text-muted)">
        Niente più cerchi color pastello: grigio caldo con le iniziali, oppure il logo vero del
        cliente.
      </p>
    </section>

    <section class="col-span-12">
      <SectionHead title="Riga di elenco · 52 px al computer, 60 px al telefono" :count="2">
        <NuxtLink
          to="#"
          class="font-medium underline decoration-(--app-border-strong) underline-offset-3"
        >
          Vedi tutti
        </NuxtLink>
      </SectionHead>
      <ListSurface
        :columns="COLUMNS"
        :head="['Post', 'Quando', 'Profili', 'Stato', 'Autore', { label: 'Azioni', hidden: true }]"
        label="Post"
      >
        <ListRow v-for="p in posts" :key="p.text" class="max-md:grid-cols-[minmax(0,1fr)_auto]">
          <span class="flex min-w-0 items-center gap-3" role="cell">
            <span
              class="grid size-10 shrink-0 place-items-center rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline-1 -outline-offset-1 outline-(--app-img-outline)"
            >
              <UIcon name="i-lucide-image" class="size-4" />
            </span>
            <span class="grid min-w-0">
              <span class="truncate font-medium">{{ p.text }}</span>
              <span class="truncate text-detail text-(--app-text-muted)">
                <span class="max-md:hidden">{{ p.kind }}</span>
                <span class="md:hidden">{{ p.when }}</span>
              </span>
            </span>
          </span>
          <span role="cell" class="max-md:hidden">{{ p.when }}</span>
          <span role="cell" class="max-md:hidden">
            <PlatformIcons :platforms="['instagram', 'facebook']" />
          </span>
          <span role="cell"><StatusDot :status="p.status" :label="p.label" /></span>
          <span role="cell" class="text-(--app-text-muted) max-md:hidden">Tu</span>
          <span role="cell" class="max-md:hidden">
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Altro: ${p.text}`"
            />
          </span>
        </ListRow>
      </ListSurface>
    </section>

    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Riga di impostazione</h2>
      <div class="rounded-card border border-(--app-border) bg-(--app-surface)">
        <SettingsRow label="Nome">Giulia Ferri</SettingsRow>
        <SettingsRow label="Email">
          <span class="text-(--app-text-muted)">giulia@studioriva.example</span>
          <UButton color="neutral" variant="outline" size="sm">Cambia</UButton>
        </SettingsRow>
        <SettingsRow label="Avvisi via email" inline>
          <USwitch v-model="on" aria-label="Avvisi via email" />
        </SettingsRow>
      </div>
    </section>
    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Barra sopra l’elenco</h2>
      <Toolbar>
        <SegmentedFilter v-model="filter" label="Filtro" :options="filters" />
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Cerca"
          aria-label="Cerca nei post"
          class="w-[180px] max-md:w-full"
        />
        <span class="flex-1 max-md:hidden" />
        <UButton icon="i-lucide-plus" color="neutral" variant="outline">Nuovo cliente</UButton>
      </Toolbar>
    </section>

    <section class="col-span-6 max-md:col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Conferma in basso</h2>
      <Toast
        v-model:open="toast"
        message="Programmato per ven 20 nov alle 8:00"
        link-label="Apri"
        to="#"
        :duration="0"
        inline
      />
    </section>

    <section class="col-span-12">
      <h2 class="mb-3 border-b border-(--app-border) pb-2">Regole</h2>
      <div class="grid grid-cols-2 gap-x-8 gap-y-2.5 max-md:grid-cols-1">
        <p
          v-for="[title, text] in rules"
          :key="title"
          class="relative pl-3.5 before:absolute before:top-2 before:left-0 before:size-[5px] before:rounded-full before:bg-(--app-text)"
        >
          <b>{{ title }}</b> {{ text }}
        </p>
      </div>
    </section>
  </main>
</template>
