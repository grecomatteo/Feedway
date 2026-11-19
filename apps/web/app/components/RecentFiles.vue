<script setup lang="ts">
import type { LibraryFile } from '~/composables/useLibrary'

/**
 * «Ultimi file» and «Spazio occupato» in a client's Panoramica (plan 04 Task 12): the newest
 * files of its library and the space they take, with the way into «Libreria».
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
  <section aria-labelledby="client-recent" class="space-y-3">
    <div class="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
      <h2 id="client-recent" class="text-lg">{{ $t('library.recent') }}</h2>
      <UButton
        class="min-h-control"
        color="neutral"
        variant="ghost"
        trailing-icon="i-lucide-arrow-right"
        :to="libraryPage"
      >
        {{ $t('library.openLibrary') }}
      </UButton>
    </div>
    <p v-if="page" class="text-sm text-(--app-text-muted)">
      {{ $t('library.usage') }}:
      <span class="font-semibold text-(--app-text) tabular-nums">{{
        formatBytes(page.usedBytes)
      }}</span>
    </p>
    <p v-if="failed" role="alert" class="text-(--app-danger)">{{ $t('library.loadError') }}</p>
    <ul
      v-else-if="!page"
      :aria-label="$t('library.loading')"
      aria-busy="true"
      class="grid grid-cols-3 gap-2 sm:grid-cols-6"
    >
      <li v-for="n in 6" :key="n" class="skeleton aspect-square rounded-lg" />
    </ul>
    <p
      v-else-if="page.items.length === 0"
      class="max-w-none rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-5 text-(--app-text-muted)"
    >
      {{ $t('library.noRecent') }}
    </p>
    <ul v-else :aria-label="$t('library.recent')" class="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <li v-for="f in page.items" :key="f.id" class="min-w-0">
        <NuxtLink
          :to="libraryPage"
          class="relative block overflow-hidden rounded-lg border"
          :class="
            f.status === 'failed'
              ? 'border-(--app-danger) bg-(--app-danger-soft)'
              : 'border-(--app-border) bg-(--app-surface-sunken)'
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
