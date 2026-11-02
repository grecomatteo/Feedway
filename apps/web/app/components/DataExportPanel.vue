<script setup lang="ts">
import type { DataExport, Me } from '@app/contracts'

const props = defineProps<{ me: Me | null }>()

const { t } = useI18n()
const { call, failure } = useApi()

const POLL_MS = 3000

const { data, refresh } = useFetch<{ items: DataExport[] }>('/api/v1/me/exports', {
  key: 'my-data-exports',
  server: false,
  lazy: true,
})
const latest = computed(() => data.value?.items[0] ?? null)
const preparing = computed(
  () => latest.value?.status === 'pending' || latest.value?.status === 'running',
)
const sending = ref(false)
const downloading = ref(false)
const problem = ref<string | null>(null)

// asking for the data and downloading it both need the password (or a passkey) again
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const { data: factors } = useFetch<SecondFactor>('/api/v1/me/second-factor', {
  key: 'second-factor',
  server: false,
  lazy: true,
})

// while the file is being prepared the page asks again every 3 seconds, and stops after
let timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  clearTimeout(timer)
  if (preparing.value) timer = setTimeout(() => void refresh(), POLL_MS)
}
watch(latest, schedule)
onBeforeUnmount(() => clearTimeout(timer))

const when = (iso: string) => formatDate(iso, true, props.me?.timezone)

/** What the screen reader hears when the state changes. */
const announcement = computed(() => {
  switch (latest.value?.status) {
    case 'pending':
    case 'running':
      return t('dataExport.preparing')
    case 'ready':
      return t('dataExport.ready')
    case 'failed':
      return t('dataExport.failed')
    case 'expired':
      return t('dataExport.expired')
    default:
      return ''
  }
})

async function request() {
  sending.value = true
  problem.value = null
  try {
    await withReauth(async () => {
      await call('POST', '/api/v1/me/exports')
    })
    await refresh()
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}

/** The file through a request of the page, so a missing confirmation opens the dialog. */
async function download(item: DataExport) {
  downloading.value = true
  problem.value = null
  try {
    await withReauth(async () => {
      const response = await $fetch.raw<Blob>(
        `/api/v1/me/exports/${encodeURIComponent(item.id)}/download`,
        { responseType: 'blob' },
      )
      const name =
        /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
        'dati-personali.zip'
      if (!response._data) throw new Error('empty download')
      const url = URL.createObjectURL(response._data)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 60_000)
    })
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
    await refresh()
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <section
    aria-labelledby="data-export-heading"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 id="data-export-heading" class="text-lg">{{ $t('dataExport.heading') }}</h2>
    <p class="text-sm text-(--app-text-muted)">{{ $t('dataExport.explain') }}</p>

    <template v-if="latest">
      <ol
        v-if="preparing || latest.status === 'ready'"
        :aria-label="$t('dataExport.stepsLabel')"
        class="flex flex-wrap items-center gap-2 text-sm"
      >
        <li
          class="flex items-center gap-2 rounded-md px-3 py-2"
          :class="preparing ? 'bg-(--app-surface-sunken) font-semibold' : 'text-(--app-text-muted)'"
          :aria-current="preparing ? 'step' : undefined"
        >
          <UIcon
            :name="preparing ? 'i-lucide-loader-circle' : 'i-lucide-circle-check'"
            :class="preparing ? 'animate-spin motion-reduce:animate-none' : ''"
            aria-hidden="true"
          />
          {{ $t('dataExport.stepPreparing') }}
        </li>
        <li aria-hidden="true" class="text-(--app-text-muted)">→</li>
        <li
          class="flex items-center gap-2 rounded-md px-3 py-2"
          :class="
            latest.status === 'ready'
              ? 'bg-(--app-surface-sunken) font-semibold'
              : 'text-(--app-text-muted)'
          "
          :aria-current="latest.status === 'ready' ? 'step' : undefined"
        >
          <UIcon
            :name="latest.status === 'ready' ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            aria-hidden="true"
          />
          {{ $t('dataExport.stepReady') }}
        </li>
      </ol>
      <p class="text-sm text-(--app-text-muted)">
        {{ $t('dataExport.requestedAt', { date: when(latest.createdAt) }) }}
      </p>
    </template>

    <p
      role="status"
      aria-live="polite"
      :class="latest?.status === 'failed' ? 'text-(--app-danger)' : ''"
    >
      {{ announcement }}
    </p>

    <div v-if="latest?.status === 'ready'" class="space-y-2">
      <UButton
        class="min-h-11"
        icon="i-lucide-download"
        :loading="downloading"
        @click="download(latest)"
      >
        {{ $t('dataExport.download') }}
      </UButton>
      <p v-if="latest.expiresAt" class="text-sm text-(--app-text-muted)">
        {{ $t('dataExport.expires', { date: when(latest.expiresAt) }) }}
      </p>
    </div>

    <div v-if="!preparing" class="space-y-2">
      <UButton
        class="min-h-11"
        :color="latest?.status === 'ready' ? 'neutral' : 'primary'"
        :variant="latest?.status === 'ready' ? 'outline' : 'solid'"
        :loading="sending"
        @click="request"
      >
        {{ latest ? $t('dataExport.requestAgain') : $t('dataExport.request') }}
      </UButton>
      <p class="text-sm text-(--app-text-muted)">{{ $t('dataExport.limit') }}</p>
      <p class="text-sm text-(--app-text-muted)">{{ $t('dataExport.reauth') }}</p>
    </div>

    <p v-if="problem" role="alert" class="flex items-center gap-2 text-(--app-danger)">
      <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
      {{ problem }}
    </p>

    <ReauthDialog
      v-model:open="reauthOpen"
      :passkeys="factors?.passkeys.length ?? 0"
      @done="reauthDone"
    />
  </section>
</template>
