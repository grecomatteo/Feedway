<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()
const route = useRoute()
const router = useRouter()

useHead({ title: () => t('reset.title') })

// Read once, then dropped from the address bar (and the router's copy of it).
const token = typeof route.query['token'] === 'string' ? route.query['token'] : ''
const linkError = typeof route.query['error'] === 'string'
onMounted(() => {
  if (token !== '' || linkError) void router.replace({ path: route.path })
})

const password = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)
const done = ref(false)
const invalid = ref(token === '' || linkError)

async function submit() {
  sending.value = true
  problem.value = null
  try {
    await call('POST', '/api/auth/reset-password', { token, newPassword: password.value })
    password.value = ''
    done.value = true
  } catch (e) {
    const f = failure(e)
    if (f.code === 'INVALID_TOKEN' || f.code === 'LINK_INVALID' || f.code === 'FORBIDDEN') {
      invalid.value = true
      problem.value = f.code === 'FORBIDDEN' ? f.message : null
    } else
      problem.value =
        f.status === 429 ? t('signIn.wait', { seconds: f.retryAfter ?? 60 }) : f.message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('reset.title') }}</h1>
    <template v-if="done">
      <p role="status" class="text-(--app-success)">{{ $t('reset.done') }}</p>
      <UButton class="min-h-11" to="/accedi">{{ $t('reset.signIn') }}</UButton>
    </template>
    <template v-else-if="invalid">
      <p role="alert" class="text-(--app-danger)">{{ problem ?? $t('reset.invalid') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" to="/accedi/password-dimenticata">
        {{ $t('reset.askAgain') }}
      </UButton>
    </template>
    <form v-else class="space-y-4" novalidate @submit.prevent="submit">
      <fieldset :disabled="!ready" class="min-w-0 space-y-4">
        <p>{{ $t('reset.explain') }}</p>
        <UFormField
          :label="$t('reset.password')"
          :help="$t('reset.help')"
          name="new-password"
          required
          :error="problem ?? undefined"
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <PasswordStrength :password="password" />
        <UButton type="submit" block size="xl" class="min-h-12" :loading="sending">
          {{ $t('reset.submit') }}
        </UButton>
      </fieldset>
    </form>
  </div>
</template>
