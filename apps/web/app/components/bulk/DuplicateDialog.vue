<script setup lang="ts">
import type { BulkImportResponse } from '@app/contracts'
import { addDays } from '~/utils/day-time'

/**
 * «Duplica» (spec §11.6, Scelta 9): a post of the client copied on up to 31 days, at the time of
 * each; the copies are drafts, or scheduled with «Duplica e programma» when they pass the checks
 * (from Publisher). The outcome is the summary of «In blocco», with «Annulla» for 10 seconds.
 */
const props = defineProps<{
  client: WorkspaceView
  postId: string
  /** the post's own time, for the first date; «18:00» without one */
  time: string | null
  /** the client's address, for the copies and the calendar */
  clientPath: string
}>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const org = useOrganization()
const { call, failure } = useApi()
const base = computed(() => org.api(`/workspaces/${encodeURIComponent(props.client.id)}`))

const MAX = 31
const mayPublish = computed(() =>
  ['owner', 'admin', 'manager', 'publisher'].includes(props.client.myRole),
)
const today = computed(() =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: org.organization.value?.timezone ?? 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
)
const dates = ref<{ localDate: string; localTime: string }[]>([])
const result = ref<BulkImportResponse | null>(null)
const busy = ref<'drafts' | 'schedule' | 'undo' | null>(null)
const problem = ref<string | null>(null)
const undoProblem = ref<string | null>(null)
watch(
  open,
  (now) => {
    if (!now) return
    dates.value = [{ localDate: addDays(today.value, 1), localTime: props.time ?? '18:00' }]
    result.value = null
    problem.value = null
    undoProblem.value = null
  },
  { immediate: true },
)
function addDate() {
  const last = dates.value.at(-1)
  if (dates.value.length >= MAX) return
  dates.value.push({
    localDate: addDays(last?.localDate ?? today.value, 1),
    localTime: last?.localTime ?? props.time ?? '18:00',
  })
}
const twice = computed(
  () =>
    new Set(dates.value.map((d) => `${d.localDate} ${d.localTime}`)).size !== dates.value.length,
)

async function duplicate(schedule: boolean) {
  if (twice.value || dates.value.length === 0 || busy.value) return
  busy.value = schedule ? 'schedule' : 'drafts'
  problem.value = null
  try {
    result.value = await call<BulkImportResponse>(
      'POST',
      `${base.value}/posts/${encodeURIComponent(props.postId)}/duplicate`,
      { dates: dates.value, schedule },
    )
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    busy.value = null
  }
}
async function undo() {
  const current = result.value
  if (!current || busy.value) return
  busy.value = 'undo'
  undoProblem.value = null
  try {
    result.value = await call<BulkImportResponse>(
      'POST',
      `${base.value}/bulk-imports/${encodeURIComponent(current.id)}/undo`,
    )
  } catch (e) {
    undoProblem.value = failure(e).message
  } finally {
    busy.value = null
  }
}
const dayName = (d: { localDate: string; localTime: string }) => {
  const [y, m, day] = d.localDate.split('-').map(Number)
  const name = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, day ?? 1)))
  return `${name}, ${d.localTime}`
}
const names = computed(() => dates.value.map(dayName))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('bulk.duplicate.title')"
    :description="result ? undefined : $t('bulk.duplicate.text')"
    :ui="{ content: 'max-w-[36rem]' }"
  >
    <template #body>
      <BulkSummary
        v-if="result"
        :result="result"
        :names="names"
        :client-path="clientPath"
        :undoing="busy === 'undo'"
        :undo-problem="undoProblem"
        compact
        @undo="undo"
        @again="result = null"
      />
      <fieldset v-else class="space-y-2" data-duplicate-dates>
        <legend class="mb-2 font-medium">{{ $t('bulk.duplicate.dates') }}</legend>
        <div v-for="(d, i) in dates" :key="i" class="flex items-center gap-2">
          <DayField
            v-model="d.localDate"
            :label="$t('bulk.duplicate.day', { n: i + 1 })"
            :today="today"
            class="min-w-0 flex-1"
          />
          <TimeField
            v-model="d.localTime"
            :label="$t('bulk.duplicate.time', { n: i + 1 })"
            class="w-28"
          />
          <UButton
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-x"
            :disabled="dates.length === 1"
            :aria-label="$t('bulk.duplicate.remove', { n: i + 1 })"
            @click="dates.splice(i, 1)"
          />
        </div>
        <div class="flex flex-wrap items-center gap-3 pt-1">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-plus"
            :disabled="dates.length >= MAX"
            data-duplicate-add
            @click="addDate"
          >
            {{ $t('bulk.duplicate.add') }}
          </UButton>
          <span v-if="dates.length >= MAX" class="text-detail text-(--app-text-muted)">{{
            $t('bulk.duplicate.max')
          }}</span>
          <span v-if="twice" class="text-detail text-(--app-warning)" role="alert">{{
            $t('bulk.duplicate.twice')
          }}</span>
        </div>
        <p v-if="problem" role="alert" class="text-(--app-danger)">
          {{ $t('bulk.duplicate.failed', { message: problem }) }}
        </p>
      </fieldset>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="open = false">
          {{ $t('bulk.duplicate.cancel') }}
        </UButton>
        <template v-if="!result">
          <UButton
            :color="mayPublish ? 'neutral' : 'primary'"
            :variant="mayPublish ? 'outline' : 'solid'"
            :loading="busy === 'drafts'"
            :disabled="twice"
            data-duplicate-drafts
            @click="duplicate(false)"
          >
            {{ $t('bulk.duplicate.asDrafts') }} · {{ $t('bulk.duplicate.count', dates.length) }}
          </UButton>
          <UButton
            v-if="mayPublish"
            :loading="busy === 'schedule'"
            :disabled="twice"
            data-duplicate-schedule
            @click="duplicate(true)"
          >
            {{ $t('bulk.duplicate.andSchedule') }}
          </UButton>
        </template>
      </div>
    </template>
  </UModal>
</template>
