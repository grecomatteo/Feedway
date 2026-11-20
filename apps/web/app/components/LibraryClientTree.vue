<script setup lang="ts">
import type { Folder } from '~/composables/useLibrary'

/**
 * The column of «Libreria» with «Tutti i clienti» (D-103): the clients whose library the person
 * uses, each with its folders under it, as a tree. A client or a folder opens that client's library
 * (`?spazio=<slug>&cartella=<id>`), with its own column of folders. A client's folders are read
 * when its branch opens, with the client's own route: the tree never shows what the person does
 * not see, because the clients are the ones the page already reads.
 */
const props = defineProps<{ clients: WorkspaceView[] }>()
const { t } = useI18n()
const { call } = useApi()
const org = useOrganization()
const route = useRoute()

const open = ref<Set<string>>(new Set())
const read = reactive<Record<string, Folder[] | 'pending' | 'error'>>({})

async function readFolders(client: WorkspaceView) {
  read[client.id] = 'pending'
  try {
    const list = await call<{ items: Folder[] }>(
      'GET',
      org.api(`/workspaces/${encodeURIComponent(client.id)}/folders`),
    )
    read[client.id] = list.items
  } catch {
    read[client.id] = 'error'
  }
}
function toggle(client: WorkspaceView) {
  const next = new Set(open.value)
  if (next.has(client.id)) next.delete(client.id)
  else {
    next.add(client.id)
    if (!Array.isArray(read[client.id])) void readFolders(client)
  }
  open.value = next
}
const foldersOf = (client: WorkspaceView) => {
  const list = read[client.id]
  return Array.isArray(list) ? list : []
}
const branchId = (client: WorkspaceView) => `library-tree-${client.id}`

/** The library of a client, or of one of its folders, keeping the rest of the address. */
function to(client: WorkspaceView, folderId?: string) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query))
    if (typeof value === 'string' && !['spazio', 'profilo', 'cartella'].includes(key))
      query[key] = value
  query['spazio'] = client.slug
  if (folderId) query['cartella'] = folderId
  return { path: org.to('/libreria'), query }
}
const row =
  'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 text-left font-medium text-(--app-text-muted) transition-colors hover:bg-(--app-nav-hover) hover:text-(--app-text) pointer-coarse:h-11'
</script>

<template>
  <nav :aria-label="$t('library.tree.label')" data-client-tree>
    <p
      aria-hidden="true"
      class="mb-2 flex min-h-8 items-center px-2.5 text-caption font-medium text-(--app-text-muted)"
    >
      {{ $t('library.tree.label') }}
    </p>
    <ul class="space-y-0.5">
      <li v-for="c in props.clients" :key="c.id" :data-tree-client="c.name">
        <div class="flex items-center gap-0.5">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :icon="open.has(c.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-8 shrink-0 justify-center pointer-coarse:size-11"
            :aria-expanded="open.has(c.id)"
            :aria-controls="open.has(c.id) ? branchId(c) : undefined"
            :aria-label="t('library.tree.folders', { name: c.name })"
            @click="toggle(c)"
          />
          <NuxtLink :to="to(c)" :class="row">
            <Avatar :name="c.name" :size="20" kind="client" />
            <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
          </NuxtLink>
        </div>
        <div v-if="open.has(c.id)" :id="branchId(c)">
          <p
            v-if="read[c.id] === 'pending'"
            class="py-1.5 pl-11 text-caption text-(--app-text-muted)"
            role="status"
          >
            {{ $t('library.tree.loading') }}
          </p>
          <p
            v-else-if="read[c.id] === 'error'"
            class="flex items-center gap-2 py-1 pl-11 text-caption text-(--app-danger)"
            role="alert"
          >
            {{ $t('library.tree.error') }}
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              class="p-0"
              :label="$t('library.tree.retry')"
              @click="readFolders(c)"
            />
          </p>
          <p
            v-else-if="foldersOf(c).length === 0"
            class="py-1.5 pl-11 text-caption text-(--app-text-muted)"
          >
            {{ $t('library.tree.none') }}
          </p>
          <LibraryTreeFolders
            v-else
            :aria-label="t('library.tree.foldersOf', { name: c.name })"
            :folders="foldersOf(c)"
            :parent-id="null"
            :depth="0"
            :to="(id: string) => to(c, id)"
            :row-class="row"
          />
        </div>
      </li>
    </ul>
  </nav>
</template>
