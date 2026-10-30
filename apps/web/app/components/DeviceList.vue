<script setup lang="ts">
interface MySession {
  id: string
  device: { browser: string; os: string }
  ipApprox: string | null
  createdAt: string
  lastActiveAt: string
  current: boolean
}

const props = defineProps<{ sessions: MySession[] }>()
const emit = defineEmits<{ changed: []; allSignedOut: [] }>()

const { t } = useI18n()
const { call, failure } = useApi()

const sending = ref<string | null>(null)
const problem = ref<string | null>(null)
const done = ref<string | null>(null)
const confirmOpen = ref(false)

const deviceLabel = (s: MySession) =>
  t('devices.deviceOn', { browser: s.device.browser, os: s.device.os })

async function run(key: string, action: () => Promise<void>) {
  sending.value = key
  problem.value = null
  done.value = null
  try {
    await action()
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    sending.value = null
  }
}

const signOut = (s: MySession) =>
  run(s.id, async () => {
    await call('DELETE', `/api/v1/me/sessions/${encodeURIComponent(s.id)}`)
    done.value = t('devices.signedOut')
    emit('changed')
  })

const signOutAll = () =>
  run('all', async () => {
    try {
      await call('DELETE', '/api/v1/me/sessions')
    } finally {
      // the outcome, good or bad, is shown on the page
      confirmOpen.value = false
    }
    emit('allSignedOut')
  })
</script>

<template>
  <section
    aria-labelledby="devices-list"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 id="devices-list" class="text-lg">{{ $t('devices.listLabel') }}</h2>
    <p class="text-sm text-(--app-text-muted)">{{ $t('devices.explain') }}</p>

    <p v-if="props.sessions.length === 0">{{ $t('devices.empty') }}</p>
    <ul v-else class="divide-y divide-(--app-border)" :aria-label="$t('devices.listLabel')">
      <li
        v-for="s in props.sessions"
        :key="s.id"
        class="flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <div class="space-y-1">
          <p class="flex flex-wrap items-center gap-2 font-semibold">
            {{ deviceLabel(s) }}
            <UBadge v-if="s.current" color="success" variant="subtle">
              {{ $t('devices.current') }}
            </UBadge>
          </p>
          <p class="text-sm text-(--app-text-muted)">
            {{ s.ipApprox ? $t('devices.ip', { ip: s.ipApprox }) : $t('devices.ipUnknown') }}
          </p>
          <p class="text-sm text-(--app-text-muted)">
            {{ $t('devices.lastActive', { date: formatDate(s.lastActiveAt, true) }) }}
          </p>
        </div>
        <UButton
          v-if="!s.current"
          class="min-h-11"
          color="neutral"
          variant="outline"
          :loading="sending === s.id"
          :aria-label="$t('devices.signOutOf', { device: deviceLabel(s) })"
          @click="signOut(s)"
        >
          {{ $t('devices.signOut') }}
        </UButton>
      </li>
    </ul>

    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <UButton
      class="min-h-11"
      color="error"
      variant="outline"
      icon="i-lucide-log-out"
      @click="confirmOpen = true"
    >
      {{ $t('devices.signOutAll') }}
    </UButton>

    <UModal
      v-model:open="confirmOpen"
      :title="$t('devices.confirmTitle')"
      :description="$t('devices.confirmText')"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton class="min-h-11" color="error" :loading="sending === 'all'" @click="signOutAll">
            {{ $t('devices.confirm') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="confirmOpen = false">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
