<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LibraryFile } from '~/composables/useLibrary'
import type { LibraryLayout } from '~/composables/useLibraryView'

/**
 * A file in the library (plan 04 Task 12, brief F03): in the grid a square that never changes size
 * while the image arrives, its name on up to two lines, and for a video its length; in the list
 * (prova 0.10.0, E-1) a row with a small thumbnail, the whole name, weight and date. A file not
 * ready says why, a failed one in red. The whole card opens the detail; it can be dragged onto a
 * folder, and «⋯» moves or deletes it without dragging.
 */
const props = withDefaults(
  defineProps<{
    file: LibraryFile
    src: string | null
    actions: DropdownMenuItem[][]
    layout?: LibraryLayout
  }>(),
  { layout: 'grid' },
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
  <li
    class="group relative flex min-w-0 rounded-xl border border-(--app-border) bg-(--app-card) p-2 transition-shadow focus-within:ring-2 focus-within:ring-(--app-focus) hover:shadow-[0_2px_8px_rgb(36_35_33/0.12)]"
    :class="layout === 'list' ? 'items-center gap-3' : 'flex-col'"
    draggable="true"
    :data-media-id="file.id"
    :data-layout="layout"
    @dragstart="dragStart"
  >
    <div
      class="relative shrink-0 overflow-hidden rounded-lg"
      :class="[
        layout === 'list' ? 'size-14' : 'aspect-square',
        file.status === 'failed'
          ? 'bg-(--app-danger-soft) text-(--app-danger)'
          : 'bg-(--app-surface-sunken) text-(--app-text-muted)',
      ]"
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
        <UIcon :name="icon" :class="layout === 'list' ? 'size-5' : 'size-7'" />
      </span>
      <span
        v-if="percent !== null"
        class="absolute h-1 overflow-hidden rounded-full bg-(--app-border)"
        :class="layout === 'list' ? 'inset-x-1.5 bottom-1.5' : 'inset-x-2 bottom-2'"
      >
        <span
          class="block h-full rounded-full bg-(--app-brand)"
          :style="{ width: `${percent}%` }"
        />
      </span>
      <span
        v-if="used && layout === 'grid'"
        class="absolute top-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] items-center gap-1 rounded-md bg-(--app-card) px-1.5 py-0.5 text-xs font-medium text-(--app-text) shadow-[0_1px_2px_rgb(36_35_33/0.2)]"
        data-used-in
      >
        <UIcon name="i-lucide-calendar-check" class="size-3 shrink-0" />
        <span class="truncate">{{ used }}</span>
      </span>
      <span
        v-if="layout === 'grid' && file.kind === 'video' && file.status === 'ready'"
        class="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums"
      >
        <UIcon name="i-lucide-play" class="size-3" />
        {{ file.durationMs === null ? '' : formatDuration(file.durationMs) }}
      </span>
    </div>
    <div class="flex min-w-0 flex-1 items-start gap-1" :class="layout === 'grid' ? 'mt-2' : ''">
      <div class="min-w-0 flex-1 px-0.5">
        <!-- the name is the card's button: the whole card is its target; at most two lines, then
             the dots (D-63), so «IMG_0221.HEIC» and «IMG_0222.HEIC» are not both «IMG_022…»; the
             whole name stays in the tooltip and for the screen reader -->
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
          <span v-else-if="state" :class="layout === 'list' ? 'truncate' : ''"
            >{{ state.label }}<template v-if="percent !== null"> · {{ percent }}%</template></span
          >
          <span v-else class="truncate">{{ detail }}</span>
          <span v-if="layout === 'list'" class="truncate">{{ facts }}</span>
          <!-- on the thumbnail in the grid, which screen readers skip: said here for them -->
          <span v-if="used" :class="layout === 'list' ? 'truncate' : 'sr-only'">{{ used }}</span>
        </p>
      </div>
      <div class="relative z-10 shrink-0" :class="layout === 'grid' ? '-mt-1.5 -mr-1.5' : ''">
        <RowActions :name="file.originalName" :items="actions" />
      </div>
    </div>
  </li>
</template>
