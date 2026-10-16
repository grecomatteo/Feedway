<script setup lang="ts">
import { DateTime } from 'luxon'
import { AGENCY, WORKSPACES, ZONE, type PlanItem } from '~/fixtures/scenario'
import { TYPE_ICON, TYPE_LABEL, capitalize, dt, hhmm, now, workspace } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Piano editoriale · Feedway demo' })

// The editorial plan is separate from scheduling: an empty month to fill, one client at a time.
const { state, can } = useDemo()
const planClient = ref<string | null>(state.value.client !== 'all' ? state.value.client : null)
const askClient = ref(!planClient.value)
watch(() => state.value.client, (c) => { if (c !== 'all') planClient.value = c })
function chooseClient(id: string) { planClient.value = id; askClient.value = false }

const month = ref(now().startOf('month'))
const cells = computed(() => {
  const out: DateTime[] = []
  for (let d = month.value.startOf('week'); d <= month.value.endOf('month').endOf('week'); d = d.plus({ days: 1 })) out.push(d)
  return out
})
const items = computed(() => state.value.plan.filter(p => p.workspaceId === planClient.value))
const onDay = (d: DateTime) => items.value.filter(p => p.date === d.toISODate()).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))
const inMonth = computed(() => items.value.filter(p => p.date.startsWith(month.value.toFormat('yyyy-MM'))))
const postOf = (it: PlanItem) => state.value.posts.find(p => p.id === it.postId)
const isPast = (d: DateTime) => d < now().startOf('day')

const dialogOpen = ref(false)
const dialogItem = ref<PlanItem | null>(null)
const dialogDate = ref(now().toISODate()!)
function addOn(d: DateTime) {
  if (!can.value.plan || isPast(d)) return
  dialogItem.value = null; dialogDate.value = d.toISODate()!; dialogOpen.value = true
}
function openItem(it: PlanItem) { dialogItem.value = it; dialogOpen.value = true }
function printPlan() { window.print() }
const ws = computed(() => (planClient.value ? workspace(planClient.value) : null))
</script>

