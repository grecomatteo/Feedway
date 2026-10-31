<script setup lang="ts">
import type { Me } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

const { t } = useI18n()
const { call, failure } = useApi()
const colorMode = useColorMode()
const session = useSession()

useHead({ title: () => t('account.title') })

const {
  data: me,
  status,
  error,
  refresh,
} = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })

// The theme saved in the profile wins on every device (the cookie only remembers it locally).
watch(
  () => me.value?.theme,
  (theme) => {
    if (theme && colorMode.preference !== theme) colorMode.preference = theme
  },
  { immediate: true },
)

const signedOut = computed(() => error.value?.statusCode === 401)

/** One form's state: what is being sent, the last error, the last success. */
function formState() {
  return reactive({
    sending: false,
    failure: null as ApiFailure | null,
    done: false,
  })
}
const fieldError = (state: { failure: ApiFailure | null }, field: string) =>
  state.failure?.field === field ? state.failure.message : undefined
const formError = (state: { failure: ApiFailure | null }, fields: readonly string[]) =>
  state.failure && !fields.includes(state.failure.field ?? '') ? state.failure.message : null

async function save(state: ReturnType<typeof formState>, body: Record<string, unknown>) {
  state.sending = true
  state.failure = null
  state.done = false
  try {
    me.value = await call<Me>('PATCH', '/api/v1/me', body)
    state.done = true
  } catch (e) {
    state.failure = failure(e)
  } finally {
    state.sending = false
  }
}

// ---- photo: the header shows it too, so the session is read again
async function avatarSaved(value: Me) {
  me.value = value
  await session.load()
}

// ---- name and nickname
const profile = reactive({ name: '', nickname: '' })
const profileState = formState()
watch(
  me,
  (value) => {
    if (!value) return
    profile.name = value.name
    profile.nickname = value.nickname ?? ''
  },
  { immediate: true },
)
const saveProfile = () =>
  save(profileState, { name: profile.name, nickname: profile.nickname.trim() || null })

// ---- preferences
const AGENCY_ZONE = '__agency__'
const preferences = reactive({ theme: 'system' as Me['theme'], timezone: AGENCY_ZONE })
const preferencesState = formState()
watch(
  me,
  (value) => {
    if (!value) return
    preferences.theme = value.theme
    preferences.timezone = value.timezone ?? AGENCY_ZONE
  },
  { immediate: true },
)
const themeItems = computed(() =>
  (['light', 'dark', 'system'] as const).map((value) => ({ value, label: t(`theme.${value}`) })),
)
const zoneItems = computed(() => [
  { value: AGENCY_ZONE, label: t('account.preferences.agencyZone') },
  ...Intl.supportedValuesOf('timeZone').map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  })),
])
async function savePreferences() {
  await save(preferencesState, {
    theme: preferences.theme,
    timezone: preferences.timezone === AGENCY_ZONE ? null : preferences.timezone,
  })
  if (preferencesState.done) colorMode.preference = preferences.theme
}

