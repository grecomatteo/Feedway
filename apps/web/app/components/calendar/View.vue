<script setup lang="ts">
import type { CalendarEntry, CalendarPost } from '@app/contracts'
import type { CalendarShow, LocalDate, QuickFilter } from '@app/domain'
import type { FilterOption } from '~/components/calendar/Filters.vue'
import type { WorkspaceView } from '~/composables/useOrganization'
import { periodLabel, postsByDay, type CalendarCardInfo, type PeriodView } from '~/utils/calendar'
import type { PostType } from '~/utils/post-editor'
import { mayMove } from '~/utils/calendar-move'
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'

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

// ---- moving a post (plan 09 Task 4): dragged onto a day on a computer, «Sposta…» everywhere
const mover = useCalendarMove({
  posts: cal.posts,
  timeZone: cal.timeZone,
  today,
  patch: cal.patchPost,
  reload: cal.reload,
})
provide(CALENDAR_MOVING, mover.moving)
const { problem: moveProblem, toast: moveToast, dialog: moveDialog } = mover

// ---- the bar
const label = computed(() => periodLabel(view.value, date.value))
const isToday = computed(() => period.value.days.includes(today.value))
const views = computed(() => [
  { value: 'month' as const, label: t('calendar.view.month') },
  { value: 'week' as const, label: t('calendar.view.week') },
  { value: 'list' as const, label: t('calendar.view.list') },
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
  async (id, _, onCleanup) => {
    authors.value = []
    if (!id) return
    // a late answer for the client left behind does not take the place of this one's
    let gone = false
    onCleanup(() => (gone = true))
    try {
      const res = await $fetch<{ items: { userId: string; displayName: string }[] }>(
        org.api(`/workspaces/${encodeURIComponent(id)}/members`),
      )
      if (!gone) authors.value = res.items.map((m) => ({ id: m.userId, label: m.displayName }))
    } catch {
      // without the people the filter of the authors is not offered
    }
  },
  { immediate: true },
)
const { labels } = useContentSettings(computed(() => props.workspace?.id ?? null))
// the labels are the client's: none in «Tutti i clienti», where the last client's would linger
const labelOptions = computed(() =>
  (props.workspace ? (labels.value ?? []) : []).map((l) => ({
    id: l.id,
    label: l.name,
    color: l.color,
  })),
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
function cardOf(p: CalendarPost): CalendarCardInfo {
  const client = clientsById.value.get(p.workspaceId)
  const state = postStateLabel(p, t)
  return {
    kind: 'post',
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
    movable: !mover.pending.value.has(p.id) && mayMove(p, client, org.me.value?.id ?? null),
    to: {
      path: org.to(
        `/spazi/${encodeURIComponent(client?.slug ?? '')}/post/${encodeURIComponent(p.id)}`,
      ),
      query: keep.value,
    },
  }
}
// a content of the plan still to prepare (§11.12): the fields the plan declares (PlanEntryData)
const PLAN_TONE = { to_prepare: 'neutral', due_soon: 'warning', late: 'danger' } as const
const PLAN_TYPES: readonly string[] = ['photo', 'carousel', 'reel', 'story']
function planCardOf(e: CalendarEntry): CalendarCardInfo | null {
  const type = e.data['type']
  const state = e.data['state']
  if (typeof type !== 'string' || !PLAN_TYPES.includes(type)) return null
  const known = state === 'due_soon' || state === 'late' ? state : 'to_prepare'
  const client = clientsById.value.get(e.workspaceId)
  return {
    kind: 'plan',
    id: e.id,
    date: e.localDate,
    time: e.localTime ? formatTime(e.localTime) : null,
    title: e.title,
    client: client?.name ?? '',
    status: null,
    state: t(`calendar.plan.state.${known}`),
    tone: PLAN_TONE[known],
    draft: false,
    thumb: null,
    type: type as PostType,
    platforms: [],
    labels: [],
    movable: false,
    to: {
      path: org.to('/piano'),
      query: { ...(client ? { spazio: client.slug } : {}), giorno: e.localDate },
    },
  }
}
const byDay = computed(() => {
  const plan = cal.entries.value
    .filter((e) => e.source === 'plan')
    .map((e) => ({ e, card: planCardOf(e) }))
    .filter((x) => x.card !== null)
  const rows = [
    // a post of a client not in the list (the list did not load) would have no page to open
    ...cal.posts.value
      .filter((p) => clientsById.value.has(p.workspaceId))
      .map((p) => ({
        id: p.id,
        localDate: p.localDate,
        localTime: p.localTime,
        card: cardOf(p),
      })),
    ...plan.map(({ e, card }) => ({
      id: e.id,
      localDate: e.localDate,
      localTime: e.localTime,
      card: card as CalendarCardInfo,
    })),
  ]
  return new Map([...postsByDay(rows)].map(([d, list]) => [d, list.map((r) => r.card)] as const))
})

// «Mostra: Post · Piano · Entrambi» (§11.4): offered once the plan has something in the period,
// or while it is narrowed, so it can be put back
const hasPlan = computed(
  () =>
    (data.value?.entries ?? []).some((e) => e.source === 'plan') || filters.value.show !== 'both',
)
const showOptions = computed(() => [
  { value: 'both' as const, label: t('calendar.show.both') },
  { value: 'posts' as const, label: t('calendar.show.posts') },
  { value: 'plan' as const, label: t('calendar.show.plan') },
])
const show = computed<CalendarShow>({
  get: () => filters.value.show,
  set: (v) => void cal.setFilters({ show: v }),
})
const showClient = computed(() => props.workspace === null)

// ---- the states of the read
const loading = computed(() => data.value === null && status.value !== 'error')

// ---- the list (plan 09 Scelta 2): the days read, the drafts without a date, the search
const search = ref('')
const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const matches = (c: CalendarCardInfo) => {
  const q = fold(search.value.trim())
  return q === '' || fold(c.title).includes(q) || fold(c.client).includes(q)
}
const listDays = computed(() =>
  [...byDay.value]
    .filter(([d]) => d >= period.value.from && d <= cal.readTo.value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, cards]) => ({ date: d, cards: cards.filter(matches) }))
    .filter((d) => d.cards.length > 0),
)
const draftCards = computed(() =>
  cal.drafts.value ? cal.drafts.value.items.map(cardOf).filter(matches) : null,
)
/**
 * The empty drafts the person may delete: their own, and the others' where they manage posts.
 * The server deletes in the whole client (or in every client) and does not know the filters: so
 * the button is offered only when the list shows that whole set, the number it says included.
 */
