<script setup lang="ts">
import type { Folder } from '~/composables/useLibrary'
import type { RouteLocationRaw } from 'vue-router'

/**
 * The folders of one client in the tree of «Libreria» (D-103), each list inside the folder it
 * belongs to, so a screen reader hears «Reel» inside «Novembre» and not beside it.
 */
const props = defineProps<{
  folders: Folder[]
  parentId: string | null
  depth: number
  to: (folderId: string) => RouteLocationRaw
  rowClass: string
}>()
const here = computed(() => props.folders.filter((f) => f.parentId === props.parentId))
const hasInside = (id: string) => props.folders.some((f) => f.parentId === id)
</script>

<template>
  <ul>
    <li v-for="f in here" :key="f.id">
      <NuxtLink
        :to="to(f.id)"
        :class="rowClass"
        :style="{ paddingLeft: `${2.25 + depth * 0.875}rem` }"
        :data-tree-folder="f.name"
      >
        <UIcon name="i-lucide-folder" class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
        <span class="text-xs tabular-nums">
          <span aria-hidden="true">{{ f.fileCount }}</span>
          <span class="sr-only">{{
            $t('library.folders.files', { n: f.fileCount }, f.fileCount)
          }}</span>
        </span>
      </NuxtLink>
      <LibraryTreeFolders
        v-if="hasInside(f.id)"
        :folders="folders"
        :parent-id="f.id"
        :depth="depth + 1"
        :to="to"
        :row-class="rowClass"
      />
    </li>
  </ul>
</template>
