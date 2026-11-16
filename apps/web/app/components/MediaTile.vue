<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LibraryFile } from '~/composables/useLibrary'

/**
 * A file in the library's grid (plan 04 Task 12, brief F03): a square that never changes size
 * while the image arrives, its name, and for a video its length; a file not ready says why. The
 * whole card opens the detail; it can be dragged onto a folder, and «⋯» moves or deletes it
 * without dragging.
 */
const props = defineProps<{
  file: LibraryFile
  src: string | null
  actions: DropdownMenuItem[][]
}>()
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
    class="group relative flex min-w-0 flex-col rounded-xl border border-(--app-border) bg-(--app-card) p-2 transition-shadow focus-within:ring-2 focus-within:ring-(--app-focus) hover:shadow-[0_2px_8px_rgb(36_35_33/0.12)]"
    draggable="true"
    :data-media-id="file.id"
    @dragstart="dragStart"
  >
    <div
      class="relative aspect-square overflow-hidden rounded-lg bg-(--app-surface-sunken)"
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
      <span v-else class="flex size-full items-center justify-center text-(--app-text-muted)">
        <UIcon
          :name="
            file.status === 'failed'
              ? 'i-lucide-file-x'
              : file.kind === 'video'
                ? 'i-lucide-film'
                : 'i-lucide-image'
          "
          class="size-7"
        />
      </span>
      <span
        v-if="percent !== null"
        class="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-(--app-border)"
      >
        <span
          class="block h-full rounded-full bg-(--app-brand)"
          :style="{ width: `${percent}%` }"
        />
      </span>
      <span
        v-if="file.kind === 'video' && file.status === 'ready'"
        class="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums"
      >
        <UIcon name="i-lucide-play" class="size-3" />
        {{ file.durationMs === null ? '' : formatDuration(file.durationMs) }}
      </span>
    </div>
    <div class="mt-2 flex min-w-0 items-start gap-1">
      <div class="min-w-0 flex-1 px-0.5">
        <!-- the name is the card's button: the whole card is its target -->
        <button
          type="button"
          class="block w-full truncate text-left text-sm font-semibold after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          :title="file.originalName"
          @click="emit('open')"
        >
          <span class="sr-only">{{ $t('library.openFile', { name: '' }) }}</span
          >{{ file.originalName }}
        </button>
        <p v-if="state?.tone === 'danger'" class="mt-0.5 text-[0.8125rem]">
          <StatusDot :tone="state.tone" :label="state.label" />
        </p>
        <p v-else-if="state" class="mt-0.5 truncate text-[0.8125rem] text-(--app-text-muted)">
          {{ state.label }}<template v-if="percent !== null"> · {{ percent }}%</template>
        </p>
        <p v-else class="mt-0.5 truncate text-[0.8125rem] text-(--app-text-muted)">
          {{ detail }}
        </p>
      </div>
      <div class="relative z-10 -mt-1.5 -mr-1.5 shrink-0">
        <RowActions :name="file.originalName" :items="actions" />
      </div>
    </div>
  </li>
</template>
