<script setup lang="ts">
import type { CalendarFilters } from '@app/domain'

/**
 * The calendar's filters (spec §11.4, plan 09 Task 3): «Filtri» opens a window on a computer and
 * a sheet on a phone, with a group of ticks for each filter. Every tick applies at once and goes
 * into the address; the groups combine (a client and a state: that client's posts in that state).
 * Clients only in «Tutti i clienti»; profiles, authors and labels only inside a client, where they
 * are few and named.
 */
export interface FilterOption {
  id: string
  label: string
  icon?: string
}
const props = defineProps<{
  filters: CalendarFilters
  clients: FilterOption[]
  accounts: FilterOption[]
  authors: FilterOption[]
  labels: (FilterOption & { color: LabelColorName })[]
  count: number
}>()
const emit = defineEmits<{ change: [change: Partial<CalendarFilters>]; clear: [] }>()
const { t } = useI18n()
const open = ref(false)

type ListKey =
  'workspaceIds' | 'accountIds' | 'platforms' | 'types' | 'statuses' | 'authorIds' | 'labelIds'
const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: 'i-lucide-instagram' },
  { id: 'facebook', label: 'Facebook', icon: 'i-lucide-facebook' },
]
const TYPES = ['photo', 'carousel', 'reel', 'story'] as const
const STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partial',
  'failed',
  'problem',
  'paused',
  'cancelled',
] as const

const groups = computed(() =>
  [
    { key: 'workspaceIds' as const, title: t('calendar.filters.clients'), options: props.clients },
    { key: 'accountIds' as const, title: t('calendar.filters.accounts'), options: props.accounts },
    { key: 'platforms' as const, title: t('calendar.filters.platforms'), options: PLATFORMS },
    {
      key: 'types' as const,
      title: t('calendar.filters.types'),
      options: TYPES.map((id) => ({ id, label: t(`posts.type.${id}`) })),
    },
    {
      key: 'statuses' as const,
      title: t('calendar.filters.statuses'),
      options: STATUSES.map((id) => ({ id, label: t(`calendar.status.${id}`) })),
    },
    { key: 'authorIds' as const, title: t('calendar.filters.authors'), options: props.authors },
    { key: 'labelIds' as const, title: t('calendar.filters.labels'), options: props.labels },
  ].filter((g) => g.options.length > 0),
)
const has = (key: ListKey, id: string) => (props.filters[key] as readonly string[]).includes(id)
function toggle(key: ListKey, id: string, on: boolean) {
  const now = props.filters[key] as readonly string[]
  emit('change', { [key]: on ? [...now, id] : now.filter((v) => v !== id) })
}
const colorOf = (key: ListKey, id: string) =>
  key === 'labelIds' ? (props.labels.find((l) => l.id === id)?.color ?? null) : null
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('calendar.filters.title')"
    :description="$t('calendar.filters.title')"
    :ui="{
      ...DIALOG_UI,
      body: 'max-h-[65vh] overflow-y-auto px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
    }"
    data-calendar-filters
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-sliders-horizontal"
      :aria-label="
        count > 0
          ? $t('calendar.filters.buttonOn', { n: count }, count)
          : $t('calendar.filters.title')
      "
      data-filters-open
    >
      {{ $t('calendar.filters.title') }}
      <span
        v-if="count > 0"
        class="ms-0.5 h-5 min-w-5 rounded-full bg-(--app-text) px-1.5 text-center text-caption leading-5 font-semibold text-(--app-bg) tabular-nums"
        aria-hidden="true"
        >{{ count }}</span
      >
    </UButton>
    <template #body>
      <div class="grid gap-5">
        <slot />
        <fieldset v-for="g in groups" :key="g.key" class="grid min-w-0 gap-1" :data-filter="g.key">
          <legend class="mb-1.5 font-medium">{{ g.title }}</legend>
          <div class="flex flex-wrap gap-x-5 gap-y-1">
            <label
              v-for="o in g.options"
              :key="o.id"
              class="flex min-h-9 min-w-0 cursor-pointer items-center gap-2.5 max-md:min-h-11"
            >
              <UCheckbox
                :model-value="has(g.key, o.id)"
                @update:model-value="(v) => toggle(g.key, o.id, v === true)"
              />
              <UIcon
                v-if="o.icon"
                :name="o.icon"
                class="size-4 shrink-0 text-(--app-text-muted)"
                aria-hidden="true"
              />
              <ContentLabelDot v-if="colorOf(g.key, o.id)" :color="colorOf(g.key, o.id)!" />
              <span class="min-w-0 truncate">{{ o.label }}</span>
            </label>
          </div>
        </fieldset>
      </div>
    </template>
    <template #footer>
      <UButton
        v-if="count > 0"
        class="me-auto max-md:flex-1 max-md:justify-center"
        color="neutral"
        variant="ghost"
        data-filters-clear
        @click="emit('clear')"
      >
        {{ $t('calendar.filters.clear') }}
      </UButton>
      <UButton
        class="max-md:flex-1 max-md:justify-center"
        color="neutral"
        variant="outline"
        @click="open = false"
      >
        {{ $t('calendar.filters.done') }}
      </UButton>
    </template>
  </UModal>
</template>
