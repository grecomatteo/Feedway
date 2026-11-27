<script setup lang="ts">
import type { LocalDate } from '@app/domain'
import { listGroupOf, type CalendarCardInfo, type ListGroup } from '~/utils/calendar'

/**
 * The list (plan 09 Scelta 2, D-120 request 2): the drafts without a date in a section of their
 * own on top, with «Elimina le bozze vuote»; then the days with posts under «Oggi», «Domani»,
 * «Questa settimana», «Più avanti» (and «Ieri», «Questa settimana», «Prima» behind), each day by
 * the time of its posts (D-79). Pages of 42 days, «Mostra altri» for the next.
 */
const props = defineProps<{
  days: { date: LocalDate; cards: CalendarCardInfo[] }[]
  today: LocalDate
  /** null: the section is not shown (a quick filter is on) */
  drafts: CalendarCardInfo[] | null
  draftsFailed: boolean
  draftsTruncated: boolean
  /** the empty drafts the person may delete */
  removable: number
  showClient: boolean
  loading: boolean
  moreStatus: 'idle' | 'pending' | 'error'
  /** a search or filters are on: the empty lines say so */
  narrowed: boolean
  /** «Eliminati» (plan 09 Scelta 12): `drafts` are the deleted posts, and no day is shown */
  trash?: boolean
}>()
const emit = defineEmits<{
  more: []
  removeEmpty: []
  retryDrafts: []
  trash: [cards: CalendarCardInfo[]]
  restore: [cards: CalendarCardInfo[]]
  purge: [cards: CalendarCardInfo[]]
  empty: []
}>()
const { t } = useI18n()

// ---- choosing more rows (plan 09 Scelta 12): «Seleziona», the boxes, «Elimina (n)»; on a
// phone a long press on a row starts it with that row
const selecting = ref(false)
const chosen = ref(new Set<string>())
/** a row this person may act on: «Elimina» in «Bozze», «Ripristina» in «Eliminati» */
const canChoose = (c: CalendarCardInfo) => (props.trash ? c.handleable : c.trashable) === true
const choosable = computed(() => (props.drafts ?? []).filter(canChoose))
const picked = computed(() => choosable.value.filter((c) => chosen.value.has(c.id)))
function toggle(c: CalendarCardInfo) {
  if (!canChoose(c)) return
  const next = new Set(chosen.value)
  if (next.has(c.id)) next.delete(c.id)
  else next.add(c.id)
  chosen.value = next
}
function hold(c: CalendarCardInfo) {
  if (!canChoose(c)) return
  selecting.value = true
  chosen.value = new Set([c.id])
}
const allPicked = computed(
  () => choosable.value.length > 0 && picked.value.length === choosable.value.length,
)
function pickAll() {
  chosen.value = allPicked.value ? new Set() : new Set(choosable.value.map((c) => c.id))
}
function stop() {
  selecting.value = false
  chosen.value = new Set()
}
// «Bozze» and «Eliminati» are different rows: the choice does not go from one to the other
watch(
  () => props.trash,
  () => stop(),
)
// a row gone (deleted, restored) is no longer chosen; nothing left to choose ends the choice
watch(choosable, (list) => {
  const ids = new Set(list.map((c) => c.id))
  if ([...chosen.value].some((id) => !ids.has(id)))
    chosen.value = new Set([...chosen.value].filter((id) => ids.has(id)))
  if (list.length === 0) selecting.value = false
})
function act(what: 'trash' | 'restore' | 'purge') {
  const cards = picked.value
  if (cards.length === 0) return
  if (what === 'trash') emit('trash', cards)
  else if (what === 'restore') emit('restore', cards)
  else emit('purge', cards)
  // «Elimina per sempre» asks first: the choice stays until the rows go
  if (what !== 'purge') stop()
}
const sectionTitle = computed(() => (props.trash ? t('trash.title') : t('calendar.list.drafts')))

const DAY = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const dayLabel = (date: LocalDate) => DAY.format(new Date(`${date}T00:00:00Z`))
/** the groups of one day only say their date beside the name */
const SINGLE: ListGroup[] = ['today', 'tomorrow', 'yesterday']

const groups = computed(() => {
  const out: { key: ListGroup; label: string; count: number; days: typeof props.days }[] = []
  for (const day of props.days) {
    const key = listGroupOf(day.date, props.today)
    const last = out.at(-1)
    if (last?.key === key) {
      last.days.push(day)
      last.count += day.cards.length
    } else
      out.push({
        key,
        label: t(`calendar.list.group.${key}`),
        count: day.cards.length,
        days: [day],
      })
  }
  return out
})
</script>

