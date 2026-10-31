<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const ready = useHydrated()

const { t } = useI18n()
const passkey = usePasskey()
const session = useSession()
const { failure } = useApi()

useHead({ title: () => t('secondFactor.title') })

const view = computed(() => session.view.value)
const useExisting = computed(() => view.value.state === 'second_factor' && view.value.useExisting)
const choice = ref<'none' | 'totp'>('none')
const sending = ref(false)
const problem = ref<string | null>(null)

async function enter() {
  const v = await session.load()
  if (v.state === 'active') await navigateTo(session.home(v.me))
}

async function withPasskey() {
  sending.value = true
  problem.value = null
  try {
    const created = await passkey.register(t('passkeyPrompt.defaultName'))
    // a passkey sign-in satisfies the second factor and replaces this session
    await passkey.authenticate({ only: created })
    await enter()
  } catch (e) {
    problem.value = e instanceof DOMException ? t('passkeyPrompt.cancelled') : failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('secondFactor.title') }}</h1>

    <template v-if="useExisting">
      <p role="alert">{{ $t('secondFactor.useExisting') }}</p>
      <UButton block size="xl" class="min-h-12" :disabled="!ready" @click="() => session.signOut()">
        {{ $t('nav.signOut') }}
      </UButton>
    </template>

    <TotpEnrollment v-else-if="choice === 'totp'" @done="enter" />

    <template v-else>
      <p>{{ $t('secondFactor.explain') }}</p>
      <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
      <fieldset :disabled="!ready" class="min-w-0 space-y-3">
        <UButton
          v-if="passkey.supported()"
          block
          size="xl"
          class="min-h-12"
          icon="i-lucide-key-round"
          :loading="sending"
          @click="withPasskey"
        >
          {{ $t('passkeyPrompt.create') }}
        </UButton>
        <UButton
          block
          size="xl"
          class="min-h-12"
          color="neutral"
          variant="outline"
          :disabled="sending"
          @click="choice = 'totp'"
        >
          {{ $t('secondFactor.useApp') }}
        </UButton>
        <UButton
          block
          class="min-h-11"
          color="neutral"
          variant="ghost"
          @click="() => session.signOut()"
        >
          {{ $t('nav.signOut') }}
        </UButton>
      </fieldset>
    </template>
  </div>
</template>
