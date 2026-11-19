<script setup lang="ts">
/**
 * «Libreria» (spec §11.8, plan 04 Task 12): the library of the client chosen in the selector
 * (`?spazio=`). Without a client it asks to choose one. Only for Editor and above (§10.2): for
 * whoever uses no library (a Viewer everywhere) the page does not exist.
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { data, status } = useWorkspaces()
const { workspace } = useActiveContext()

useHead({ title: () => t('library.title') })

const usable = computed(() =>
  (data.value?.items ?? []).filter((w) => w.archivedAt === null && usesLibrary(w)),
)
const client = computed(() =>
  workspace.value && usesLibrary(workspace.value) ? workspace.value : null,
)

// a Viewer everywhere, or a client whose library the person may not use: «Pagina non trovata»
watchEffect(() => {
  if (status.value !== 'success') return
  // archived clients count: their library is read only, not gone
  const any = (data.value?.items ?? []).some((w) => usesLibrary(w))
  const nothing = !any && !org.may.value.manageUsers
  if (nothing || (workspace.value && !usesLibrary(workspace.value)))
    showError(createError({ statusCode: 404, statusMessage: 'Not Found' }))
})

const used = ref(0)
const library = ref<{ chooseFiles: () => void } | null>(null)
</script>

<template>
  <PageShell>
    <template #head>
      <PageHeader :title="$t('library.title')">
        <template v-if="client" #summary>
          {{ client.name }} · {{ $t('library.usage') }}: {{ formatBytes(used) }}
        </template>
        <template v-else-if="status === 'success'" #summary>
          {{ $t('library.chooseClientText') }}
        </template>
        <template v-if="client && client.archivedAt === null" #actions>
          <UButton icon="i-lucide-upload" class="min-h-control" @click="library?.chooseFiles()">
            {{ $t('upload.choose') }}
          </UButton>
        </template>
      </PageHeader>
    </template>

    <MediaLibrary
      v-if="client"
      ref="library"
      :key="client.id"
      :workspace="client"
      upload-in-header
      @usage="used = $event"
    />
    <ListSkeleton v-else-if="status !== 'success'" :label="$t('library.loading')" :rows="3" />
    <section v-else-if="usable.length > 0" aria-labelledby="choose-client">
      <h2 id="choose-client" class="mb-3 text-lg font-semibold">
        {{ $t('library.chooseClient') }}
      </h2>
      <DataList :label="$t('library.chooseClient')">
        <DataRow
          v-for="w in usable"
          :key="w.id"
          :name="w.name"
          :src="w.photoUrl"
          :to="{ path: org.to('/libreria'), query: { spazio: w.slug } }"
        />
      </DataList>
    </section>
    <EmptyState v-else :title="$t('library.noClients')" icon="i-lucide-images" />
  </PageShell>
</template>
