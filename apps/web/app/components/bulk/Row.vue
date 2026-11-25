<script setup lang="ts">
import type { BulkTable } from '~/composables/useBulkTable'
import { typeOptions, type PostType } from '~/utils/post-editor'
import type { BulkTableRow, BulkTarget } from '~/utils/bulk-table'

/**
 * One row of «In blocco» (§11.6): the file, its type, the text, the account (one, or a saved
 * group), the day and the time. Wide, a row of the table; narrow (a phone, a small window), the
 * same fields one under the other, so nothing is cut (container query, DESIGN.md).
 */
const props = defineProps<{
  table: BulkTable
  row: BulkTableRow
  index: number
  /** «oggi» in the agency's zone, for the day field */
  today: string
  /** the items of the account menu, shared by every row */
  targets: { label: string; value: string; disabled?: boolean; type?: 'label' }[]
}>()
const { t } = useI18n()
const n = computed(() => props.index + 1)
const tb = props.table

const problem = computed(() => tb.problems.value.get(props.row.key) ?? null)
const thumb = computed(() => {
  const first = props.row.files[0]
  const item = first ? tb.itemOf(first.key) : null
  return item?.preview ?? null
})
// the bar of the files still on their way: sent, then prepared by the worker
const { showsBar, barPercent, line } = useUploadLine()
const items = computed(() => props.row.files.map((f) => tb.itemOf(f.key)).filter((i) => i !== null))
const moving = computed(() => items.value.filter((i) => showsBar(i)))
const bar = computed(() =>
  moving.value.length === 0
    ? null
    : Math.round(moving.value.reduce((s, i) => s + barPercent(i), 0) / moving.value.length),
)
const types = computed(() =>
  typeOptions(props.row.files).map((o) => ({
    label: t(`posts.type.${o.type}`),
    value: o.type,
    disabled: !o.enabled,
  })),
)
const type = computed({
  get: () => props.row.type ?? undefined,
  set: (v: PostType | undefined) => {
    if (v) tb.change(props.row.key, { type: v, typeChosen: true })
  },
})
const caption = computed({
  get: () => props.row.caption,
  set: (v: string) => tb.change(props.row.key, { caption: v }),
})
const encode = (target: BulkTarget) =>
  target === null
    ? undefined
    : target.kind === 'accounts'
      ? `accounts:${target.ids.join(',')}`
      : `${target.kind}:${target.id}`
const target = computed({
  get: () => encode(props.row.target),
  set: (v: string | undefined) => {
    if (!v) return
    const [kind, id] = v.split(':')
    if ((kind === 'account' || kind === 'group') && id)
      tb.change(props.row.key, { target: { kind, id } })
  },
})
// the accounts a sheet named (Task 11) are one more choice of the menu, until another is chosen
const rowTargets = computed(() => {
  const t0 = props.row.target
  if (t0?.kind !== 'accounts') return props.targets
  return [
    {
      label: t('bulk.target.several', { n: t0.ids.length }, t0.ids.length),
      value: encode(t0) ?? '',
    },
    ...props.targets,
  ]
})
const platformTexts = computed(() =>
  [
    props.row.captionInstagram ? t('posts.destinations.kind.instagram') : null,
    props.row.captionFacebook ? t('posts.destinations.kind.facebook') : null,
  ].filter((x): x is string => x !== null),
)
const day = computed({
  get: () => props.row.when?.localDate ?? '',
  set: (v: string) => {
    if (!v) return
    tb.change(props.row.key, {
      when: { localDate: v, localTime: props.row.when?.localTime ?? '12:00' },
    })
  },
})
const time = computed({
  get: () => props.row.when?.localTime ?? '',
  set: (v: string) => {
    if (!v) return
    tb.change(props.row.key, {
      when: { localDate: props.row.when?.localDate ?? props.today, localTime: v.slice(0, 5) },
    })
  },
})
const name = computed(() =>
  props.row.files.length > 1
    ? t('bulk.row.files', { n: props.row.files.length })
    : (props.row.files[0]?.name ?? ''),
)
const menu = computed(() => [
  ...(props.row.files.length > 1
    ? [
        {
          label: t('bulk.row.split'),
          icon: 'i-lucide-ungroup',
          onSelect: () => tb.split(props.row.key),
        },
      ]
    : []),
  // the day back to none: the row stays a draft («Senza data»)
  ...(props.row.when
    ? [
        {
          label: t('bulk.row.clearWhen'),
          icon: 'i-lucide-calendar-x',
          onSelect: () => tb.change(props.row.key, { when: null }),
        },
      ]
    : []),
  {
    label: t('bulk.row.remove', { n: n.value }),
    icon: 'i-lucide-trash-2',
    onSelect: () => tb.removeRow(props.row.key),
  },
])
</script>