<template>
  <div class="flex flex-col gap-section" data-calendar-list>
    <!-- the drafts without a date: on top, they are the work still to place (Scelta 2); in
         «Eliminati» the deleted posts, alone (Scelta 12) -->
    <section
      v-if="drafts !== null || draftsFailed || trash"
      :aria-label="sectionTitle"
      :data-list-drafts="trash ? undefined : ''"
      :data-list-trash="trash ? '' : undefined"
    >
      <SectionHead :title="sectionTitle" :count="drafts?.length ?? null" :level="3">
        <template v-if="!selecting">
          <UButton
            v-if="!trash && removable > 0"
            color="neutral"
            variant="link"
            class="px-0 underline underline-offset-3"
            data-drafts-remove-empty
            @click="$emit('removeEmpty')"
            >{{ $t('calendar.list.removeEmpty', { n: removable }, removable) }}</UButton
          >
          <UButton
            v-if="choosable.length > 0"
            color="neutral"
            variant="link"
            class="px-0 underline underline-offset-3"
            data-list-select
            @click="selecting = true"
            >{{ $t('trash.select') }}</UButton
          >
          <UButton
            v-if="trash && choosable.length > 0"
            color="neutral"
            variant="link"
            class="px-0 underline underline-offset-3"
            data-trash-empty
            @click="$emit('empty')"
            >{{ $t('trash.empty') }}</UButton
          >
        </template>
      </SectionHead>
      <p v-if="trash" class="-mt-1 mb-2 text-detail text-(--app-text-muted)" data-trash-note>
        {{ $t('trash.keepNote') }}
      </p>
      <!-- the choice: how many, «Tutte», the actions and «Fine» -->
      <div
        v-if="selecting"
        class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-(--app-border) bg-(--app-surface-sunken) px-3 py-2"
        role="toolbar"
        :aria-label="$t('trash.selected', { n: picked.length }, picked.length)"
        data-list-selection
      >
        <UCheckbox
          :model-value="allPicked ? true : picked.length > 0 ? 'indeterminate' : false"
          :label="$t('trash.selectAll')"
          :ui="{ root: 'min-h-11 items-center' }"
          data-select-all
          @update:model-value="pickAll()"
        />
        <span class="text-detail text-(--app-text-muted) tabular-nums" aria-live="polite">{{
          $t('trash.selected', { n: picked.length }, picked.length)
        }}</span>
        <span class="flex-1" />
        <template v-if="trash">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-undo-2"
            class="min-h-control"
            :aria-disabled="picked.length === 0 || undefined"
            data-selection-restore
            @click="act('restore')"
            >{{ $t('trash.restoreSelected', { n: picked.length }) }}</UButton
          >
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            class="min-h-control"
            :aria-disabled="picked.length === 0 || undefined"
            data-selection-purge
            @click="act('purge')"
            >{{ $t('trash.purgeSelected', { n: picked.length }) }}</UButton
          >
        </template>
        <UButton
          v-else
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          class="min-h-control"
          :aria-disabled="picked.length === 0 || undefined"
          data-selection-trash
          @click="act('trash')"
          >{{ $t('trash.trashSelected', { n: picked.length }) }}</UButton
        >
        <UButton
          color="neutral"
          variant="ghost"
          class="min-h-control"
          data-selection-done
          @click="stop()"
          >{{ $t('trash.selectDone') }}</UButton
        >
      </div>
      <LoadFailed
        v-if="draftsFailed"
        :text="trash ? $t('trash.loadFailed') : $t('calendar.list.draftsFailed')"
        @retry="$emit('retryDrafts')"
      />
      <ListSkeleton
        v-else-if="drafts === null && trash"
        :label="$t('calendar.list.loading')"
        :rows="3"
        :action="false"
      />
      <p
        v-else-if="drafts !== null && drafts.length === 0"
        class="text-(--app-text-muted)"
        :data-drafts-none="trash ? undefined : ''"
        :data-trash-none="trash ? '' : undefined"
      >
        <template v-if="trash">{{ narrowed ? $t('trash.noneMatch') : $t('trash.none') }}</template>
        <template v-else>{{
          narrowed ? $t('calendar.list.noDraftsMatch') : $t('calendar.list.noDrafts')
        }}</template>
      </p>
      <ul
        v-else-if="drafts !== null"
        class="divide-y divide-(--app-border) overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
      >
        <li v-for="c in drafts" :key="c.id">
          <CalendarRow
            :card="c"
            :show-client="showClient"
            :selecting="selecting"
            :selected="chosen.has(c.id)"
            :selectable="canChoose(c)"
            :holdable="canChoose(c)"
            @toggle="toggle(c)"
            @hold="hold(c)"
          />
        </li>
      </ul>
      <p v-if="draftsTruncated" class="mt-2 text-detail text-(--app-text-muted)">
        {{ trash ? $t('trash.truncated') : $t('calendar.list.draftsTruncated') }}
      </p>
    </section>

    <template v-if="!trash">
      <ListSkeleton v-if="loading" :label="$t('calendar.list.loading')" :rows="4" :action="false" />
      <p
        v-else-if="groups.length === 0"
        class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
        role="status"
        data-calendar-empty
      >
        {{ narrowed ? $t('calendar.noMatch') : $t('calendar.empty.list') }}
      </p>
      <section
        v-for="g in groups"
        :key="`${g.key}-${g.days[0]?.date}`"
        :aria-label="g.label"
        :data-list-group="g.key"
      >
        <SectionHead :title="g.label" :count="g.count" :level="3">
          <span
            v-if="SINGLE.includes(g.key) && g.days[0]"
            class="text-detail text-(--app-text-muted)"
            >{{ dayLabel(g.days[0].date) }}</span
          >
        </SectionHead>
        <div class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)">
          <div
            v-for="d in g.days"
            :key="d.date"
            class="border-t border-(--app-border) first:border-t-0"
            :data-day="d.date"
          >
            <h4
              v-if="!SINGLE.includes(g.key)"
              class="border-b border-(--app-border) bg-(--app-surface-sunken) px-5 py-1.5 text-caption font-medium text-(--app-text-muted) first-letter:uppercase max-md:px-4"
            >
              {{ dayLabel(d.date) }}
            </h4>
            <ul class="divide-y divide-(--app-border)">
              <li v-for="c in d.cards" :key="c.id">
                <CalendarRow :card="c" :show-client="showClient" />
              </li>
            </ul>
          </div>
        </div>
      </section>

      <div v-if="!loading" class="flex flex-col items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :loading="moreStatus === 'pending'"
          data-list-more
          @click="$emit('more')"
          >{{ $t('calendar.list.more') }}</UButton
        >
        <p v-if="moreStatus === 'error'" role="alert" class="text-detail text-(--app-danger)">
          {{ $t('calendar.list.moreFailed') }}
        </p>
      </div>
    </template>
  </div>
</template>
