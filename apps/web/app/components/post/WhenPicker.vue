<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Quando» (§11.2 point 6, P1; design E1, E1b): the day and the time in the post's zone. Rome,
 * the default, is not said (Matteo 18/11); another zone set in the agency's settings is said next
 * to the time, so nobody reads it as Rome (D-58). The client's default time is already
 * written. «Pubblica subito» is drawn for who can schedule, off with «Presto» until publishing
 * arrives (stage 7, Matteo 18/11).
 */
const props = defineProps<{ editor: PostEditor; client: WorkspaceView }>()
const { t } = useI18n()
const e = props.editor

/** «ora di New York»; null for Rome, the default */
const zone = computed(() => {
  const tz = e.timeZone.value
  if (tz === 'Europe/Rome') return null
  const city = tz.split('/').pop()?.replaceAll('_', ' ') ?? tz
  return t('posts.when.zone', { city })
})

const date = computed({
  get: () => e.when.value?.localDate ?? '',
  set: (v: string) => {
    if (!v) return
    e.when.value = { localDate: v, localTime: e.when.value?.localTime ?? '18:00' }
    e.touched()
  },
})
const time = computed({
  get: () => e.when.value?.localTime ?? '',
  set: (v: string) => {
    if (!v) return
    e.when.value = { localDate: e.when.value?.localDate ?? '', localTime: v.slice(0, 5) }
    e.touched()
  },
})

const sentence = computed(() => {
  const w = e.when.value
  if (!w?.localDate || !w.localTime) return null
  const day = formatDay(w.localDate)
  const time = formatTime(w.localTime)
  return zone.value
    ? t('posts.when.sentence', { day, time, zone: zone.value })
    : t('posts.when.sentenceLocal', { day, time })
})
const isDefault = computed(
  () => props.client.defaultPostTime && e.when.value?.localTime === props.client.defaultPostTime,
)
</script>

<template>
  <PostEditorRow heading="post-when" :label="$t('posts.when.title')">
    <div class="flex flex-col gap-3">
      <div
        v-if="e.may.value.publish"
        role="group"
        :aria-label="$t('posts.when.mode')"
        class="inline-flex self-start rounded-[0.625rem] border border-(--app-border) bg-(--app-groove) p-[3px]"
      >
        <button
          type="button"
          aria-pressed="false"
          aria-disabled="true"
          class="flex min-h-11 cursor-not-allowed items-center gap-2 rounded-[0.4375rem] px-3.5 text-sm text-(--app-text-muted) md:min-h-9"
          :aria-label="`${$t('posts.when.now')} (${$t('client.soon')})`"
        >
          <UIcon name="i-lucide-send" class="size-4" aria-hidden="true" />
          {{ $t('posts.when.now') }}
          <span class="text-xs" aria-hidden="true">{{ $t('client.soon') }}</span>
        </button>
        <button
          type="button"
          aria-pressed="true"
          class="flex min-h-11 items-center gap-2 rounded-[0.4375rem] bg-(--app-card) px-3.5 text-sm font-semibold shadow-[0_1px_2px_rgb(36_35_33/0.15)] md:min-h-9"
        >
          <UIcon name="i-lucide-calendar-clock" class="size-4" aria-hidden="true" />
          {{ $t('posts.when.at') }}
        </button>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="$t('posts.when.day')" name="post-day">
          <UInput
            v-model="date"
            type="date"
            :disabled="!e.editable.value"
            class="min-w-48"
            :ui="{ base: 'min-h-control' }"
          />
        </UFormField>
        <UFormField :label="$t('posts.when.time')" name="post-time">
          <UInput
            v-model="time"
            type="time"
            step="60"
            :disabled="!e.editable.value"
            class="w-32"
            :ui="{ base: 'min-h-control' }"
          />
        </UFormField>
        <p
          v-if="zone"
          class="flex min-h-control items-center gap-1.5 text-sm text-(--app-text-muted)"
        >
          <UIcon name="i-lucide-globe" class="size-4" aria-hidden="true" />
          {{ zone }}
        </p>
      </div>
      <p
        v-if="sentence"
        class="flex items-start gap-2 text-sm text-(--app-text-muted)"
        data-when-sentence
      >
        <UIcon name="i-lucide-calendar" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {{ sentence }}
          <template v-if="isDefault">
            {{ $t('posts.when.default', { time: client.defaultPostTime, client: client.name }) }}
          </template>
        </span>
      </p>
    </div>
  </PostEditorRow>
</template>
