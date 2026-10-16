<script setup lang="ts">
import { DateTime } from 'luxon'
import { AGENCY, INITIAL_PLAN, INITIAL_POSTS, MEDIA, SHARE_LINKS, ZONE, type Post } from '~/fixtures/scenario'
import { TYPE_ICON, TYPE_LABEL, capitalize, dt, hhmm, now, workspace } from '~/utils/format'

// Public read-only view: it uses the fixture directly, never the demo's private state.
const route = useRoute()
const link = computed(() => SHARE_LINKS[route.params.token as string])
const ws = computed(() => (link.value ? workspace(link.value.workspaceId) : null))
useHead({ title: () => (ws.value ? `Piano di ${ws.value.short}` : 'Link non valido'), meta: [{ name: 'robots', content: 'noindex' }] })

const password = ref('')
const unlocked = ref(false)
const wrong = ref(false)
function unlock() {
  wrong.value = password.value !== 'forma2026'
  unlocked.value = !wrong.value
}

// The client sees what the agency planned and published, never drafts or internal notes.
const posts = computed<Post[]>(() => (link.value && link.value.state !== 'empty'
  ? INITIAL_POSTS.filter(p => p.workspaceId === link.value!.workspaceId && p.status !== 'draft').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  : []))

// Months flow one after the other: from the current month to the last planned one (at least two).
const months = computed(() => {
  const first = now().startOf('month')
  const lastPost = posts.value.at(-1)
  const last = lastPost ? DateTime.max(dt(lastPost.scheduledAt).startOf('month'), first.plus({ months: 1 })) : first.plus({ months: 1 })
  const out: DateTime[] = []
  for (let m = first; m <= last; m = m.plus({ months: 1 })) out.push(m)
  return out
})
const cells = (m: DateTime) => {
  const start = m.startOf('week')
  const end = m.endOf('month').endOf('week')
  const out: DateTime[] = []
  for (let d = start; d <= end; d = d.plus({ days: 1 })) out.push(d)
  return out
}
const onDay = (d: DateTime) => posts.value.filter(p => dt(p.scheduledAt).hasSame(d, 'day'))
// Planned contents not prepared yet are shared too, as "in preparazione" (no internal notes).
const plan = computed(() => (link.value && link.value.state !== 'empty' ? INITIAL_PLAN.filter(p => p.workspaceId === link.value!.workspaceId && !p.postId) : []))
const planOn = (d: DateTime) => plan.value.filter(p => p.date === d.toISODate())
const isPast = (d: DateTime) => d < now().startOf('day')
// Print and PDF contain only what comes from today onwards.
function printCalendar() { window.print() }
const opened = ref<Post | null>(null)
const published = (p: Post) => p.status === 'done' && p.targets.some(t => t.state === 'confirmed')
</script>

