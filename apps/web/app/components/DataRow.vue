<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * A row of a `DataList`: 56 px on a computer, 64 on a phone, all the same height. The picture or
 * initials (32 px), the name as the row's link, the details in `text-muted`. `status` holds a
 * `StatusDot` only when there is something to do; `actions` at most one button and `RowActions`.
 */
withDefaults(
  defineProps<{
    name: string
    to?: RouteLocationRaw
    src?: string | null
    detail?: string
    avatar?: boolean
  }>(),
  { to: undefined, src: null, detail: undefined, avatar: true },
)
</script>

<template>
  <li class="flex h-16 items-center gap-3 pr-2 pl-4 md:h-14">
    <slot name="avatar"><RowAvatar v-if="avatar" :name="name" :src="src" /></slot>
    <span class="min-w-0 flex-1">
      <NuxtLink
        v-if="to"
        :to="to"
        class="block truncate rounded-sm text-[0.9375rem] leading-5 font-semibold underline-offset-3 hover:underline"
      >
        {{ name }}
      </NuxtLink>
      <span v-else class="block truncate text-[0.9375rem] leading-5 font-semibold">{{ name }}</span>
      <span
        v-if="detail || $slots.detail"
        class="block truncate text-[0.8125rem] leading-[1.125rem] text-(--app-text-muted)"
      >
        <slot name="detail">{{ detail }}</slot>
      </span>
    </span>
    <span v-if="$slots.status" class="shrink-0"><slot name="status" /></span>
    <span v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
      <slot name="actions" />
    </span>
  </li>
</template>
