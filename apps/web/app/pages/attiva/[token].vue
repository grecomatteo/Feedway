<script setup lang="ts">
import type { ActivateResponse, LinkDescription } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
const { call, failure } = useApi()
const passkey = usePasskey()
const session = useSession()
const route = useRoute()

useHead({ title: () => t('activate.title') })

// The link's token leaves the address bar (history, the `dopo` of the sign-in page): it is kept
// for this tab only, under a neutral address.
const HIDDEN = '-'
const STORE_KEY = 'feedway:activation-token'
const fromPath = String(route.params['token'] ?? '')
function storedToken(): string {
  try {
    return sessionStorage.getItem(STORE_KEY) ?? ''
  } catch {
    return ''
  }
}
const token = fromPath === HIDDEN ? (import.meta.client ? storedToken() : '') : fromPath
const path = `/api/v1/links/${encodeURIComponent(token)}`
const router = useRouter()
onMounted(() => {
  if (fromPath === HIDDEN || token === '') return
  try {
    sessionStorage.setItem(STORE_KEY, token)
    void router.replace({ path: `/attiva/${HIDDEN}` })
  } catch {
    // no storage: the token stays in the address, the page still works
  }
})

const { data: link, error: linkError } = useFetch<LinkDescription>(path, {
  key: 'activation-link',
  server: false,
  lazy: true,
  immediate: token !== '',
})
const linkProblem = computed(() =>
  token === ''
    ? { ...failure(null), code: 'LINK_INVALID' }
    : linkError.value
      ? failure(linkError.value)
      : null,
)

// an existing account accepts while signed in as that account
const signedInAs = ref<string | null>(null)
/** The link once it answered, or null when it failed or there is no token. */
function linkSettled(): Promise<LinkDescription | null> {
  if (token === '') return Promise.resolve(null)
  return new Promise((resolve) => {
    const stop = watch(
      [link, linkError],
      ([l, e]) => {
        if (!l && !e) return
        queueMicrotask(() => stop())
        resolve(l ?? null)
      },
      { immediate: true },
    )
  })
}
onMounted(async () => {
  const view = await session.load().catch(() => null)
  const me = view?.state === 'active' || view?.state === 'second_factor' ? view.me : null
  if (view?.state === 'active') signedInAs.value = view.me.email
  if (!me) return
  // someone else, even halfway through signing in: the page asks to leave that account first
  const invited = await linkSettled()
  if (invited && !invited.existingUser && invited.email !== me.email) {
    signedInAs.value = me.email
    return
  }
  // reloaded after activating: the account exists. Without a passkey or a password it has no
  // way in yet (a passkey cancelled), and that comes first; otherwise the second factor is
  // still to set up (the component asks the password again).
  if (!me.hasPassword && me.secondFactor.passkeys === 0 && token !== '') {
    slug = me.organizations[0]?.slug ?? ''
    account = { name: me.name, nickname: me.nickname }
    step.value = 'method'
  } else if (view?.state === 'second_factor') {
    slug = me.organizations[0]?.slug ?? ''
    step.value = 'totp'
  }
})

const form = reactive({
  name: '',
  nickname: '',
  method: 'passkey' as 'passkey' | 'password',
  password: '',
})
onMounted(() => {
  if (!passkey.supported()) form.method = 'password'
})
const methodItems = computed(() => [
  ...(passkey.supported()
    ? [{ value: 'passkey', label: t('activate.passkey'), description: t('activate.passkeyHelp') }]
    : []),
  { value: 'password', label: t('activate.password'), description: t('activate.passwordHelp') },
])

const step = ref<'form' | 'method' | 'totp' | 'backup'>('form')
/** The account the activation created, for the `method` step after a reload. */
let account: { name: string; nickname: string | null } | null = null
/** `method` step: the password field is open. */
const choosingPassword = ref(false)
const sending = ref(false)
const problem = ref<ApiFailure | null>(null)
/** The password typed in the form, kept only until the authenticator app is set up. */
const typedPassword = ref<string | undefined>(undefined)
let slug = ''

const fieldError = (field: string) =>
  problem.value?.field === field ? problem.value.message : undefined
const formError = computed(() =>
  problem.value && !['name', 'nickname', 'password'].includes(problem.value.field ?? '')
    ? problem.value.message
    : null,
)

