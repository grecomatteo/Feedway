<script setup lang="ts">
import type { Folder, LibraryFile } from '~/composables/useLibrary'

/**
 * A file's detail (screen 20): a panel on the right, 400 wide (the whole screen on a phone), with
 * the preview (the player plays the `preview` copy by byte ranges), client, size, who uploaded it,
 * the post that uses it, the tags, «Usa in un nuovo post» and «Scarica». A file a scheduled post
 * uses says why it is not deleted, before anyone tries (D-80.4); any other has «Elimina». What the
 * analysis read and what the worker corrected open on request («Dettagli tecnici», brief F03).
 */
const props = withDefaults(
  defineProps<{
    file: LibraryFile | null
    fileUrl: (file: LibraryFile, variant: string) => string
    readOnly: boolean
    /** the editor of a post of the file's client */
    postTo: (file: LibraryFile, postId: string) => string
    /** «Usa in un nuovo post»: the editor of a new post of the file's client, or null */
    newPostTo?: ((file: LibraryFile) => string) | null
    /** the client's name, when the library shows more than one client */
    clientName?: string | null
    /** the client's folders: in the client's own library only */
    folders?: (Folder & { depth: number })[] | null
  }>(),
  { newPostTo: null, clientName: null, folders: null },
)
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
/** Why «Elimina» is not there (D-80.4), said before anyone tries. */
const blocked = computed(() =>
  props.file?.deleteBlockedBy ? deleteBlockText(props.file.deleteBlockedBy, t) : null,
)

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

