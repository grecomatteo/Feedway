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
}>()
defineEmits<{ more: []; removeEmpty: []; retryDrafts: [] }>()
const { t } = useI18n()

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
    <!-- the drafts without a date: on top, they are the work still to place (Scelta 2) -->
    <section
      v-if="drafts !== null || draftsFailed"
      :aria-label="$t('calendar.list.drafts')"
      data-list-drafts
    >
      <SectionHead :title="$t('calendar.list.drafts')" :count="drafts?.length ?? null" :level="3">
        <UButton
          v-if="removable > 0"
          color="neutral"
          variant="link"
          class="px-0 underline underline-offset-3"
          data-drafts-remove-empty
          @click="$emit('removeEmpty')"
          >{{ $t('calendar.list.removeEmpty', { n: removable }, removable) }}</UButton
        >
      </SectionHead>
      <LoadFailed
        v-if="draftsFailed"
        :text="$t('calendar.list.draftsFailed')"
        @retry="$emit('retryDrafts')"
      />
      <p
        v-else-if="drafts !== null && drafts.length === 0"
        class="text-(--app-text-muted)"
        data-drafts-none
      >
        {{ narrowed ? $t('calendar.list.noDraftsMatch') : $t('calendar.list.noDrafts') }}
      </p>
      <ul
        v-else-if="drafts !== null"
        class="divide-y divide-(--app-border) overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
      >
        <li v-for="c in drafts" :key="c.id">
          <CalendarRow :card="c" :show-client="showClient" />
        </li>
      </ul>
      <p v-if="draftsTruncated" class="mt-2 text-detail text-(--app-text-muted)">
        {{ $t('calendar.list.draftsTruncated') }}
      </p>
    </section>

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
  </div>
</template>
