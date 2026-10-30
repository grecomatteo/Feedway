<script setup lang="ts">
import type { ApiFailure } from '~/composables/useApi'

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
  <section aria-labelledby="not-me" class="space-y-4">
    <h1 id="not-me" class="text-3xl">{{ $t('notMe.title') }}</h1>
    <p v-if="locked" role="status" class="flex items-center gap-2 text-(--app-success)">
      <UIcon name="i-lucide-circle-check" aria-hidden="true" />
      {{ $t('notMe.done') }}
    </p>
    <p v-else-if="token === ''" role="alert" class="text-(--app-danger)">
      {{ $t('notMe.missing') }}
    </p>
    <template v-else>
      <p>{{ $t('notMe.intro') }}</p>
      <p v-if="problem" role="alert" class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ problem.message }}
      </p>
      <UButton class="min-h-11" color="error" :loading="sending" @click="lock">
        {{ $t('notMe.submit') }}
      </UButton>
    </template>
  </section>
</template>
