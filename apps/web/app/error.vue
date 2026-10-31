<script setup lang="ts">
import type { NuxtError } from '#app'
import { PRODUCT_NAME } from '@app/config/product'

const props = defineProps<{ error: NuxtError }>()
const { t } = useI18n()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Kind = 'notFound' | 'forbidden' | 'unauthenticated' | 'rateLimited' | 'generic'

const status = computed(() => props.error.status ?? props.error.statusCode ?? 500)

// Only our own copy is shown, chosen by status: the error's message and stack may come from
// anywhere (a library, the server) and never reach the page.
const kind = computed<Kind>(() => {
  switch (status.value) {
    case 404:
      return 'notFound'
    case 403:
      return 'forbidden'
    case 401:
      return 'unauthenticated'
    case 429:
      return 'rateLimited'
    default:
      return 'generic'
  }
})

function readData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data) as unknown
  } catch {
    return null
  }
}

/** The request id the server gave this error, if it is one: support finds the log with it. */
const requestId = computed(() => {
  const data = readData(props.error.data) as
    { requestId?: unknown; error?: { requestId?: unknown } } | null | undefined
  const found = [data?.requestId, data?.error?.requestId].find(
    (v): v is string => typeof v === 'string' && UUID.test(v),
  )
  return found ?? null
})

// after a navigation inside the app, focus moves to the heading so a screen reader announces
// the error; on a page load the browser starts at the top already
const nuxtApp = useNuxtApp()
const heading = useTemplateRef<HTMLHeadingElement>('heading')
onMounted(() => {
  if (!nuxtApp.isHydrating) heading.value?.focus()
})

useHead({ title: () => `${t(`errorPage.${kind.value}.title`)} · ${PRODUCT_NAME}` })

const goHome = () => clearError({ redirect: '/' })
const signIn = () => clearError({ redirect: '/accedi' })
</script>

<template>
  <UApp>
    <!-- never the layout of the address: an agency's layout would draw that agency around it -->
    <NuxtLayout name="default">
      <section class="py-8 sm:py-16" aria-labelledby="error-title">
        <p class="mb-2 text-sm font-medium text-(--app-text-muted)">
          {{ t('errorPage.statusLabel', { status }) }}
        </p>
        <h1 id="error-title" ref="heading" tabindex="-1" class="mb-3 text-3xl outline-none">
          {{ t(`errorPage.${kind}.title`) }}
        </h1>
        <p class="mb-6 max-w-prose text-(--app-text-muted)">
          {{ t(`errorPage.${kind}.description`) }}
        </p>
        <p
          v-if="requestId && kind === 'generic'"
          class="mb-6 rounded-lg border border-(--app-border) bg-(--app-surface) p-3 text-sm"
        >
          {{ t('errorPage.requestId') }}:
          <code class="break-all font-mono" data-testid="request-id">{{ requestId }}</code>
        </p>
        <div class="flex flex-wrap gap-3">
          <UButton v-if="kind === 'unauthenticated'" class="min-h-11" @click="signIn">
            {{ t('errorPage.signIn') }}
          </UButton>
          <UButton
            class="min-h-11"
            :color="kind === 'unauthenticated' ? 'neutral' : 'primary'"
            :variant="kind === 'unauthenticated' ? 'outline' : 'solid'"
            @click="goHome"
          >
            {{ t('errorPage.home') }}
          </UButton>
        </div>
      </section>
    </NuxtLayout>
  </UApp>
</template>
