<script setup lang="ts">
import { BULK_TABLE_MAX_ROWS } from '~/utils/bulk-table'

/**
 * «In blocco» (spec §11.6, plan 09 Task 10, P5): up to 50 files become a month of posts on one
 * page. A page of its own like the editor (no side bar, its row at the top), so «Programma» is
 * the one orange button. From the client's calendar and from «Nuovo post»; for who can schedule.
 */
definePageMeta({ layout: 'agency', editor: true })

const route = useRoute()
const org = useOrganization()
const { t } = useI18n()
const { client, profiles } = useClientPage()
const clientPath = computed(() => `/spazi/${encodeURIComponent(String(route.params['slug']))}`)
const back = computed(() => org.to(`${clientPath.value}/calendario`))
useHead({ title: () => t('bulk.pageTitle', { name: client.value?.name ?? '' }) })

const mayPublish = computed(() =>
  ['owner', 'admin', 'manager', 'publisher'].includes(client.value?.myRole ?? ''),
)
</script>

<template>
  <ClientOnly>
    <BulkPage
      v-if="client && mayPublish && !client.archivedAt"
      :key="client.id"
      :client="client"
      :profiles="profiles.data.value?.items ?? []"
      :client-path="clientPath"
      :back="back"
      :max="BULK_TABLE_MAX_ROWS"
    />
    <div v-else-if="client" class="mx-auto max-w-[42.5rem] space-y-3 px-gutter pt-page-top">
      <p role="alert">{{ $t('bulk.notAllowed') }}</p>
      <NuxtLink :to="back" class="underline">{{ $t('bulk.back', { name: client.name }) }}</NuxtLink>
    </div>
    <div v-else class="px-gutter pt-page-top"><ListSkeleton /></div>
    <template #fallback>
      <div class="px-gutter pt-page-top"><ListSkeleton /></div>
    </template>
  </ClientOnly>
</template>
