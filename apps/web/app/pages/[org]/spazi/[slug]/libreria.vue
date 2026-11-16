<script setup lang="ts">
/**
 * «Libreria» of the client's page (plan 04 Task 12): the same library as the page «Libreria», in the client's
 * context. On a phone it is the only way in: the bar at the bottom has no room for «Libreria».
 */
const { t } = useI18n()
const { client } = useClientPage()

useHead({ title: () => `${t('library.title')} · ${client.value?.name ?? t('client.title')}` })

watchEffect(() => {
  if (client.value && !usesLibrary(client.value))
    showError(createError({ statusCode: 404, statusMessage: 'Not Found' }))
})
const used = ref(0)
</script>

<template>
  <div v-if="client && usesLibrary(client)">
    <p class="mb-4 text-(--app-text-muted)">
      {{ $t('library.usage') }}: <span class="tabular-nums">{{ formatBytes(used) }}</span>
    </p>
    <MediaLibrary :key="client.id" :workspace="client" @usage="used = $event" />
  </div>
</template>
