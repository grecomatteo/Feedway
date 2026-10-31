<script setup lang="ts">
/** After a password sign-in: "Crea una passkey" or "Non ora". `done` either way. */
const emit = defineEmits<{ done: [] }>()
const passkey = usePasskey()
const { failure } = useApi()
const { t } = useI18n()

const sending = ref(false)
const problem = ref<string | null>(null)

async function create() {
  sending.value = true
  problem.value = null
  try {
    await passkey.register(t('passkeyPrompt.defaultName'))
    emit('done')
  } catch (e) {
    problem.value = e instanceof DOMException ? t('passkeyPrompt.cancelled') : failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section aria-labelledby="passkey-prompt" class="space-y-4">
    <h1 id="passkey-prompt" class="text-2xl">{{ $t('passkeyPrompt.title') }}</h1>
    <p>{{ $t('passkeyPrompt.explain') }}</p>
    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <div class="flex flex-wrap gap-3">
      <UButton class="min-h-11" icon="i-lucide-key-round" :loading="sending" @click="create">
        {{ $t('passkeyPrompt.create') }}
      </UButton>
      <UButton
        class="min-h-11"
        color="neutral"
        variant="ghost"
        :disabled="sending"
        @click="emit('done')"
      >
        {{ $t('passkeyPrompt.notNow') }}
      </UButton>
    </div>
  </section>
</template>
