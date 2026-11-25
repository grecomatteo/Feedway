<script setup lang="ts">
/**
 * «Calendario» of the menu (spec §11.4, screen 07): every client the person sees, or the client
 * and profile of the selector (§14.6, `?spazio=`, `&profilo=`). A client or profile the person
 * does not see falls back to «Tutti i clienti», as the rest of the panel (useActiveContext).
 */
definePageMeta({ layout: 'agency' })

const { t } = useI18n()
const route = useRoute()
const { workspace, profile, profiles } = useActiveContext()
useHead({ title: () => t('calendar.title') })

const profileAccountIds = computed(() => profile.value?.accounts.map((a) => a.id) ?? null)
const { status } = useWorkspaces()
// a profile asked for waits for the client's profiles; one that is not there falls back
const ready = computed(
  () =>
    (status.value === 'success' || status.value === 'error') &&
    (route.query['profilo'] === undefined ||
      workspace.value === null ||
      profiles.status.value === 'success' ||
      profiles.status.value === 'error'),
)
</script>

<template>
  <PageShell :title="$t('calendar.title')">
    <!-- in the browser only: «oggi» is the browser's moment in the agency's zone, and the
         server's could differ from it (a clock, a page left open) -->
    <ClientOnly>
      <CalendarView
        :workspace="workspace"
        :profile-account-ids="profileAccountIds"
        :profiles="profiles.data.value?.items ?? []"
        :ready="ready"
      />
    </ClientOnly>
  </PageShell>
</template>
