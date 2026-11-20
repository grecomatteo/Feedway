<script setup lang="ts">
/**
 * «Nuovo post» outside a client (spec §11.11, the + of the phone bar in «Tutti i clienti»): the
 * post is always of one client, so the client is asked first. With only one client the person
 * goes straight to its editor; with none (a Viewer everywhere) the page does not exist.
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const route = useRoute()
const { data, status } = useWorkspaces()

useHead({ title: () => t('posts.choose.title') })

const usable = computed(() =>
  (data.value?.items ?? []).filter((w) => w.archivedAt === null && w.myRole !== 'viewer'),
)
// a search only when the list is long enough to need one, as in the client selector
const SEARCH_FROM = 8
const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLocaleLowerCase('it')
  return q ? usable.value.filter((w) => w.name.toLocaleLowerCase('it').includes(q)) : usable.value
})
const editorOf = (slug: string) => {
  const profilo = route.query['profilo']
  return {
    path: org.to(`/spazi/${encodeURIComponent(slug)}/post/nuovo`),
    query: typeof profilo === 'string' ? { profilo } : {},
  }
}

watchEffect(() => {
  if (status.value !== 'success') return
  const only = usable.value.length === 1 ? usable.value[0] : undefined
  if (only) void navigateTo(editorOf(only.slug), { replace: true })
  else if (usable.value.length === 0)
    showError(createError({ statusCode: 404, statusMessage: 'Not Found' }))
})
</script>

<template>
  <PageShell>
    <template #head>
      <PageHeader :title="$t('posts.choose.title')" />
    </template>
    <div class="grid max-w-form gap-stack">
      <ListSkeleton
        v-if="status !== 'success' || usable.length === 1"
        :label="$t('posts.choose.loading')"
        :rows="3"
      />
      <template v-else>
        <SearchField
          v-if="usable.length >= SEARCH_FROM"
          v-model="query"
          :label="$t('context.search')"
          class="md:max-w-none"
        />
        <p v-if="shown.length === 0" class="text-(--app-text-muted)">
          {{ $t('context.noMatch') }}
        </p>
        <ListSurface v-else class="overflow-hidden" :label="$t('posts.choose.title')">
          <ListRow v-for="w in shown" :key="w.id">
            <NuxtLink
              :to="editorOf(w.slug)"
              class="col-span-full -mx-4 flex min-h-row items-center gap-3 px-4 font-semibold hover:bg-(--app-nav-hover) max-md:-mx-3.5 max-md:px-3.5"
            >
              <Avatar :name="w.name" :src="w.photoUrl" />
              <span class="min-w-0 flex-1 truncate">{{ w.name }}</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-(--app-text-muted)"
                aria-hidden="true"
              />
            </NuxtLink>
          </ListRow>
        </ListSurface>
      </template>
    </div>
  </PageShell>
</template>
