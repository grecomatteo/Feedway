<script setup lang="ts">
import type { PlatformMailSettings } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

/**
 * The platform's mail server, for its administrator only. Outside any agency's panel, so in the
 * pages-before-the-panel look (D-99), with the wide column a form needs: the server in one group,
 * the test email in another, «Salva» the only orange button.
 */
definePageMeta({ layout: 'auth', authWide: true })

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
/** the person's agency, when they have one (a platform administrator may have none) */
const home = computed(() => {
  if (session.view.value.state !== 'active') return null
  const to = session.home(session.view.value.me)
  return to === '/account' ? null : to
})
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
  <div class="grid gap-8">
    <div class="grid gap-1 text-center">
      <h1>{{ $t('systemEmail.title') }}</h1>
      <p class="mx-auto text-detail text-(--app-text-muted)">{{ $t('systemEmail.explain') }}</p>
    </div>
    <ListSkeleton
      v-if="status === 'pending' || status === 'idle'"
      :label="$t('account.loading')"
      :rows="3"
      :action="false"
    />
    <LoadFailed v-else-if="error" :text="$t('account.loadError')" @retry="() => refresh()" />

    <template v-else>
      <SettingsGroup :title="$t('systemEmail.settings')">
        <template #aside>
          <StatusDot
            :tone="settings ? 'success' : 'neutral'"
            :label="settings ? $t('systemEmail.configured') : $t('systemEmail.notConfigured')"
            class="text-detail"
          />
        </template>
        <form class="grid gap-4 p-4 sm:p-5" novalidate @submit.prevent="submit">
          <p v-if="settings" class="text-detail text-(--app-text-muted)">
            {{ $t('systemEmail.updatedAt', { when: formatRelative(settings.updatedAt) }) }}
            <template v-if="settings.verifiedAt">
              {{ $t('systemEmail.verifiedAt', { when: formatRelative(settings.verifiedAt) }) }}
            </template>
          </p>
          <UFormField
            :label="$t('systemEmail.host')"
            name="host"
            required
            :error="fieldError('host')"
          >
            <UInput v-model="form.host" autocomplete="off" class="w-full" />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="$t('systemEmail.port')" name="port" :error="fieldError('port')">
              <USelect v-model="form.port" :items="portItems" class="w-full" />
            </UFormField>
            <UFormField
              :label="$t('systemEmail.security')"
              name="security"
              :error="fieldError('security')"
            >
              <USelect v-model="form.security" :items="securityItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField
            :label="$t('systemEmail.username')"
            name="username"
            required
            :error="fieldError('username')"
          >
            <UInput v-model="form.username" autocomplete="off" class="w-full" />
          </UFormField>
          <UFormField
            :label="$t('systemEmail.from')"
            :help="$t('systemEmail.fromHelp')"
            name="from"
            required
            :error="fieldError('from')"
          >
            <UInput v-model="form.from" type="email" autocomplete="off" class="w-full" />
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
            />
          </UFormField>
          <p v-if="saveError" role="alert" class="text-(--app-danger)">{{ saveError }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" class="min-h-control" :loading="save.sending">
              {{ $t('account.save') }}
            </UButton>
            <p v-if="save.done" role="status" class="flex items-center gap-1.5 text-detail">
              <UIcon
                name="i-lucide-circle-check"
                class="size-4 text-(--app-success)"
                aria-hidden="true"
              />
              {{ $t('account.saved') }}
            </p>
          </div>
        </form>
      </SettingsGroup>

      <SettingsGroup :title="$t('systemEmail.testTitle')">
        <form class="grid gap-4 p-4 sm:p-5" novalidate @submit.prevent="sendTest">
          <p class="text-detail text-(--app-text-muted)">{{ $t('systemEmail.testExplain') }}</p>
          <UFormField
            :label="$t('systemEmail.testTo')"
            name="test-to"
            required
            :error="test.problem ?? undefined"
          >
            <UInput v-model="test.to" type="email" autocomplete="email" class="w-full" />
          </UFormField>
          <div v-if="test.result" :role="test.result.ok ? 'status' : 'alert'" class="grid gap-1">
            <p class="flex items-start gap-2">
              <UIcon
                :name="test.result.ok ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                class="mt-0.5 size-4 shrink-0"
                :class="test.result.ok ? 'text-(--app-success)' : 'text-(--app-danger)'"
                aria-hidden="true"
              />
              {{ $t(`systemEmail.testResult.${test.result.kind}`) }}
            </p>
            <p
              v-if="test.result.response"
              class="font-mono text-detail break-all text-(--app-text-muted)"
            >
              {{ test.result.response }}
            </p>
          </div>
          <UButton
            type="submit"
            class="min-h-control justify-self-start"
            color="neutral"
            variant="outline"
            :loading="test.sending"
            :disabled="!settings"
          >
            {{ $t('systemEmail.testSend') }}
          </UButton>
        </form>
      </SettingsGroup>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
    <!-- no bar at the top here: the way back to the panel, the settings and out -->
    <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <UButton v-if="home" :to="home" color="neutral" variant="ghost" icon="i-lucide-arrow-left">
        {{ $t('nav.agency') }}
      </UButton>
      <UButton to="/account" color="neutral" variant="ghost" icon="i-lucide-settings">
        {{ $t('nav.settings') }}
      </UButton>
      <SignOutButton />
    </div>
  </div>
</template>
