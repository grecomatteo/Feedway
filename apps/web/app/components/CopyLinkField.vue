<script setup lang="ts">
/** A link to hand over by hand (a reset link): shown once, with a copy button. */
const props = defineProps<{ url: string; label: string }>()
const copied = ref(false)
const failed = ref(false)
async function copy() {
  failed.value = false
  try {
    await navigator.clipboard.writeText(props.url)
    copied.value = true
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div class="space-y-2">
    <UFormField :label="label" name="copy-link">
      <div class="flex gap-2">
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
    <p v-if="copied" role="status" class="text-sm text-(--app-success)">
      {{ $t('copyLink.copied') }}
    </p>
    <p v-if="failed" role="alert" class="text-sm text-(--app-danger)">
      {{ $t('copyLink.failed') }}
    </p>
  </div>
</template>
