<script setup lang="ts">
/**
 * The first authenticator app of a session that owes the second factor: key and link (no QR:
 * it would need a new package, see the Task 24 note), the code, then the 10 recovery codes.
 * `password`: already typed on the page (activation); otherwise the component asks it.
 */
const props = defineProps<{ password?: string }>()
const emit = defineEmits<{ done: [] }>()
const { call, failure } = useApi()

const state = reactive({
  password: '',
  step: 'start' as 'start' | 'scan' | 'codes',
  uri: '',
  code: '',
  backupCodes: [] as string[],
  sending: false,
  problem: null as string | null,
})
const link = computed(() => (state.uri.startsWith('otpauth://totp/') ? state.uri : ''))
const secret = computed(() => {
  if (link.value === '') return ''
  try {
    return (new URL(link.value).searchParams.get('secret') ?? '').replace(/(.{4})/g, '$1 ').trim()
  } catch {
    return ''
  }
})
/** Key and codes leave the page as soon as they are not needed. */
onBeforeUnmount(() => Object.assign(state, { uri: '', backupCodes: [], password: '', code: '' }))

async function run(action: () => Promise<void>) {
  state.sending = true
  state.problem = null
  try {
    await action()
  } catch (e) {
    state.problem = failure(e).message
  } finally {
    state.sending = false
  }
}
const start = () =>
  run(async () => {
    const r = await call<{ totpURI: string; backupCodes: string[] }>(
      'POST',
      '/api/auth/two-factor/enable',
      { password: props.password ?? state.password },
    )
    Object.assign(state, { uri: r.totpURI, backupCodes: r.backupCodes, step: 'scan', password: '' })
  })
const verify = () =>
  run(async () => {
    await call('POST', '/api/auth/two-factor/verify-totp', { code: state.code.replace(/\s/g, '') })
    Object.assign(state, { step: 'codes', uri: '', code: '' })
  })
function finish() {
  state.backupCodes = []
  emit('done')
}
onMounted(() => {
  if (props.password !== undefined) void start()
})
</script>

<template>
  <section aria-labelledby="totp-enrollment" class="space-y-4">
    <h2 id="totp-enrollment" class="text-xl">{{ $t('totpEnrollment.title') }}</h2>

    <template v-if="state.step === 'start'">
      <p>{{ $t('totpEnrollment.explain') }}</p>
      <form
        v-if="props.password === undefined"
        class="space-y-4"
        novalidate
        @submit.prevent="start"
      >
        <UFormField
          :label="$t('signIn.password')"
          name="totp-password"
          required
          :error="state.problem ?? undefined"
        >
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UButton type="submit" class="min-h-11" :loading="state.sending">
          {{ $t('totpEnrollment.start') }}
        </UButton>
      </form>
      <template v-else>
        <p v-if="state.sending" role="status">{{ $t('totpEnrollment.preparing') }}</p>
        <template v-else-if="state.problem">
          <p role="alert" class="text-(--app-danger)">{{ state.problem }}</p>
          <UButton class="min-h-11" @click="start">{{ $t('totpEnrollment.retry') }}</UButton>
        </template>
      </template>
    </template>

    <template v-else-if="state.step === 'scan'">
      <p>{{ $t('security.totp.scan') }}</p>
      <p class="font-mono text-lg break-all" :aria-label="$t('security.totp.secretLabel')">
        {{ secret }}
      </p>
      <UButton v-if="link" :to="link" external class="min-h-11" color="neutral" variant="outline">
        {{ $t('security.totp.openApp') }}
      </UButton>
      <form class="space-y-4" novalidate @submit.prevent="verify">
        <UFormField
          :label="$t('security.totp.code')"
          name="totp-code"
          required
          :error="state.problem ?? undefined"
        >
          <UInput
            v-model="state.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UButton type="submit" class="min-h-11" :loading="state.sending">
          {{ $t('security.totp.verify') }}
        </UButton>
      </form>
    </template>

    <div v-else class="space-y-3" role="status">
      <p class="font-semibold">{{ $t('security.totp.codesTitle') }}</p>
      <p>{{ $t('security.totp.codesExplain') }}</p>
      <ul class="grid grid-cols-2 gap-2 font-mono" :aria-label="$t('security.totp.codesTitle')">
        <li v-for="c in state.backupCodes" :key="c">{{ c }}</li>
      </ul>
      <UButton class="min-h-11" @click="finish">{{ $t('security.totp.codesSaved') }}</UButton>
    </div>
  </section>
</template>