const MANAGES = ['owner', 'admin', 'manager']
const wholeDrafts = computed(
  () =>
    cal.activeFilters.value === 0 &&
    filters.value.quick === null &&
    props.profileAccountIds === null &&
    search.value.trim() === '' &&
    cal.drafts.value?.truncated === false,
)
const removableDrafts = computed(() =>
  wholeDrafts.value
    ? (cal.drafts.value?.items ?? []).filter(
        (d) =>
          d.empty &&
          (d.createdBy === org.me.value?.id ||
            MANAGES.includes(clientsById.value.get(d.workspaceId)?.myRole ?? '')),
      )
    : [],
)
const confirmRemove = ref(false)
const removing = ref(false)
const removeFailed = ref<string | null>(null)
const notice = useNotice()
const api = useApi()
async function removeEmpty() {
  removing.value = true
  removeFailed.value = null
  try {
    const others = removableDrafts.value.some((d) => d.createdBy !== org.me.value?.id)
    const n = await cal.removeEmptyDrafts(others)
    confirmRemove.value = false
    notice.show({ message: t('calendar.list.removed', { n }, n) })
  } catch (error) {
    removeFailed.value = api.failure(error).message
  } finally {
    removing.value = false
  }
}
const failed = computed(() => status.value === 'error')
const nothing = computed(
  () => data.value !== null && status.value === 'success' && byDay.value.size === 0,
)
const narrowed = computed(
  () =>
    cal.activeFilters.value > 0 || filters.value.quick !== null || filters.value.show !== 'both',
)

