<script setup lang="ts">
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'
import { cardLook, type CalendarCardInfo } from '~/utils/calendar'

/**
 * A post in the calendar (spec §11.4, screen 07, plan 09 Task 3), or a content of the plan still
 * to prepare (§11.12). Two sizes:
 * - `chip`, a day of the month: the format, the time and the client (or the text inside a
 *   client), 22 high;
 * - `tile`, a day of the week: the format, the time and the state above the picture (4:5), the
 *   text on two lines, the client, the platforms and the labels.
 * Every card shows its format with the icon of «Nuovo post»; the state only where it asks to be
 * looked at (Matteo 25/11): red or amber ground for what did not go out or has a problem, a full
 * border and «Bozza» for a draft with a day (D-123.3), dashes for the plan, quieter once out.
 * The whole card is one link, named by time, format, client, text and state for a screen reader.
 * A post this person may move is dragged onto another day (plan 09 Task 4); a tile of the week
 * also has its «⋯» with «Sposta…», the way for the keyboard and for a touch screen.
 */
const props = defineProps<{
  card: CalendarCardInfo
  size: 'chip' | 'tile'
  /** inside a client the client's name is not repeated: the text takes its place */
  showClient: boolean
  /** a card of today: an orange edge, so the day is found at once (Matteo 25/11) */
  today?: boolean
}>()
const { t } = useI18n()

const look = computed(() => cardLook(props.card))

const moving = inject(CALENDAR_MOVING, null)
const draggable = computed(() => moving !== null && props.card.movable)
const lifted = computed(() => moving?.lifted.value === props.card.id)
const actions = computed(() => moving?.actionsOf(props.card) ?? [])
function lift(event: DragEvent) {
  if (draggable.value) moving?.lift(event, props.card)
  else event.preventDefault()
}
const name = computed(() =>
  [
    props.card.time ?? t('calendar.noTime'),
    t(`posts.type.${props.card.type}`),
    props.showClient ? props.card.client : null,
    props.card.title,
    props.card.state,
  ]
    .filter(Boolean)
    .join(', '),
)
/** a chip says the client in «Tutti i clienti», the text inside one */
const chipText = computed(() => (props.showClient ? props.card.client : props.card.title))
const alertTone = computed(() => (props.card.tone === 'danger' ? 'danger' : 'warning'))

const CHIP: Record<ReturnType<typeof cardLook>, string> = {
  alert: '',
  draft: 'border border-(--app-border-strong) bg-(--app-surface) hover:bg-(--app-surface-sunken)',
  plan: 'border border-dashed border-(--app-border-strong) hover:bg-(--app-surface-sunken)',
  done: 'bg-(--app-surface-sunken) hover:bg-(--app-nav-hover)',
  normal: 'bg-(--app-surface-sunken) hover:bg-(--app-nav-hover)',
}
const ALERT_CHIP = {
  danger: 'bg-(--app-danger-soft) hover:brightness-97 dark:hover:brightness-110',
  warning: 'bg-(--app-warning-soft) hover:brightness-97 dark:hover:brightness-110',
}
const TILE: Record<ReturnType<typeof cardLook>, string> = {
  alert: '',
  draft: 'border-(--app-border-strong) bg-(--app-surface)',
  plan: 'border-dashed border-(--app-border-strong) bg-transparent',
  done: 'border-(--app-border) bg-(--app-surface)',
  normal: 'border-(--app-border) bg-(--app-surface)',
}
const ALERT_TILE = {
  danger: 'border-(--app-danger) bg-(--app-surface)',
  warning: 'border-(--app-warning) bg-(--app-surface)',
}
/** the icon of the format: full colour, a colour of its own where it asks to be looked at */
const iconClass = computed(() => {
  if (look.value === 'alert' || (look.value === 'plan' && props.card.tone !== 'neutral'))
    return props.card.tone === 'danger' ? 'text-(--app-danger)' : 'text-(--app-warning)'
  return look.value === 'done' || look.value === 'plan' || look.value === 'draft'
    ? 'text-(--app-text-muted)'
    : 'text-(--app-text)'
})
const edge = computed(() => (props.today ? 'shadow-[inset_2px_0_0_var(--app-brand)]' : ''))
/** the state is written where it asks to be looked at: a problem, a draft, the plan */
const saysState = computed(() => ['alert', 'draft', 'plan'].includes(look.value))
const stateClass = computed(() =>
  look.value === 'alert' || (look.value === 'plan' && props.card.tone !== 'neutral')
    ? props.card.tone === 'danger'
      ? 'font-medium text-(--app-danger)'
      : 'font-medium text-(--app-warning)'
    : 'text-(--app-text-muted)',
)
</script>

