<script setup lang="ts">
import { useBulkTable } from '~/composables/useBulkTable'

/**
 * The page «In blocco» (§11.6): a row at the top like the editor's (back, the client, the title,
 * «Programma N post»), then the files to drop, the tools for the rows chosen and the table; after
 * «Programma», the summary in place of the table.
 */
const props = defineProps<{
  client: WorkspaceView
  profiles: WorkspaceProfile[]
  clientPath: string
  back: string
  max: number
}>()
const { t } = useI18n()
const org = useOrganization()

const settings = useContentSettings(computed(() => props.client.id))
const tb = useBulkTable({
  client: toRef(props, 'client'),
  profiles: toRef(props, 'profiles'),
  groups: settings.groups,
})

// ---- the files
const picker = ref<HTMLInputElement | null>(null)
function picked(event: Event) {
  const input = event.target as HTMLInputElement
  void tb.addFiles([...(input.files ?? [])])
  input.value = ''
}
const dragOver = ref(false)
function dropped(event: DragEvent) {
  dragOver.value = false
  void tb.addFiles([...(event.dataTransfer?.files ?? [])])
}
const readyCount = computed(
  () => tb.rows.value.flatMap((r) => r.files).filter((f) => f.state === 'ready').length,
)
const fileCount = computed(() => tb.rows.value.flatMap((r) => r.files).length)
const uploading = computed(() => readyCount.value < fileCount.value)

// ---- «oggi» in the agency's zone, for the day fields
const timeZone = computed(() => org.organization.value?.timezone ?? 'Europe/Rome')
const today = computed(() =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone.value,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
)

// ---- the account menu: the accounts, then the saved groups
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const targets = computed(() => {
  const items: { label: string; value: string; disabled?: boolean; type?: 'label' }[] = [
    { label: t('bulk.target.accounts'), value: '', type: 'label' },
    ...tb.accounts.value.map(({ a, off }) => ({
      label: `${handleOf(a)} · ${t(`posts.destinations.kind.${a.platform}`)}${off ? ` (${t('bulk.target.off')})` : ''}`,
      value: `account:${a.id}`,
      disabled: off,
    })),
  ]
  const groups = settings.groups.value ?? []
  if (groups.length > 0)
    items.push(
      { label: t('bulk.target.groups'), value: '', type: 'label' },
      ...groups.map((g) => ({
        label: t('bulk.target.group', {
          name: g.name,
          n: g.accountIds.length - g.unavailableAccountIds.length,
        }),
        value: `group:${g.id}`,
      })),
    )
  return items
})
// «Account per tutte»: the same menu, applied to the rows chosen, or to every row
const allTargetItems = computed(() => {
  const groups: { label: string; type?: 'label'; disabled?: boolean; onSelect?: () => void }[][] =
    []
  let current: (typeof groups)[number] = []
  for (const item of targets.value) {
    if (item.type === 'label') {
      if (current.length > 0) groups.push(current)
      current = [{ label: item.label, type: 'label' }]
      continue
    }
    const [kind, id] = item.value.split(':')
    current.push({
      label: item.label,
      disabled: item.disabled === true,
      onSelect: () => {
        if ((kind === 'account' || kind === 'group') && id) tb.targetAll({ kind, id })
      },
    })
  }
  if (current.length > 0) groups.push(current)
  return groups
})

// ---- «Programma»
const count = computed(() => tb.rows.value.length)
const blocker = computed(() => {
  const first = tb.firstProblem.value
  if (!first) return null
  if (first.problem === 'sending') return t('bulk.schedule.waitFiles')
  const n = tb.rows.value.findIndex((r) => r.key === first.key) + 1
  return t('bulk.schedule.fix', { n, problem: t(`bulk.problem.${first.problem}`) })
})
function schedule() {
  const first = tb.firstProblem.value
  if (first) {
    // the button off leads to what is missing (DESIGN.md): the row's first field
    document
      .querySelector<HTMLElement>(
        `[data-bulk-row="${String(tb.rows.value.findIndex((r) => r.key === first.key))}"] [data-bulk-account]`,
      )
      ?.focus()
    return
  }
  void tb.schedule()
}
const names = computed(() =>
  tb.rows.value.map((r) =>
    r.files.length > 1 ? t('bulk.row.files', { n: r.files.length }) : (r.files[0]?.name ?? ''),
  ),
)
const contentSettingsTo = computed(() => org.to(`${props.clientPath}/contenuti`))
</script>

