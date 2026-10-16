<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { DateTime } from 'luxon'
import { MEDIA, ZONE, type PlanItem, type Post } from '~/fixtures/scenario'
import { TYPE_LABEL, capitalize, dt, hhmm, now, postStatus, profile, workspace } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Calendario · Feedway demo' })

const { state, can } = useDemo()
const narrow = useMediaQuery('(max-width: 1023px)')

type View = 'week' | 'month' | 'list'
// Month is the default "from afar" view; week is the detailed zoom on the same data.
const view = ref<View>('month')
const effectiveView = computed<View>(() => (narrow.value && view.value !== 'list' ? 'list' : view.value))
const libraryOpen = ref(false)
const libraryMedia = computed(() => {
  const prefix: Record<string, string> = { 'forno-luce': 'forno', 'studio-forma': 'forma', 'orto-vivo': 'orto' }
  const p = prefix[state.value.client]
  return Object.keys(MEDIA).filter(k => !p || k.startsWith(p))
})
const profileAccounts = computed(() => {
  const p = state.value.profile ? profile(state.value.profile) : null
  return p ? [p.ig?.id, p.fb?.id].filter(Boolean) as string[] : null
})
const weekStart = ref(now().startOf('week'))
const monthStart = ref(now().startOf('month'))
const focusDay = ref<string | null>(null)

const statusFilter = ref<'all' | 'draft' | 'scheduled' | 'problem' | 'unknown' | 'confirmed'>('all')
const typeFilter = ref<'all' | Post['type']>('all')
const filtersOpen = ref(false)
const activeFilters = computed(() => [statusFilter.value !== 'all', typeFilter.value !== 'all'].filter(Boolean).length)
const STATUS_OPTS = [
  ['all', 'Tutti gli stati'], ['draft', 'Bozze'], ['scheduled', 'Programmati'], ['problem', 'Con problema'], ['unknown', 'Da accertare'], ['confirmed', 'Confermati'],
] as const

function matches(p: Post) {
  if (state.value.client !== 'all' && p.workspaceId !== state.value.client) return false
  if (profileAccounts.value && !p.targets.some(t => profileAccounts.value!.includes(t.accountId))) return false
  if (typeFilter.value !== 'all' && p.type !== typeFilter.value) return false
  const s = statusFilter.value
  if (s === 'all') return true
  if (s === 'draft') return p.status === 'draft'
  if (s === 'scheduled') return p.status === 'scheduled'
  if (s === 'problem') return p.targets.some(t => t.state === 'failed')
  if (s === 'unknown') return p.targets.some(t => t.state === 'unknown')
  return p.status === 'done' && p.targets.every(t => t.state === 'confirmed')
}
const visible = computed(() => (state.value.calendarShow === 'plan' ? [] : state.value.posts).filter(matches).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)))
const byDay = (d: DateTime) => visible.value.filter(p => dt(p.scheduledAt).hasSame(d, 'day'))

const days = computed(() => Array.from({ length: 7 }, (_, i) => weekStart.value.plus({ days: i })))
const monthCells = computed(() => {
  const first = monthStart.value.startOf('week')
  return Array.from({ length: 42 }, (_, i) => first.plus({ days: i })).filter((d, i) => i < 35 || d.month === monthStart.value.month)
})
const rangeLabel = computed(() => {
  if (effectiveView.value === 'month') return capitalize(monthStart.value.setLocale('it').toFormat('LLLL yyyy'))
  const a = weekStart.value.setLocale('it'), b = a.plus({ days: 6 })
  return `${a.toFormat('d')} – ${b.toFormat('d LLLL yyyy')}`
})
const listDays = computed(() => {
  if (focusDay.value) return [DateTime.fromISO(focusDay.value, { zone: ZONE })]
  return effectiveView.value === 'list' && view.value !== 'month' ? days.value : []
})