// ---- the day: in a sheet on a computer; on a phone the month lists the chosen day under it
const phone = ref(false)
let phoneQuery: MediaQueryList | null = null
const onPhone = () => (phone.value = phoneQuery?.matches ?? false)
onMounted(() => {
  phoneQuery = window.matchMedia('(max-width: 47.99rem)')
  onPhone()
  phoneQuery.addEventListener('change', onPhone)
})
onBeforeUnmount(() => phoneQuery?.removeEventListener('change', onPhone))
const dayOpen = ref(false)
const day = ref<LocalDate | null>(null)
const chosen = ref<LocalDate | null>(null)
/** the day listed under the month on a phone: the one chosen, else today if in the month */
const listedDay = computed<LocalDate | null>(() => {
  const month = date.value.slice(0, 7)
  if (chosen.value?.startsWith(month)) return chosen.value
  return today.value.startsWith(month) ? today.value : null
})
function openDay(d: LocalDate) {
  if (phone.value && view.value === 'month') {
    chosen.value = d
    return
  }
  day.value = d
  dayOpen.value = true
}
const dayCards = computed(() => (day.value ? (byDay.value.get(day.value) ?? []) : []))
const listedCards = computed(() =>
  listedDay.value ? (byDay.value.get(listedDay.value) ?? []) : [],
)
const LISTED = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const listedTitle = computed(() => {
  if (!listedDay.value) return ''
  const long = LISTED.format(new Date(`${listedDay.value}T00:00:00Z`))
  return listedDay.value === today.value
    ? `${t('calendar.today')}, ${long}`
    : long.charAt(0).toUpperCase() + long.slice(1)
})
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
        class="min-w-[9rem] ps-1 text-[14px] leading-5 font-semibold"
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
          <fieldset v-if="hasPlan" class="grid min-w-0 gap-1" data-filter="show">
            <legend class="mb-1.5 font-medium">{{ $t('calendar.show.label') }}</legend>
            <URadioGroup
              v-model="show"
              :items="showOptions"
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
      <SegmentedFilter
        v-if="hasPlan"
        v-model="show"
        :label="$t('calendar.show.label')"
        :options="showOptions"
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

    <SearchField
      v-if="view === 'list'"
      v-model="search"
      :label="workspace ? $t('calendar.list.searchText') : $t('calendar.list.search')"
      class="md:max-w-80"
    />

    <LoadFailed v-if="failed" :text="$t('calendar.failed')" @retry="cal.reload()" />
    <p
      v-else-if="cal.truncated.value"
      class="flex items-center gap-2 text-(--app-text-muted)"
      role="status"
      data-calendar-truncated
    >
      <UIcon name="i-lucide-info" class="size-4 shrink-0" aria-hidden="true" />
      {{ $t('calendar.truncated') }}
    </p>
    <p
      v-else-if="nothing && view !== 'list'"
      class="text-(--app-text-muted)"
      role="status"
      data-calendar-empty
    >
      {{ narrowed ? $t('calendar.noMatch') : $t(`calendar.empty.${view}`) }}
    </p>

    <p
      v-if="moveProblem"
      role="alert"
      class="flex items-start gap-2 text-(--app-danger)"
      data-calendar-move-problem
    >
      <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {{ moveProblem }}
    </p>

    <CalendarMonth
      v-if="view === 'month' && !failed"
      :days="period.days"
      :month="date.slice(0, 7)"
      :today="today"
      :cards="byDay"
      :show-client="showClient"
      :loading="loading"
      :selected="phone ? listedDay : null"
      @open-day="openDay"
    />
    <!-- on a phone the chosen day is listed under the month, not in a sheet over it -->
    <section
      v-if="view === 'month' && phone && listedDay && !loading"
      :aria-label="listedTitle"
      aria-live="polite"
      data-month-day
    >
      <SectionHead :title="listedTitle" :count="listedCards.length" :level="3" />
      <p v-if="listedCards.length === 0" class="text-(--app-text-muted)">
        {{ $t('calendar.emptyDay') }}
      </p>
      <ul
        v-else
        class="divide-y divide-(--app-border) overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
      >
        <li v-for="c in listedCards" :key="c.id">
          <CalendarRow :card="c" :show-client="showClient" />
        </li>
      </ul>
    </section>
    <CalendarWeek
      v-if="view === 'week' && !failed"
      :days="period.days"
      :today="today"
      :cards="byDay"
      :show-client="showClient"
      :loading="loading"
      @open-day="openDay"
    />

    <CalendarList
      v-if="view === 'list' && !failed"
      :days="listDays"
      :today="today"
      :drafts="draftCards"
      :drafts-failed="cal.draftsStatus.value === 'error'"
      :drafts-truncated="cal.drafts.value?.truncated ?? false"
      :removable="removableDrafts.length"
      :show-client="showClient"
      :loading="loading"
      :more-status="status === 'pending' ? 'pending' : cal.moreStatus.value"
      :narrowed="narrowed || search.trim() !== ''"
      @more="cal.loadMore()"
      @remove-empty="confirmRemove = true"
      @retry-drafts="cal.reloadDrafts()"
    />
    <UModal
      v-model:open="confirmRemove"
      :title="$t('calendar.list.removeTitle')"
      :description="$t('calendar.list.removeText')"
    >
      <template #body>
        <p class="text-(--app-text-muted)">
          {{
            $t('calendar.list.removeEmpty', { n: removableDrafts.length }, removableDrafts.length)
          }}
        </p>
        <p v-if="removeFailed" role="alert" class="mt-2 text-(--app-danger)">{{ removeFailed }}</p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            class="min-h-control"
            @click="confirmRemove = false"
          >
            {{ $t('calendar.list.keep') }}
          </UButton>
          <UButton
            color="error"
            class="min-h-control"
            :loading="removing"
            data-drafts-remove-confirm
            @click="removeEmpty()"
          >
            {{ $t('calendar.list.removeOk') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <CalendarDaySheet
      v-model:open="dayOpen"
      :date="day"
      :today="today"
      :cards="dayCards"
      :show-client="showClient"
    />
    <CalendarMoveDialog
      v-model:open="moveDialog.open"
      :post="moveDialog.post"
      :today="today"
      @move="(post, to) => mover.move(post, to)"
    />
    <Toast
      v-model:open="moveToast.open"
      :message="moveToast.message"
      :action-label="moveToast.action || undefined"
      @action="mover.runUndo"
    />
  </div>
</template>
