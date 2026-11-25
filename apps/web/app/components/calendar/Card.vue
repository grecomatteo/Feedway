<script setup lang="ts">
import type { CalendarCardInfo } from '~/utils/calendar'

/**
 * A post in the calendar (spec §11.4, screen 07, plan 09 Task 3). Two sizes:
 * - `chip`, a day of the month: the state's dot, the time and the client (or the text inside a
 *   client), 22 high; red ground where something did not go out;
 * - `tile`, a day of the week: the picture large (4:5), the time and the state above it, the text
 *   on two lines, the client, the platforms and the labels.
 * A draft with a day has a full border and «Bozza» in grey (D-123.3, Matteo 24/11): the dashes
 * are only for what the plan still asks, where there is no post yet.
 * The whole card is one link, named by time, client, text and state for a screen reader.
 */
const props = defineProps<{
  card: CalendarCardInfo
  size: 'chip' | 'tile'
  /** inside a client the client's name is not repeated: the text takes its place */
  showClient: boolean
}>()
const { t } = useI18n()

const DOT: Record<CalendarCardInfo['tone'], string> = {
  neutral: 'bg-(--app-neutral-dot)',
  success: 'bg-(--app-success)',
  info: 'bg-(--app-info)',
  warning: 'bg-(--app-warning-dot)',
  danger: 'bg-(--app-danger)',
}
const name = computed(() =>
  [
    props.card.time ?? t('calendar.noTime'),
    props.showClient ? props.card.client : null,
    props.card.title,
    props.card.state,
  ]
    .filter(Boolean)
    .join(', '),
)
/** a chip says the client in «Tutti i clienti», the text inside one */
const chipText = computed(() => (props.showClient ? props.card.client : props.card.title))
</script>

<template>
  <NuxtLink
    v-if="size === 'chip'"
    :to="card.to"
    :aria-label="name"
    :title="card.title"
    class="flex h-[22px] min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 text-caption leading-[22px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-(--app-focus)"
    :class="
      card.draft
        ? 'border border-(--app-border-strong) bg-(--app-surface) text-(--app-text-muted) hover:bg-(--app-surface-sunken)'
        : card.tone === 'danger'
          ? 'bg-(--app-danger-soft) hover:brightness-97 dark:hover:brightness-110'
          : 'bg-(--app-surface-sunken) hover:bg-(--app-nav-hover)'
    "
    :data-post="card.id"
    :data-tone="card.tone"
    :data-draft="card.draft || undefined"
  >
    <span class="size-1.5 shrink-0 rounded-full" :class="DOT[card.tone]" aria-hidden="true" />
    <b v-if="card.time" class="font-semibold tabular-nums" aria-hidden="true">{{ card.time }}</b>
    <span class="min-w-0 truncate" aria-hidden="true">{{ chipText }}</span>
    <span v-if="card.draft" class="ms-auto shrink-0" aria-hidden="true">{{
      $t('posts.state.draft')
    }}</span>
  </NuxtLink>

  <NuxtLink
    v-else
    :to="card.to"
    :aria-label="name"
    class="group flex min-w-0 flex-col gap-2 rounded-card border p-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-(--app-focus)"
    :class="
      card.tone === 'danger'
        ? 'border-(--app-danger) bg-(--app-surface) hover:bg-(--app-surface-sunken)'
        : card.draft
          ? 'border-(--app-border-strong) bg-(--app-surface) hover:bg-(--app-surface-sunken)'
          : 'border-(--app-border) bg-(--app-surface) hover:bg-(--app-surface-sunken)'
    "
    :data-post="card.id"
    :data-tone="card.tone"
    :data-draft="card.draft || undefined"
  >
    <span class="flex min-w-0 items-center gap-1.5 text-caption" aria-hidden="true">
      <span class="size-1.5 shrink-0 rounded-full" :class="DOT[card.tone]" />
      <b v-if="card.time" class="font-semibold tabular-nums">{{ card.time }}</b>
      <!-- «Programmato» is what a post to come is: only another state is said (DESIGN.md) -->
      <span
        v-if="card.status !== 'scheduled'"
        class="ms-auto min-w-0 truncate"
        :class="
          card.tone === 'danger'
            ? 'font-medium text-(--app-danger)'
            : card.tone === 'warning'
              ? 'font-medium text-(--app-warning)'
              : 'text-(--app-text-muted)'
        "
        >{{ card.state }}</span
      >
    </span>
    <span
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
      />
      <UIcon v-else :name="POST_TYPE_ICON[card.type]" class="size-5" />
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
</template>
