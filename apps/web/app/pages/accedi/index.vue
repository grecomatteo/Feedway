<script setup lang="ts">
import type { ApiFailure } from '~/composables/useApi'

definePageMeta({ layout: 'auth' })

const ready = useHydrated()

const { t } = useI18n()
const { call, failure } = useApi()
const passkey = usePasskey()
const session = useSession()
const route = useRoute()

useHead({ title: () => t('signIn.title') })

const next = computed(() => safeNext(route.query['dopo']))
/** Why the person is asked to sign in again: only known reasons, never text from the address. */
const notice = computed(() => (route.query['avviso'] === 'ruolo' ? t('signIn.roleChanged') : null))
const form = reactive({ email: '', password: '' })
const sending = ref<'password' | 'passkey' | null>(null)
const problem = ref<ApiFailure | null>(null)
/** After a password sign-in: the offer to create a passkey, once per browser session. */
const offerPasskey = ref(false)
const PROMPT_KEY = 'feedway:passkey-offered'

const problemText = computed(() => {
  const p = problem.value
  if (!p) return null
  if (p.status === 429)
    return p.retryAfter ? t('signIn.wait', { seconds: p.retryAfter }) : t('signIn.tooMany')
  if (p.code === 'INVALID_EMAIL_OR_PASSWORD' || p.code === 'VALIDATION' || p.status === 401)
    return t('signIn.invalid')
  return p.message
})

async function continueSignedIn() {
  const view = await session.load()
  if (view.state === 'second_factor') return navigateTo('/accedi/secondo-fattore')
  if (view.state === 'active') return navigateTo(session.home(view.me, next.value))
  problem.value = { ...failure(null), message: t('signIn.invalid') }
}

/** Passkeys in the email field's suggestions, while the page is open. */
let autofill: AbortController | null = null
let autofillRun: Promise<void> | null = null
onMounted(() => {
  autofillRun = (async () => {
    if (!(await passkey.autofillSupported())) return
    autofill = new AbortController()
    try {
      await passkey.authenticate({ autofill: true, signal: autofill.signal })
      await continueSignedIn()
    } catch {
      // aborted or dismissed: the buttons are still there
    }
  })()
})
onBeforeUnmount(() => autofill?.abort())

async function withPasskey() {
  autofill?.abort()
  // the server keeps one challenge per browser: the suggestion's request must end before the
  // button asks for its own, or the later answer replaces it ("Challenge not found")
  sending.value = 'passkey'
  problem.value = null
  await autofillRun
  try {
    await passkey.authenticate()
    await continueSignedIn()
  } catch (e) {
    problem.value =
      e instanceof DOMException || (e instanceof Error && e.message === 'passkey not used')
        ? { ...failure(null), message: t('signIn.passkeyCancelled') }
        : failure(e)
  } finally {
    sending.value = null
  }
}

async function withPassword() {
  sending.value = 'password'
  problem.value = null
  try {
    const r = await call<{ twoFactorRedirect?: boolean }>('POST', '/api/auth/sign-in/email', {
      email: form.email.trim(),
      password: form.password,
    })
    form.password = ''
    if (r.twoFactorRedirect === true)
      return await navigateTo({
        path: '/accedi/verifica',
        query: next.value ? { dopo: next.value } : {},
      })
    const view = await session.load()
    if (view.state === 'second_factor') return await navigateTo('/accedi/secondo-fattore')
    if (view.state !== 'active') return
    const offered = (() => {
      try {
        return sessionStorage.getItem(PROMPT_KEY) === '1'
      } catch {
        return true
      }
    })()
    if (view.me.secondFactor.passkeys === 0 && passkey.supported() && !offered) {
      offerPasskey.value = true
      return
    }
    await navigateTo(session.home(view.me, next.value))
  } catch (e) {
    problem.value = failure(e)
  } finally {
    sending.value = null
  }
}

async function skipPasskey() {
  try {
    sessionStorage.setItem(PROMPT_KEY, '1')
  } catch {
    // private window: the offer may come back next time
  }
  const view = session.view.value
  if (view.state === 'active') await navigateTo(session.home(view.me, next.value))
}
</script>

<template>
  <PasskeyPrompt v-if="offerPasskey" @done="skipPasskey" />
  <div v-else class="space-y-5">
    <h1 class="text-2xl">{{ $t('signIn.title') }}</h1>
    <p v-if="notice" role="status" class="text-(--app-success)">{{ notice }}</p>

    <UButton
      block
      size="xl"
      class="min-h-12"
      icon="i-lucide-key-round"
      :loading="sending === 'passkey'"
      :disabled="sending !== null || !ready"
      @click="withPasskey"
    >
      {{ $t('signIn.withPasskey') }}
    </UButton>

    <div class="flex items-center gap-3 text-sm text-(--app-text-muted)" aria-hidden="true">
      <span class="h-px flex-1 bg-(--app-border)" />{{ $t('signIn.or')
      }}<span class="h-px flex-1 bg-(--app-border)" />
    </div>

    <form class="space-y-4" novalidate @submit.prevent="withPassword">
      <fieldset :disabled="!ready" class="min-w-0 space-y-4">
        <UFormField :label="$t('signIn.email')" name="email" required>
          <UInput
            v-model="form.email"
            type="email"
            autocomplete="username webauthn"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UFormField :label="$t('signIn.password')" name="password" required>
          <UInput
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <p v-if="problemText" role="alert" class="text-(--app-danger)">{{ problemText }}</p>
        <UButton
          type="submit"
          block
          size="xl"
          color="neutral"
          variant="outline"
          class="min-h-12"
          :loading="sending === 'password'"
          :disabled="sending !== null"
        >
          {{ $t('signIn.withPassword') }}
        </UButton>
      </fieldset>
    </form>

    <p class="text-sm text-(--app-text-muted)">
      <NuxtLink to="/accedi/password-dimenticata" class="underline">
        {{ $t('signIn.forgot') }}
      </NuxtLink>
      {{ $t('signIn.forgotHint') }}
    </p>
  </div>
</template>
