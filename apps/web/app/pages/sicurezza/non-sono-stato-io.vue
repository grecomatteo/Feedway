<script setup lang="ts">
import type { ApiFailure } from '~/composables/useApi'

/** The link of a security email, «Non sono stato io»: a page before the panel (D-99). */
definePageMeta({ layout: 'auth' })
// a click before the page runs in the browser would be lost
const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()
const route = useRoute()

useHead({ title: () => t('notMe.title') })

// Read once, then dropped from the address bar, like the other links from an email.
const token = typeof route.query['t'] === 'string' ? route.query['t'] : ''
const router = useRouter()
onMounted(() => {
  // through the router: it keeps its own copy of the address in history.state
  if (token !== '') void router.replace({ path: route.path })
})

const sending = ref(false)
const problem = ref<ApiFailure | null>(null)
const locked = ref(false)

// A button, not an automatic request: mail scanners that open links must not lock anyone out.
async function lock() {
  sending.value = true
  problem.value = null
  try {
    await call('POST', '/api/v1/security/lock', { token })
    locked.value = true
  } catch (e) {
    problem.value = failure(e)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section aria-labelledby="not-me" class="grid gap-5">
    <h1 id="not-me" class="text-center">{{ $t('notMe.title') }}</h1>
    <p v-if="locked" role="status" class="flex items-start gap-2">
      <UIcon
        name="i-lucide-circle-check"
        class="mt-0.5 size-4 shrink-0 text-(--app-success)"
        aria-hidden="true"
      />
      {{ $t('notMe.done') }}
    </p>
    <p v-else-if="token === ''" role="alert" class="flex items-start gap-2">
      <UIcon
        name="i-lucide-triangle-alert"
        class="mt-0.5 size-4 shrink-0 text-(--app-danger)"
        aria-hidden="true"
      />
      {{ $t('notMe.missing') }}
    </p>
    <template v-else>
      <p>{{ $t('notMe.intro') }}</p>
      <p v-if="problem" role="alert" class="flex items-start gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ problem.message }}
      </p>
      <UButton
        block
        size="xl"
        class="min-h-control"
        color="error"
        :loading="sending"
        :disabled="!ready"
        @click="lock"
      >
        {{ $t('notMe.submit') }}
      </UButton>
    </template>
  </section>
</template>
