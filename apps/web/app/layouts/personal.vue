<script setup lang="ts">
import AgencyLayout from './agency.vue'
import DefaultLayout from './default.vue'

/**
 * The personal settings (`/account/*`): inside the agency's sidebar when the person works in an
 * active agency, so the menu never disappears; with the plain header otherwise.
 */
const org = useOrganization()
</script>

<template>
  <AgencyLayout v-if="org.active.value"><slot /></AgencyLayout>
  <DefaultLayout v-else><slot /></DefaultLayout>
</template>
