<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Quando» (§11.2 point 6, P1; screens 08 and 09): «Programma» · «Pubblica subito», then the day
 * and the time in the post's zone, in the panel's own fields (never the browser's). Rome, the
 * default, is not said (Matteo 18/11); another zone set in the agency's settings is said next to
 * the time, so nobody reads it as Rome (D-58). The client's usual time is already written, and
 * said («Orario abituale di Forno Luce») while it stays. «Pubblica subito» (plan 07 Scelta 2) is
 * for who can schedule, on a draft: the day and the time step aside (they stay for «Programma»)
 * and the button at the top becomes «Pubblica su N account», which asks first (screen 11).
 */
const props = defineProps<{ editor: PostEditor; client: WorkspaceView }>()
const MODES = [
  { mode: 'at', icon: 'i-lucide-calendar-days', label: 'posts.when.at' },
  { mode: 'now', icon: 'i-lucide-send', label: 'posts.when.now' },
] as const
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

const isDefault = computed(
  () => props.client.defaultPostTime && e.when.value?.localTime === props.client.defaultPostTime,
)
/** «oggi» in the post's zone, for the month the day field opens on */
const today = computed(() => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: e.timeZone.value,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
})
</script>

<template>
  <PostEditorRow heading="post-when" :label="$t('posts.when.title')">
    <div class="grid gap-2.5">
      <div
        v-if="e.may.value.publish && e.status.value === 'draft'"
        role="group"
        :aria-label="$t('posts.when.mode')"
        class="inline-flex gap-0.5 self-start justify-self-start rounded-control border border-(--app-border) bg-(--app-surface-sunken) p-[3px]"
      >
        <button
          v-for="m in MODES"
          :key="m.mode"
          type="button"
          :aria-pressed="e.mode.value === m.mode"
          :disabled="!e.editable.value"
          class="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 max-md:h-9"
          :class="
            e.mode.value === m.mode
              ? 'bg-(--app-surface) font-semibold shadow-[var(--app-shadow-1),0_0_0_1px_var(--app-border)]'
              : 'font-medium text-(--app-text-muted) hover:text-(--app-text) disabled:hover:text-(--app-text-muted)'
          "
          :data-when-mode="m.mode"
          @click="e.setMode(m.mode)"
        >
          <UIcon :name="m.icon" class="size-4" aria-hidden="true" />
          {{ $t(m.label) }}
        </button>
      </div>
      <p
        v-if="e.mode.value === 'now'"
        class="flex items-center gap-1.5 text-detail text-(--app-text-muted)"
        data-when-now
      >
        <UIcon name="i-lucide-info" class="size-4 shrink-0" aria-hidden="true" />
        {{ $t('posts.when.nowHint') }}
      </p>
      <div v-else class="flex flex-wrap items-center gap-2.5" data-when>
        <DayField
          v-model="date"
          :label="$t('posts.when.day')"
          :today="today"
          :disabled="!e.editable.value"
        />
        <TimeField v-model="time" :label="$t('posts.when.time')" :disabled="!e.editable.value" />
        <p
          v-if="zone"
          class="flex items-center gap-1.5 text-detail text-(--app-text-muted)"
          data-when-zone
        >
          <UIcon name="i-lucide-globe" class="size-4" aria-hidden="true" />
          {{ zone }}
        </p>
        <p
          v-if="isDefault"
          class="text-detail text-(--app-text-muted) max-md:hidden"
          data-when-usual
        >
          {{ $t('posts.when.usual', { client: client.name }) }}
        </p>
      </div>
    </div>
  </PostEditorRow>
</template>
