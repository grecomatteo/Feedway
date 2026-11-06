<script setup lang="ts">
/** «Esci»: if the server does not close the session, the person is told and stays signed in. */
const session = useSession()
const failed = ref(false)
const sending = ref(false)

async function signOut() {
  failed.value = false
  sending.value = true
  try {
    await session.signOut()
  } catch {
    failed.value = true
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <UButton
      class="min-h-11"
      color="neutral"
      variant="ghost"
      icon="i-lucide-log-out"
      :loading="sending"
      @click="signOut"
    >
      {{ $t('nav.signOut') }}
    </UButton>
    <p v-if="failed" role="alert" class="text-sm text-(--app-danger)">
      {{ $t('nav.signOutFailed') }}
    </p>
  </div>
</template>
