<script setup lang="ts">
import type { Me } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

definePageMeta({ layout: 'personal' })

const { t } = useI18n()
const { call, failure } = useApi()
const colorMode = useColorMode()
const session = useSession()

useHead({ title: () => t('account.tabs.profile') })

const {
  data: me,
  status,
  error,
  refresh,
} = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })

// The theme saved in the profile wins on every device (the cookie only remembers it locally).
watch(
  () => me.value?.theme,
  () => {
    if (me.value) session.applyTheme(me.value)
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
const AVATAR_ROUTES = {
  upload: '/api/v1/me/avatar',
  save: '/api/v1/me/avatar/crop',
  remove: '/api/v1/me/avatar',
}
async function avatarSaved(value: Me) {
  me.value = value
  await session.load()
}

// ---- name and nickname
const profile = reactive({ name: '', nickname: '' })
const profileState = formState()
watch(
  me,
  // a field the person changed meanwhile is theirs: a save of the other one does not undo it
  (value, old) => {
    if (!value) return
    if (!old || profile.name === old.name) profile.name = value.name
    if (!old || profile.nickname === (old.nickname ?? '')) profile.nickname = value.nickname ?? ''
  },
  { immediate: true },
)
/** Saved when a field is left changed (screen 23 has no «Salva»). */
function saveProfile() {
  if (!me.value) return
  const nickname = profile.nickname.trim() || null
  if (profile.name === me.value.name && nickname === me.value.nickname) return
  void save(profileState, { name: profile.name, nickname })
}

// ---- preferences
const AGENCY_ZONE = '__agency__'
const preferences = reactive({ theme: 'system' as Me['theme'], timezone: AGENCY_ZONE })
const preferencesState = formState()
watch(
  me,
  (value, old) => {
    if (!value) return
    if (!old || preferences.theme === old.theme) preferences.theme = value.theme
    if (!old || preferences.timezone === (old.timezone ?? AGENCY_ZONE))
      preferences.timezone = value.timezone ?? AGENCY_ZONE
  },
  { immediate: true },
)
const THEME_ICON = { light: 'i-lucide-sun-medium', dark: 'i-lucide-moon', system: undefined }
const themeItems = computed(() =>
  (['light', 'dark', 'system'] as const).map((value) => ({
    value,
    label: t(`theme.${value}`),
    icon: THEME_ICON[value],
  })),
)
const theme = computed({
  get: () => preferences.theme,
  set: (value: Me['theme']) => {
    preferences.theme = value
    void savePreferences()
  },
})
const timezone = computed({
  get: () => preferences.timezone,
  set: (value: string) => {
    preferences.timezone = value
    void savePreferences()
  },
})
const zoneItems = computed(() => [
  { value: AGENCY_ZONE, label: t('account.preferences.agencyZone') },
  ...Intl.supportedValuesOf('timeZone').map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  })),
])
async function savePreferences() {
  // the browser takes the choice first: when the saved profile comes back, its theme and this
  // one already agree, so a light or dark one left here does not fill a fresh «Automatico»
  const previous = colorMode.preference
  colorMode.preference = preferences.theme
  await save(preferencesState, {
    theme: preferences.theme,
    timezone: preferences.timezone === AGENCY_ZONE ? null : preferences.timezone,
  })
  if (!preferencesState.done) colorMode.preference = previous
}

