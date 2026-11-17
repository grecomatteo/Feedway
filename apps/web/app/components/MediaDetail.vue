<script setup lang="ts">
import type { Folder, LibraryFile } from '~/composables/useLibrary'

/**
 * A file's detail (plan 04 Task 12): the preview (the player plays the `preview` copy by byte
 * ranges), what the analysis read, what the worker corrected, its tags and folder, «Elimina».
 * The heavy details open on request, as the brief asks (F03).
 */
const props = defineProps<{
  file: LibraryFile | null
  folders: (Folder & { depth: number })[]
  fileUrl: (file: LibraryFile, variant: string) => string
  readOnly: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  tags: [file: LibraryFile, tags: string[]]
  move: [file: LibraryFile, folderId: string | null]
  delete: [file: LibraryFile]
  retry: [file: LibraryFile]
}>()

/** The failures that keep the original: the fault may be the machine's, so it can be tried again. */
const RETRYABLE = new Set(['timeout', 'processing_failed'])
const retryable = computed(
  () =>
    !props.readOnly &&
    props.file?.status === 'failed' &&
    RETRYABLE.has(props.file.failure?.code ?? ''),
)
const { t } = useI18n()

const has = (purpose: string) => props.file?.variants.some((v) => v.purpose === purpose) ?? false
const image = computed(() => {
  const f = props.file
  if (!f) return null
  if (f.kind === 'image' && has('ig_feed')) return props.fileUrl(f, 'ig_feed')
  if (has('thumbnail')) return props.fileUrl(f, 'thumbnail')
  return null
})
const video = computed(() =>
  props.file?.kind === 'video' && has('preview') ? props.fileUrl(props.file, 'preview') : null,
)

const facts = computed(() => {
  const f = props.file
  if (!f) return []
  const rows: { label: string; value: string }[] = [
    { label: t('library.detail.kind'), value: t(`library.kind.${f.kind}`) },
  ]
  if (f.width !== null && f.height !== null)
    rows.push({
      label: t('library.detail.dimensions'),
      value: `${String(f.width)} × ${String(f.height)} px`,
    })
  if (f.durationMs !== null)
    rows.push({ label: t('library.detail.duration'), value: formatDuration(f.durationMs) })
  rows.push({ label: t('library.detail.size'), value: formatBytes(f.sizeBytes) })
  const codecs = [f.videoCodec, f.audioCodec].filter((c): c is string => Boolean(c))
  if (codecs.length > 0)
    rows.push({ label: t('library.detail.codec'), value: codecs.join(' · ').toUpperCase() })
  if (f.fps !== null)
    rows.push({
      label: t('library.detail.fps'),
      value: new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(f.fps),
    })
  rows.push({ label: t('library.detail.uploaded'), value: formatDate(f.createdAt, true) })
  return rows
})

const PLATFORM: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' }
const fixes = computed(() =>
  (props.file?.checks?.fixes ?? []).map((fix) =>
    t(`library.fix.${fix.code}`, {
      platform: PLATFORM[String(fix['platform'])] ?? '',
      width: String(fix['width'] ?? ''),
    }),
  ),
)
const warnings = computed(() =>
  (props.file?.checks?.warnings ?? []).map((w) =>
    t(`library.warning.${w.code}`, { fps: String(w['fps'] ?? '') }),
  ),
)

// ---- tags: saved as soon as one is added or removed
const tagList = ref<string[]>([])
watch(
  () => props.file?.tags,
  (tags) => (tagList.value = [...(tags ?? [])]),
  { immediate: true },
)
function saveTags(tags: string[]) {
  if (props.file) emit('tags', props.file, tags)
}

