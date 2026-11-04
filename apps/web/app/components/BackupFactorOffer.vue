<script setup lang="ts">
/**
 * Shown when a passkey just became the only second factor of a role that requires one: losing
 * the device would lock the person out, since a password reset still asks for the factor.
 */
const emit = defineEmits<{ later: [] }>()
const session = useSession()
const going = ref(false)

async function addNow() {
  going.value = true
  try {
    // the passkey sign-in replaced the session: the page guard must see it as active
    await session.load()
    await navigateTo('/account/sicurezza')
  } finally {
    going.value = false
  }
}
</script>

<template>
  <section aria-labelledby="backup-factor" class="space-y-4">
    <h2 id="backup-factor" class="text-xl">{{ $t('backupFactor.title') }}</h2>
    <p>{{ $t('backupFactor.explain') }}</p>
    <div class="flex flex-col gap-3">
      <UButton block size="xl" class="min-h-12" :loading="going" @click="addNow">
        {{ $t('backupFactor.addNow') }}
      </UButton>
      <UButton
        block
        class="min-h-11"
        color="neutral"
        variant="ghost"
        :disabled="going"
        @click="emit('later')"
      >
        {{ $t('backupFactor.later') }}
      </UButton>
    </div>
  </section>
</template>
