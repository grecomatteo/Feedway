<script setup lang="ts">
/**
 * "Conferma la tua identità": the password or a passkey, before a change that weakens the
 * account. The confirmation lasts a few minutes on the server (REAUTH_REQUIRED after).
 */
const props = defineProps<{ passkeys: number }>()
const open = defineModel<boolean>('open', { required: true })
/** The password typed here, for a call that asks it again (null after a passkey). */
const emit = defineEmits<{ done: [password: string | null] }>()

const { call, failure } = useApi()
const passkey = usePasskey()
const { t } = useI18n()

const password = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)

watch(open, (value) => {
  if (value) {
    password.value = ''
    problem.value = null
  }
})

async function confirm(how: 'password' | 'passkey') {
  sending.value = true
  problem.value = null
  try {
    if (how === 'password') await call('POST', '/api/v1/auth/reauth', { password: password.value })
    else await passkey.authenticate({ reauth: true })
    const typed = how === 'password' ? password.value : null
    password.value = ''
    // done first: closing without it means "cancelled" to the page
    emit('done', typed)
    open.value = false
  } catch (e) {
    problem.value =
      e instanceof DOMException ? t('security.passkeys.cancelled') : failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('reauth.title')" :description="$t('reauth.description')">
    <template #body>
      <form class="space-y-4" novalidate @submit.prevent="confirm('password')">
        <UFormField
          :label="$t('reauth.password')"
          name="reauth-password"
          :error="problem ?? undefined"
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" class="min-h-11" :loading="sending">
            {{ $t('reauth.confirm') }}
          </UButton>
          <UButton
            v-if="props.passkeys > 0 && passkey.supported()"
            type="button"
            class="min-h-11"
            color="neutral"
            variant="outline"
            icon="i-lucide-fingerprint"
            :disabled="sending"
            @click="confirm('passkey')"
          >
            {{ $t('reauth.withPasskey') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
