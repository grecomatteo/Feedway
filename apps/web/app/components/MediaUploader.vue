<script setup lang="ts">
import type { Leftover, UploadItem } from '~/composables/useUploads'

/**
 * Uploading into a client's library (spec §11.1, §14.2, plan 04 Task 13; brief F03). Files come
 * from «Carica file» (gallery or camera on a phone), from a drop on the library or pasted with
 * Ctrl/Cmd+V. Each has its bar, with the total when they are more than one; upload, then the
 * worker's preparation, then «Pronto». The uploads left halfway by a reload are listed above.
 */
const props = defineProps<{ workspace: WorkspaceView; folderId: string | null }>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()

// the workspace is fixed for the life of the component (the library keys it by the workspace)
const uploads = useUploads(props.workspace.id, { onChange: () => emit('changed'), shown: true })
const { items, leftovers, totals, limits } = uploads

const picker = ref<HTMLInputElement | null>(null)
const again = ref<HTMLInputElement | null>(null)
let againFor: Leftover | null = null

function choose() {
  picker.value?.click()
}
function picked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length > 0) void uploads.add(files, props.folderId)
}
function chooseAgain(left: Leftover) {
  againFor = left
  again.value?.click()
}
function pickedAgain(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  if (file && againFor) uploads.resumeLeftover(againFor, file)
  againFor = null
}
function add(files: readonly File[]) {
  if (files.length > 0) void uploads.add(files, props.folderId)
}

// Ctrl/Cmd+V of a copied picture, anywhere on the page but in a field
function pasted(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable="true"]')) return
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length === 0) return
  event.preventDefault()
  const now = new Date()
  add(
    files.map((f) =>
      f.name && f.name !== 'image.png'
        ? f
        : new File([f], pastedFileName(f.type, now), { type: f.type, lastModified: now.getTime() }),
    ),
  )
}
onMounted(() => document.addEventListener('paste', pasted))
onBeforeUnmount(() => document.removeEventListener('paste', pasted))

const limitsText = computed(() =>
  limits.value
    ? t('upload.limits', {
        image: formatBytes(limits.value.maxImageBytes),
        video: formatBytes(limits.value.maxVideoBytes),
      })
    : t('upload.limitsUnknown'),
)

defineExpose({ choose, add, limitsText })

const { line, tone, showsBar, barPercent, workPercent, uploadSummary } = useUploadLine()

const org = useOrganization()
const thumbOf = (i: UploadItem) => {
  const variant = i.media && i.state === 'ready' ? thumbnailOf(i.media) : null
  return variant && i.media
    ? `${org.api(`/workspaces/${encodeURIComponent(props.workspace.id)}`)}/media/${encodeURIComponent(i.media.id)}/file/${variant}`
    : null
}
/** No picture of it until the server's: a HEIC, or a video the browser does not play (HEVC). */
const waitsPreview = (i: UploadItem) =>
  ['queued', 'hashing', 'uploading', 'paused', 'offline', 'completing', 'processing'].includes(
    i.state,
  ) &&
  (!i.preview || (i.preview.kind === 'video' && unplayable.value.has(i.key)))
const unplayable = ref(new Set<string>())
const markUnplayable = (key: string) => (unplayable.value = new Set([...unplayable.value, key]))

const finished = computed(() =>
  items.value.some((i) => ['ready', 'failed', 'rejected'].includes(i.state)),
)
const summary = computed(() => uploadSummary(totals.value))
const leftoverPercent = (u: Leftover) =>
  u.partCount > 0 ? Math.floor((u.received.length / u.partCount) * 100) : 0
const leftoverComplete = (u: Leftover) => u.received.length >= u.partCount
</script>