async function goIn() {
  const view = await session.load()
  if (view.state === 'second_factor' && view.me) {
    step.value = 'totp'
    return
  }
  if (view.state === 'second_factor') return navigateTo('/accedi/secondo-fattore')
  await navigateTo(slug ? `/${slug}` : '/accedi')
}

/** Signed in as someone else: that session closes before a new account takes this browser. */
async function leaveOther() {
  sending.value = true
  problem.value = null
  try {
    await session.signOut({ stay: { keep: 'activation-link' } })
    signedInAs.value = null
  } catch {
    problem.value = { ...failure(null), message: t('nav.signOutFailed') }
  } finally {
    sending.value = false
  }
}

function problemOf(e: unknown): ApiFailure {
  const f =
    e instanceof DOMException
      ? { ...failure(null), message: t('activate.passkeyCancelled') }
      : failure(e)
  return f.field === 'password' && f.code === 'VALIDATION'
    ? { ...f, message: t('activate.weakPassword') }
    : f
}

/**
 * The passkey of an account the activation already created: registered, the link closed, then
 * a passkey sign-in. A cancel or an error leaves the account without a way in: the `method`
 * step offers the passkey again or a password, never the activation from scratch.
 */
/** The passkey already created: a retry after a later failure only signs in with it. */
let registered: Awaited<ReturnType<typeof passkey.register>> | null = null
async function withPasskey() {
  try {
    registered ??= await passkey.register(t('passkeyPrompt.defaultName'))
    const created = registered
    await call('POST', `${path}/complete`)
    // the activation session gives way to a passkey sign-in (it satisfies the second factor)
    await passkey.authenticate({ only: created })
  } catch (e) {
    problem.value = problemOf(e)
    step.value = 'method'
    return
  }
  // where the role requires a second factor, this passkey is the only one: offer a backup
  const factors = await call<{ required: boolean }>('GET', '/api/v1/me/second-factor')
  if (factors.required) step.value = 'backup'
  else await goIn()
}

async function activate(body: Record<string, unknown>) {
  sending.value = true
  problem.value = null
  try {
    const r = await call<ActivateResponse>('POST', `${path}/activate`, body)
    slug = r.organizationSlug
    if (r.next === 'register_passkey') {
      account = { name: String(body['name'] ?? ''), nickname: (body['nickname'] as string) ?? null }
      await withPasskey()
      return
    }
    if (typeof body['password'] === 'string') typedPassword.value = body['password']
    form.password = ''
    choosingPassword.value = false
    await goIn()
  } catch (e) {
    problem.value = problemOf(e)
  } finally {
    sending.value = false
  }
}

async function retryPasskey() {
  sending.value = true
  problem.value = null
  try {
    await withPasskey()
  } catch (e) {
    problem.value = problemOf(e)
  } finally {
    sending.value = false
  }
}

/** `method` step: the activation again, with a password, from the session it opened. */
const savePassword = () =>
  activate({
    name: account?.name ?? form.name,
    nickname: account?.nickname ?? null,
    password: form.password,
  })

const submitNew = () =>
  activate({
    name: form.name,
    nickname: form.nickname.trim() || null,
    password: form.method === 'password' ? form.password : null,
  })
const acceptExisting = () => activate({})

async function totpDone() {
  typedPassword.value = undefined
  // the session now satisfies the second factor: read it again before moving on
  await session.load()
  await navigateTo(slug ? `/${slug}` : '/accedi')
}

const heading = computed(() => {
  const l = link.value
  if (!l) return t('activate.title')
  if (l.existingUser) return t('activate.joinTitle', { agency: l.organizationName ?? '' })
  return l.purpose === 'bootstrap' ? t('activate.bootstrapTitle') : t('activate.title')
})
const signInTo = computed(() => ({ path: '/accedi', query: { dopo: `/attiva/${HIDDEN}` } }))
</script>