<template>
  <NuxtLink
    v-if="size === 'chip'"
    :to="card.to"
    :aria-label="name"
    :title="card.title"
    class="flex h-[22px] min-w-0 items-center gap-1.5 overflow-hidden rounded-[5px] px-1.5 text-caption leading-[22px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-(--app-focus)"
    :class="[
      look === 'alert' ? ALERT_CHIP[alertTone] : CHIP[look],
      edge,
      draggable ? 'cursor-grab active:cursor-grabbing' : '',
      lifted ? 'opacity-40' : '',
    ]"
    :draggable="draggable ? 'true' : 'false'"
    :data-movable="draggable || undefined"
    :data-post="card.kind === 'post' ? card.id : undefined"
    :data-plan="card.kind === 'plan' ? card.id : undefined"
    :data-tone="card.tone"
    :data-draft="look === 'draft' || undefined"
    :data-look="look"
    @dragstart="lift"
    @dragend="moving?.settle()"
  >
    <PostTypeIcon :type="card.type" class="text-[15px]" :class="iconClass" />
    <b
      v-if="card.time"
      class="tabular-nums"
      :class="look === 'done' ? 'font-medium text-(--app-text-muted)' : 'font-semibold'"
      aria-hidden="true"
      >{{ card.time }}</b
    >
    <span class="min-w-0 truncate" aria-hidden="true">{{ chipText }}</span>
    <!-- «Bozza» only where the chip has room: a narrow day (the library open) keeps the text -->
    <span
      v-if="look === 'draft'"
      class="ms-auto hidden shrink-0 text-(--app-text-muted) @[9rem]:inline"
      aria-hidden="true"
      >{{ $t('posts.state.draft') }}</span
    >
  </NuxtLink>

  <div v-else class="group/tile relative flex min-w-0 flex-col">
    <NuxtLink
      :to="card.to"
      :aria-label="name"
      class="group flex min-w-0 flex-col gap-2 rounded-card border p-2 transition-colors duration-150 hover:bg-(--app-surface-sunken) focus-visible:outline-2 focus-visible:outline-(--app-focus)"
      :class="[
        look === 'alert' ? ALERT_TILE[alertTone] : TILE[look],
        edge,
        draggable ? 'cursor-grab active:cursor-grabbing' : '',
        lifted ? 'opacity-40' : '',
      ]"
      :draggable="draggable ? 'true' : 'false'"
      :data-movable="draggable || undefined"
      :data-post="card.kind === 'post' ? card.id : undefined"
      :data-plan="card.kind === 'plan' ? card.id : undefined"
      :data-tone="card.tone"
      :data-draft="look === 'draft' || undefined"
      :data-look="look"
      @dragstart="lift"
      @dragend="moving?.settle()"
    >
      <span class="flex min-w-0 items-center gap-1.5 text-caption" aria-hidden="true">
        <PostTypeIcon :type="card.type" class="text-[16px]" :class="iconClass" />
        <b
          v-if="card.time"
          class="font-semibold tabular-nums"
          :class="look === 'done' ? 'text-(--app-text-muted)' : ''"
          >{{ card.time }}</b
        >
        <span v-if="saysState" class="ms-auto min-w-0 truncate" :class="stateClass">{{
          card.state
        }}</span>
      </span>
      <span
        v-if="card.kind === 'post'"
        class="flex w-full items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
        :class="card.thumb ? 'aspect-[4/5]' : 'aspect-[2/1]'"
        aria-hidden="true"
      >
        <img
          v-if="card.thumb"
          :src="card.thumb"
          alt=""
          loading="lazy"
          decoding="async"
          class="size-full object-cover"
          :class="look === 'done' ? 'opacity-80 group-hover:opacity-100' : ''"
        />
        <PostTypeIcon v-else :type="card.type" class="text-[20px]" />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5" aria-hidden="true">
        <span class="line-clamp-2 text-detail leading-[18px] font-medium">{{ card.title }}</span>
        <span
          v-if="showClient"
          class="truncate text-caption text-(--app-text-muted)"
          data-card-client
          >{{ card.client }}</span
        >
      </span>
      <span
        v-if="card.platforms.length > 0 || card.labels.length > 0"
        class="flex min-w-0 items-center gap-2 text-caption text-(--app-text-muted)"
        aria-hidden="true"
      >
        <PlatformIcons v-if="card.platforms.length > 0" :platforms="card.platforms" />
        <span
          v-for="l in card.labels.slice(0, 2)"
          :key="l.id"
          class="inline-flex min-w-0 items-center gap-1"
          data-label
          ><ContentLabelDot :color="l.color" /><span class="truncate">{{ l.name }}</span></span
        >
      </span>
    </NuxtLink>
    <!-- over the picture, out of the link: shown on hover and focus, always on a touch screen -->
    <div
      v-if="actions.length > 0"
      class="absolute top-9 right-3 rounded-control bg-(--app-surface) opacity-0 shadow-1 group-hover/tile:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
      data-card-actions
    >
      <RowActions :name="card.title" :items="actions" compact />
    </div>
  </div>
</template>