<template>
  <div :data-hasher="uploads.hasherMode.value">
    <input
      ref="picker"
      type="file"
      multiple
      :accept="UPLOAD_ACCEPT"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      data-upload-input
      @change="picked"
    />
    <input
      ref="again"
      type="file"
      :accept="UPLOAD_ACCEPT"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      data-upload-again
      @change="pickedAgain"
    />
    <p class="sr-only" aria-live="polite" aria-atomic="true" data-upload-announcer>
      {{ uploads.announcement.value }}
    </p>

    <section
      v-if="leftovers.length > 0"
      aria-labelledby="upload-leftovers"
      class="mb-4 rounded-xl border border-(--app-border) bg-(--app-card) p-4"
    >
      <h2 id="upload-leftovers" class="font-semibold">{{ $t('upload.leftovers.title') }}</h2>
      <p class="mt-1 text-sm text-(--app-text-muted)">{{ $t('upload.leftovers.text') }}</p>
      <p v-if="uploads.leftoverProblem.value" role="alert" class="mt-2 text-sm text-(--app-danger)">
        {{ uploads.leftoverProblem.value }}
      </p>
      <ul class="mt-3 divide-y divide-(--app-border)">
        <li
          v-for="u in leftovers"
          :key="u.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
        >
          <div class="min-w-0 flex-1 basis-56">
            <p class="line-clamp-2 font-medium [overflow-wrap:anywhere]" :title="u.name">
              {{ u.name }}
            </p>
            <p class="text-sm text-(--app-text-muted) tabular-nums">
              {{
                $t('upload.leftovers.progress', {
                  percent: leftoverPercent(u),
                  total: formatBytes(u.sizeBytes),
                  when: formatDate(u.expiresAt, true),
                })
              }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="leftoverComplete(u)"
              class="min-h-11"
              icon="i-lucide-check"
              @click="uploads.resumeLeftover(u, null)"
            >
              {{ $t('upload.leftovers.complete') }}
            </UButton>
            <UButton
              v-else
              class="min-h-11"
              icon="i-lucide-file-up"
              :aria-label="$t('upload.leftovers.chooseAgainFor', { name: u.name })"
              @click="chooseAgain(u)"
            >
              {{ $t('upload.leftovers.chooseAgain') }}
            </UButton>
            <UButton
              class="min-h-11"
              color="neutral"
              variant="ghost"
              :aria-label="$t('upload.cancelFor', { name: u.name })"
              @click="uploads.cancelLeftover(u)"
            >
              {{ $t('upload.cancel') }}
            </UButton>
          </div>
        </li>
      </ul>
    </section>

    <section
      v-if="items.length > 0"
      aria-labelledby="upload-title"
      class="mb-4 rounded-xl border border-(--app-border) bg-(--app-card) p-4"
    >
      <div class="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div class="min-w-0 flex-1">
          <h2 id="upload-title" class="font-semibold">{{ $t('upload.title') }}</h2>
          <p class="text-sm text-(--app-text-muted) tabular-nums">{{ summary }}</p>
        </div>
        <UButton
          v-if="finished"
          class="-my-1 min-h-11"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="uploads.clearFinished()"
        >
          {{ $t('upload.clear') }}
        </UButton>
      </div>
      <div
        v-if="totals.files > 1"
        role="progressbar"
        :aria-label="$t('upload.overallLabel')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="totals.percent"
        :aria-valuetext="summary"
        class="mt-3 h-2 overflow-hidden rounded-full bg-(--app-surface-sunken)"
      >
        <span
          class="block h-full rounded-full bg-(--app-brand) transition-[width] duration-300 motion-reduce:transition-none"
          :style="{ width: `${totals.percent}%` }"
        />
      </div>

      <ul class="mt-3 divide-y divide-(--app-border)">
        <li
          v-for="i in items"
          :key="i.key"
          class="flex items-start gap-3 py-3 first:pt-1 last:pb-0"
          :data-upload="i.name"
          :data-state="i.state"
        >
          <div
            class="relative size-12 shrink-0 overflow-hidden rounded-lg bg-(--app-surface-sunken)"
            aria-hidden="true"
          >
            <img
              v-if="thumbOf(i)"
              :src="thumbOf(i) ?? undefined"
              alt=""
              class="size-full object-cover"
            />
            <img
              v-else-if="i.preview?.kind === 'image'"
              :src="i.preview.url"
              alt=""
              class="size-full object-cover"
            />
            <video
              v-else-if="i.preview?.kind === 'video' && !unplayable.has(i.key)"
              :src="i.preview.url"
              muted
              playsinline
              preload="metadata"
              class="size-full object-cover"
              data-local-preview
              @error="markUnplayable(i.key)"
            />
            <span v-else class="flex size-full items-center justify-center text-(--app-text-muted)">
              <UIcon
                :name="
                  i.state === 'rejected' || i.state === 'error' || i.state === 'failed'
                    ? 'i-lucide-file-x'
                    : i.kind === 'video'
                      ? 'i-lucide-film'
                      : 'i-lucide-image'
                "
                class="size-5"
              />
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="line-clamp-2 font-medium [overflow-wrap:anywhere]" :title="i.name">
              {{ i.name }}
            </p>
            <p class="text-sm tabular-nums" :class="tone(i)" data-upload-line>
              {{ line(i) }}
            </p>
            <p
              v-if="i.duplicateOf"
              class="flex items-start gap-1.5 text-sm text-(--app-warning)"
              data-upload-duplicate
            >
              <UIcon name="i-lucide-copy" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span class="min-w-0 break-words">{{
                $t('upload.duplicate', { name: i.duplicateOf.name })
              }}</span>
            </p>
            <p v-if="waitsPreview(i)" class="text-sm text-(--app-text-muted)">
              {{ $t('library.detail.preparing') }}
            </p>
            <div
              v-if="showsBar(i)"
              role="progressbar"
              :aria-label="$t('upload.progressLabel', { name: i.name })"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="
                i.state === 'processing' && workPercent(i) === null ? undefined : barPercent(i)
              "
              :aria-valuetext="line(i)"
              class="mt-2 h-1.5 overflow-hidden rounded-full bg-(--app-surface-sunken)"
            >
              <span
                class="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                :class="
                  i.state === 'paused' || i.state === 'offline'
                    ? 'bg-(--app-text-muted)'
                    : 'bg-(--app-brand)'
                "
                :style="{ width: `${barPercent(i)}%` }"
              />
            </div>
          </div>
          <div class="-my-1 flex shrink-0 items-center gap-1">
            <UButton
              v-if="['queued', 'hashing', 'uploading', 'offline'].includes(i.state)"
              color="neutral"
              variant="ghost"
              icon="i-lucide-pause"
              class="size-11 justify-center"
              :aria-label="$t('upload.pauseFor', { name: i.name })"
              @click="uploads.pause(i)"
            />
            <UButton
              v-if="i.state === 'paused'"
              color="neutral"
              variant="ghost"
              icon="i-lucide-play"
              class="size-11 justify-center"
              :aria-label="$t('upload.resumeFor', { name: i.name })"
              @click="uploads.resume(i)"
            />
            <UButton
              v-if="i.state === 'error' || i.state === 'offline'"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :aria-label="$t('upload.retryFor', { name: i.name })"
              @click="i.state === 'offline' ? uploads.wake(i.key) : uploads.resume(i)"
            >
              {{ i.state === 'offline' ? $t('upload.retryNow') : $t('upload.retry') }}
            </UButton>
            <UButton
              v-if="
                ['queued', 'hashing', 'uploading', 'paused', 'offline', 'error'].includes(i.state)
              "
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              class="size-11 justify-center"
              :aria-label="$t('upload.cancelFor', { name: i.name })"
              @click="uploads.cancel(i)"
            />
            <UButton
              v-if="['ready', 'failed', 'rejected'].includes(i.state)"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              class="size-11 justify-center"
              :aria-label="$t('upload.dismissFor', { name: i.name })"
              @click="uploads.dismiss(i)"
            />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
