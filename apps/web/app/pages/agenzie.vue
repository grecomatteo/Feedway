<script setup lang="ts">
/** Several agencies and no last one: the person picks where to go. */
const session = useSession()
const { t } = useI18n()
useHead({ title: () => t('agencies.title') })
const organizations = computed(() =>
  session.view.value.state === 'active' ? session.view.value.me.organizations : [],
)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-3xl">{{ $t('agencies.title') }}</h1>
    <EmptyState v-if="organizations.length === 0" :title="$t('agencies.empty')" />
    <ul v-else class="space-y-2" :aria-label="$t('agencies.title')">
      <li v-for="o in organizations" :key="o.id">
        <NuxtLink
          :to="`/${o.slug}`"
          class="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-(--app-border) bg-(--app-surface) px-4 hover:border-(--app-border-strong)"
        >
          <span class="font-semibold">{{ o.name }}</span>
          <span class="flex items-center gap-2">
            <UBadge v-if="o.status === 'suspended'" color="warning" variant="subtle">
              {{ $t('agencies.suspended') }}
            </UBadge>
            <RoleBadge :role="o.role" />
          </span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
