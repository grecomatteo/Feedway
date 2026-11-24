<script setup lang="ts">
import type { ExternalWatchOutcome, PlatformMonitoring, WorkerBeat } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

/**
 * Piattaforma → Integrazioni, plan 08 Task 9: the worker's beats and the external watch.
 * Each instance of the worker with its colour (green beating, amber late, red silent) and the
 * address of healthchecks.io, which goes in and never comes back: the group says when it was
 * saved and how the last call went. «Prova» calls it now.
 */
const props = defineProps<{
  withReauth: <T>(fn: () => Promise<T>) => Promise<T>
}>()

const API = '/api/v1/platform/monitoring'
const WATCH_API = '/api/v1/platform/external-watch'
/** The page follows the beats without a reload: as often as the worker beats. */
const REFRESH_MS = 30_000

const { t } = useI18n()
const { call, failure } = useApi()

const { data, status, error, refresh } = useFetch<PlatformMonitoring>(API, {
  key: 'platform-monitoring',
  server: false,
  lazy: true,
})

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, REFRESH_MS)
})
onBeforeUnmount(() => clearInterval(timer))

const loading = computed(() => !data.value && !error.value && status.value !== 'error')

const HEALTH_TONE = { ok: 'success', late: 'warning', silent: 'danger' } as const
const workers = computed(() => data.value?.workers ?? [])
/** The whole worker: green when one instance beats, since one is enough to run the jobs. */
const workerState = computed(() => {
  const list = workers.value
  if (list.length === 0) return { tone: 'neutral' as const, label: t('workerStatus.none') }
  const best = list.some((w) => w.health === 'ok')
    ? 'ok'
    : list.some((w) => w.health === 'late')
      ? 'late'
      : 'silent'
  return { tone: HEALTH_TONE[best], label: t(`workerStatus.health.${best}`) }
})
const beatDetail = (w: WorkerBeat) => {
  const beat = t('workerStatus.lastBeat', {
    when: formatRelative(w.lastBeatAt, { sentence: true }),
  })
  return w.version ? `${beat} · ${t('workerStatus.version', { version: w.version })}` : beat
}

const external = computed(() => data.value?.external ?? null)
const watchState = computed(() => {
  const e = external.value
  if (!e) return { tone: 'neutral' as const, label: t('externalWatch.none') }
  if (!e.last) return { tone: 'info' as const, label: t('externalWatch.waiting') }
  return e.last.ok
    ? { tone: 'success' as const, label: t('externalWatch.active') }
    : { tone: 'danger' as const, label: t('externalWatch.failing') }
})
function outcomeText(o: ExternalWatchOutcome) {
  const when = formatRelative(o.at, { sentence: true })
  if (o.ok) return t('externalWatch.outcome.ok', { when })
  if (o.problem === 'status' && o.status !== null)
    return t('externalWatch.outcome.status', { when, status: o.status })
  return t(`externalWatch.outcome.${o.problem === 'timeout' ? 'timeout' : 'network'}`, { when })
}

const form = reactive({ open: false, url: '', sending: false, failure: null as ApiFailure | null })
const saved = ref<'saved' | 'removed' | null>(null)
const urlError = computed(() =>
  form.failure && (form.failure.field === 'url' || form.failure.status === 422)
    ? form.failure.message
    : undefined,
)
const formError = computed(() =>
  form.failure && urlError.value === undefined ? form.failure.message : null,
)
const showForm = computed(() => form.open || (data.value && !external.value))
const closeForm = () => Object.assign(form, { open: false, url: '', failure: null })

async function save() {
  Object.assign(form, { sending: true, failure: null })
  saved.value = null
  try {
    await props.withReauth(() => call('PUT', WATCH_API, { url: form.url }))
    closeForm()
    await refresh()
    saved.value = 'saved'
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) form.failure = failure(e)
  } finally {
    form.sending = false
  }
}

const test = reactive({ sending: false, problem: '' })
async function runTest() {
  Object.assign(test, { sending: true, problem: '' })
  saved.value = null
  try {
    const r = await call<{ configured: boolean; last: ExternalWatchOutcome | null }>(
      'POST',
      `${WATCH_API}/test`,
    )
    if (!r.configured) await refresh()
    // the fetched data is a shallow ref: a new object, so the page redraws
    else if (data.value?.external)
      data.value = { ...data.value, external: { ...data.value.external, last: r.last } }
  } catch (e) {
    test.problem = failure(e).message
  } finally {
    test.sending = false
  }
}

const removal = reactive({ open: false, sending: false, problem: '' })
async function remove() {
  Object.assign(removal, { sending: true, problem: '' })
  try {
    await props.withReauth(() => call('DELETE', WATCH_API))
    if (data.value) data.value = { ...data.value, external: null }
    // a refresh of the polling may have started before the removal
    void refresh()
    removal.open = false
    closeForm()
    saved.value = 'removed'
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) removal.problem = failure(e).message
  } finally {
    removal.sending = false
  }
}

const guideSteps = ['account', 'check', 'copy', 'paste'] as const
</script>

