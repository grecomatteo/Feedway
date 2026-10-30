<script setup lang="ts">
import type { Me } from '@app/contracts'

interface Passkey {
  id: string
  name: string | null
  createdAt: string | null
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
}
interface SecondFactor {
  required: boolean
  totpEnabled: boolean
  passkeys: Passkey[]
}

const { t } = useI18n()
const { call, failure } = useApi()

useHead({ title: () => t('security.title') })

const { data: me } = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })
const {
  data: factors,
  error,
  refresh,
} = useFetch<SecondFactor>('/api/v1/me/second-factor', {
  key: 'second-factor',
  server: false,
  lazy: true,
})
const signedOut = computed(() => error.value?.statusCode === 401)

/** With the role that requires 2FA, the last factor stays: the panel says why. */
const lastFactor = computed(() => {
  const f = factors.value
  if (!f?.required) return false
  return (f.totpEnabled ? 1 : 0) + f.passkeys.length <= 1
})

// ---- confirmation of identity, asked only when the server wants it
const reauthOpen = ref(false)
let pending: {
  action: (password?: string) => Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
} | null = null
/**
 * Runs `action`; when the server asks for a recent confirmation, asks it and runs it again.
 * Settles only once the action has really run, failed, or the person closed the dialog.
 */
const withReauth: WithReauth = async (action) => {
  try {
    await action()
  } catch (e) {
    if (failure(e).code !== 'REAUTH_REQUIRED') throw e
    pending?.reject(new ReauthCancelled())
    await new Promise<void>((resolve, reject) => {
      pending = { action, resolve, reject }
      reauthOpen.value = true
    })
  }
}
async function reauthDone(password: string | null) {
  const p = pending
  pending = null
  if (!p) return
  try {
    await p.action(password ?? undefined)
    p.resolve()
  } catch (e) {
    p.reject(e)
  }
}
watch(reauthOpen, (open) => {
  if (open || !pending) return
  // closed without confirming
  pending.reject(new ReauthCancelled())
  pending = null
})

// ---- password
const passwordForm = reactive({ current: '', next: '' })
const passwordState = reactive({
  sending: false,
  problem: null as string | null,
  field: '',
  done: false,
})
async function changePassword() {
  Object.assign(passwordState, { sending: true, problem: null, field: '', done: false })
  try {
    await call('POST', '/api/auth/change-password', {
      currentPassword: passwordForm.current,
      newPassword: passwordForm.next,
    })
    passwordForm.current = ''
    passwordForm.next = ''
    passwordState.done = true
  } catch (e) {
    const f = failure(e)
    passwordState.problem = f.message
    passwordState.field = f.code === 'INVALID_PASSWORD' ? 'current' : 'next'
  } finally {
    passwordState.sending = false
  }
}

// ---- authenticator app
const totp = reactive({
  password: '',
  step: 'idle' as 'idle' | 'scan' | 'codes',
  uri: '',
  code: '',
  backupCodes: [] as string[],
  sending: false,
  problem: null as string | null,
})
/** Only the authenticator scheme is ever used as a link. */
const totpLink = computed(() => (totp.uri.startsWith('otpauth://totp/') ? totp.uri : ''))
const totpSecret = computed(() => {
  if (totpLink.value === '') return ''
  try {
    const secret = new URL(totpLink.value).searchParams.get('secret') ?? ''
    return secret.replace(/(.{4})/g, '$1 ').trim()
  } catch {
    return ''
  }
})
/** Secret and codes stay in the page only while they are on screen. */
function resetTotp() {
  Object.assign(totp, { step: 'idle', uri: '', code: '', backupCodes: [], password: '' })
}
onBeforeUnmount(resetTotp)
async function totpAction(action: () => Promise<void>) {
  totp.sending = true
  totp.problem = null
  try {
    await action()
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) totp.problem = failure(e).message
  } finally {
    totp.sending = false
  }
}
const totpBody = (password = totp.password) => (password === '' ? {} : { password })
const startTotp = () =>
  totpAction(async () => {
    const r = await call<{ totpURI: string; backupCodes: string[] }>(
      'POST',
      '/api/auth/two-factor/enable',
      totpBody(),
    )
    Object.assign(totp, { uri: r.totpURI, backupCodes: r.backupCodes, step: 'scan', code: '' })
  })
const verifyTotp = () =>
  totpAction(async () => {
    await call('POST', '/api/auth/two-factor/verify-totp', { code: totp.code.replace(/\s/g, '') })
    Object.assign(totp, { step: 'codes', password: '', uri: '', code: '' })
    await refresh()
  })
const disableTotp = () =>
  totpAction(() =>
    withReauth(async (password) => {
      await call('POST', '/api/auth/two-factor/disable', totpBody(password))
      resetTotp()
      await refresh()
    }),
  )
