<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { t } = useI18n()

useHead({ title: () => t('accountDeletion.doneTitle') })
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-2xl">{{ $t('accountDeletion.doneTitle') }}</h1>
    <p role="status">{{ $t('accountDeletion.done') }}</p>
    <UButton to="/accedi" class="min-h-11" color="neutral" variant="outline">
      {{ $t('accountDeletion.signIn') }}
    </UButton>
  </div>
</template>