<template>
  <div class="flex min-h-full flex-col gap-4 px-4 py-5 lg:px-7 lg:py-6">
    <header class="flex flex-wrap items-center gap-3 print:hidden">
      <div class="min-w-0 flex-1">
        <h1 class="fw-title text-[26px] leading-tight">Piano editoriale</h1>
        <p class="text-[13px] text-[var(--text-muted)]">Decidi cosa deve uscire e quando, prima che il contenuto esista. Chi carica lo ritrova nel calendario.</p>
      </div>
      <button v-if="ws" type="button" class="fw-btn" @click="askClient = true">
        <span class="size-2.5 rounded-full" :style="{ background: ws.color }" />{{ ws.short }}<span class="text-[var(--text-muted)]">· cambia</span>
      </button>
      <button v-if="ws" type="button" class="fw-btn" @click="printPlan"><UIcon name="i-lucide-printer" class="size-[18px]" aria-hidden="true" />Stampa o salva PDF</button>
    </header>

    <div v-if="!ws" class="fw-card grid place-items-center gap-2 px-6 py-14 text-center print:hidden" role="status">
      <UIcon name="i-lucide-calendar-range" class="size-8 text-[var(--text-muted)]" aria-hidden="true" />
      <p class="fw-title text-lg">Scegli il cliente del piano</p>
      <button type="button" class="fw-btn fw-btn--primary mt-2" @click="askClient = true">Scegli il cliente</button>
    </div>

    <template v-else>
      <!-- Print header: same logos as the client calendar -->
      <div class="hidden items-center gap-4 border-b border-[var(--border)] pb-3 print:flex">
        <FwLogo :width="110" />
        <span class="flex-1" />
        <span class="flex items-center gap-2"><span class="grid size-8 place-items-center rounded-lg text-[11px] font-bold text-white" :style="{ background: ws.color }">{{ ws.initials }}</span><span class="text-sm font-semibold">{{ ws.short }}</span></span>
        <span class="text-[11px] text-[var(--text-muted)]">gestito da</span>
        <span class="flex items-center gap-2"><span class="grid size-8 place-items-center rounded-full bg-[var(--fw-carbone)] text-[10px] font-bold text-white">SA</span><span class="text-sm font-semibold">{{ AGENCY.name }}</span></span>
      </div>
      <h2 class="fw-title hidden text-xl print:block">Piano editoriale · {{ ws.short }} · {{ capitalize(month.setLocale('it').toFormat('LLLL yyyy')) }}</h2>

      <div class="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" class="fw-btn !min-h-9 !p-2" aria-label="Mese precedente" @click="month = month.minus({ months: 1 })"><UIcon name="i-lucide-chevron-left" class="size-[18px]" /></button>
        <button type="button" class="fw-btn !min-h-9 !p-2" aria-label="Mese successivo" @click="month = month.plus({ months: 1 })"><UIcon name="i-lucide-chevron-right" class="size-[18px]" /></button>
        <h2 class="ml-1 text-[15px] font-semibold" aria-live="polite">{{ capitalize(month.setLocale('it').toFormat('LLLL yyyy')) }}</h2>
        <span class="flex-1" />
        <p class="text-[13px] text-[var(--text-muted)]">{{ inMonth.length }} contenuti nel piano · {{ inMonth.filter(i => i.postId).length }} già preparati</p>
      </div>
      <p v-if="can.plan" class="text-xs text-[var(--text-muted)] print:hidden">Clicca un giorno per aggiungere un contenuto. I giorni passati non si pianificano.</p>
      <p v-else class="rounded-lg bg-[var(--surface-sunken)] p-3 text-sm print:hidden">Puoi consultare il piano. Pianificare spetta a Manager e Publisher.</p>

      <div class="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div class="grid grid-cols-7 border-b border-[var(--border)] text-xs font-semibold text-[var(--text-muted)]">
          <div v-for="w in ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']" :key="w" class="px-2.5 py-2">{{ w }}</div>
        </div>
        <div class="grid grid-cols-7">
          <div v-for="d in cells" :key="d.toISODate()!" class="plan-day group relative flex min-h-28 flex-col gap-1 border-b border-r border-[var(--border)] p-1.5" :class="d.month !== month.month ? 'bg-[var(--surface-sunken)]' : isPast(d) ? 'bg-[var(--surface-sunken)]/50' : ''">
            <template v-if="d.month === month.month">
              <button
                v-if="can.plan && !isPast(d)" type="button"
                class="absolute inset-0 rounded-none hover:bg-[var(--brand-soft)]/40 focus-visible:bg-[var(--brand-soft)]/40 print:hidden"
                :aria-label="`Aggiungi al piano di ${d.setLocale('it').toFormat('cccc d LLLL')}`" @click="addOn(d)"
              />
              <span class="tabular relative grid size-6 place-items-center rounded-full text-xs font-semibold" :class="d.hasSame(now(), 'day') ? 'bg-[var(--fw-carbone)] text-white' : isPast(d) ? 'text-[var(--text-muted)]' : ''">{{ d.day }}</span>
              <button
                v-for="it in onDay(d)" :key="it.id" type="button"
                class="plan-item relative flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5 text-left shadow-[0_1px_0_var(--border)]"
                :style="{ borderLeft: `4px solid ${ws.color}` }"
                :aria-label="`${TYPE_LABEL[it.type]} «${it.title}»${it.time ? ` alle ${it.time}` : ''}${it.postId ? ', già preparato' : ''}`"
                @click="openItem(it)"
              >
                <span class="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)]">
                  <UIcon :name="TYPE_ICON[it.type]" class="size-3.5" aria-hidden="true" />{{ TYPE_LABEL[it.type] }}<span v-if="it.time" class="tabular ml-auto text-[var(--text)]">{{ it.time }}</span>
                </span>
                <span class="mt-0.5 line-clamp-2 text-[12px] font-bold leading-snug">{{ it.title }}</span>
                <span v-if="postOf(it)" class="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--success)] print:hidden"><UIcon name="i-lucide-circle-check" class="size-3" aria-hidden="true" />Preparato · {{ hhmm(postOf(it)!.scheduledAt) }}</span>
              </button>
              <span v-if="can.plan && !isPast(d) && !onDay(d).length" class="relative mt-auto hidden self-center text-[11px] text-[var(--text-muted)] group-hover:inline print:hidden" aria-hidden="true">+ Aggiungi</span>
            </template>
          </div>
        </div>
      </div>
      <p class="hidden text-[11px] text-[var(--text-muted)] print:block">Orari in {{ ZONE }}. Documento generato da Feedway il {{ now().setLocale('it').toFormat('d LLLL yyyy') }}.</p>
    </template>

    <UModal v-model:open="askClient" title="Per quale cliente fai il piano?" description="Il piano editoriale è sempre di un solo cliente.">
      <template #body>
        <ul class="flex flex-col gap-2">
          <li v-for="w in WORKSPACES" :key="w.id">
            <button type="button" class="fw-card flex w-full items-center gap-3 p-3 text-left hover:border-[var(--border-strong)]" @click="chooseClient(w.id)">
              <span class="grid size-8 place-items-center rounded-md text-xs font-bold text-white" :style="{ background: w.color }">{{ w.initials }}</span>
              <span class="flex-1"><span class="block font-semibold">{{ w.short }}</span><span class="text-xs text-[var(--text-muted)]">{{ state.plan.filter(p => p.workspaceId === w.id).length }} contenuti nel piano</span></span>
              <UIcon v-if="planClient === w.id" name="i-lucide-check" class="size-4" aria-label="selezionato" />
            </button>
          </li>
        </ul>
      </template>
    </UModal>
    <PlanDialog v-model:open="dialogOpen" :item="dialogItem" :default-date="dialogDate" :workspace="planClient ?? undefined" />
  </div>
</template>

<style>
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: #fff !important; }
  .plan-day { min-height: 22mm !important; }
  .plan-item { break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
</style>
