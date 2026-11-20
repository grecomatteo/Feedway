<script setup lang="ts">
import type { ApiFailure } from '~/composables/useApi'

/** The link of the email that confirms a new address: a page before the panel (D-99). */
definePageMeta({ layout: 'auth' })
// a click before the page runs in the browser would be lost
const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()
const route = useRoute()

useHead({ title: () => t('confirmEmail.title') })

// Read once, then dropped from the address bar: the link works only once anyway.
const token = typeof route.query['t'] === 'string' ? route.query['t'] : ''
const router = useRouter()
onMounted(() => {
  // through the router: it keeps its own copy of the address in history.state
  if (token !== '') void router.replace({ path: route.path })
})

const sending = ref(false)
const problem = ref<ApiFailure | null>(null)
const confirmed = ref<string | null>(null)

// A button, not an automatic request: mail scanners that open links must not confirm anything.
async function confirm() {
  sending.value = true
  problem.value = null
  try {
    const { email } = await call<{ email: string }>('POST', '/api/v1/email-change/confirm', {
      token,
    })
    confirmed.value = email
  } catch (e) {
    problem.value = failure(e)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section aria-labelledby="confirm-email" class="grid gap-5">
    <h1 id="confirm-email" class="text-center">{{ $t('confirmEmail.title') }}</h1>
    <template v-if="confirmed">
      <p role="status" class="flex items-start gap-2">
        <UIcon
          name="i-lucide-circle-check"
          class="mt-0.5 size-4 shrink-0 text-(--app-success)"
          aria-hidden="true"
        />
        {{ $t('confirmEmail.done', { email: confirmed }) }}
      </p>
      <p class="text-(--app-text-muted)">{{ $t('confirmEmail.doneNext') }}</p>
      <UButton to="/accedi" block size="xl" class="min-h-control">
        {{ $t('home.signIn') }}
      </UButton>
    </template>
    <p v-else-if="token === ''" role="alert" class="flex items-start gap-2">
      <UIcon
        name="i-lucide-triangle-alert"
        class="mt-0.5 size-4 shrink-0 text-(--app-danger)"
        aria-hidden="true"
      />
      {{ $t('confirmEmail.missing') }}
    </p>
    <template v-else>
      <p>{{ $t('confirmEmail.intro') }}</p>
      <p v-if="problem" role="alert" class="flex items-start gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ problem.message }}
      </p>
      <UButton
        block
        size="xl"
        class="min-h-control"
        :loading="sending"
        :disabled="!ready"
        @click="confirm"
      >
        {{ $t('confirmEmail.button') }}
      </UButton>
    </template>
  </section>
</template>
