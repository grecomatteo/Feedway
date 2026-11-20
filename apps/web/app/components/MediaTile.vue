<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LibraryFile } from '~/composables/useLibrary'
import type { LibraryLayout } from '~/composables/useLibraryView'

/**
 * A file in the library (screen 19): in the grid a square that never changes size while the image
 * arrives, the name on one line, the client and the size, the post that uses it in blue, a video's
 * length on the picture; in the list (prova 0.10.0, E-1) a row with a small thumbnail, the whole
 * name, weight and date. A file not ready says why, a failed one in red. The whole tile opens the
 * detail; it can be dragged onto a folder, and «⋯» moves or deletes it without dragging.
 */
const props = withDefaults(
  defineProps<{
    file: LibraryFile
    src: string | null
    actions: DropdownMenuItem[][]
    layout?: LibraryLayout
    /** under the name in the grid: «Forno Luce · 2,4 MB» (screen 19); the size when left out */
    meta?: string | null
  }>(),
  { layout: 'grid', meta: null },
)
const emit = defineEmits<{ open: [] }>()
const { t } = useI18n()

const state = computed(() => {
  const f = props.file
  if (f.status === 'failed') return { tone: 'danger' as const, label: t('library.status.failed') }
  if (f.status === 'processing' || f.status === 'uploading')
    return { tone: 'neutral' as const, label: t(`library.status.${f.status}`) }
  return null
})
/** The worker's progress, under the picture while the file is being prepared. */
const percent = computed(() =>
  props.file.status === 'processing' && props.file.progress
    ? Math.min(100, Math.max(0, Math.round(props.file.progress.percent)))
    : null,
)
const detail = computed(() => {
  const f = props.file
  if (f.kind === 'video')
    return f.durationMs === null
      ? t('library.kind.video')
      : `${t('library.kind.video')} ${formatDuration(f.durationMs)}`
  return t('library.kind.image')
})
/** In the list: weight and day of the upload, after the kind. */
const facts = computed(() =>
  [formatBytes(props.file.sizeBytes), formatRelative(props.file.createdAt, { time: false })].join(
    ' · ',
  ),
)
/** Under the name in the grid: the client and the size, or what the file is waiting for. */
const gridMeta = computed(() => props.meta ?? formatBytes(props.file.sizeBytes))
const icon = computed(() =>
  props.file.status === 'failed'
    ? 'i-lucide-file-x'
    : props.file.kind === 'video'
      ? 'i-lucide-film'
      : 'i-lucide-image',
)
/** «Nel post di oggi, 18:00», «In una bozza» (D-18, D-80.7): the use the server decided. */
const used = computed(() => mediaUseLabel(props.file.usedIn, t))
const failedImage = ref(false)
watch(
  () => props.src,
  () => (failedImage.value = false),
)

function dragStart(event: DragEvent) {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-feedway-media', props.file.id)
}
</script>