function shift(n: number) {
  focusDay.value = null
  if (effectiveView.value === 'month') monthStart.value = monthStart.value.plus({ months: n })
  else weekStart.value = weekStart.value.plus({ weeks: n })
}
function goToday() { focusDay.value = null; weekStart.value = now().startOf('week'); monthStart.value = now().startOf('month') }
function openDay(d: DateTime) { focusDay.value = d.toISODate(); view.value = 'list' }
function resetFilters() { statusFilter.value = 'all'; typeFilter.value = 'all'; state.value.client = 'all' }
const isToday = (d: DateTime) => d.hasSame(now(), 'day')
const newPostLink = (d: DateTime) => `/demo/post/nuovo?data=${d.toISODate()}`
const clientLabel = computed(() => {
  if (state.value.client === 'all') return 'Tutti i clienti · visione d’insieme'
  const p = state.value.profile ? profile(state.value.profile) : null
  return p ? `${workspace(state.value.client).short} · profilo ${p.name}` : workspace(state.value.client).name
})
const unfilteredInRange = computed(() => (effectiveView.value === 'month' ? monthCells.value : days.value).reduce((n, d) => n + state.value.posts.filter(p => dt(p.scheduledAt).hasSame(d, 'day')).length, 0))
// Editorial plan items not yet prepared show as translucent cards next to the real posts.
const visiblePlan = computed(() => (state.value.calendarShow !== 'posts'
  ? state.value.plan.filter(p => !p.postId && (state.value.client === 'all' || p.workspaceId === state.value.client) && (typeFilter.value === 'all' || p.type === typeFilter.value))
  : []))
const planByDay = (d: DateTime) => visiblePlan.value.filter(p => p.date === d.toISODate()).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'))
const planInRange = computed(() => (effectiveView.value === 'month' ? monthCells.value : days.value).reduce((n, d) => n + planByDay(d).length, 0))
const planOpen = ref(false)
const planItem = ref<PlanItem | null>(null)
const planDate = ref(now().toISODate()!)
function openPlan(item: PlanItem | null, d?: DateTime) {
  planItem.value = item
  planDate.value = (d ?? now()).toISODate()!
  planOpen.value = true
}
const totalInRange = computed(() => (effectiveView.value === 'month' ? monthCells.value : days.value).reduce((n, d) => n + byDay(d).length, 0))
</script>

