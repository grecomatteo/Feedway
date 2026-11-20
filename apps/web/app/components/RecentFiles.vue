<script setup lang="ts">
import type { LibraryFile } from '~/composables/useLibrary'

/**
 * «Ultimi file» in a client's Panoramica (screen 16): the six newest files of its library, three
 * on a row in the side column and up to six where the page has one column (tiles never grow
 * past ~140 px), with the way into «Libreria» (which says the space they take).
 */
const props = defineProps<{ workspace: WorkspaceView }>()
const org = useOrganization()
const { call } = useApi()

const base = computed(() => org.api(`/workspaces/${encodeURIComponent(props.workspace.id)}`))
const page = ref<{ items: LibraryFile[]; usedBytes: number } | null>(null)
const failed = ref(false)
onMounted(async () => {
  try {
    page.value = await call('GET', `${base.value}/media?limit=6`)
  } catch {
    failed.value = true
  }
})
const thumb = (f: LibraryFile) => {
  const variant = thumbnailOf(f)
  return variant ? `${base.value}/media/${encodeURIComponent(f.id)}/file/${variant}` : null
}
const libraryPage = computed(() => org.to(`/spazi/${props.workspace.slug}/libreria`))
</script>

<template>
  <section :aria-label="$t('library.recent')" data-recent-files>
    <SectionHead :title="$t('library.recent')">
      <NuxtLink :to="libraryPage" class="text-detail underline underline-offset-3">{{
        $t('client.libraryLink')
      }}</NuxtLink>
    </SectionHead>
    <p v-if="failed" role="alert" class="text-(--app-danger)">{{ $t('library.loadError') }}</p>
    <ul
      v-else-if="!page"
      :aria-label="$t('library.loading')"
      aria-busy="true"
      class="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2"
    >
      <li v-for="n in 6" :key="n" class="skeleton aspect-square rounded-lg" aria-hidden="true" />
    </ul>
    <p
      v-else-if="page.items.length === 0"
      class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
    >
      {{ $t('library.noRecent') }}
    </p>
    <ul
      v-else
      :aria-label="$t('library.recent')"
      class="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2"
    >
      <li v-for="f in page.items" :key="f.id" class="min-w-0">
        <NuxtLink
          :to="libraryPage"
          class="relative block overflow-hidden rounded-lg outline-1 -outline-offset-1"
          :class="
            f.status === 'failed'
              ? 'bg-(--app-danger-soft) outline-(--app-danger)'
              : 'bg-(--app-surface-sunken) outline-(--app-img-outline)'
          "
          :title="
            f.status === 'failed'
              ? `${f.originalName} · ${$t('library.status.failed')}`
              : f.originalName
          "
        >
          <span class="sr-only"
            >{{ f.originalName
            }}<template v-if="f.status === 'failed'">, {{ $t('library.status.failed') }}</template
            ><template v-else-if="f.status !== 'ready'"
              >, {{ $t(`library.status.${f.status}`) }}</template
            ></span
          >
          <img
            v-if="thumb(f)"
            :src="thumb(f)!"
            alt=""
            loading="lazy"
            class="aspect-square w-full object-cover"
          />
          <!-- a file not ready says so: a failed one in red, with its word (R-9) -->
          <span
            v-else-if="f.status === 'failed'"
            class="flex aspect-square flex-col items-center justify-center gap-1.5 p-1 text-center text-(--app-danger)"
            aria-hidden="true"
            data-failed
          >
            <UIcon name="i-lucide-file-x" class="size-6" />
            <span class="text-xs font-semibold">{{ $t('library.status.failed') }}</span>
          </span>
          <span
            v-else
            class="flex aspect-square flex-col items-center justify-center gap-1.5 p-1 text-center text-(--app-text-muted)"
            aria-hidden="true"
          >
            <UIcon :name="f.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'" class="size-6" />
            <span v-if="f.status !== 'ready'" class="text-xs">{{
              $t(`library.status.${f.status}`)
            }}</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
