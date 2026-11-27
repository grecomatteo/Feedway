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
  const view = await session.load({ themeWithNextPage: true })
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
    const view = await session.load({ themeWithNextPage: true })
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
  <div v-else class="grid gap-4">
    <h1 class="mb-1 text-center">{{ $t('signIn.title') }}</h1>
    <p v-if="notice" role="status" class="text-center text-(--app-success)">{{ notice }}</p>

    <UButton
      block
      color="neutral"
      variant="outline"
      class="h-11 bg-(--app-surface) font-semibold"
      icon="i-lucide-key-round"
      :loading="sending === 'passkey'"
      :disabled="sending !== null || !ready"
      @click="withPasskey"
    >
      {{ $t('signIn.withPasskey') }}
    </UButton>

    <div
      class="my-1 flex items-center gap-3 text-detail text-(--app-text-muted)"
      aria-hidden="true"
    >
      <span class="h-px flex-1 bg-(--app-border)" />{{ $t('signIn.or')
      }}<span class="h-px flex-1 bg-(--app-border)" />
    </div>

    <form novalidate @submit.prevent="withPassword">
      <fieldset :disabled="!ready" class="grid min-w-0 gap-4">
        <div class="grid gap-2">
          <label for="sign-in-email" class="font-medium">{{ $t('signIn.email') }}</label>
          <UInput
            id="sign-in-email"
            v-model="form.email"
            type="email"
            name="email"
            required
            autocomplete="username webauthn"
            class="w-full"
            :ui="{ base: 'h-11! bg-(--app-surface)' }"
          />
        </div>
        <div class="grid gap-2">
          <div class="flex items-baseline justify-between gap-3">
            <label for="sign-in-password" class="font-medium">{{ $t('signIn.password') }}</label>
            <NuxtLink
              to="/accedi/password-dimenticata"
              class="text-detail underline underline-offset-2"
              :aria-label="$t('signIn.forgotLabel')"
            >
              {{ $t('signIn.forgot') }}
            </NuxtLink>
          </div>
          <UInput
            id="sign-in-password"
            v-model="form.password"
            type="password"
            name="password"
            required
            autocomplete="current-password"
            class="w-full"
            :ui="{ base: 'h-11! bg-(--app-surface)' }"
          />
        </div>
        <p v-if="problemText" role="alert" class="text-(--app-danger)">{{ problemText }}</p>
        <UButton
          type="submit"
          block
          class="h-11 font-semibold"
          :loading="sending === 'password'"
          :disabled="sending !== null"
        >
          {{ $t('signIn.withPassword') }}
        </UButton>
      </fieldset>
    </form>

    <!-- at the foot of the window, so the column stays in the middle as in screen 01 -->
    <p class="absolute inset-x-0 bottom-6 text-center text-detail text-(--app-text-muted)">
      <NuxtLink to="/privacy" class="underline underline-offset-2">{{
        $t('privacyNotice.link')
      }}</NuxtLink>
    </p>
  </div>
</template>
