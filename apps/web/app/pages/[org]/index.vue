<script setup lang="ts">
/** The agency's home, for now: name and role. The agency's pages arrive with the next task. */
const route = useRoute()
const session = useSession()
const { t } = useI18n()

const organization = computed(() => {
  const view = session.view.value
  if (view.state !== 'active') return null
  return view.me.organizations.find((o) => o.slug === route.params['org']) ?? null
})
// another agency's address, or one that does not exist: the same answer
if (!organization.value) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

useHead({ title: () => organization.value?.name ?? t('agencyHome.title') })
</script>

<template>
  <div v-if="organization" class="space-y-4">
    <h1 class="text-3xl">{{ organization.name }}</h1>
    <p v-if="organization.status === 'suspended'" role="alert" class="text-(--app-danger)">
      {{ $t('agencyHome.suspended') }}
    </p>
    <p v-else class="text-(--app-text-muted)">
      {{ $t('agencyHome.welcome', { role: $t(`roles.${organization.role}`) }) }}
    </p>
  </div>
</template>
