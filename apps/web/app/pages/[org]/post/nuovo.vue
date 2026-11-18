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
      <PageHeader :title="$t('posts.choose.title')">
        <template #summary>{{ $t('posts.choose.text') }}</template>
      </PageHeader>
    </template>
    <ListSkeleton
      v-if="status !== 'success' || usable.length === 1"
      :label="$t('posts.choose.loading')"
      :rows="3"
    />
    <DataList v-else :label="$t('posts.choose.title')">
      <DataRow
        v-for="w in usable"
        :key="w.id"
        :name="w.name"
        :src="w.photoUrl"
        :to="editorOf(w.slug)"
      />
    </DataList>
  </PageShell>
</template>
