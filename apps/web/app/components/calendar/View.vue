<script setup lang="ts">
import type { LocalDate, QuickFilter } from '@app/domain'
import type { FilterOption } from '~/components/calendar/Filters.vue'
import type { CalendarPostRow } from '~/composables/useCalendar'
import type { WorkspaceView } from '~/composables/useOrganization'
import { periodLabel, postsByDay, type CalendarCardInfo, type PeriodView } from '~/utils/calendar'

/**
 * The calendar (spec §11.4, screen 07, plan 09 Task 3), for «Tutti i clienti» or one client: the
 * bar with the arrows, the period, «Oggi» and the views; under it the quick filters and «Filtri»;
 * then the month or the week. Everything it shows is in the address (useCalendar). A click on a
 * post opens it as the list does: the editor, or the page of its outcome once it is on its way.
 */
const props = defineProps<{
  /** the client of the context; null: «Tutti i clienti» */
  workspace: WorkspaceView | null
  /** the accounts of the profile of the context (§14.6); null: the whole client */
  profileAccountIds: string[] | null
  /** the client's profiles, for the filter of the accounts */
  profiles: WorkspaceProfile[]
  /** the context is known: the clients are read, and the profile asked for */
  ready: boolean
}>()

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { data: workspaces } = useWorkspaces()

const cal = useCalendar({
  workspaceId: computed(() => props.workspace?.id ?? null),
  accountIds: computed(() => props.profileAccountIds),
  ready: computed(() => props.ready),
})
const { view, date, period, today, filters, status, data } = cal

// ---- the bar
const label = computed(() => periodLabel(view.value, date.value))
const isToday = computed(() => period.value.days.includes(today.value))
const views = computed(() => [
  { value: 'month' as const, label: t('calendar.view.month') },
  { value: 'week' as const, label: t('calendar.view.week') },
])
const chosenView = computed({
  get: () => view.value,
  set: (v: PeriodView) => void cal.setView(v),
})

// the quick filters of the posts (plan 09 Task 2); «Da preparare» is the plan's (Task 7)
type Quick = 'all' | Extract<QuickFilter, 'to_publish' | 'published' | 'with_problem'>
const quickOptions = computed(() => [
  { value: 'all' as const, label: t('calendar.quick.all') },
  { value: 'to_publish' as const, label: t('calendar.quick.to_publish') },
  { value: 'published' as const, label: t('calendar.quick.published') },
  { value: 'with_problem' as const, label: t('calendar.quick.with_problem') },
])
const quick = computed<Quick>({
  get: () => {
    const q = filters.value.quick
    return q === 'to_publish' || q === 'published' || q === 'with_problem' ? q : 'all'
  },
  set: (q) => void cal.setFilters({ quick: q === 'all' ? null : q }),
})

// ---- the options of «Filtri»
const clientOptions = computed<FilterOption[]>(() =>
  props.workspace
    ? []
    : (workspaces.value?.items ?? [])
        .filter((w) => w.archivedAt === null)
        .map((w) => ({ id: w.id, label: w.name })),
)
const PLATFORM_ICON = { instagram: 'i-lucide-instagram', facebook: 'i-lucide-facebook' } as const
const accountOptions = computed<FilterOption[]>(() => {
  if (!props.workspace || props.profileAccountIds) return []
  return props.profiles.flatMap((p) =>
    instagramFirst([p])
      .flatMap((x) => x.accounts)
      .map((a) => ({
        id: a.id,
        label: a.platform === 'instagram' && a.username ? `@${a.username}` : a.name,
        icon: PLATFORM_ICON[a.platform],
      })),
  )
})
// the people of the client, for «Autore»
const authors = ref<FilterOption[]>([])
watch(
  () => props.workspace?.id ?? null,
  async (id) => {
    authors.value = []
    if (!id) return
    try {
      const res = await $fetch<{ items: { userId: string; displayName: string }[] }>(
        org.api(`/workspaces/${encodeURIComponent(id)}/members`),
      )
      authors.value = res.items.map((m) => ({ id: m.userId, label: m.displayName }))
    } catch {
      // without the people the filter of the authors is not offered
    }
  },
  { immediate: true },
)
const { labels } = useContentSettings(computed(() => props.workspace?.id ?? null))
const labelOptions = computed(() =>
  (labels.value ?? []).map((l) => ({ id: l.id, label: l.name, color: l.color })),
)
const labelsById = computed(() => new Map((labels.value ?? []).map((l) => [l.id, l])))

// ---- the cards
const clientsById = computed(
  () => new Map((workspaces.value?.items ?? []).map((w) => [w.id, w] as const)),
)
const keep = computed(() => {
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== '' ? { profilo } : {}
})
const PLATFORMS = ['instagram', 'facebook'] as const
function cardOf(p: CalendarPostRow): CalendarCardInfo {
  const client = clientsById.value.get(p.workspaceId)
  const state = postStateLabel(p, t)
  return {
    id: p.id,
    date: p.localDate,
    time: p.localTime ? formatTime(p.localTime) : null,
    title: postTitle(p, t),
    client: client?.name ?? '',
    status: p.status,
    state: state.label,
    tone: state.tone,
    draft: p.status === 'draft',
    thumb: p.thumbnail
      ? org.api(
          `/workspaces/${encodeURIComponent(p.workspaceId)}/media/${encodeURIComponent(p.thumbnail.mediaId)}/file/${p.thumbnail.variant}`,
        )
      : null,
    type: p.type,
    platforms: PLATFORMS.filter((pl) => p.accounts.some((a) => a.platform === pl)),
    labels: p.labelIds
      .map((id) => labelsById.value.get(id))
      .filter((l) => l !== undefined)
      .map((l) => ({ id: l.id, name: l.name, color: l.color })),
    to: {
      path: org.to(
        `/spazi/${encodeURIComponent(client?.slug ?? '')}/post/${encodeURIComponent(p.id)}`,
      ),
      query: keep.value,
    },
  }
}
const byDay = computed(
  () =>
    new Map([...postsByDay(cal.posts.value)].map(([d, list]) => [d, list.map(cardOf)] as const)),
)
const showClient = computed(() => props.workspace === null)

