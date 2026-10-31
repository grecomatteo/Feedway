<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()
const session = useSession()
const route = useRoute()

useHead({ title: () => t('verify.title') })

const mode = ref<'app' | 'backup'>('app')
const code = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)

async function submit() {
  sending.value = true
  problem.value = null
  try {
    await call(
      'POST',
      mode.value === 'app'
        ? '/api/auth/two-factor/verify-totp'
        : '/api/auth/two-factor/verify-backup-code',
      { code: code.value.replace(/\s/g, '') },
    )
    code.value = ''
    const view = await session.load()
    if (view.state === 'active') await navigateTo(session.home(view.me, route.query['dopo']))
    else if (view.state === 'second_factor') await navigateTo('/accedi/secondo-fattore')
    else problem.value = t('verify.expired')
  } catch (e) {
    const f = failure(e)
    problem.value =
      f.status === 429
        ? t('signIn.wait', { seconds: f.retryAfter ?? 60 })
        : f.code === 'INVALID_TWO_FACTOR_COOKIE' || f.status === 401
          ? t('verify.expired')
          : f.message
  } finally {
    sending.value = false
  }
}

function toggle() {
  mode.value = mode.value === 'app' ? 'backup' : 'app'
  code.value = ''
  problem.value = null
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('verify.title') }}</h1>
    <p>{{ mode === 'app' ? $t('verify.appExplain') : $t('verify.backupExplain') }}</p>
    <form class="space-y-4" novalidate @submit.prevent="submit">
      <fieldset :disabled="!ready" class="min-w-0 space-y-4">
        <UFormField
          :label="mode === 'app' ? $t('verify.appCode') : $t('verify.backupCode')"
          name="code"
          required
          :error="problem ?? undefined"
        >
          <UInput
            v-model="code"
            :inputmode="mode === 'app' ? 'numeric' : 'text'"
            autocomplete="one-time-code"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UButton type="submit" block size="xl" class="min-h-12" :loading="sending">
          {{ $t('verify.submit') }}
        </UButton>
      </fieldset>
    </form>
    <div class="flex flex-wrap gap-2">
      <UButton class="min-h-11" color="neutral" variant="link" @click="toggle">
        {{ mode === 'app' ? $t('verify.useBackup') : $t('verify.useApp') }}
      </UButton>
      <UButton class="min-h-11" color="neutral" variant="link" to="/accedi">
        {{ $t('verify.back') }}
      </UButton>
    </div>
  </div>
</template>
