<script setup lang="ts">
import type { BulkImportResponse } from '@app/contracts'

/**
 * The summary of «In blocco» (§11.6, P5): while the server makes the posts, how many are done;
 * then «18 programmati, 2 da sistemare» with each row's outcome and «Annulla» for the seconds the
 * server still allows. After «Annulla», what was taken off and what was kept because someone
 * changed it, and the table back for another «Programma».
 */
const props = defineProps<{
  result: BulkImportResponse
  /** the name of each row, as the table had it */
  names: string[]
  /** the client's address, for the posts and the calendar */
  clientPath: string
  undoing: boolean
  undoProblem: string | null
  /** in a dialog («Duplica»): no link to the calendar, the dialog closes */
  compact?: boolean
}>()
const emit = defineEmits<{ undo: []; again: [] }>()
const { t } = useI18n()
const org = useOrganization()

const running = computed(
  () => props.result.status === 'pending' || props.result.status === 'running',
)
const undone = computed(() => props.result.status === 'undone')

// the seconds «Annulla» stays: the server's time, counted here
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tick = setInterval(() => (now.value = Date.now()), 250)
})
onBeforeUnmount(() => clearInterval(tick))
const secondsLeft = computed(() => {
  const until = props.result.undoUntil ? Date.parse(props.result.undoUntil) : 0
  return Math.max(0, Math.ceil((until - now.value) / 1000))
})

const s = computed(() => props.result.summary)
const line = computed(() =>
  s.value.drafts > 0
    ? t('bulk.summary.line', { scheduled: s.value.scheduled, drafts: s.value.drafts })
    : t('bulk.summary.lineAll', { scheduled: s.value.scheduled }),
)
const postLink = (postId: string) =>
  org.to(`${props.clientPath}/post/${encodeURIComponent(postId)}`)

type Outcome = BulkImportResponse['rows'][number]
function what(o: Outcome): { text: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!o) return { text: '', tone: 'muted' }
  if (o.status === 'failed') {
    const key = ['not_found', 'forbidden'].includes(o.code) ? o.code : 'other'
    return { text: t(`bulk.summary.failed.${key}`, { code: o.code }), tone: 'danger' }
  }
  if (o.undo === 'removed') return { text: t('bulk.summary.removed'), tone: 'muted' }
  if (o.undo === 'kept') return { text: t('bulk.summary.keptRow'), tone: 'muted' }
  if (o.status === 'scheduled') return { text: t('bulk.summary.scheduled'), tone: 'success' }
  if (o.reason === 'blocked') {
    const code = o.codes[0]
    return {
      text: code
        ? t('bulk.summary.reason.blocked', { what: t(`rules.${code}.title`) })
        : t('bulk.summary.reason.blockedNoCode'),
      tone: 'warning',
    }
  }
  return { text: t(`bulk.summary.reason.${o.reason}`), tone: 'warning' }
}
const TONE = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'neutral',
} as const
</script>

<template>
  <section class="space-y-4" aria-live="polite" data-bulk-summary :data-status="result.status">
    <div v-if="running" class="rounded-card border border-(--app-border) bg-(--app-surface) p-5">
      <h2 class="text-[15px]/5 font-semibold">{{ $t('bulk.progress.title') }}</h2>
      <p class="mt-1 text-(--app-text-muted) tabular-nums" data-bulk-progress>
        {{ $t('bulk.progress.line', { done: result.done, total: result.total }) }}
      </p>
      <div
        class="mt-3 h-1.5 overflow-hidden rounded-full bg-(--app-surface-sunken)"
        role="progressbar"
        :aria-valuenow="result.done"
        aria-valuemin="0"
        :aria-valuemax="result.total"
        :aria-label="$t('bulk.progress.title')"
      >
        <div
          class="h-full bg-(--app-text) transition-[width] duration-300 motion-reduce:transition-none"
          :style="{ width: `${result.total ? (result.done / result.total) * 100 : 0}%` }"
        />
      </div>
      <p class="mt-3 max-w-prose text-detail text-(--app-text-muted)">
        {{ $t('bulk.progress.text') }}
      </p>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0">
          <h2 class="text-[15px]/5 font-semibold">
            {{ undone ? $t('bulk.summary.titleUndone') : $t('bulk.summary.title') }}
          </h2>
          <p class="text-(--app-text-muted)" data-bulk-line>
            <template v-if="undone">
              {{ $t('bulk.summary.undoneLine', { removed: s.removed }, s.removed) }}
              <template v-if="s.kept > 0"> {{ $t('bulk.summary.kept', s.kept) }}</template>
            </template>
            <template v-else>
              {{ line
              }}<template v-if="s.failed > 0"
                >, {{ $t('bulk.summary.failedLine', s.failed) }}</template
              >
            </template>
          </p>
        </div>
        <span class="flex-1" />
        <UButton
          v-if="!undone && secondsLeft > 0"
          color="neutral"
          variant="outline"
          icon="i-lucide-undo-2"
          :loading="undoing"
          data-bulk-undo
          @click="emit('undo')"
        >
          {{
            undoing ? $t('bulk.summary.undoing') : $t('bulk.summary.undoFor', { s: secondsLeft })
          }}
        </UButton>
        <UButton
          v-if="undone"
          color="neutral"
          variant="outline"
          data-bulk-again
          @click="emit('again')"
        >
          {{ $t('bulk.summary.again') }}
        </UButton>
        <UButton
          v-if="!compact"
          color="neutral"
          variant="outline"
          :to="org.to(`${clientPath}/calendario`)"
        >
          {{ $t('bulk.summary.calendar') }}
        </UButton>
      </div>
      <p v-if="undoProblem" role="alert" class="text-(--app-danger)">
        {{ $t('bulk.summary.undoFailed', { message: undoProblem }) }}
      </p>

      <ol class="rounded-card border border-(--app-border) bg-(--app-surface)">
        <li
          v-for="(o, i) in result.rows"
          :key="i"
          class="flex min-h-row items-center gap-3 border-b border-(--app-border) px-4 py-2 last:border-b-0"
          :data-bulk-outcome="o?.status ?? 'todo'"
        >
          <span class="w-6 shrink-0 text-(--app-text-muted) tabular-nums">{{ i + 1 }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ names[i] ?? '' }}</span>
            <span class="flex items-center gap-1.5 text-detail">
              <StatusDot :tone="TONE[what(o).tone]" :label="what(o).text" />
            </span>
          </span>
          <UButton
            v-if="o && o.status !== 'failed' && o.undo !== 'removed'"
            color="neutral"
            variant="outline"
            size="sm"
            :to="postLink(o.postId)"
          >
            {{
              o.status === 'draft' && o.reason !== 'asked'
                ? $t('bulk.summary.fix')
                : $t('bulk.summary.open')
            }}
          </UButton>
        </li>
      </ol>
    </template>
  </section>
</template>