/** «1920 × 1080 · 0:42 · 38,8 MB» */
const size = computed(() => {
  const f = props.file
  if (!f) return ''
  return [
    f.width !== null && f.height !== null ? `${String(f.width)} × ${String(f.height)}` : null,
    f.durationMs !== null ? formatDuration(f.durationMs) : null,
    formatBytes(f.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ')
})
/** «oggi alle 10:14, da Marco Bassi» */
const uploaded = computed(() => {
  const f = props.file
  if (!f) return ''
  const when = formatRelative(f.createdAt, { sentence: true })
  return f.uploadedByName ? t('library.detail.uploadedBy', { when, name: f.uploadedByName }) : when
})
/** «Post di oggi, 18:00», «Bozza»: the use the server decided (D-80.7), and how many more. */
const use = computed(() => {
  const u = props.file?.usedIn
  if (!u) return null
  const label =
    u.status === 'scheduled' && u.scheduledAt
      ? t('library.detail.useScheduled', {
          when: formatRelative(u.scheduledAt, { timeZone: u.timezone }),
        })
      : t(`library.detail.${u.status === 'cancelled' ? 'useCancelled' : 'useDraft'}`)
  return { label, more: u.count > 1 ? t('library.detail.useMore', { n: u.count - 1 }) : null }
})

/**
 * «Scarica»: the best copy the panel serves (never the original, which may hold the GPS until
 * its copy is ready, §15.7): the photo's master, the video's published copy or its preview.
 */
const download = computed(() => {
  const f = props.file
  if (!f || f.status !== 'ready') return null
  const order = f.kind === 'video' ? ['reel', 'preview'] : ['master', 'ig_feed']
  const purpose = order.find(has)
  if (!purpose) return null
  const base = f.originalName.replace(/\.[^.]+$/, '')
  return {
    href: props.fileUrl(f, purpose),
    name: `${base}.${f.kind === 'video' ? 'mp4' : 'jpg'}`,
  }
})

const technical = computed(() => {
  const f = props.file
  if (!f) return []
  const rows: { label: string; value: string }[] = []
  const codecs = [f.videoCodec, f.audioCodec].filter((c): c is string => Boolean(c))
  if (codecs.length > 0)
    rows.push({ label: t('library.detail.codec'), value: codecs.join(' · ').toUpperCase() })
  if (f.fps !== null)
    rows.push({
      label: t('library.detail.fps'),
      value: new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(f.fps),
    })
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

// ---- folder, in the client's library
const folderItems = computed(() => [
  { value: 'none', label: t('library.folders.none') },
  ...(props.folders ?? []).map((f) => ({
    value: f.id,
    label: `${'— '.repeat(f.depth)}${f.name}`,
  })),
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
    :overlay="false"
    :ui="{
      content: 'md:max-w-[25rem] bg-(--app-surface)',
      header: 'min-h-14 py-0 pr-12 pl-5 border-b border-(--app-border)',
      title: 'truncate font-display text-base font-semibold',
      close: 'top-7 end-3 -translate-y-1/2',
      description: 'sr-only',
      body: 'p-5 sm:p-5',
    }"
  >
    <template #body>
      <div v-if="file" class="grid gap-5" data-media-detail>
        <div
          class="flex aspect-[4/5] max-h-[18.75rem] items-center justify-center justify-self-center overflow-hidden rounded-lg bg-(--app-surface-sunken) outline-1 -outline-offset-1 outline-(--app-img-outline)"
        >
          <!-- the copy for the panel, by byte ranges (206); no download of the original -->
          <video
            v-if="video"
            :src="video"
            :poster="image ?? undefined"
            controls
            playsinline
            preload="metadata"
            class="size-full bg-black object-cover"
            data-testid="media-player"
          />
          <img v-else-if="image" :src="image" alt="" class="size-full object-cover" />
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

        <dl class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <template v-if="clientName">
            <dt class="text-(--app-text-muted)">{{ $t('library.detail.client') }}</dt>
            <dd>{{ clientName }}</dd>
          </template>
          <dt class="text-(--app-text-muted)">{{ $t(`library.detail.${file.kind}`) }}</dt>
          <dd class="tabular-nums">{{ size }}</dd>
          <dt class="text-(--app-text-muted)">{{ $t('library.detail.uploaded') }}</dt>
          <dd>{{ uploaded }}</dd>
          <dt class="text-(--app-text-muted)">{{ $t('library.detail.usedIn') }}</dt>
          <dd>
            <template v-if="use && file.usedIn">
              <ULink
                :to="postTo(file, file.usedIn.postId)"
                class="font-medium text-(--app-text) underline decoration-(--app-border-strong) underline-offset-[3px]"
                >{{ use.label }}</ULink
              >
              <span v-if="use.more" class="ms-1 text-(--app-text-muted)">{{ use.more }}</span>
            </template>
            <span v-else class="text-(--app-text-muted)">{{ $t('library.detail.notUsed') }}</span>
          </dd>
          <template v-if="folders">
            <dt class="self-center text-(--app-text-muted)">
              <label for="media-folder">{{ $t('library.detail.folder') }}</label>
            </dt>
            <dd>
              <USelect
                id="media-folder"
                v-model="folderValue"
                :items="folderItems"
                :disabled="readOnly"
                class="w-full"
              />
            </dd>
          </template>
          <dt class="pt-0.5 text-(--app-text-muted)">{{ $t('library.detail.tags') }}</dt>
          <dd>
            <TagChips v-model="tagList" :read-only="readOnly" @update:model-value="saveTags" />
          </dd>
        </dl>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="newPostTo && !readOnly && file.status === 'ready'"
            :to="newPostTo(file)"
            color="neutral"
            variant="outline"
            icon="i-lucide-file-plus"
            :label="$t('library.detail.newPost')"
          />
          <UButton
            v-if="download"
            :to="download.href"
            :download="download.name"
            external
            color="neutral"
            variant="outline"
            icon="i-lucide-download"
            :label="$t('library.detail.download')"
          />
          <UButton
            v-if="!readOnly && !blocked"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :label="$t('library.delete')"
            @click="emit('delete', file)"
          />
        </div>

        <p
          v-if="!readOnly && blocked && file.deleteBlockedBy"
          class="text-sm text-(--app-text-muted)"
          data-delete-blocked
        >
          {{ blocked }}
          <ULink
            :to="postTo(file, file.deleteBlockedBy.postId)"
            class="text-(--app-text) underline underline-offset-2"
            >{{ $t('library.deleteBlocked.fix') }}</ULink
          >
        </p>

        <details
          v-if="file.status === 'ready'"
          class="text-sm [&[open]>summary>svg]:rotate-90"
          data-technical
        >
          <summary
            class="flex cursor-pointer list-none items-center gap-1.5 font-medium text-(--app-text-muted)"
          >
            <UIcon name="i-lucide-chevron-right" class="size-4 transition-transform" />
            {{ $t('library.detail.technical') }}
          </summary>
          <div class="mt-3 grid gap-4">
            <dl
              v-if="technical.length > 0"
              class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5"
            >
              <template v-for="row in technical" :key="row.label">
                <dt class="text-(--app-text-muted)">{{ row.label }}</dt>
                <dd class="tabular-nums">{{ row.value }}</dd>
              </template>
            </dl>
            <section>
              <h3 class="mb-1.5 font-semibold">{{ $t('library.detail.fixes') }}</h3>
              <ul v-if="fixes.length > 0" class="space-y-1">
                <li v-for="fix in fixes" :key="fix" class="flex gap-2">
                  <UIcon
                    name="i-lucide-check"
                    class="mt-0.5 size-4 shrink-0 text-(--app-success)"
                    aria-hidden="true"
                  />
                  {{ fix }}
                </li>
              </ul>
              <p v-else class="text-(--app-text-muted)">{{ $t('library.detail.noFixes') }}</p>
            </section>
            <section v-if="warnings.length > 0">
              <h3 class="mb-1.5 font-semibold">{{ $t('library.detail.warnings') }}</h3>
              <ul class="space-y-1">
                <li v-for="w in warnings" :key="w" class="flex gap-2">
                  <UIcon
                    name="i-lucide-info"
                    class="mt-0.5 size-4 shrink-0 text-(--app-info)"
                    aria-hidden="true"
                  />
                  {{ w }}
                </li>
              </ul>
            </section>
          </div>
        </details>
      </div>
    </template>
  </USlideover>
</template>