<template>
  <div class="grid gap-8">
    <SettingsGroup :title="$t('workerStatus.title')">
      <template #aside>
        <StatusDot
          v-if="data"
          :tone="workerState.tone"
          :label="workerState.label"
          class="text-detail"
          data-testid="worker-state"
        />
      </template>
      <ListSkeleton v-if="loading" :label="$t('account.loading')" :rows="1" :action="false" />
      <LoadFailed
        v-else-if="error && !data"
        :text="$t('workerStatus.loadError')"
        @retry="() => refresh()"
      />
      <div v-else-if="workers.length === 0" class="p-4" data-testid="worker-none">
        <p class="font-medium">{{ $t('workerStatus.noneTitle') }}</p>
        <p class="text-detail text-(--app-text-muted)">{{ $t('workerStatus.noneExplain') }}</p>
      </div>
      <template v-else>
        <SettingsRow
          v-for="w in workers"
          :key="w.instance"
          :label="w.instance"
          data-testid="worker-instance"
        >
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot
              :tone="HEALTH_TONE[w.health]"
              :label="$t(`workerStatus.health.${w.health}`)"
            />
            <span class="text-(--app-text-muted)">{{ beatDetail(w) }}</span>
          </span>
        </SettingsRow>
        <p
          v-if="workerState.tone === 'danger'"
          role="alert"
          class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
        >
          {{ $t('workerStatus.silentExplain') }}
        </p>
      </template>
    </SettingsGroup>

    <SettingsGroup :title="$t('externalWatch.title')">
      <template #aside>
        <p v-if="saved" role="status" class="text-detail text-(--app-success)">
          {{ $t(`externalWatch.${saved}`) }}
        </p>
        <StatusDot
          v-if="data"
          :tone="watchState.tone"
          :label="watchState.label"
          class="text-detail"
          data-testid="external-watch-state"
        />
      </template>
      <ListSkeleton v-if="loading" :label="$t('account.loading')" :rows="2" :action="false" />
      <LoadFailed
        v-else-if="error && !data"
        :text="$t('externalWatch.loadError')"
        @retry="() => refresh()"
      />
      <template v-else>
        <template v-if="external">
          <SettingsRow :label="$t('externalWatch.address')">
            <span class="text-(--app-text-muted)">{{
              $t('externalWatch.addressSaved', { when: formatDate(external.updatedAt) })
            }}</span>
            <template v-if="!form.open">
              <UButton color="neutral" variant="outline" size="sm" @click="form.open = true">
                {{ $t('externalWatch.replace') }}
              </UButton>
              <UButton
                color="error"
                variant="ghost"
                size="sm"
                data-testid="external-watch-remove"
                :aria-label="$t('externalWatch.remove')"
                @click="removal.open = true"
              >
                {{ $t('externalWatch.removeShort') }}
              </UButton>
            </template>
          </SettingsRow>
          <SettingsRow :label="$t('externalWatch.last')">
            <span
              :class="
                external.last && !external.last.ok
                  ? 'text-(--app-danger)'
                  : 'text-(--app-text-muted)'
              "
              data-testid="external-watch-last"
              >{{ external.last ? outcomeText(external.last) : $t('externalWatch.never') }}</span
            >
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-send"
              :loading="test.sending"
              data-testid="external-watch-test"
              @click="runTest"
            >
              {{ $t('externalWatch.test') }}
            </UButton>
          </SettingsRow>
          <p
            v-if="test.problem"
            role="alert"
            class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
          >
            {{ test.problem }}
          </p>
        </template>

        <form
          v-if="showForm"
          class="grid gap-4 p-4 sm:p-5"
          :class="external ? 'border-t border-(--app-border)' : ''"
          novalidate
          @submit.prevent="save"
        >
          <p v-if="!external" class="text-detail text-(--app-text-muted)">
            {{ $t('externalWatch.explain') }}
          </p>
          <UFormField
            :label="$t('externalWatch.urlField')"
            :help="$t('externalWatch.urlHelp')"
            name="external-watch-url"
            required
            :error="urlError"
          >
            <UInput
              v-model="form.url"
              type="password"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              data-testid="external-watch-url"
            />
          </UFormField>
          <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton
              type="submit"
              class="min-h-control"
              :loading="form.sending"
              :disabled="form.url.trim() === ''"
            >
              {{ $t('externalWatch.save') }}
            </UButton>
            <UButton
              v-if="external"
              color="neutral"
              variant="ghost"
              class="min-h-control"
              @click="closeForm"
            >
              {{ $t('externalWatch.cancel') }}
            </UButton>
          </div>
        </form>
      </template>
    </SettingsGroup>

    <SettingsGroup v-if="data && (!external || form.open)" :title="$t('externalWatch.guide.title')">
      <ol class="grid list-decimal gap-2 p-4 pl-9">
        <li v-for="step in guideSteps" :key="step">{{ $t(`externalWatch.guide.${step}`) }}</li>
      </ol>
    </SettingsGroup>

    <UModal
      v-model:open="removal.open"
      :title="$t('externalWatch.remove')"
      :description="$t('externalWatch.removeExplain')"
      :close="false"
      :ui="DIALOG_UI"
    >
      <template #body>
        <p v-if="removal.problem" role="alert" class="text-(--app-danger)">
          {{ removal.problem }}
        </p>
      </template>
      <template #footer>
        <UButton
          class="max-md:flex-1 max-md:justify-center"
          color="neutral"
          variant="outline"
          @click="removal.open = false"
        >
          {{ $t('externalWatch.cancel') }}
        </UButton>
        <UButton
          class="max-md:flex-1 max-md:justify-center"
          color="error"
          :loading="removal.sending"
          data-testid="external-watch-remove-confirm"
          @click="remove"
        >
          {{ $t('externalWatch.remove') }}
        </UButton>
      </template>
    </UModal>
  </div>
</template>