<template>
  <div class="flex min-h-dvh min-w-0 flex-col" data-bulk-page>
    <header
      class="sticky top-0 z-30 flex h-14 min-w-0 items-center gap-3 border-b border-(--app-border) bg-(--app-surface) px-5 max-md:h-13 max-md:gap-1 max-md:ps-1 max-md:pe-2"
    >
      <UButton
        :to="back"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-arrow-left"
        class="shrink-0"
        :aria-label="$t('bulk.back', { name: client.name })"
      />
      <span class="flex min-w-0 shrink items-center gap-2 max-lg:hidden">
        <Avatar :name="client.name" :src="client.photoUrl" :size="22" />
        <span class="truncate text-(--app-text-muted)">{{ client.name }}</span>
      </span>
      <span class="h-5 w-px shrink-0 bg-(--app-border-strong) max-lg:hidden" aria-hidden="true" />
      <h1
        class="min-w-0 shrink truncate text-[0.9375rem] leading-5 tracking-[-0.01em] max-md:text-base"
      >
        {{ $t('bulk.title') }}
      </h1>
      <span
        v-if="!tb.result.value"
        class="text-detail text-(--app-text-muted) tabular-nums max-md:hidden"
      >
        {{ $t('bulk.count', count) }} · {{ $t('bulk.max', { n: max }) }}
      </span>
      <span class="flex-1" />
      <template v-if="!tb.result.value && count > 0">
        <span
          v-if="blocker"
          class="truncate text-detail text-(--app-text-muted) max-lg:hidden"
          data-bulk-blocker
          >{{ blocker }}</span
        >
        <UButton
          color="primary"
          :loading="tb.sending.value"
          :aria-disabled="blocker ? 'true' : undefined"
          :class="blocker ? 'opacity-50' : ''"
          data-bulk-schedule
          @click="schedule"
        >
          {{
            count === 1 ? $t('bulk.schedule.buttonOne') : $t('bulk.schedule.button', { n: count })
          }}
        </UButton>
      </template>
    </header>

    <div class="mx-auto w-full max-w-[75rem] space-y-4 px-gutter pt-6 pb-16 max-md:pt-4">
      <BulkSummary
        v-if="tb.result.value"
        :result="tb.result.value"
        :names="names"
        :client-path="clientPath"
        :undoing="tb.undoing.value"
        :undo-problem="tb.undoProblem.value"
        @undo="tb.undo"
        @again="tb.again"
      />

      <template v-else>
        <input
          ref="picker"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          data-bulk-input
          @change="picked"
        />

        <!-- no rows yet: the whole space takes the files -->
        <div
          v-if="count === 0"
          class="flex flex-col items-center justify-center gap-3 rounded-card border-[1.5px] border-dashed px-6 py-16 text-center"
          :class="
            dragOver
              ? 'border-(--app-text) bg-(--app-surface-sunken)'
              : 'border-(--app-border-strong) bg-(--app-surface)'
          "
          data-bulk-drop
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="dropped"
        >
          <UIcon name="i-lucide-images" class="size-7 text-(--app-text-muted)" aria-hidden="true" />
          <h2 class="text-[15px]/5 font-semibold">{{ $t('bulk.drop.title') }}</h2>
          <p class="max-w-prose text-(--app-text-muted)">{{ $t('bulk.drop.text') }}</p>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-upload"
            @click="picker?.click()"
          >
            {{ $t('bulk.drop.choose') }}
          </UButton>
        </div>

        <template v-else>
          <!-- the tools, for the rows chosen (or all) -->
          <div class="flex flex-wrap items-center gap-2" data-bulk-tools>
            <UCheckbox
              :model-value="
                tb.allChosen.value ? true : tb.chosen.value.length > 0 ? 'indeterminate' : false
              "
              :aria-label="$t('bulk.head.choose')"
              class="ms-4 me-1"
              data-bulk-choose-all
              @update:model-value="tb.chooseAll($event === true)"
            />
            <span class="text-detail text-(--app-text-muted) tabular-nums me-2" aria-live="polite">
              {{ $t('bulk.tools.chosen', tb.chosen.value.length) }}
            </span>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-gallery-horizontal"
              data-bulk-merge
              @click="tb.merge"
            >
              {{ $t('bulk.tools.merge') }}
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-calendar-clock"
              :loading="tb.slotState.value === 'asking'"
              data-bulk-distribute
              @click="tb.distribute"
            >
              {{
                tb.chosen.value.length > 0
                  ? $t('bulk.tools.distributeChosen')
                  : $t('bulk.tools.distribute')
              }}
            </UButton>
            <UDropdownMenu :items="allTargetItems" :content="{ align: 'start' }">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-at-sign"
                trailing-icon="i-lucide-chevron-down"
                data-bulk-account-all
              >
                {{ tb.chosen.value.length > 0 ? $t('bulk.target.chosen') : $t('bulk.target.all') }}
              </UButton>
            </UDropdownMenu>
            <span class="flex-1" />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              :disabled="tb.room.value === 0"
              data-bulk-more
              @click="picker?.click()"
            >
              {{ $t('bulk.drop.more') }}
            </UButton>
          </div>

          <div class="space-y-1 text-detail" aria-live="polite">
            <p v-if="tb.mergeRefused.value" class="text-(--app-warning)" data-bulk-merge-refused>
              {{
                tb.mergeRefused.value === 'many'
                  ? $t('bulk.tools.mergeMany')
                  : $t('bulk.tools.mergeFew')
              }}
            </p>
            <p v-if="tb.slotState.value === 'none'" class="text-(--app-warning)" data-bulk-no-slots>
              {{ $t('bulk.tools.noSlots') }}
              <NuxtLink
                v-if="['owner', 'admin', 'manager'].includes(client.myRole)"
                :to="contentSettingsTo"
                class="underline"
                >{{ $t('bulk.tools.contentSettings') }}</NuxtLink
              >
            </p>
            <p v-if="tb.slotState.value === 'short'" class="text-(--app-warning)">
              {{ $t('bulk.tools.slotsShort', tb.slotsLeft.value) }}
            </p>
            <p v-if="tb.slotState.value === 'failed'" role="alert" class="text-(--app-danger)">
              {{ $t('bulk.tools.slotsFailed') }}
            </p>
            <p v-if="uploading" class="text-(--app-text-muted) tabular-nums" data-bulk-uploads>
              {{ $t('bulk.upload.overall', { done: readyCount, n: fileCount }) }}
            </p>
            <p v-if="tb.leftOut.value > 0" class="text-(--app-warning)">
              {{ $t('bulk.upload.leftOut', tb.leftOut.value) }}
            </p>
            <p v-for="item in tb.refused.value" :key="item.key" class="text-(--app-danger)">
              {{ $t('bulk.upload.refused', { name: item.name, reason: item.message ?? '' }) }}
            </p>
            <p v-if="tb.undated.value > 0" class="text-(--app-text-muted)" data-bulk-undated>
              {{ $t('bulk.schedule.undated', tb.undated.value) }}
            </p>
            <p v-if="tb.sendProblem.value" role="alert" class="text-(--app-danger)">
              {{ $t('bulk.schedule.failed', { message: tb.sendProblem.value }) }}
            </p>
          </div>

          <div
            class="@container rounded-card border border-(--app-border) bg-(--app-surface)"
            :class="dragOver ? 'outline-2 outline-dashed outline-(--app-text)' : ''"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="dropped"
          >
            <div
              class="hidden min-h-9 grid-cols-[1.5rem_3.5rem_7.5rem_minmax(0,1fr)_12rem_12.5rem_6.5rem_2.25rem] items-center gap-x-3 border-b border-(--app-border) px-4 text-caption font-medium text-(--app-text-muted) @min-[60rem]:grid"
              aria-hidden="true"
            >
              <span />
              <span>{{ $t('bulk.head.file') }}</span>
              <span>{{ $t('bulk.head.type') }}</span>
              <span>{{ $t('bulk.head.caption') }}</span>
              <span>{{ $t('bulk.head.account') }}</span>
              <span>{{ $t('bulk.head.day') }}</span>
              <span>{{ $t('bulk.head.time') }}</span>
              <span />
            </div>
            <ol :aria-label="$t('bulk.title')">
              <BulkRow
                v-for="(row, i) in tb.rows.value"
                :key="row.key"
                :table="tb"
                :row="row"
                :index="i"
                :today="today"
                :targets="targets"
              />
            </ol>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
