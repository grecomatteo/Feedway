<script setup lang="ts">
definePageMeta({ layout: 'agency' })

interface Settings {
  id: string
  name: string
  slug: string
  require2fa: 'admins' | 'all' | null
  platformRequire2fa: 'admins' | 'all'
  privacy: { controllerName: string; contactEmail: string; extraText?: string } | null
  storage: { usedBytes: number; limitBytes: number | null }
  /** IANA: the zone of the new posts (D-58), Rome while never chosen */
  timezone: string
}

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('orgSettings.tabs.general') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const { data, status, error, refresh } = useFetch<Settings>(() => org.api('/settings'), {
  key: () => `settings-${org.slug.value}`,
  server: false,
  lazy: true,
})
const form = reactive({
  name: '',
  require2fa: 'admins' as 'admins' | 'all',
  timezone: 'Europe/Rome',
  controllerName: '',
  contactEmail: '',
  extraText: '',
})
watch(
  data,
  (s) => {
    if (!s) return
    form.name = s.name
    form.require2fa = s.require2fa ?? s.platformRequire2fa
    form.timezone = s.timezone
    form.controllerName = s.privacy?.controllerName ?? ''
    form.contactEmail = s.privacy?.contactEmail ?? ''
    form.extraText = s.privacy?.extraText ?? ''
  },
  { immediate: true },
)
// every zone of the browser, with its long name: «Europe/Rome · ora standard dell'Europa centrale»
const zoneItems = computed(() =>
  Intl.supportedValuesOf('timeZone').map((zone) => ({
    value: zone,
    label: `${zone.replaceAll('_', ' ')} · ${zoneName(zone)}`,
  })),
)
function zoneName(zone: string) {
  const part = new Intl.DateTimeFormat('it-IT', { timeZone: zone, timeZoneName: 'long' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? zone
}
const policyItems = computed(() => [
  {
    value: 'admins',
    label: t('orgSettings.policy.admins'),
    disabled: data.value?.platformRequire2fa === 'all',
  },
  { value: 'all', label: t('orgSettings.policy.all') },
])
const state = reactive({ sending: false, problem: null as string | null, field: '', done: false })
async function save() {
  Object.assign(state, { sending: true, problem: null, field: '', done: false })
  try {
    await withReauth(async () => {
      // the controller data go as a whole: anything written is checked by the server; all
      // three emptied remove what was stored
      const written = [form.controllerName, form.contactEmail, form.extraText].some(
        (v) => v.trim() !== '',
      )
      const privacy = written
        ? {
            controllerName: form.controllerName,
            contactEmail: form.contactEmail,
            extraText: form.extraText,
          }
        : data.value?.privacy
          ? null
          : undefined
      data.value = await call<Settings>('PATCH', org.api('/settings'), {
        name: form.name,
        require2fa: form.require2fa,
        ...(form.timezone === data.value?.timezone ? {} : { timezone: form.timezone }),
        ...(privacy === undefined ? {} : { privacy }),
      })
    })
    state.done = true
    // the agency's name is in the menu
    await useSession().load()
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) {
      const f = failure(e)
      state.problem = f.message
      state.field = f.field ?? ''
    }
  } finally {
    state.sending = false
  }
}
// ---- the logo: in the sidebar of every member, so the session is read again
const logoRoutes = computed(() => ({
  upload: org.api('/logo'),
  save: org.api('/logo/confirm'),
  remove: org.api('/logo'),
}))
async function logoSaved() {
  await useSession().load()
}

const fieldError = (name: string) =>
  state.field === name ? (state.problem ?? undefined) : undefined
const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <SettingsShell>
    <p v-if="!org.may.value.editSettings" class="text-(--app-text-muted)">
      {{ $t('orgSettings.ownerOnly') }}
    </p>
    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <form v-else-if="data" class="grid gap-8" novalidate @submit.prevent="save">
      <SettingsGroup :title="$t('orgSettings.group')">
        <SettingsRow
          v-if="org.may.value.editSettings && org.organization.value"
          :label="$t('logo.label')"
          inline
        >
          <AvatarUploader
            compact
            :name="org.organization.value.name"
            :current="org.organization.value.logoUrl"
            shape="square"
            texts="logo"
            :routes="logoRoutes"
            :guard="withReauth"
            @saved="logoSaved"
          />
        </SettingsRow>
        <SettingsRow :label="$t('orgSettings.name')" for="org-name">
          <UFormField
            name="name"
            class="w-full max-w-[360px]"
            :error="state.field === 'name' ? (state.problem ?? undefined) : undefined"
          >
            <UInput
              id="org-name"
              v-model="form.name"
              class="w-full"
              :disabled="!org.may.value.editSettings"
              :ui="{ base: 'bg-(--app-surface)' }"
            />
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('orgSettings.timezone')" for="org-timezone">
          <UFormField
            name="timezone"
            class="w-full max-w-[360px]"
            :help="$t('orgSettings.timezoneHelp')"
            :error="fieldError('timezone')"
          >
            <USelectMenu
              id="org-timezone"
              v-model="form.timezone"
              :items="zoneItems"
              value-key="value"
              class="w-full"
              :disabled="!org.may.value.editSettings"
              :ui="{ base: 'bg-(--app-surface)' }"
              :search-input="{ placeholder: $t('account.preferences.searchZone') }"
            />
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('orgSettings.require2fa')">
          <UFormField
            name="require2fa"
            :help="data.platformRequire2fa === 'all' ? $t('orgSettings.platformAll') : undefined"
          >
            <URadioGroup
              v-model="form.require2fa"
              :items="policyItems"
              :disabled="!org.may.value.editSettings"
              :aria-label="$t('orgSettings.require2fa')"
              orientation="horizontal"
              :ui="{ item: 'min-h-11 items-center' }"
            />
          </UFormField>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup :title="$t('orgSettings.privacy.title')">
        <template #aside>
          <NuxtLink
            to="/account/privacy"
            class="text-detail font-medium underline underline-offset-3"
            >{{ $t('orgSettings.privacy.see') }}</NuxtLink
          >
        </template>
        <p
          v-if="!data.privacy && org.may.value.editSettings"
          class="border-b border-(--app-border) bg-(--app-warning-soft) px-4 py-3"
        >
          {{ $t('orgSettings.privacy.missing') }}
        </p>
        <p class="px-4 pt-3 text-detail text-(--app-text-muted)">
          {{ $t('orgSettings.privacy.help') }}
        </p>
        <SettingsRow :label="$t('orgSettings.privacy.controllerName')" for="org-controller">
          <UFormField
            name="privacy.controllerName"
            class="w-full max-w-[360px]"
            :error="fieldError('privacy.controllerName')"
          >
            <UInput
              id="org-controller"
              v-model="form.controllerName"
              class="w-full"
              :disabled="!org.may.value.editSettings"
              :ui="{ base: 'bg-(--app-surface)' }"
            />
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('orgSettings.privacy.contactEmail')" for="org-contact">
          <UFormField
            name="privacy.contactEmail"
            class="w-full max-w-[360px]"
            :error="fieldError('privacy.contactEmail')"
          >
            <UInput
              id="org-contact"
              v-model="form.contactEmail"
              type="email"
              class="w-full"
              :disabled="!org.may.value.editSettings"
              :ui="{ base: 'bg-(--app-surface)' }"
            />
          </UFormField>
        </SettingsRow>
        <SettingsRow :label="$t('orgSettings.privacy.extraText')" for="org-extra">
          <UFormField
            name="privacy.extraText"
            class="w-full"
            :help="$t('orgSettings.privacy.extraTextHelp')"
            :error="fieldError('privacy.extraText')"
          >
            <UTextarea
              id="org-extra"
              v-model="form.extraText"
              class="w-full"
              :rows="3"
              autoresize
              :disabled="!org.may.value.editSettings"
              :ui="{ base: 'bg-(--app-surface)' }"
            />
          </UFormField>
        </SettingsRow>
      </SettingsGroup>

      <p
        v-if="
          state.problem &&
          ![
            'name',
            'timezone',
            'privacy.controllerName',
            'privacy.contactEmail',
            'privacy.extraText',
          ].includes(state.field)
        "
        role="alert"
        class="text-(--app-danger)"
      >
        {{ state.problem }}
      </p>
      <div v-if="org.may.value.editSettings" class="-mt-4 flex flex-wrap items-center gap-3">
        <UButton type="submit" :loading="state.sending">{{ $t('account.save') }}</UButton>
        <p v-if="state.done" role="status" class="text-(--app-success)">
          {{ $t('account.saved') }}
        </p>
      </div>
    </form>
    <SettingsGroup v-if="data" :title="$t('orgSettings.storage.title')">
      <SettingsRow
        :label="
          data.storage.limitBytes === null
            ? $t('orgSettings.storage.used', { used: formatBytes(data.storage.usedBytes) })
            : $t('orgSettings.storage.usedOf', {
                used: formatBytes(data.storage.usedBytes),
                limit: formatBytes(data.storage.limitBytes),
              })
        "
        :hint="$t('orgSettings.storage.text')"
      >
        <UProgress
          v-if="data.storage.limitBytes"
          :model-value="Math.min(100, (data.storage.usedBytes / data.storage.limitBytes) * 100)"
          :aria-label="$t('orgSettings.storage.title')"
          size="sm"
          class="max-w-[360px]"
        />
        <p v-else class="text-detail text-(--app-text-muted)">
          {{ $t('orgSettings.storage.noLimit') }}
        </p>
      </SettingsRow>
    </SettingsGroup>
    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </SettingsShell>
</template>
