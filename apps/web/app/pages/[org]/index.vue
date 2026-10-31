<script setup lang="ts">
/** The agency's home, for now: name, role and where to go. Today's view arrives later. */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const nav = useAgencyNav()
const { t } = useI18n()
useHead({ title: () => org.organization.value?.name ?? t('agencyHome.title') })
</script>

<template>
  <div v-if="org.organization.value" class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ org.organization.value.name }}</h1>
      <p class="text-(--app-text-muted)">
        {{ $t('agencyHome.welcome', { role: $t(`roles.${org.organization.value.role}`) }) }}
      </p>
    </header>
    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="item in nav.slice(1)" :key="item.to">
        <NuxtLink
          :to="item.to"
          class="flex min-h-14 items-center gap-3 rounded-xl border border-(--app-border) bg-(--app-surface) px-4 hover:border-(--app-border-strong)"
        >
          <UIcon :name="item.icon" class="size-5" aria-hidden="true" />
          {{ $t(item.label) }}
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
