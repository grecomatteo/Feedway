<script setup lang="ts">
import type { PlatformMailSettings } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

type TestKind =
  | 'sent'
  | 'not_configured'
  | 'unexpected'
  | 'invalid_config'
  | 'blocked_destination'
  | 'dns'
  | 'timeout'
  | 'tls'
  | 'auth'
  | 'connection'
  | 'rejected'

const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const session = useSession()

useHead({ title: () => t('systemEmail.title') })

const { data, status, error, refresh } = useFetch<{ settings: PlatformMailSettings | null }>(
  '/api/v1/platform/mail-settings',
  { key: 'platform-mail', server: false, lazy: true },
)
const settings = computed(() => data.value?.settings ?? null)
const passkeys = computed(() =>
  session.view.value.state === 'active' ? session.view.value.me.secondFactor.passkeys : 0,
)

const form = reactive({
  host: '',
  port: 587 as 465 | 587 | 2525,
  security: 'auto' as 'auto' | 'tls' | 'starttls',
  username: '',
  from: '',
  password: '',
})
watch(
  settings,
  (s) => {
    if (!s) return
    Object.assign(form, {
      host: s.host,
      port: s.port,
      security: s.security,
      username: s.username,
      from: s.from,
      password: '',
    })
  },
  { immediate: true },
)
const portItems = [465, 587, 2525].map((p) => ({ value: p, label: String(p) }))
const securityItems = computed(() => [
  { value: 'auto', label: t('systemEmail.securityAuto') },
  { value: 'tls', label: 'TLS' },
  { value: 'starttls', label: 'STARTTLS' },
])

const save = reactive({ sending: false, failure: null as ApiFailure | null, done: false })
const fieldError = (field: string) =>
  save.failure?.field === field ? save.failure.message : undefined
const saveError = computed(() =>
  save.failure &&
  !['host', 'port', 'security', 'username', 'from', 'password'].includes(save.failure.field ?? '')
    ? save.failure.message
    : null,
)

async function submit() {
  Object.assign(save, { sending: true, failure: null, done: false })
  try {
    await withReauth(async () => {
      const r = await call<{ settings: PlatformMailSettings }>(
        'PUT',
        '/api/v1/platform/mail-settings',
        {
          host: form.host.trim(),
          port: form.port,
          ...(form.security === 'auto' ? {} : { security: form.security }),
          username: form.username.trim(),
          from: form.from.trim(),
          ...(form.password === '' ? {} : { password: form.password }),
        },
      )
      data.value = r
      form.password = ''
      save.done = true
    })
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) save.failure = failure(e)
  } finally {
    save.sending = false
  }
}

const test = reactive({
  to: '',
  sending: false,
  result: null as { ok: boolean; kind: TestKind; response: string | null } | null,
  problem: null as string | null,
})
async function sendTest() {
  Object.assign(test, { sending: true, result: null, problem: null })
  try {
    await withReauth(async () => {
      test.result = await call('POST', '/api/v1/platform/mail-settings/test', {
        to: test.to.trim(),
      })
    })
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) test.problem = failure(e).message
  } finally {
    test.sending = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('systemEmail.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('systemEmail.explain') }}</p>
    </header>

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('account.loadError') }}
      </p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else>
      <section
        aria-labelledby="system-email-settings"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="system-email-settings" class="text-lg">{{ $t('systemEmail.settings') }}</h2>
          <UBadge :color="settings ? 'success' : 'neutral'" variant="subtle">
            {{ settings ? $t('systemEmail.configured') : $t('systemEmail.notConfigured') }}
          </UBadge>
        </div>
        <p v-if="settings" class="text-sm text-(--app-text-muted)">
          {{ $t('systemEmail.updatedAt', { when: formatDate(settings.updatedAt, true) }) }}
          <template v-if="settings.verifiedAt">
            {{ $t('systemEmail.verifiedAt', { when: formatDate(settings.verifiedAt, true) }) }}
          </template>
        </p>
        <form class="space-y-4" novalidate @submit.prevent="submit">
          <UFormField
            :label="$t('systemEmail.host')"
            name="host"
            required
            :error="fieldError('host')"
          >
            <UInput v-model="form.host" autocomplete="off" class="w-full" size="xl" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('systemEmail.port')" name="port" :error="fieldError('port')">
              <USelect v-model="form.port" :items="portItems" class="w-full" size="xl" />
            </UFormField>
            <UFormField
              :label="$t('systemEmail.security')"
              name="security"
              :error="fieldError('security')"
            >
              <USelect v-model="form.security" :items="securityItems" class="w-full" size="xl" />
            </UFormField>
          </div>
          <UFormField
            :label="$t('systemEmail.username')"
            name="username"
            required
            :error="fieldError('username')"
          >
            <UInput v-model="form.username" autocomplete="off" class="w-full" size="xl" />
          </UFormField>
          <UFormField
            :label="$t('systemEmail.from')"
            :help="$t('systemEmail.fromHelp')"
            name="from"
            required
            :error="fieldError('from')"
          >
            <UInput v-model="form.from" type="email" autocomplete="off" class="w-full" size="xl" />
          </UFormField>
          <UFormField
            :label="$t('systemEmail.password')"
            :help="settings ? $t('systemEmail.passwordKeep') : undefined"
            name="smtp-password"
            :required="!settings"
            :error="fieldError('password')"
          >
            <UInput
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <p v-if="saveError" role="alert" class="text-(--app-danger)">{{ saveError }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" class="min-h-11" :loading="save.sending">
              {{ $t('account.save') }}
            </UButton>
            <p v-if="save.done" role="status" class="text-(--app-success)">
              {{ $t('account.saved') }}
            </p>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="system-email-test"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="system-email-test" class="text-lg">{{ $t('systemEmail.testTitle') }}</h2>
        <p class="text-sm text-(--app-text-muted)">{{ $t('systemEmail.testExplain') }}</p>
        <form class="space-y-4" novalidate @submit.prevent="sendTest">
          <UFormField
            :label="$t('systemEmail.testTo')"
            name="test-to"
            required
            :error="test.problem ?? undefined"
          >
            <UInput v-model="test.to" type="email" autocomplete="email" class="w-full" size="xl" />
          </UFormField>
          <UButton
            type="submit"
            class="min-h-11"
            color="neutral"
            variant="outline"
            :loading="test.sending"
            :disabled="!settings"
          >
            {{ $t('systemEmail.testSend') }}
          </UButton>
        </form>
        <div v-if="test.result" :role="test.result.ok ? 'status' : 'alert'" class="space-y-1">
          <p :class="test.result.ok ? 'text-(--app-success)' : 'text-(--app-danger)'">
            {{ $t(`systemEmail.testResult.${test.result.kind}`) }}
          </p>
          <p
            v-if="test.result.response"
            class="font-mono text-sm break-all text-(--app-text-muted)"
          >
            {{ test.result.response }}
          </p>
        </div>
      </section>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