<template>
  <li
    class="@container border-b border-(--app-border) last:border-b-0"
    :aria-label="$t('bulk.row.label', { n })"
    :data-bulk-row="index"
    :data-problem="problem ?? undefined"
  >
    <!-- narrow: picture, name and menu on the first line, then each field on its own; wide: one
         line of eight columns, as the head says -->
    <div
      class="grid grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 @min-[60rem]:grid-cols-[1.5rem_3.5rem_7.5rem_minmax(0,1fr)_12rem_12.5rem_6.5rem_2.25rem] @min-[60rem]:items-center"
      :class="row.selected ? 'bg-(--app-nav-hover)' : ''"
    >
      <UCheckbox
        :model-value="row.selected"
        :aria-label="$t('bulk.row.choose', { n })"
        class="self-center"
        data-bulk-choose
        @update:model-value="tb.change(row.key, { selected: $event === true })"
      />
      <span
        class="relative flex size-14 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted)"
      >
        <video
          v-if="thumb?.kind === 'video'"
          :src="thumb.url"
          muted
          playsinline
          preload="metadata"
          class="size-full object-cover"
          aria-hidden="true"
        />
        <img v-else-if="thumb" :src="thumb.url" alt="" class="size-full object-cover" />
        <PostTypeIcon v-else-if="row.type" :type="row.type" named class="text-[18px]" />
        <span
          v-if="bar !== null"
          class="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/30"
          role="progressbar"
          :aria-valuenow="bar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuetext="moving[0] ? line(moving[0]) : undefined"
          :aria-label="name"
          data-bulk-bar
        >
          <span class="block h-full bg-white" :style="{ width: `${bar}%` }" />
        </span>
        <span
          v-else-if="row.files.length > 1"
          class="absolute right-1 bottom-1 rounded-sm bg-(--app-media-badge) px-1 text-[11px] leading-4 font-semibold text-white tabular-nums"
          aria-hidden="true"
          >{{ row.files.length }}</span
        >
      </span>

      <span class="col-3 row-1 min-w-0 self-center @min-[60rem]:hidden">
        <span class="block truncate font-medium" :title="name">{{ name }}</span>
        <span
          v-if="problem"
          class="block text-detail"
          :class="problem === 'sending' ? 'text-(--app-text-muted)' : 'text-(--app-warning)'"
          >{{ $t(`bulk.problem.${problem}`) }}</span
        >
      </span>

      <USelect
        v-model="type"
        :items="types"
        :aria-label="$t('bulk.row.type', { n })"
        class="col-[2/-1] row-3 w-full @min-[60rem]:col-auto @min-[60rem]:row-auto"
        data-bulk-type
      />

      <div class="col-[2/-1] row-2 min-w-0 @min-[60rem]:col-auto @min-[60rem]:row-auto">
        <textarea
          v-model="caption"
          rows="1"
          :aria-label="$t('bulk.row.caption', { n })"
          :placeholder="$t('bulk.row.captionPlaceholder')"
          class="block max-h-40 min-h-control w-full resize-none rounded-control border border-(--app-field-border) bg-(--app-surface) [field-sizing:content] px-3 py-1.5 leading-5 outline-none placeholder:text-(--app-text-muted) focus-visible:border-(--app-focus) max-md:text-base"
          data-bulk-caption
        />
        <p
          v-if="platformTexts.length > 0"
          class="mt-1 text-detail text-(--app-text-muted)"
          data-bulk-platform-texts
        >
          {{ $t('bulk.row.platformTexts', { list: platformTexts.join(', ') }) }}
        </p>
        <p
          v-if="problem"
          class="mt-1 hidden truncate text-detail @min-[60rem]:block"
          :class="problem === 'sending' ? 'text-(--app-text-muted)' : 'text-(--app-warning)'"
          data-bulk-problem
        >
          {{ name }} · {{ $t(`bulk.problem.${problem}`) }}
        </p>
      </div>

      <USelect
        v-model="target"
        :items="rowTargets"
        :placeholder="$t('bulk.row.accountPlaceholder')"
        :aria-label="$t('bulk.row.account', { n })"
        class="col-[2/-1] row-4 w-full @min-[60rem]:col-auto @min-[60rem]:row-auto"
        data-bulk-account
      />

      <div
        class="col-[2/-1] row-5 flex gap-2 @min-[60rem]:col-auto @min-[60rem]:row-auto @min-[60rem]:contents"
      >
        <DayField
          v-model="day"
          :label="$t('bulk.row.day', { n })"
          :today="today"
          class="min-w-0 flex-1"
          data-bulk-day
        />
        <TimeField
          v-model="time"
          :label="$t('bulk.row.time', { n })"
          :empty-label="$t('bulk.row.noTime')"
          class="w-28 min-w-0 @min-[60rem]:w-auto"
          data-bulk-time
        />
      </div>

      <UDropdownMenu
        :items="menu"
        :content="{ align: 'end' }"
        class="col-4 row-1 justify-self-end @min-[60rem]:col-auto @min-[60rem]:row-auto"
      >
        <UButton
          color="neutral"
          variant="ghost"
          square
          icon="i-lucide-ellipsis"
          :aria-label="$t('bulk.row.menu', { n })"
          class="pointer-coarse:size-11"
          data-bulk-menu
        />
      </UDropdownMenu>
    </div>
  </li>
</template>