// ---- email
const emailForm = reactive({ newEmail: '', password: '' })
const emailState = formState()
const sentTo = ref('')
async function changeEmail() {
  emailState.sending = true
  emailState.failure = null
  emailState.done = false
  try {
    // the change needs a confirmation of the last minutes: the password, asked here
    try {
      await call('POST', '/api/v1/auth/reauth', { password: emailForm.password })
    } catch (e) {
      const f = failure(e)
      emailState.failure = { ...f, field: f.code === 'REAUTH_FAILED' ? 'password' : f.field }
      return
    }
    await call('POST', '/api/auth/change-email', { newEmail: emailForm.newEmail.trim() })
    sentTo.value = emailForm.newEmail.trim()
    emailForm.newEmail = ''
    emailForm.password = ''
    emailState.done = true
  } catch (e) {
    const f = failure(e)
    emailState.failure =
      f.code === 'MAIL_NOT_CONFIGURED'
        ? { ...f, message: t('account.email.notConfigured') }
        : f.code === 'VALIDATION' || f.code === 'BAD_REQUEST'
          ? { ...f, field: 'newEmail', message: t('account.email.invalid') }
          : f
  } finally {
    emailState.sending = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('account.title') }}</h1>
      <p v-if="me" class="text-(--app-text-muted)">
        <span :title="me.name">{{ me.displayName }}</span
        >, {{ me.email }}
      </p>
    </header>

    <AccountTabs />

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ signedOut ? $t('account.signedOut') : $t('account.loadError') }}
      </p>
      <UButton
        v-if="!signedOut"
        class="min-h-11"
        color="neutral"
        variant="outline"
        @click="() => refresh()"
      >
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else-if="me">
      <AvatarUploader :me="me" @saved="avatarSaved" />

      <section
        aria-labelledby="account-profile"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="account-profile" class="text-lg">{{ $t('account.profile.title') }}</h2>
        <form class="space-y-4" novalidate @submit.prevent="saveProfile">
          <UFormField
            :label="$t('account.profile.name')"
            name="name"
            required
            :error="fieldError(profileState, 'name')"
          >
            <UInput v-model="profile.name" autocomplete="name" class="w-full" size="xl" />
          </UFormField>
          <UFormField
            :label="$t('account.profile.nickname')"
            :hint="$t('account.optional')"
            :help="$t('account.profile.nicknameHelp')"
            name="nickname"
            :error="fieldError(profileState, 'nickname')"
          >
            <UInput v-model="profile.nickname" autocomplete="nickname" class="w-full" size="xl" />
          </UFormField>
          <p
            v-if="formError(profileState, ['name', 'nickname'])"
            role="alert"
            class="text-(--app-danger)"
          >
            {{ formError(profileState, ['name', 'nickname']) }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" class="min-h-11" :loading="profileState.sending">
              {{ $t('account.save') }}
            </UButton>
            <p v-if="profileState.done" role="status" class="text-(--app-success)">
              {{ $t('account.saved') }}
            </p>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="account-preferences"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="account-preferences" class="text-lg">{{ $t('account.preferences.title') }}</h2>
        <form class="space-y-4" novalidate @submit.prevent="savePreferences">
          <UFormField :label="$t('theme.label')" name="theme">
            <URadioGroup
              v-model="preferences.theme"
              :items="themeItems"
              orientation="horizontal"
              :ui="{ item: 'min-h-11 items-center' }"
            />
          </UFormField>
          <UFormField
            :label="$t('account.preferences.timezone')"
            :help="$t('account.preferences.timezoneHelp')"
            name="timezone"
            :error="fieldError(preferencesState, 'timezone')"
          >
            <USelectMenu
              v-model="preferences.timezone"
              :items="zoneItems"
              value-key="value"
              class="w-full"
              size="xl"
              :search-input="{ placeholder: $t('account.preferences.searchZone') }"
            />
          </UFormField>
          <p
            v-if="formError(preferencesState, ['timezone'])"
            role="alert"
            class="text-(--app-danger)"
          >
            {{ formError(preferencesState, ['timezone']) }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" class="min-h-11" :loading="preferencesState.sending">
              {{ $t('account.save') }}
            </UButton>
            <p v-if="preferencesState.done" role="status" class="text-(--app-success)">
              {{ $t('account.saved') }}
            </p>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="account-email"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="account-email" class="text-lg">{{ $t('account.email.title') }}</h2>
        <p>
          {{ $t('account.email.current') }} <strong>{{ me.email }}</strong>
        </p>
        <p class="text-sm text-(--app-text-muted)">{{ $t('account.email.explain') }}</p>
        <form class="space-y-4" novalidate @submit.prevent="changeEmail">
          <UFormField
            :label="$t('account.email.newEmail')"
            name="newEmail"
            required
            :error="fieldError(emailState, 'newEmail')"
          >
            <UInput
              v-model="emailForm.newEmail"
              type="email"
              autocomplete="email"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <UFormField
            :label="$t('account.email.password')"
            :help="$t('account.email.passwordHelp')"
            name="password"
            required
            :error="fieldError(emailState, 'password')"
          >
            <UInput
              v-model="emailForm.password"
              type="password"
              autocomplete="current-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <p
            v-if="formError(emailState, ['newEmail', 'password'])"
            role="alert"
            class="text-(--app-danger)"
          >
            {{ formError(emailState, ['newEmail', 'password']) }}
          </p>
          <div class="space-y-3">
            <UButton type="submit" class="min-h-11" :loading="emailState.sending">
              {{ $t('account.email.submit') }}
            </UButton>
            <p v-if="emailState.done" role="status" class="text-(--app-success)">
              {{ $t('account.email.sent', { email: sentTo }) }}
            </p>
          </div>
        </form>
      </section>
    </template>
  </div>
</template>
