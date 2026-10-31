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
onMounted(async () => {
  const view = await session.load().catch(() => null)
  if (view?.state === 'active') signedInAs.value = view.me.email
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

const step = ref<'form' | 'totp'>('form')
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

async function activate(body: Record<string, unknown>) {
  sending.value = true
  problem.value = null
  try {
    const r = await call<ActivateResponse>('POST', `${path}/activate`, body)
    slug = r.organizationSlug
    if (r.next === 'register_passkey') {
      const created = await passkey.register(t('passkeyPrompt.defaultName'))
      await call('POST', `${path}/complete`)
      // the activation session gives way to a passkey sign-in (it satisfies the second factor)
      await passkey.authenticate({ only: created })
    }
    if (typeof body['password'] === 'string') typedPassword.value = body['password']
    form.password = ''
    await goIn()
  } catch (e) {
    const f =
      e instanceof DOMException
        ? { ...failure(null), message: t('activate.passkeyCancelled') }
        : failure(e)
    problem.value =
      f.field === 'password' && f.code === 'VALIDATION'
        ? { ...f, message: t('activate.weakPassword') }
        : f
  } finally {
    sending.value = false
  }
}

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