<template>
  <div class="space-y-5">
    <TotpEnrollment v-if="step === 'totp'" :password="typedPassword" @done="totpDone" />
    <BackupFactorOffer v-else-if="step === 'backup'" @later="goIn" />

    <section v-else-if="step === 'method'" aria-labelledby="activate-method" class="space-y-4">
      <h1 id="activate-method" class="text-2xl">{{ $t('activate.methodTitle') }}</h1>
      <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
      <p>{{ $t('activate.methodExplain') }}</p>
      <form v-if="choosingPassword" class="space-y-4" novalidate @submit.prevent="savePassword">
        <UFormField
          :label="$t('signIn.password')"
          :help="$t('reset.help')"
          name="new-password"
          required
          :error="fieldError('password')"
        >
          <UInput
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <PasswordStrength :password="form.password" />
        <UButton type="submit" block size="xl" class="min-h-12" :loading="sending">
          {{ $t('activate.savePassword') }}
        </UButton>
      </form>
      <div class="space-y-3">
        <UButton
          v-if="passkey.supported()"
          block
          size="xl"
          class="min-h-12"
          icon="i-lucide-key-round"
          :variant="choosingPassword ? 'outline' : 'solid'"
          :color="choosingPassword ? 'neutral' : 'primary'"
          :loading="sending && !choosingPassword"
          :disabled="sending"
          @click="retryPasskey"
        >
          {{ $t('activate.retryPasskey') }}
        </UButton>
        <UButton
          v-if="!choosingPassword"
          block
          size="xl"
          class="min-h-12"
          color="neutral"
          variant="outline"
          :disabled="sending"
          @click="choosingPassword = true"
        >
          {{ $t('activate.usePassword') }}
        </UButton>
      </div>
    </section>

    <template v-else>
      <h1 class="text-2xl">{{ heading }}</h1>

      <p v-if="!link && !linkProblem" role="status">{{ $t('activate.loading') }}</p>
      <p v-else-if="linkProblem" role="alert" class="text-(--app-danger)">
        {{ linkProblem.code === 'LINK_INVALID' ? $t('activate.invalid') : linkProblem.message }}
      </p>

      <template v-else-if="link && link.existingUser">
        <p>{{ $t('activate.existingExplain', { email: link.email }) }}</p>
        <template v-if="signedInAs === link.email">
          <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
          <UButton block size="xl" class="min-h-12" :loading="sending" @click="acceptExisting">
            {{ $t('activate.accept') }}
          </UButton>
        </template>
        <template v-else>
          <p v-if="signedInAs" class="text-sm text-(--app-text-muted)">
            {{ $t('activate.otherAccount', { email: signedInAs }) }}
          </p>
          <UButton block size="xl" class="min-h-12" :to="signInTo">
            {{ $t('activate.signInFirst') }}
          </UButton>
        </template>
      </template>

      <template v-else-if="link && signedInAs !== null && signedInAs !== link.email">
        <p role="alert">
          {{ $t('activate.otherAccountNew', { email: signedInAs, invited: link.email }) }}
        </p>
        <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
        <UButton block size="xl" class="min-h-12" :loading="sending" @click="leaveOther">
          {{ $t('activate.signOutAndContinue') }}
        </UButton>
      </template>

      <form v-else-if="link" class="space-y-4" novalidate @submit.prevent="submitNew">
        <p>
          {{
            link.organizationName
              ? $t('activate.intro', { agency: link.organizationName, email: link.email })
              : $t('activate.introNoAgency', { email: link.email })
          }}
        </p>
        <UFormField :label="$t('activate.name')" name="name" required :error="fieldError('name')">
          <UInput v-model="form.name" autocomplete="name" class="w-full" size="xl" />
        </UFormField>
        <UFormField
          :label="$t('account.profile.nickname')"
          :hint="$t('account.optional')"
          :help="$t('account.profile.nicknameHelp')"
          name="nickname"
          :error="fieldError('nickname')"
        >
          <UInput v-model="form.nickname" autocomplete="nickname" class="w-full" size="xl" />
        </UFormField>
        <UFormField :label="$t('activate.method')" name="method">
          <URadioGroup
            v-model="form.method"
            :items="methodItems"
            :ui="{ item: 'min-h-11 items-start py-1' }"
          />
        </UFormField>
        <template v-if="form.method === 'password'">
          <UFormField
            :label="$t('signIn.password')"
            :help="$t('reset.help')"
            name="new-password"
            required
            :error="fieldError('password')"
          >
            <UInput
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <PasswordStrength :password="form.password" />
        </template>
        <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
        <UButton type="submit" block size="xl" class="min-h-12" :loading="sending">
          {{ $t('activate.submit') }}
        </UButton>
      </form>
    </template>
  </div>
</template>
