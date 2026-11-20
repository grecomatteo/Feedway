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
const done = useFlash()
const confirmOpen = ref(false)

const deviceLabel = (s: MySession) =>
  t('devices.deviceOn', { browser: s.device.browser, os: s.device.os })
// a phone or a computer, by its system: only a hint for the eye, the words say which one
const iconOf = (s: MySession) =>
  /android|ios|iphone|ipad/i.test(s.device.os) ? 'i-lucide-smartphone' : 'i-lucide-laptop'
const detailOf = (s: MySession) =>
  [
    s.ipApprox ? t('devices.ip', { ip: s.ipApprox }) : t('devices.ipUnknown'),
    t('devices.lastActive', { date: formatRelative(s.lastActiveAt) }),
  ].join(' · ')

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
  <!-- the devices in the settings' grammar (D-81, screen 24): one group, a row each -->
  <SettingsGroup :title="$t('devices.listLabel')">
    <template #aside>
      <p v-if="done" role="status" class="text-detail text-(--app-text-muted)">{{ done }}</p>
    </template>
    <p v-if="props.sessions.length === 0" class="px-4 py-3">{{ $t('devices.empty') }}</p>
    <ul v-else :aria-label="$t('devices.listLabel')">
      <li
        v-for="s in props.sessions"
        :key="s.id"
        class="flex min-h-15 items-center gap-3 border-t border-(--app-border) px-4 py-3 first:border-t-0"
      >
        <UIcon
          :name="iconOf(s)"
          class="size-5 shrink-0 text-(--app-text-muted)"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-medium">
            {{ deviceLabel(s) }}
            <StatusDot v-if="s.current" tone="success" :label="$t('devices.current')" />
          </p>
          <p class="text-detail text-(--app-text-muted)">{{ detailOf(s) }}</p>
        </div>
        <UButton
          v-if="!s.current"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="sending === s.id"
          :aria-label="$t('devices.signOutOf', { device: deviceLabel(s) })"
          @click="signOut(s)"
        >
          {{ $t('devices.signOut') }}
        </UButton>
      </li>
    </ul>
    <!-- the way out for a device not recognised: beside its reason, under it on a phone -->
    <div
      class="flex min-h-15 flex-wrap items-center gap-x-6 gap-y-2 border-t border-(--app-border) px-4 py-3"
    >
      <div class="min-w-48 flex-1">
        <p class="font-medium">{{ $t('devices.unknown') }}</p>
        <p class="text-detail text-(--app-text-muted)">{{ $t('devices.explain') }}</p>
      </div>
      <UButton
        color="error"
        variant="outline"
        size="sm"
        icon="i-lucide-log-out"
        @click="confirmOpen = true"
      >
        {{ $t('devices.signOutAll') }}
      </UButton>
    </div>
  </SettingsGroup>
  <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>

  <UModal
    v-model:open="confirmOpen"
    :title="$t('devices.confirmTitle')"
    :description="$t('devices.confirmText')"
  >
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton color="error" :loading="sending === 'all'" @click="signOutAll">
          {{ $t('devices.confirm') }}
        </UButton>
        <UButton color="neutral" variant="outline" @click="confirmOpen = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
