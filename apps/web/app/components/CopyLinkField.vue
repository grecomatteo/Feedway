<script setup lang="ts">
/**
 * A text to hand over by hand, with a copy button: a link (a reset link, shown once) or, with
 * `multiline`, a message to send.
 */
const props = defineProps<{ url: string; label: string; multiline?: boolean; copied?: string }>()
const done = ref(false)
const failed = ref(false)
async function copy() {
  failed.value = false
  try {
    await navigator.clipboard.writeText(props.url)
    done.value = true
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div class="space-y-2">
    <UFormField :label="label" name="copy-link">
      <div v-if="multiline" class="space-y-2">
        <UTextarea
          :model-value="url"
          readonly
          class="w-full"
          :rows="8"
          autoresize
          @focus="($event.target as HTMLTextAreaElement).select()"
        />
        <UButton class="min-h-11" icon="i-lucide-copy" @click="copy">{{
          $t('copyLink.copy')
        }}</UButton>
      </div>
      <div v-else class="flex gap-2">
        <UInput
          :model-value="url"
          readonly
          class="w-full"
          size="xl"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <UButton class="min-h-11" icon="i-lucide-copy" @click="copy">{{
          $t('copyLink.copy')
        }}</UButton>
      </div>
    </UFormField>
    <p v-if="done" role="status" class="text-sm text-(--app-success)">
      {{ props.copied ?? $t('copyLink.copied') }}
    </p>
    <p v-if="failed" role="alert" class="text-sm text-(--app-danger)">
      {{ $t('copyLink.failed') }}
    </p>
  </div>
</template>
