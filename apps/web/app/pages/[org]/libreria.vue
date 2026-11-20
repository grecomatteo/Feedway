<script setup lang="ts">
/**
 * «Libreria» (screen 19, Matteo 20/11; one library since D-103): with «Tutti i clienti» the files
 * of every client whose library the person uses, with the clients and their folders on the left;
 * with a client in the address (`?spazio=<slug>`, the same the context selector reads, so the two
 * always agree) that client's library with its folders, the folder open in `?cartella=`. The
 * client's «Libreria» tab is the same library. Only for Editor and above (§10.2): for whoever uses
 * no library (a Viewer everywhere) the page does not exist.
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
/** The client of the address, when its library is one the person uses. */
const client = computed(() =>
  workspace.value && usable.value.some((w) => w.id === workspace.value?.id)
    ? workspace.value
    : null,
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

const library = ref<{
  upload: () => void
  uploadItems: { label: string; onSelect: () => void }[]
  filteredClient: WorkspaceView | null
} | null>(null)
const used = ref(0)
</script>

<template>
  <PageShell>
    <template #head>
      <PageHeader :title="$t('library.title')">
        <template v-if="!client && library && usable.length > 0" #actions>
          <!-- on a phone «Carica» sits by the title (screen 19); on a computer in the tools -->
          <div class="md:hidden">
            <UButton
              v-if="library.filteredClient"
              color="neutral"
              variant="outline"
              icon="i-lucide-upload"
              :label="$t('library.upload')"
              @click="library.upload()"
            />
            <UDropdownMenu v-else :items="library.uploadItems" :content="{ align: 'end' }">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-upload"
                :label="$t('library.upload')"
                :aria-label="$t('library.uploadTo')"
              />
            </UDropdownMenu>
          </div>
        </template>
      </PageHeader>
    </template>

    <ListSkeleton v-if="status !== 'success'" :label="$t('library.loading')" :rows="3" />
    <div v-else-if="client">
      <p class="mb-3 text-detail text-(--app-text-muted) md:hidden">
        {{ $t('library.usageOf', { used: formatBytes(used) }) }}
      </p>
      <MediaLibrary :key="client.id" :workspace="client" :clients="usable" @usage="used = $event" />
    </div>
    <AgencyLibrary v-else-if="usable.length > 0" ref="library" :clients="usable" />
    <EmptyState v-else :title="$t('library.noClients')" icon="i-lucide-images" />
  </PageShell>
</template>
