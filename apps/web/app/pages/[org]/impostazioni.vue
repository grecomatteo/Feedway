<script setup lang="ts">
definePageMeta({ layout: 'agency' })

interface Settings {
  id: string
  name: string
  slug: string
  require2fa: 'admins' | 'all' | null
  platformRequire2fa: 'admins' | 'all'
}

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('orgSettings.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const { data, status, error, refresh } = useFetch<Settings>(() => org.api('/settings'), {
  key: () => `settings-${org.slug.value}`,
  server: false,
  lazy: true,
})
const form = reactive({ name: '', require2fa: 'admins' as 'admins' | 'all' })
watch(
  data,
  (s) => {
    if (!s) return
    form.name = s.name
    form.require2fa = s.require2fa ?? s.platformRequire2fa
  },
  { immediate: true },
)
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
      data.value = await call<Settings>('PATCH', org.api('/settings'), {
        name: form.name,
        require2fa: form.require2fa,
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
const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('orgSettings.title') }}</h1>
      <p v-if="!org.may.value.editSettings" class="text-(--app-text-muted)">
        {{ $t('orgSettings.ownerOnly') }}
      </p>
    </header>

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <form
      v-else-if="data"
      class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      novalidate
      @submit.prevent="save"
    >
      <fieldset :disabled="!org.may.value.editSettings" class="min-w-0 space-y-4">
        <UFormField
          :label="$t('orgSettings.name')"
          name="name"
          required
          :error="state.field === 'name' ? (state.problem ?? undefined) : undefined"
        >
          <UInput v-model="form.name" class="w-full" size="xl" />
        </UFormField>
        <UFormField
          :label="$t('orgSettings.require2fa')"
          :help="data.platformRequire2fa === 'all' ? $t('orgSettings.platformAll') : undefined"
          name="require2fa"
        >
          <URadioGroup
            v-model="form.require2fa"
            :items="policyItems"
            :ui="{ item: 'min-h-11 items-center' }"
          />
        </UFormField>
        <p v-if="state.problem && state.field !== 'name'" role="alert" class="text-(--app-danger)">
          {{ state.problem }}
        </p>
        <div v-if="org.may.value.editSettings" class="flex flex-wrap items-center gap-3">
          <UButton type="submit" class="min-h-11" :loading="state.sending">{{
            $t('account.save')
          }}</UButton>
          <p v-if="state.done" role="status" class="text-(--app-success)">
            {{ $t('account.saved') }}
          </p>
        </div>
      </fieldset>
    </form>
    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </div>
</template>