const regenerateCodes = () =>
  totpAction(() =>
    withReauth(async (password) => {
      const r = await call<{ backupCodes: string[] }>(
        'POST',
        '/api/auth/two-factor/generate-backup-codes',
        totpBody(password),
      )
      Object.assign(totp, { step: 'codes', backupCodes: r.backupCodes, password: '' })
    }),
  )
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('account.title') }}</h1>
      <p v-if="me" class="text-(--app-text-muted)">
        <span :title="me.name">{{ me.displayName }}</span
        >, {{ me.email }}
      </p>
    </header>

    <AccountTabs />

    <p v-if="!factors && !error" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ signedOut ? $t('account.signedOut') : $t('account.loadError') }}
      </p>
      <UButton
        v-if="!signedOut"
        class="min-h-11"
        color="neutral"
        variant="outline"
        @click="() => refresh()"
      >
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else-if="factors">
      <section
        aria-labelledby="security-password"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="security-password" class="text-lg">{{ $t('security.password.title') }}</h2>
        <p class="text-sm text-(--app-text-muted)">{{ $t('security.password.explain') }}</p>
        <form class="space-y-4" novalidate @submit.prevent="changePassword">
          <UFormField
            :label="$t('security.password.current')"
            name="current-password"
            required
            :error="
              passwordState.field === 'current' ? (passwordState.problem ?? undefined) : undefined
            "
          >
            <UInput
              v-model="passwordForm.current"
              type="password"
              autocomplete="current-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <UFormField
            :label="$t('security.password.next')"
            :help="$t('security.password.nextHelp')"
            name="new-password"
            required
            :error="
              passwordState.field === 'next' ? (passwordState.problem ?? undefined) : undefined
            "
          >
            <UInput
              v-model="passwordForm.next"
              type="password"
              autocomplete="new-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <div class="flex flex-wrap items-center gap-3">
            <UButton type="submit" class="min-h-11" :loading="passwordState.sending">
              {{ $t('security.password.submit') }}
            </UButton>
            <p v-if="passwordState.done" role="status" class="text-(--app-success)">
              {{ $t('security.password.done') }}
            </p>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="security-totp"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="security-totp" class="text-lg">{{ $t('security.totp.title') }}</h2>
          <UBadge :color="factors.totpEnabled ? 'success' : 'neutral'" variant="subtle">
            {{ factors.totpEnabled ? $t('security.totp.on') : $t('security.totp.off') }}
          </UBadge>
        </div>
        <p class="text-sm text-(--app-text-muted)">{{ $t('security.totp.explain') }}</p>

        <div v-if="totp.step === 'scan'" class="space-y-4">
          <p>{{ $t('security.totp.scan') }}</p>
          <p class="font-mono text-lg break-all" :aria-label="$t('security.totp.secretLabel')">
            {{ totpSecret }}
          </p>
          <UButton
            v-if="totpLink"
            :to="totpLink"
            external
            class="min-h-11"
            color="neutral"
            variant="outline"
          >
            {{ $t('security.totp.openApp') }}
          </UButton>
          <form class="space-y-4" novalidate @submit.prevent="verifyTotp">
            <UFormField
              :label="$t('security.totp.code')"
              name="totp-code"
              required
              :error="totp.problem ?? undefined"
            >
              <UInput
                v-model="totp.code"
                inputmode="numeric"
                autocomplete="one-time-code"
                class="w-full"
                size="xl"
              />
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UButton type="submit" class="min-h-11" :loading="totp.sending">
                {{ $t('security.totp.verify') }}
              </UButton>
              <UButton class="min-h-11" color="neutral" variant="ghost" @click="resetTotp">
                {{ $t('security.cancel') }}
              </UButton>
            </div>
          </form>
        </div>

        <div v-else-if="totp.step === 'codes'" class="space-y-3" role="status">
          <p class="font-semibold">{{ $t('security.totp.codesTitle') }}</p>
          <p>{{ $t('security.totp.codesExplain') }}</p>
          <ul class="grid grid-cols-2 gap-2 font-mono" :aria-label="$t('security.totp.codesTitle')">
            <li v-for="code in totp.backupCodes" :key="code">{{ code }}</li>
          </ul>
          <UButton class="min-h-11" color="neutral" variant="outline" @click="resetTotp">
            {{ $t('security.totp.codesSaved') }}
          </UButton>
        </div>

        <form v-else class="space-y-4" novalidate @submit.prevent>
          <UFormField
            :label="$t('security.password.current')"
            :help="$t('security.totp.passwordHelp')"
            name="totp-password"
            :error="totp.problem ?? undefined"
          >
            <UInput
              v-model="totp.password"
              type="password"
              autocomplete="current-password"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <div class="flex flex-wrap gap-3">
            <UButton
              v-if="!factors.totpEnabled"
              class="min-h-11"
              :loading="totp.sending"
              @click="startTotp"
            >
              {{ $t('security.totp.enable') }}
            </UButton>
            <template v-else>
              <UButton
                class="min-h-11"
                color="neutral"
                variant="outline"
                :loading="totp.sending"
                @click="regenerateCodes"
              >
                {{ $t('security.totp.regenerate') }}
              </UButton>
              <UButton
                class="min-h-11"
                color="error"
                variant="outline"
                :disabled="lastFactor"
                :aria-describedby="lastFactor ? 'last-factor-totp' : undefined"
                @click="disableTotp"
              >
                {{ $t('security.totp.disable') }}
              </UButton>
            </template>
          </div>
          <p
            v-if="factors.totpEnabled && lastFactor"
            id="last-factor-totp"
            class="text-sm text-(--app-text-muted)"
          >
            {{ $t('security.lastFactor') }}
          </p>
        </form>
      </section>

      <PasskeyList
        :passkeys="factors.passkeys"
        :last-factor="lastFactor"
        :with-reauth="withReauth"
        @changed="() => refresh()"
      />

      <ReauthDialog
        v-model:open="reauthOpen"
        :passkeys="factors.passkeys.length"
        @done="reauthDone"
      />
    </template>
  </div>
</template>