<template>
  <div class="min-h-dvh bg-[var(--fw-carta)] text-[var(--fw-carbone)]">
    <header class="sticky top-0 z-10 border-b border-[var(--border)] bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-[1200px] items-center gap-4 px-4 py-3 sm:px-6">
        <FwLogo :width="120" />
        <span class="flex-1" />
        <template v-if="ws">
          <span class="flex items-center gap-2" :title="`Logo di ${ws.short} (segnaposto)`">
            <span class="grid size-9 place-items-center rounded-lg text-xs font-bold text-white" :style="{ background: ws.color }" aria-hidden="true">{{ ws.initials }}</span>
            <span class="text-sm font-semibold max-sm:hidden">{{ ws.short }}</span>
          </span>
          <span class="h-8 w-px bg-[var(--border)]" aria-hidden="true" />
        </template>
        <span class="flex items-center gap-2" :title="`Logo di ${AGENCY.name} (segnaposto)`">
          <span class="text-[11px] text-[var(--text-muted)] max-sm:hidden">gestito da</span>
          <span class="grid size-9 place-items-center rounded-full bg-[var(--fw-carbone)] text-[11px] font-bold text-white" aria-hidden="true">SA</span>
          <span class="text-sm font-semibold max-sm:sr-only">{{ AGENCY.name }}</span>
        </span>
      </div>
    </header>

    <main class="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div v-if="!link || link.state === 'revoked'" class="py-16 text-center" role="alert">
        <UIcon name="i-lucide-link-2-off" class="mx-auto size-8 text-[var(--text-muted)]" aria-hidden="true" />
        <h1 class="fw-title mt-3 text-2xl">Questo link non è più attivo</h1>
        <p class="mt-2 text-sm text-[var(--text-muted)]">L'agenzia lo ha revocato. Chiedi a chi te l'ha inviato un nuovo link.</p>
      </div>
      <div v-else-if="link.state === 'expired'" class="py-16 text-center" role="alert">
        <UIcon name="i-lucide-calendar-x" class="mx-auto size-8 text-[var(--text-muted)]" aria-hidden="true" />
        <h1 class="fw-title mt-3 text-2xl">Questo link è scaduto</h1>
        <p class="mt-2 text-sm text-[var(--text-muted)]">Era valido fino al {{ link.expires }}. Chiedi all'agenzia di prorogarlo o di inviarne uno nuovo.</p>
      </div>
      <form v-else-if="link.state === 'protected' && !unlocked" class="mx-auto flex max-w-sm flex-col gap-3 py-10" @submit.prevent="unlock">
        <h1 class="fw-title text-2xl">Calendario protetto</h1>
        <label class="text-sm font-semibold" for="pw">Password ricevuta dall'agenzia</label>
        <input id="pw" v-model="password" type="password" class="fw-input" autocomplete="off" :aria-invalid="wrong" aria-describedby="pw-hint">
        <p v-if="wrong" id="pw-hint" class="text-sm text-[var(--danger)]" role="alert">Password non corretta. Riprova o chiedi all'agenzia.</p>
        <p v-else id="pw-hint" class="text-xs text-[var(--text-muted)]">Demo: la password è forma2026.</p>
        <button type="submit" class="fw-btn fw-btn--primary">Apri il calendario</button>
      </form>
      <template v-else>
        <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 class="fw-title text-[28px] leading-tight">Piano dei contenuti · {{ ws?.short }}</h1>
          <button type="button" class="fw-btn print:hidden sm:order-last sm:ml-auto" @click="printCalendar"><UIcon name="i-lucide-printer" class="size-[18px]" aria-hidden="true" />Stampa o salva PDF</button>
          <p class="hidden basis-full text-sm font-semibold print:block">Pubblicazioni dal {{ now().setLocale('it').toFormat('d LLLL yyyy') }} in poi</p>
          <p class="text-[13px] text-[var(--text-muted)]">Aggiornato il {{ now().setLocale('it').toFormat("d LLLL yyyy 'alle' HH:mm") }} · orari in {{ ZONE }} · sola lettura</p>
        </div>
        <p v-if="!posts.length" class="mt-8 rounded-xl bg-white p-6 text-center text-sm">Non ci sono ancora contenuti programmati. Il piano apparirà qui.</p>

        <section v-for="m in months" :key="m.toISODate()!" class="month mt-8" :aria-labelledby="`m-${m.month}`">
          <h2 :id="`m-${m.month}`" class="fw-title mb-3 text-xl">{{ capitalize(m.setLocale('it').toFormat('LLLL yyyy')) }}</h2>
          <div class="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <div class="grid grid-cols-7 border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-muted)] sm:text-xs">
              <div v-for="d in ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']" :key="d" class="px-1.5 py-2 sm:px-2.5">{{ d }}</div>
            </div>
            <div class="grid grid-cols-7">
              <div v-for="d in cells(m)" :key="d.toISODate()!" class="day min-h-20 border-b border-r border-[var(--border)] p-1 sm:min-h-32 sm:p-1.5" :class="d.month !== m.month ? 'bg-[var(--fw-carta)]' : ''">
                <template v-if="d.month === m.month">
                  <span class="tabular grid size-6 place-items-center rounded-full text-xs font-semibold" :class="d.hasSame(now(), 'day') ? 'bg-[var(--fw-carbone)] text-white' : d < now().startOf('day') ? 'text-[var(--text-muted)]' : ''">{{ d.day }}</span>
                  <div :class="isPast(d) ? 'print:hidden' : ''">
                  <div class="mt-1 grid gap-1 sm:grid-cols-2">
                    <button v-for="p in onDay(d).slice(0, 4)" :key="p.id" type="button" class="group relative block overflow-hidden rounded-md" :class="onDay(d).indexOf(p) > 0 ? 'max-sm:hidden' : ''" :aria-label="`${hhmm(p.scheduledAt)}, ${TYPE_LABEL[p.type]}: apri l'anteprima`" @click="opened = p">
                      <img :src="MEDIA[p.media]" alt="" class="aspect-square w-full object-cover" loading="lazy">
                      <span class="tabular absolute inset-x-0 bottom-0 bg-[#242321cc] px-1 text-[10px] font-semibold text-white max-sm:hidden">{{ hhmm(p.scheduledAt) }}</span>
                    </button>
                  </div>
                  <span v-if="onDay(d).length > 1" class="mt-0.5 block text-[10px] font-bold sm:hidden">+{{ onDay(d).length - 1 }}</span>
                  <span v-if="onDay(d).length > 4" class="mt-0.5 block text-[11px] font-bold max-sm:hidden">+{{ onDay(d).length - 4 }} altri</span>
                  <div v-for="it in planOn(d)" :key="it.id" class="mt-1 rounded-md border border-dashed border-[var(--border-strong)] p-1 text-[10px] leading-tight sm:text-[11px]" :title="`In preparazione: ${TYPE_LABEL[it.type]} ${it.title}`">
                    <span class="flex items-center gap-1 font-semibold"><UIcon :name="TYPE_ICON[it.type]" class="size-3 shrink-0" aria-hidden="true" /><span class="truncate max-sm:sr-only">{{ it.title }}</span></span>
                    <span class="text-[var(--text-muted)] max-sm:hidden">In preparazione{{ it.time ? ` · ${it.time}` : '' }}</span>
                  </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </section>
      </template>
      <p class="mt-12 text-center text-xs text-[var(--text-muted)] print:mt-4">Prototipo Feedway con dati fittizi. Loghi di cliente e agenzia sono segnaposto.</p>
    </main>

    <UModal :open="!!opened" :title="opened ? `${capitalize(dt(opened.scheduledAt).toFormat('cccc d LLLL, HH:mm'))}` : ''" :description="opened ? TYPE_LABEL[opened.type] : ''" @update:open="v => { if (!v) opened = null }">
      <template #body>
        <div v-if="opened" class="flex flex-col gap-3 sm:flex-row">
          <img :src="MEDIA[opened.media]" alt="Anteprima del contenuto" class="aspect-[4/5] w-full rounded-xl object-cover sm:w-56">
          <div class="flex-1 text-sm">
            <p class="leading-relaxed">{{ opened.caption }}</p>
            <p class="mt-3 text-xs text-[var(--text-muted)]">{{ published(opened) ? 'Pubblicato' : 'Programmato' }} · Instagram e Facebook</p>
            <span v-if="published(opened)" class="fw-link mt-2 inline-block text-[13px]">Apri il post pubblicato</span>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style>
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: #fff !important; }
  header.sticky { position: static !important; }
  .month { break-inside: avoid; page-break-inside: avoid; margin-top: 4mm !important; }
  .month + .month { break-before: page; }
  .day { min-height: 16mm !important; padding: 1mm !important; }
  .day .grid { display: flex !important; flex-wrap: wrap; gap: 1mm; }
  .day .grid img { width: 11mm !important; height: 11mm !important; }
  .day .grid button span { display: block !important; position: static !important; background: none !important; color: #242321 !important; font-size: 8px !important; padding: 0 !important; }
  .day .grid button { display: block !important; }
  header.sticky > div { padding-top: 2mm !important; padding-bottom: 2mm !important; }
  main { padding-top: 4mm !important; }
  img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>