// ---- email
const emailOpen = ref(false)
const emailForm = reactive({ newEmail: '', password: '' })
watch(emailOpen, (open) => {
  if (!open) return
  Object.assign(emailForm, { newEmail: '', password: '' })
  emailState.failure = null
})
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
    emailOpen.value = false
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
  <SettingsShell :data-ready="me ? true : undefined">
    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ signedOut ? $t('account.signedOut') : $t('account.loadError') }}
      </p>
      <UButton v-if="!signedOut" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else-if="me">
      <SettingsGroup :title="$t('account.profile.group')">
        <template #aside>
          <p role="status" class="text-detail text-(--app-text-muted)">
            <template v-if="profileState.done">{{ $t('account.saved') }}</template>
          </p>
        </template>
        <SettingsRow :label="$t('avatar.label')" inline>
          <AvatarUploader
            compact
            :name="me.displayName"
            :current="me.avatarUrl"
            :routes="AVATAR_ROUTES"
            @saved="(answer) => avatarSaved(answer as Me)"
          />
        </SettingsRow>
        <SettingsRow :label="$t('account.profile.nameRow')" for="profile-name">
          <UFormField
            name="name"
            class="w-full max-w-[360px]"
            :error="fieldError(profileState, 'name')"
          >
            <UInput
              id="profile-name"
              v-model="profile.name"
              autocomplete="name"
              class="w-full"
              :ui="{ base: 'bg-(--app-surface)' }"
              @change="saveProfile"
            />
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('account.profile.nickname')" for="profile-nickname">
          <UFormField
            name="nickname"
            class="w-full max-w-[360px]"
            :error="fieldError(profileState, 'nickname')"
          >
            <UInput
              id="profile-nickname"
              v-model="profile.nickname"
              autocomplete="nickname"
              class="w-full"
              :title="$t('account.profile.nicknameHelp')"
              aria-describedby="profile-nickname-help"
              :ui="{ base: 'bg-(--app-surface)' }"
              @change="saveProfile"
            />
            <span id="profile-nickname-help" class="sr-only">{{
              $t('account.profile.nicknameHelp')
            }}</span>
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('account.email.title')" for="profile-email">
          <UInput
            id="profile-email"
            :model-value="me.email"
            readonly
            class="w-full max-w-[344px] flex-1 max-md:max-w-none max-md:basis-full"
            :ui="{ base: 'bg-(--app-surface)' }"
          />
          <UButton color="neutral" variant="ghost" size="sm" @click="emailOpen = true">
            {{ $t('account.email.change') }}
          </UButton>
        </SettingsRow>
        <p
          v-if="formError(profileState, ['name', 'nickname'])"
          role="alert"
          class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
        >
          {{ formError(profileState, ['name', 'nickname']) }}
        </p>
        <p
          v-if="emailState.done"
          role="status"
          class="border-t border-(--app-border) px-4 py-3 text-(--app-success)"
        >
          {{ $t('account.email.sent', { email: sentTo }) }}
        </p>
      </SettingsGroup>

      <SettingsGroup :title="$t('account.preferences.title')">
        <template #aside>
          <p role="status" class="text-detail text-(--app-text-muted)">
            <template v-if="preferencesState.done">{{ $t('account.saved') }}</template>
          </p>
        </template>
        <SettingsRow :label="$t('theme.label')">
          <SegmentedFilter v-model="theme" :label="$t('theme.label')" :options="themeItems" />
        </SettingsRow>
        <SettingsRow :label="$t('palette.label')">
          <PalettePicker compact />
        </SettingsRow>
        <SettingsRow :label="$t('account.preferences.timezone')" for="profile-timezone">
          <UFormField
            name="timezone"
            class="w-full max-w-[360px]"
            :error="fieldError(preferencesState, 'timezone')"
          >
            <USelectMenu
              id="profile-timezone"
              v-model="timezone"
              :items="zoneItems"
              value-key="value"
              class="w-full"
              :ui="{ base: 'bg-(--app-surface)' }"
              :search-input="{ placeholder: $t('account.preferences.searchZone') }"
            />
          </UFormField>
        </SettingsRow>
        <p
          v-if="formError(preferencesState, ['timezone'])"
          role="alert"
          class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
        >
          {{ formError(preferencesState, ['timezone']) }}
        </p>
      </SettingsGroup>

      <UModal
        v-model:open="emailOpen"
        :title="$t('account.email.change')"
        :description="$t('account.email.explain')"
        :close="false"
        :ui="DIALOG_UI"
      >
        <template #body>
          <form id="change-email" class="grid gap-4" novalidate @submit.prevent="changeEmail">
            <p class="text-detail text-(--app-text-muted)">{{ $t('account.email.explain') }}</p>
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
              />
            </UFormField>
            <p
              v-if="formError(emailState, ['newEmail', 'password'])"
              role="alert"
              class="text-(--app-danger)"
            >
              {{ formError(emailState, ['newEmail', 'password']) }}
            </p>
          </form>
        </template>
        <template #footer>
          <UButton
            class="max-md:flex-1 max-md:justify-center"
            color="neutral"
            variant="outline"
            @click="emailOpen = false"
          >
            {{ $t('security.cancel') }}
          </UButton>
          <UButton
            type="submit"
            form="change-email"
            class="max-md:flex-1 max-md:justify-center"
            :loading="emailState.sending"
          >
            {{ $t('account.email.submit') }}
          </UButton>
        </template>
      </UModal>
    </template>
  </SettingsShell>
</template>