<template>
  <div class="flex min-h-full flex-col gap-4 px-4 pt-5 lg:px-7 lg:pt-6">
    <header class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <h1 class="fw-title text-[26px] leading-tight">Calendario</h1>
        <p class="text-[13px] text-[var(--text-muted)]">{{ clientLabel }} · {{ ZONE }}</p>
        <p class="text-xs text-[var(--text-muted)] max-lg:hidden">Mese per la panoramica, Settimana per il dettaglio con miniature grandi.</p>
      </div>
      <button type="button" class="fw-btn max-lg:hidden" :aria-expanded="libraryOpen" aria-controls="libreria" @click="libraryOpen = !libraryOpen"><UIcon name="i-lucide-images" class="size-[18px]" aria-hidden="true" />Libreria</button>
      <NuxtLink v-if="can.create" to="/demo/post/nuovo" class="fw-btn fw-btn--primary max-lg:hidden"><UIcon name="i-lucide-plus" class="size-[18px]" aria-hidden="true" />Nuovo post</NuxtLink>
    </header>

    <div v-if="!can.seeClients" class="fw-card grid place-items-center gap-2 px-6 py-14 text-center" role="status">
      <UIcon name="i-lucide-user-round" class="size-8 text-[var(--text-muted)]" aria-hidden="true" />
      <p class="fw-title text-lg">Non lavori ancora su nessun cliente</p>
      <p class="max-w-md text-sm text-[var(--text-muted)]">Come Member vedi i clienti solo quando un Manager o un Admin ti assegna un ruolo. Con la versione 1.5 qui trovi le tue attività, il to-do e le note personali.</p>
    </div>
    <template v-else>

    <div class="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 lg:gap-3">
      <div class="flex items-center gap-1">
        <button type="button" class="fw-btn !min-h-9 !p-2" aria-label="Periodo precedente" @click="shift(-1)"><UIcon name="i-lucide-chevron-left" class="size-[18px]" /></button>
        <button type="button" class="fw-btn !min-h-9 !p-2" aria-label="Periodo successivo" @click="shift(1)"><UIcon name="i-lucide-chevron-right" class="size-[18px]" /></button>
        <h2 class="tabular ml-1 text-[15px] font-semibold" aria-live="polite">{{ focusDay ? capitalize(dt(focusDay + 'T12:00:00').toFormat('cccc d LLLL')) : rangeLabel }}</h2>
      </div>
      <button type="button" class="fw-btn !min-h-9 !px-3 !text-[13px]" @click="goToday">Oggi</button>
      <span class="flex-1" />
      <div role="radiogroup" aria-label="Vista" class="flex gap-0.5 rounded-[9px] bg-[var(--surface-sunken)] p-[3px]">
        <button
          v-for="[v, l] in ([['month', 'Mese'], ['week', 'Settimana'], ['list', 'Elenco']] as const)" :key="v" type="button" role="radio"
          :aria-checked="effectiveView === v"
          class="rounded-[7px] border px-3 py-1.5 text-[13px]"
          :class="effectiveView === v ? 'border-[var(--border)] bg-[var(--surface)] font-bold' : 'border-transparent text-[var(--text-muted)]'"
          @click="view = v; focusDay = null"
        >{{ l }}</button>
      </div>
      <div role="radiogroup" aria-label="Contenuti da mostrare" class="flex gap-0.5 rounded-[9px] bg-[var(--surface-sunken)] p-[3px]">
        <button
          v-for="[v, l] in ([['all', 'Tutto'], ['posts', 'Solo post'], ['plan', 'Solo piano']] as const)" :key="v" type="button" role="radio"
          :aria-checked="state.calendarShow === v"
          class="rounded-[7px] border px-3 py-1.5 text-[13px]"
          :class="state.calendarShow === v ? 'border-[var(--border)] bg-[var(--surface)] font-bold' : 'border-transparent text-[var(--text-muted)]'"
          @click="state.calendarShow = v"
        >{{ l }}</button>
      </div>
      <button type="button" class="fw-btn !min-h-9 !px-3 !text-[13px]" :aria-expanded="filtersOpen" aria-controls="filtri" @click="filtersOpen = !filtersOpen">
        <UIcon name="i-lucide-sliders-horizontal" class="size-4" aria-hidden="true" />Filtri<span v-if="activeFilters"> · {{ activeFilters }} attivi</span>
      </button>
    </div>

    <section v-if="filtersOpen" id="filtri" aria-label="Filtri" class="fw-card flex flex-wrap items-end gap-4 p-4">
      <label class="text-[13px] font-semibold">Stato
        <select v-model="statusFilter" class="fw-input mt-1 !min-h-10 w-52">
          <option v-for="[v, l] in STATUS_OPTS" :key="v" :value="v">{{ l }}</option>
        </select>
      </label>
      <label class="text-[13px] font-semibold">Tipo
        <select v-model="typeFilter" class="fw-input mt-1 !min-h-10 w-44">
          <option value="all">Tutti i tipi</option>
          <option v-for="(l, v) in TYPE_LABEL" :key="v" :value="v">{{ l }}</option>
        </select>
      </label>
      <button type="button" class="fw-link text-[13px]" @click="resetFilters">Azzera filtri e cliente</button>
    </section>

    <div class="flex min-h-0 flex-1 gap-4">
    <div class="flex min-w-0 flex-1 flex-col">
    <div v-if="totalInRange === 0 && planInRange === 0 && unfilteredInRange > 0" class="fw-card grid place-items-center gap-2 px-6 py-14 text-center" role="status">
      <UIcon name="i-lucide-filter-x" class="size-8 text-[var(--text-muted)]" aria-hidden="true" />
      <p class="fw-title text-lg">Nessun post corrisponde ai filtri</p>
      <p class="max-w-md text-sm text-[var(--text-muted)]">Nel periodo ci sono contenuti, ma nessuno con questi filtri. Il calendario non è vuoto.</p>
      <button type="button" class="fw-btn mt-2" @click="resetFilters">Azzera filtri</button>
    </div>

    <div v-else-if="totalInRange === 0 && planInRange === 0 && !focusDay" class="fw-card grid place-items-center gap-2 px-6 py-14 text-center" role="status">
      <UIcon name="i-lucide-calendar-plus" class="size-8 text-[var(--text-muted)]" aria-hidden="true" />
      <p class="fw-title text-lg">Nessun post in questo periodo</p>
      <NuxtLink v-if="can.create" to="/demo/post/nuovo" class="fw-btn fw-btn--primary mt-2"><UIcon name="i-lucide-plus" class="size-[18px]" aria-hidden="true" />Nuovo post</NuxtLink>
    </div>

    <!-- Week -->
    <div v-else-if="effectiveView === 'week' && !focusDay" class="grid flex-1 grid-cols-7 gap-3 pb-6">
      <section v-for="d in days" :key="d.toISODate()!" class="flex min-w-0 flex-col gap-2.5" :aria-label="capitalize(d.setLocale('it').toFormat('cccc d LLLL'))">
        <div class="flex items-center gap-1.5 rounded-lg px-2 py-1.5" :class="isToday(d) ? 'bg-[var(--fw-carbone)] text-white' : ''">
          <span class="text-[13px]" :class="isToday(d) ? '' : 'text-[var(--text-muted)]'">{{ capitalize(d.setLocale('it').toFormat('ccc')) }}</span>
          <span class="tabular text-[15px] font-bold">{{ d.day }}</span>
          <span v-if="isToday(d)" class="ml-auto text-xs font-semibold text-[var(--fw-arancio)]">Oggi</span>
        </div>
        <PostCard v-for="p in byDay(d).slice(0, 3)" :key="p.id" :post="p" :show-client="state.client === 'all'" />
        <button v-if="byDay(d).length > 3" type="button" class="fw-card px-2.5 py-2 text-left text-xs font-semibold underline underline-offset-2" @click="openDay(d)">Altri {{ byDay(d).length - 3 }} · apri il giorno</button>
        <PlanCard v-for="it in planByDay(d)" :key="it.id" :item="it" :show-client="state.client === 'all'" @open="openPlan($event)" />
        <NuxtLink v-if="d >= now().startOf('day') && can.create" :to="newPostLink(d)" class="grid min-h-12 place-items-center rounded-xl border border-dashed border-[var(--border-strong)] text-xs text-[var(--text-muted)] hover:bg-[var(--surface)]" :aria-label="`Nuovo post ${d.setLocale('it').toFormat('cccc d')}`">
          <span class="inline-flex items-center gap-1"><UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" />Nuovo post</span>
        </NuxtLink>
      </section>
    </div>

    <!-- Month -->
    <div v-else-if="effectiveView === 'month'" class="fw-card mb-6 overflow-hidden">
      <div class="grid grid-cols-7 border-b border-[var(--border)]">
        <div v-for="w in ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']" :key="w" class="px-2.5 py-2 text-xs font-semibold text-[var(--text-muted)]">{{ w }}</div>
      </div>
      <div class="grid grid-cols-7">
        <div v-for="d in monthCells" :key="d.toISODate()!" class="flex min-h-28 flex-col gap-1 border-b border-r border-[var(--border)] p-1.5" :class="d.month !== monthStart.month ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)]' : ''">
          <div class="flex items-center justify-between">
            <span class="tabular grid size-6 place-items-center rounded-full text-xs font-semibold" :class="isToday(d) ? 'bg-[var(--fw-carbone)] text-white' : ''">{{ d.day }}</span>
            <NuxtLink v-if="can.create && d >= now().startOf('day') && d.month === monthStart.month" :to="newPostLink(d)" class="grid size-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--text)]" :aria-label="`Nuovo post ${d.setLocale('it').toFormat('cccc d LLLL')}`" :title="`Nuovo post il ${d.day}`"><UIcon name="i-lucide-plus" class="size-4" aria-hidden="true" /></NuxtLink>
          </div>
          <NuxtLink v-for="p in byDay(d).slice(0, 3)" :key="p.id" :to="`/demo/post/${p.id}`" class="flex items-center gap-1.5 rounded-md bg-[var(--surface-sunken)] p-1" :aria-label="`${hhmm(p.scheduledAt)} ${workspace(p.workspaceId).short}: ${postStatus(p).label}`">
            <img :src="MEDIA[p.media]" alt="" class="size-6 rounded object-cover" loading="lazy">
            <span class="tabular text-[11px] font-bold">{{ hhmm(p.scheduledAt) }}</span>
            <span class="size-[7px] rounded-full" :style="{ background: workspace(p.workspaceId).color }" />
            <StatusBadge :status="{ ...postStatus(p), label: '' }" plain class="ml-auto" />
          </NuxtLink>
          <button v-if="byDay(d).length > 3" type="button" class="px-1 text-left text-[11px] font-bold underline" @click="openDay(d)">Altri {{ byDay(d).length - 3 }} · apri il giorno</button>
          <PlanCard v-for="it in planByDay(d).slice(0, 2)" :key="it.id" :item="it" compact :show-client="state.client === 'all'" @open="openPlan($event)" />
        </div>
      </div>
    </div>

    <!-- List -->
    <div v-else class="flex flex-col gap-2 pb-6">
      <button v-if="focusDay" type="button" class="fw-link self-start text-[13px]" @click="focusDay = null; view = 'week'">← Torna alla settimana</button>
      <template v-for="d in listDays" :key="d.toISODate()!">
        <h3 class="pt-2 text-[13px] font-bold uppercase text-[var(--text-muted)]">{{ isToday(d) ? 'Oggi · ' : '' }}{{ d.setLocale('it').toFormat('cccc d LLLL') }}</h3>
        <p v-if="!byDay(d).length && !planByDay(d).length" class="text-sm text-[var(--text-muted)]">Nessun post.</p>
        <PlanCard v-for="it in planByDay(d)" :key="it.id" :item="it" :show-client="state.client === 'all'" @open="openPlan($event)" />
        <NuxtLink v-for="p in byDay(d)" :key="p.id" :to="`/demo/post/${p.id}`" class="fw-card flex items-center gap-3 p-2.5">
          <img :src="MEDIA[p.media]" alt="" class="h-[90px] w-[72px] rounded-lg object-cover" loading="lazy">
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5"><span class="tabular text-[15px] font-bold">{{ hhmm(p.scheduledAt) }}</span><span class="text-[13px] text-[var(--text-muted)]">· {{ TYPE_LABEL[p.type] }}</span></span>
            <span class="flex items-center gap-1.5 text-[13px] font-semibold"><span class="size-2 rounded-full" :style="{ background: workspace(p.workspaceId).color }" />{{ workspace(p.workspaceId).short }}</span>
            <span class="block truncate text-[13px] text-[var(--text-muted)]">{{ p.caption }}</span>
            <StatusBadge :status="postStatus(p)" plain />
          </span>
        </NuxtLink>
      </template>
    </div>
    </div>
    <aside v-if="libraryOpen" id="libreria" aria-label="Libreria" class="fw-card mb-6 flex w-[300px] shrink-0 flex-col gap-3 self-start p-4 max-lg:hidden">
      <div class="flex items-center"><h2 class="fw-title flex-1 text-[17px]">Libreria</h2><button type="button" class="fw-btn fw-btn--ghost !min-h-9 !p-2" aria-label="Chiudi la libreria" @click="libraryOpen = false"><UIcon name="i-lucide-x" class="size-[18px]" /></button></div>
      <p class="text-xs text-[var(--text-muted)]">{{ state.client === 'all' ? 'File di tutti i clienti' : workspace(state.client).short }} · scegli un file e crea il post da qui</p>
      <div class="grid grid-cols-2 gap-2.5">
        <NuxtLink v-for="k in libraryMedia" :key="k" :to="can.create ? '/demo/post/nuovo' : undefined" class="block" :aria-label="`Nuovo post con ${k}`">
          <img :src="MEDIA[k]" alt="" class="aspect-[4/5] w-full rounded-lg object-cover" loading="lazy">
          <span class="mt-1 block truncate text-xs font-semibold">{{ k }}.jpg</span>
        </NuxtLink>
      </div>
    </aside>
    </div>
    </template>
    <PlanDialog v-model:open="planOpen" :item="planItem" :default-date="planDate" />
  </div>
</template>