// ---- the states of the read
const loading = computed(() => data.value === null && status.value !== 'error')
const failed = computed(() => status.value === 'error')
const nothing = computed(
  () => data.value !== null && status.value === 'success' && cal.posts.value.length === 0,
)
const narrowed = computed(() => cal.activeFilters.value > 0 || filters.value.quick !== null)

// ---- the day in a sheet
const dayOpen = ref(false)
const day = ref<LocalDate | null>(null)
function openDay(d: LocalDate) {
  day.value = d
  dayOpen.value = true
}
const dayCards = computed(() => (day.value ? (byDay.value.get(day.value) ?? []) : []))
</script>

<template>
  <div class="flex flex-col gap-stack" :data-ready="data !== null || failed || undefined">
    <!-- the bar: arrows, period, «Oggi»; the views at the end (screen 07) -->
    <div class="flex flex-wrap items-center gap-2" data-calendar-bar>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        :aria-label="$t(`calendar.prev.${view}`)"
        data-calendar-prev
        @click="cal.step(-1)"
      />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-right"
        :aria-label="$t(`calendar.next.${view}`)"
        data-calendar-next
        @click="cal.step(1)"
      />
      <h2
        class="min-w-[9rem] ps-1 text-[15px] leading-5 font-semibold"
        aria-live="polite"
        data-calendar-period
      >
        {{ label }}
      </h2>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="isToday && !route.query['da']"
        data-calendar-today
        @click="cal.toToday()"
        >{{ $t('calendar.today') }}</UButton
      >
      <!-- on a phone the views and «Filtri» go to a line of their own -->
      <span class="flex-1 max-md:h-0 max-md:basis-full" />
      <SegmentedFilter v-model="chosenView" :label="$t('calendar.view.label')" :options="views" />
      <!-- on a phone the quick filters are in the sheet of «Filtri» (plan 09 Task 3) -->
      <div class="ms-auto md:hidden">
        <CalendarFilters
          :filters="filters"
          :clients="clientOptions"
          :accounts="accountOptions"
          :authors="authors"
          :labels="labelOptions"
          :count="cal.activeFilters.value + (quick === 'all' ? 0 : 1)"
          @change="cal.setFilters"
          @clear="cal.clearFilters"
        >
          <fieldset class="grid min-w-0 gap-1" data-filter="quick">
            <legend class="mb-1.5 font-medium">{{ $t('calendar.quick.label') }}</legend>
            <URadioGroup
              v-model="quick"
              :items="quickOptions"
              :ui="{ item: 'min-h-11 items-center' }"
            />
          </fieldset>
        </CalendarFilters>
      </div>
    </div>

    <Toolbar class="mb-0 max-md:hidden">
      <SegmentedFilter
        v-model="quick"
        :label="$t('calendar.quick.label')"
        :options="quickOptions"
      />
      <CalendarFilters
        :filters="filters"
        :clients="clientOptions"
        :accounts="accountOptions"
        :authors="authors"
        :labels="labelOptions"
        :count="cal.activeFilters.value"
        @change="cal.setFilters"
        @clear="cal.clearFilters"
      />
      <UButton
        v-if="narrowed"
        color="neutral"
        variant="link"
        class="px-0 underline underline-offset-3"
        data-calendar-clear
        @click="cal.clearFilters()"
        >{{ $t('calendar.filters.clear') }}</UButton
      >
    </Toolbar>

    <LoadFailed v-if="failed" :text="$t('calendar.failed')" @retry="cal.reload()" />
    <p
      v-else-if="data?.truncated"
      class="flex items-center gap-2 text-(--app-text-muted)"
      role="status"
      data-calendar-truncated
    >
      <UIcon name="i-lucide-info" class="size-4 shrink-0" aria-hidden="true" />
      {{ $t('calendar.truncated') }}
    </p>
    <p v-else-if="nothing" class="text-(--app-text-muted)" role="status" data-calendar-empty>
      {{ narrowed ? $t('calendar.noMatch') : $t(`calendar.empty.${view}`) }}
    </p>

    <CalendarMonth
      v-if="view === 'month'"
      :days="period.days"
      :month="date.slice(0, 7)"
      :today="today"
      :cards="byDay"
      :show-client="showClient"
      :loading="loading"
      @open-day="openDay"
    />
    <CalendarWeek
      v-else
      :days="period.days"
      :today="today"
      :cards="byDay"
      :show-client="showClient"
      :loading="loading"
      @open-day="openDay"
    />

    <CalendarDaySheet
      v-model:open="dayOpen"
      :date="day"
      :today="today"
      :cards="dayCards"
      :show-client="showClient"
    />
  </div>
</template>
