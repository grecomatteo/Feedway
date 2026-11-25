<script setup lang="ts">
import { cardLook, type CalendarCardInfo } from '~/utils/calendar'

/**
 * A post on one line, as the rows of «In uscita» in Oggi: the time, the picture (or the format),
 * the text, under it the client and the labels, and the state at the end. A content of the plan
 * has a dashed square with its format. The whole row opens the post, or the plan on its day. Used
 * by the day's sheet, by the day under the month on a phone and by the list (plan 09 Scelta 2).
 */
const props = defineProps<{ card: CalendarCardInfo; showClient: boolean }>()
defineEmits<{ open: [] }>()
const plan = computed(() => cardLook(props.card) === 'plan')
</script>

<template>
  <NuxtLink
    :to="card.to"
    class="grid min-h-row grid-cols-[3rem_2.5rem_minmax(0,1fr)] items-center gap-x-3 px-5 py-2 hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus) max-md:px-4"
    :data-post="card.kind === 'post' ? card.id : undefined"
    :data-plan="card.kind === 'plan' ? card.id : undefined"
    :data-tone="card.tone"
    @click="$emit('open')"
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
        <span class="flex-1" />
        <PlatformIcons
          v-if="card.platforms.length > 0"
          :platforms="card.platforms"
          class="shrink-0 max-md:hidden"
        />
        <StatusDot :tone="card.tone" :label="card.state" class="shrink-0" />
      </span>
    </span>
  </NuxtLink>
</template>
