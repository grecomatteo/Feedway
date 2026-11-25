<script setup lang="ts">
/**
 * «Calendario», a tab of the client's page (spec §14.7, plan 09 Task 3): the client's calendar in
 * place of the old tab «Post», whose address leads here (`…/post`). The same calendar as the
 * menu's, inside one client and, with `?profilo=`, one of its profiles (§14.6). On a phone it
 * opens on the list, as the old tab did.
 */
definePageMeta({ layout: 'agency' })

const route = useRoute()
const { t } = useI18n()
const { client, profiles } = useClientPage()

useHead({
  title: () =>
    client.value ? `${t('calendar.title')} · ${client.value.name}` : t('calendar.title'),
})

const profile = computed(() => {
  const id = route.query['profilo']
  if (typeof id !== 'string' || id === '') return null
  return profiles.data.value?.items.find((p) => p.accounts.some((a) => a.id === id)) ?? null
})
const profileAccountIds = computed(() => profile.value?.accounts.map((a) => a.id) ?? null)
// the client first; a profile asked for waits for the client's profiles
const ready = computed(
  () =>
    client.value !== null &&
    (route.query['profilo'] === undefined ||
      profiles.status.value === 'success' ||
      profiles.status.value === 'error'),
)
</script>

<template>
  <!-- in the browser only, as the menu's calendar: «oggi» is the browser's moment -->
  <ClientOnly>
    <CalendarView
      :workspace="client"
      :profile-account-ids="profileAccountIds"
      :profiles="profiles.data.value?.items ?? []"
      :ready="ready"
    />
  </ClientOnly>
</template>