<template>
  <!-- the grid of screen 19: the picture, the name on one line, client and size, the use in blue -->
  <li
    v-if="layout === 'grid'"
    class="group relative min-w-0"
    draggable="true"
    :data-media-id="file.id"
    data-layout="grid"
    @dragstart="dragStart"
  >
    <div
      class="relative aspect-square overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-(--app-img-outline) transition-shadow group-focus-within:ring-2 group-focus-within:ring-(--app-focus) group-hover:shadow-[0_2px_8px_rgb(36_35_33/0.12)]"
      :class="
        file.status === 'failed'
          ? 'bg-(--app-danger-soft) text-(--app-danger)'
          : 'bg-(--app-surface-sunken) text-(--app-text-muted)'
      "
      aria-hidden="true"
    >
      <img
        v-if="src && !failedImage"
        :src="src"
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
        class="size-full object-cover"
        @error="failedImage = true"
      />
      <span v-else class="flex size-full items-center justify-center">
        <UIcon :name="icon" class="size-7" />
      </span>
      <span
        v-if="percent !== null"
        class="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-(--app-border)"
      >
        <span class="block h-full rounded-full bg-(--app-text)" :style="{ width: `${percent}%` }" />
      </span>
      <span
        v-if="file.kind === 'video' && file.status === 'ready' && file.durationMs !== null"
        class="absolute bottom-1.5 left-1.5 flex h-5 items-center gap-1 rounded-md bg-[rgb(20_20_20/0.72)] px-1.5 text-xs text-white tabular-nums"
      >
        <UIcon name="i-lucide-clapperboard" class="size-3" />
        {{ formatDuration(file.durationMs) }}
      </span>
    </div>
    <div class="mt-2 grid min-w-0">
      <!-- the name is the tile's button: the whole tile is its target; the whole name stays in the
           tooltip and for the screen reader -->
      <button
        type="button"
        class="truncate text-left text-[0.8125rem] leading-[1.125rem] font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
        :title="file.originalName"
        @click="emit('open')"
      >
        <span class="sr-only">{{ $t('library.openFile', { name: '' }) }}</span
        >{{ file.originalName }}
      </button>
      <span class="truncate text-xs text-(--app-text-muted) max-md:hidden" data-meta>
        <template v-if="state"
          >{{ state.label }}<template v-if="percent !== null"> · {{ percent }}%</template></template
        >
        <template v-else>{{ gridMeta }}</template>
      </span>
      <span
        v-if="state && state.tone === 'danger'"
        class="truncate text-xs text-(--app-danger) md:hidden"
        >{{ state.label }}</span
      >
      <span v-if="used" class="mt-0.5 truncate text-xs text-(--app-info)" data-used-in>{{
        used
      }}</span>
    </div>
    <!-- «⋯» over the picture, at the pointer or the keyboard; on a touch screen the detail has
         every action -->
    <div
      class="absolute top-1 right-1 z-10 rounded-lg bg-(--app-surface)/90 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden"
    >
      <RowActions :name="file.originalName" :items="actions" />
    </div>
  </li>
  <li
    v-else
    class="group relative flex min-w-0 items-center gap-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-2 transition-shadow focus-within:ring-2 focus-within:ring-(--app-focus) hover:shadow-[0_2px_8px_rgb(36_35_33/0.12)]"
    draggable="true"
    :data-media-id="file.id"
    data-layout="list"
    @dragstart="dragStart"
  >
    <div
      class="relative size-14 shrink-0 overflow-hidden rounded-lg"
      :class="
        file.status === 'failed'
          ? 'bg-(--app-danger-soft) text-(--app-danger)'
          : 'bg-(--app-surface-sunken) text-(--app-text-muted)'
      "
      aria-hidden="true"
    >
      <img
        v-if="src && !failedImage"
        :src="src"
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
        class="size-full object-cover"
        @error="failedImage = true"
      />
      <span v-else class="flex size-full items-center justify-center">
        <UIcon :name="icon" class="size-5" />
      </span>
      <span
        v-if="percent !== null"
        class="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-(--app-border)"
      >
        <span class="block h-full rounded-full bg-(--app-text)" :style="{ width: `${percent}%` }" />
      </span>
    </div>
    <div class="flex min-w-0 flex-1 items-start gap-1">
      <div class="min-w-0 flex-1 px-0.5">
        <button
          type="button"
          class="line-clamp-2 w-full text-left text-sm font-semibold [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          :title="file.originalName"
          @click="emit('open')"
        >
          <span class="sr-only">{{ $t('library.openFile', { name: '' }) }}</span
          >{{ file.originalName }}
        </button>
        <p
          class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[0.8125rem] text-(--app-text-muted)"
        >
          <StatusDot v-if="state?.tone === 'danger'" :tone="state.tone" :label="state.label" />
          <span v-else-if="state" class="truncate"
            >{{ state.label }}<template v-if="percent !== null"> · {{ percent }}%</template></span
          >
          <span v-else class="truncate">{{ detail }}</span>
          <span class="truncate">{{ meta ? `${meta} · ` : '' }}{{ facts }}</span>
          <span v-if="used" class="truncate text-(--app-info)" data-used-in>{{ used }}</span>
        </p>
      </div>
      <div class="relative z-10 shrink-0">
        <RowActions :name="file.originalName" :items="actions" />
      </div>
    </div>
  </li>
</template>
