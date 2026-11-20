<script setup lang="ts">
/**
 * Several agencies and no last one: the person picks where to go. Before any agency's panel, so
 * it has the pages-before-the-panel look (screen 01): the logo and one column, a row per agency
 * with its logo and the person's role, then the way to the account and out.
 */
definePageMeta({ layout: 'auth' })
const session = useSession()
const { t } = useI18n()
useHead({ title: () => t('agencies.title') })
const me = computed(() => (session.view.value.state === 'active' ? session.view.value.me : null))
const organizations = computed(() => me.value?.organizations ?? [])
</script>

<template>
  <div class="grid gap-5">
    <div class="grid gap-1 text-center">
      <h1>{{ $t('agencies.title') }}</h1>
      <p v-if="me" class="text-detail text-(--app-text-muted)">
        {{ $t('agencies.signedInAs', { email: me.email }) }}
      </p>
    </div>
    <EmptyState v-if="organizations.length === 0" :title="$t('agencies.empty')" />
    <ListSurface v-else class="overflow-hidden" :label="$t('agencies.title')">
      <ListRow v-for="o in organizations" :key="o.id">
        <NuxtLink
          :to="`/${o.slug}`"
          class="col-span-full -mx-4 flex min-h-row focus-visible:-outline-offset-2! items-center gap-3 px-4 hover:bg-(--app-nav-hover) max-md:-mx-3.5 max-md:px-3.5"
        >
          <Avatar :name="o.name" :src="o.logoUrl" kind="agency" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ o.name }}</span>
            <span class="block text-detail text-(--app-text-muted)">{{
              $t(`roles.${o.role}`)
            }}</span>
          </span>
          <StatusDot
            v-if="o.status === 'suspended'"
            tone="warning"
            :label="$t('agencies.suspended')"
          />
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 shrink-0 text-(--app-text-muted)"
            aria-hidden="true"
          />
        </NuxtLink>
      </ListRow>
    </ListSurface>
    <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <UButton to="/account" color="neutral" variant="ghost" icon="i-lucide-settings">
        {{ $t('nav.settings') }}
      </UButton>
      <SignOutButton />
    </div>
  </div>
</template>
