<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()

useHead({ title: () => t('forgot.title') })

const email = ref('')
const sending = ref(false)
const outcome = ref<'sent' | 'no_mail' | null>(null)
const problem = ref<string | null>(null)

async function submit() {
  sending.value = true
  problem.value = null
  try {
    await call('POST', '/api/auth/request-password-reset', {
      email: email.value.trim(),
      redirectTo: '/reimposta',
    })
    outcome.value = 'sent'
  } catch (e) {
    const f = failure(e)
    if (f.code === 'MAIL_NOT_CONFIGURED') outcome.value = 'no_mail'
    else
      problem.value =
        f.status === 429
          ? t('signIn.wait', { seconds: f.retryAfter ?? 60 })
          : f.status === 400 || f.code === 'VALIDATION'
            ? t('forgot.invalid')
            : f.message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('forgot.title') }}</h1>
    <p v-if="outcome === 'sent'" role="status">{{ $t('forgot.sent') }}</p>
    <p v-else-if="outcome === 'no_mail'" role="status">{{ $t('forgot.noMail') }}</p>
    <template v-else>
      <p>{{ $t('forgot.explain') }}</p>
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <fieldset :disabled="!ready" class="min-w-0 space-y-4">
          <UFormField
            :label="$t('signIn.email')"
            name="email"
            required
            :error="problem ?? undefined"
          >
            <UInput v-model="email" type="email" autocomplete="email" class="w-full" size="xl" />
          </UFormField>
          <UButton type="submit" block size="xl" class="min-h-12" :loading="sending">
            {{ $t('forgot.submit') }}
          </UButton>
        </fieldset>
      </form>
    </template>
    <UButton class="min-h-11" color="neutral" variant="link" to="/accedi">
      {{ $t('verify.back') }}
    </UButton>
  </div>
</template>