// ---- folder
const folderItems = computed(() => [
  { value: 'none', label: t('library.folders.none') },
  ...props.folders.map((f) => ({ value: f.id, label: `${'— '.repeat(f.depth)}${f.name}` })),
])
const folderValue = computed({
  get: () => props.file?.folderId ?? 'none',
  set: (v: string) => {
    if (props.file) emit('move', props.file, v === 'none' ? null : v)
  },
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="file?.originalName ?? $t('library.detail.title')"
    :description="$t('library.detail.title')"
    :ui="{ content: 'max-w-lg', title: 'break-all', description: 'sr-only' }"
  >
    <template #body>
      <div v-if="file" class="space-y-6">
        <div
          class="flex aspect-square max-h-[60vh] w-full items-center justify-center overflow-hidden rounded-xl bg-(--app-surface-sunken)"
        >
          <!-- the copy for the panel, by byte ranges (206); no download of the original -->
          <video
            v-if="video"
            :src="video"
            :poster="image ?? undefined"
            controls
            playsinline
            preload="metadata"
            class="size-full bg-black object-contain"
            data-testid="media-player"
          />
          <img v-else-if="image" :src="image" alt="" class="size-full object-contain" />
          <p v-else class="px-6 text-center text-sm text-(--app-text-muted)">
            {{
              file.status === 'processing'
                ? $t('library.detail.preparing')
                : $t('library.detail.noPreview')
            }}
          </p>
        </div>

        <div
          v-if="file.status === 'failed' && file.failure"
          role="alert"
          class="rounded-[10px] bg-(--app-danger-soft) px-4 py-3 text-sm"
        >
          <p class="font-semibold text-(--app-danger)">{{ $t('library.detail.failure') }}</p>
          <p class="mt-1">{{ $t(`library.failure.${file.failure.code}`) }}</p>
          <p class="mt-1 text-(--app-text-muted)">{{ $t('library.detail.failureRemoved') }}</p>
          <UButton
            v-if="retryable"
            class="mt-3"
            color="neutral"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            :label="$t('library.detail.retry')"
            data-testid="media-retry"
            @click="emit('retry', file)"
          />
        </div>

        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ $t('library.detail.facts') }}</h3>
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <template v-for="row in facts" :key="row.label">
              <dt class="text-(--app-text-muted)">{{ row.label }}</dt>
              <dd class="tabular-nums">{{ row.value }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="file.status === 'ready'">
          <h3 class="mb-2 text-sm font-semibold">{{ $t('library.detail.fixes') }}</h3>
          <ul v-if="fixes.length > 0" class="space-y-1 text-sm">
            <li v-for="fix in fixes" :key="fix" class="flex gap-2">
              <UIcon
                name="i-lucide-check"
                class="mt-0.5 size-4 shrink-0 text-(--app-success)"
                aria-hidden="true"
              />
              {{ fix }}
            </li>
          </ul>
          <p v-else class="text-sm text-(--app-text-muted)">{{ $t('library.detail.noFixes') }}</p>
          <template v-if="warnings.length > 0">
            <h3 class="mt-4 mb-2 text-sm font-semibold">{{ $t('library.detail.warnings') }}</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="w in warnings" :key="w" class="flex gap-2">
                <UIcon
                  name="i-lucide-info"
                  class="mt-0.5 size-4 shrink-0 text-(--app-info)"
                  aria-hidden="true"
                />
                {{ w }}
              </li>
            </ul>
          </template>
        </section>

        <section class="space-y-4">
          <UFormField :label="$t('library.detail.folder')" name="media-folder">
            <USelect
              v-model="folderValue"
              :items="folderItems"
              :disabled="readOnly"
              class="w-full"
              size="lg"
            />
          </UFormField>
          <UFormField
            :label="$t('library.detail.tags')"
            :hint="readOnly ? undefined : $t('library.detail.tagsHint')"
            name="media-tags"
          >
            <UInputTags
              v-model="tagList"
              :disabled="readOnly"
              :max-length="40"
              class="w-full"
              size="lg"
              @update:model-value="saveTags"
            />
          </UFormField>
        </section>
      </div>
    </template>
    <template v-if="file && !readOnly" #footer>
      <div class="flex w-full flex-wrap justify-between gap-3">
        <UButton
          class="min-h-11"
          color="error"
          variant="outline"
          icon="i-lucide-trash-2"
          @click="emit('delete', file)"
        >
          {{ $t('library.delete') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('library.detail.close') }}
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
