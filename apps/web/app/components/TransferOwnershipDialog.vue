<script setup lang="ts">
/**
 * "Passa la proprietà": to an active Admin with the second factor. The Owner becomes Admin.
 * The request needs a recent confirmation (withReauth of the page).
 */
interface Candidate {
  id: string
  displayName: string
}
const props = defineProps<{ candidates: Candidate[]; withReauth: WithReauth; path: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ done: [] }>()
const { call, failure } = useApi()

const chosen = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)
watch(open, (v) => {
  if (v) {
    chosen.value = ''
    problem.value = null
  }
})
const items = computed(() => props.candidates.map((c) => ({ value: c.id, label: c.displayName })))

async function confirm() {
  sending.value = true
  problem.value = null
  try {
    await props.withReauth(async () => {
      await call('POST', props.path, { userId: chosen.value })
    })
    open.value = false
    emit('done')
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('transfer.title')" :description="$t('transfer.explain')">
    <template #body>
      <p v-if="candidates.length === 0">{{ $t('transfer.noCandidates') }}</p>
      <form v-else class="space-y-4" novalidate @submit.prevent="confirm">
        <UFormField :label="$t('transfer.to')" name="new-owner" :error="problem ?? undefined">
          <URadioGroup v-model="chosen" :items="items" :ui="{ item: 'min-h-11 items-center' }" />
        </UFormField>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" class="min-h-11" :loading="sending" :disabled="chosen === ''">
            {{ $t('transfer.confirm') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
