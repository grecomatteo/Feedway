<script setup lang="ts">
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'
import { cardLook, type CalendarCardInfo } from '~/utils/calendar'

/**
 * A post on one line, as the rows of «In uscita» in Oggi: the time, the picture (or the format),
 * the text, under it the client and the labels, and the state at the end. A content of the plan
 * has a dashed square with its format. The whole row opens the post, or the plan on its day. Used
 * by the day's sheet, by the day under the month on a phone and by the list (plan 09 Scelta 2).
 * A post this person may move has its «⋯» at the end, with «Sposta…» (plan 09 Task 4), and
 * «Elimina» for a draft (Scelta 12).
 * In the list's «Bozze» and «Eliminati» the rows can be chosen (`selecting`): a box in front,
 * and the row ticks it instead of opening the post. On a touch screen a long press on a row
 * starts the choice (`holdable`).
 */
const props = defineProps<{
  card: CalendarCardInfo
  showClient: boolean
  selecting?: boolean
  selected?: boolean
  /** this row may be chosen while `selecting` */
  selectable?: boolean
  /** a long press on a touch screen sends `hold` */
  holdable?: boolean
}>()
const emit = defineEmits<{ open: []; toggle: []; hold: [] }>()
const { t } = useI18n()
const plan = computed(() => cardLook(props.card) === 'plan')
const moving = inject(CALENDAR_MOVING, null)
const actions = computed(() => (props.selecting ? [] : (moving?.actionsOf(props.card) ?? [])))

// ---- the long press: half a second still on a touch screen
const HOLD_MS = 500
let timer: ReturnType<typeof setTimeout> | undefined
let start: { x: number; y: number } | null = null
let held = false
function down(e: PointerEvent) {
  // a long press the browser sent no click after does not take the next tap
  held = false
  if (!props.holdable || props.selecting || e.pointerType !== 'touch') return
  start = { x: e.clientX, y: e.clientY }
  clearTimeout(timer)
  timer = setTimeout(() => {
    held = true
    start = null
    emit('hold')
  }, HOLD_MS)
}
function moved(e: PointerEvent) {
  // a scroll is not a press
  if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel()
}
function cancel() {
  clearTimeout(timer)
  start = null
}
onBeforeUnmount(cancel)
function click(e: MouseEvent) {
  // the click after a long press, or any while choosing, does not open the post
  if (held || props.selecting) {
    e.preventDefault()
    if (!held && props.selectable) emit('toggle')
    held = false
    return
  }
  emit('open')
}
</script>

<template>
  <div class="flex min-w-0 items-center" :data-selected="selected || undefined">
    <span
      v-if="selecting"
      class="flex size-11 shrink-0 items-center justify-center ps-3 max-md:ps-2"
    >
      <UCheckbox
        v-if="selectable"
        :model-value="selected"
        :aria-label="t('trash.selectRow', { name: card.title })"
        data-row-select
        @update:model-value="emit('toggle')"
      />
    </span>
    <NuxtLink
      :to="card.to"
      class="grid min-h-row min-w-0 flex-1 grid-cols-[3rem_2.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2 select-none hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus) max-md:px-4"
      :class="selecting ? 'ps-2 max-md:ps-2' : ''"
      :data-post="card.kind === 'post' ? card.id : undefined"
      :data-plan="card.kind === 'plan' ? card.id : undefined"
      :data-tone="card.tone"
      :tabindex="selecting ? -1 : undefined"
      @click="click"
      @pointerdown="down"
      @pointermove="moved"
      @pointerup="cancel"
      @pointercancel="cancel"
      @contextmenu="
        holdable && $event.pointerType !== 'mouse' ? $event.preventDefault() : undefined
      "
    >
      <span class="tabular-nums" :class="card.time ? 'font-semibold' : 'text-(--app-text-muted)'">{{
        card.time ?? '—'
      }}</span>
      <span
        class="flex size-10 items-center justify-center overflow-hidden rounded-thumb text-(--app-text-muted)"
        :class="
          plan
            ? 'border border-dashed border-(--app-border-strong)'
            : 'bg-(--app-surface-sunken) outline outline-1 -outline-offset-1 outline-(--app-img-outline)'
        "
      >
        <img v-if="card.thumb" :src="card.thumb" alt="" class="size-full object-cover" />
        <PostTypeIcon v-else :type="card.type" named class="text-[16px]" />
      </span>
      <span class="min-w-0">
        <span class="flex min-w-0 items-center gap-1.5">
          <PostTypeIcon
            v-if="card.thumb"
            :type="card.type"
            named
            class="text-[14px] text-(--app-text-muted)"
          />
          <span class="truncate font-medium">{{ card.title }}</span>
        </span>
        <span class="flex items-center gap-2.5 text-detail text-(--app-text-muted)">
          <span v-if="showClient" class="min-w-0 truncate" data-card-client>{{ card.client }}</span>
          <span
            v-for="l in card.labels"
            :key="l.id"
            class="inline-flex min-w-0 items-center gap-1.5 max-md:hidden"
            data-label
          >
            <ContentLabelDot :color="l.color" /><span class="truncate">{{ l.name }}</span>
          </span>
          <span
            v-if="card.note"
            class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
            :class="card.trashed ? '' : 'font-medium text-(--app-warning)'"
            data-card-note
          >
            <UIcon
              :name="card.trashed ? 'i-lucide-clock' : 'i-lucide-clock-alert'"
              class="size-3.5 shrink-0"
              aria-hidden="true"
            />{{ card.note }}</span
          >
          <span class="flex-1" />
          <PlatformIcons
            v-if="card.platforms.length > 0"
            :platforms="card.platforms"
            class="shrink-0 max-md:hidden"
          />
          <!-- on a phone the note takes the state's place: the line holds one of them whole -->
          <StatusDot
            :tone="card.tone"
            :label="card.state"
            class="shrink-0"
            :class="card.note ? 'max-md:hidden' : ''"
          />
        </span>
      </span>
    </NuxtLink>
    <div v-if="actions.length > 0" class="shrink-0 pe-2 max-md:pe-1" data-card-actions>
      <RowActions :name="card.title" :items="actions" />
    </div>
  </div>
</template>
