<script setup lang="ts">
import type { ApiFailure } from '~/composables/useApi'

/**
 * A picture of the panel: the profile photo (`round`) or the agency's logo (`square`). Choose
 * or drop an image; a photo is cropped to a circle (by dragging, with the buttons or the
 * keyboard), a logo is shown whole, fitted inside the square (plan 04, choice 8). Both are seen
 * at their two sizes before saving. The server removes EXIF and GPS and checks the type from the
 * bytes; the checks here only spare a useless upload.
 */
interface Source {
  stagingId: string
  width: number
  height: number
  previewUrl: string
}

const props = withDefaults(
  defineProps<{
    /** The name behind the initials shown without a picture. */
    name: string
    /** The current picture (256 px), or null. */
    current: string | null
    shape?: 'round' | 'square'
    /** Upload (POST, multipart), save (POST, with the preview's id) and remove (DELETE). */
    routes: { upload: string; save: string; remove: string }
    /** The i18n group of the texts: `avatar` or `logo`. */
    texts?: 'avatar' | 'logo'
    /** Runs each change: the logo asks for a recent reauth (`withReauth`). */
    guard?: (action: () => Promise<void>) => Promise<void>
  }>(),
  { shape: 'round', texts: 'avatar', guard: (action: () => Promise<void>) => action() },
)
const emit = defineEmits<{ saved: [answer: unknown] }>()

const { t } = useI18n()
const { call, failure } = useApi()
const ready = useHydrated()
const id = useId()
const tx = (key: string) => t(`${props.texts}.${key}`)
const cropping = computed(() => props.shape === 'round')

const MAX_BYTES = 5 * 1024 * 1024
const MIN_CROP = 64
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
const KNOWN = /\.(jpe?g|png|webp|heic|heif)$/i

const input = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const saving = ref(false)
const removing = ref(false)
const problem = ref<string | null>(null)
const done = ref<string | null>(null)
const dragging = ref(false)

/** The uploaded preview and the square on it, in the preview's own pixels. */
const source = ref<Source | null>(null)
const crop = reactive({ x: 0, y: 0, size: 0 })
const open = ref(false)

const busy = computed(() => uploading.value || saving.value || removing.value)

/** A change through the guard; closing the reauth dialog is not an error. */
async function guarded(action: () => Promise<void>) {
  try {
    await props.guard(action)
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = messageOf(failure(e))
  }
}

function choose() {
  input.value?.click()
}

function precheck(file: File): string | null {
  if (file.size > MAX_BYTES) return tx('tooLarge')
  if (file.type !== '' && !/^image\//.test(file.type) && !KNOWN.test(file.name))
    return tx('wrongType')
  return null
}

async function upload(file: File) {
  problem.value = null
  done.value = null
  const local = precheck(file)
  if (local) {
    problem.value = local
    return
  }
  uploading.value = true
  await guarded(async () => {
    const form = new FormData()
    form.append('file', file, file.name)
    const answer = await call<Source>('POST', props.routes.upload, form)
    source.value = answer
    const side = Math.min(answer.width, answer.height)
    crop.size = side
    crop.x = Math.floor((answer.width - side) / 2)
    crop.y = Math.floor((answer.height - side) / 2)
    open.value = true
  })
  uploading.value = false
}

function messageOf(f: ApiFailure): string {
  if (f.code === 'FILE_TOO_LARGE' || f.code === 'REQUEST_TOO_LARGE') return tx('tooLarge')
  if (f.code === 'UNSUPPORTED_FILE_TYPE') return tx('wrongType')
  return f.message
}

function onPicked(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  // the same file can be chosen again after an error
  target.value = ''
  if (file) void upload(file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file && !busy.value) void upload(file)
}

// ---- crop: every change keeps the square inside the photo
const side = computed(() => Math.min(source.value?.width ?? 0, source.value?.height ?? 0))
function place(x: number, y: number, size: number) {
  const s = source.value
  if (!s) return
  const next = Math.round(Math.min(Math.max(size, Math.min(MIN_CROP, side.value)), side.value))
  // zoom around the centre of the square
  const cx = x + crop.size / 2
  const cy = y + crop.size / 2
  const nx = size === crop.size ? x : cx - next / 2
  const ny = size === crop.size ? y : cy - next / 2
  crop.size = next
  crop.x = Math.round(Math.min(Math.max(nx, 0), s.width - next))
  crop.y = Math.round(Math.min(Math.max(ny, 0), s.height - next))
}
const step = computed(() => Math.max(1, Math.round(crop.size / 20)))
const move = (dx: number, dy: number) => {
  place(crop.x + dx * step.value, crop.y + dy * step.value, crop.size)
}
const zoom = (direction: 1 | -1) => {
  // zooming in shows less of the photo: a smaller square
  place(crop.x, crop.y, crop.size - direction * Math.max(1, Math.round(side.value / 10)))
}
const canZoomIn = computed(() => crop.size > Math.min(MIN_CROP, side.value))
const canZoomOut = computed(() => crop.size < side.value)

function onKey(event: KeyboardEvent) {
  const keys: Record<string, () => void> = {
    ArrowLeft: () => move(-1, 0),
    ArrowRight: () => move(1, 0),
    ArrowUp: () => move(0, -1),
    ArrowDown: () => move(0, 1),
    '+': () => zoom(1),
    '=': () => zoom(1),
    '-': () => zoom(-1),
  }
  const action = keys[event.key]
  if (!action) return
  event.preventDefault()
  action()
}

/** The photo fits a square of FRAME px; the selection is drawn over it. */
const FRAME = 288
const scale = computed(() => {
  const s = source.value
  return s ? FRAME / Math.max(s.width, s.height) : 1
})
const frameStyle = computed(() => ({
  width: `${String(Math.round((source.value?.width ?? 0) * scale.value))}px`,
  height: `${String(Math.round((source.value?.height ?? 0) * scale.value))}px`,
}))
const selectionStyle = computed(() => ({
  left: `${String(crop.x * scale.value)}px`,
  top: `${String(crop.y * scale.value)}px`,
  width: `${String(crop.size * scale.value)}px`,
  height: `${String(crop.size * scale.value)}px`,
}))

let drag: { pointer: number; startX: number; startY: number; x: number; y: number } | null = null
function onPointerDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = {
    pointer: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: crop.x,
    y: crop.y,
  }
}
function onPointerMove(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return
  place(
    drag.x + (event.clientX - drag.startX) / scale.value,
    drag.y + (event.clientY - drag.startY) / scale.value,
    crop.size,
  )
}
function onPointerUp() {
  drag = null
}

/** The logo whole inside the square, as the server will fit it. */
const fitStyle = computed(() => {
  const s = source.value
  return s ? { backgroundImage: `url("${s.previewUrl}")` } : {}
})

/** The square as a circle of `px` pixels: the photo moved and scaled behind it. */
function previewStyle(px: number) {
  const s = source.value
  if (!s || crop.size === 0) return {}
  const k = px / crop.size
  return {
    backgroundImage: `url("${s.previewUrl}")`,
    backgroundSize: `${String(s.width * k)}px ${String(s.height * k)}px`,
    backgroundPosition: `${String(-crop.x * k)}px ${String(-crop.y * k)}px`,
  }
}

async function save() {
  const s = source.value
  if (!s) return
  saving.value = true
  problem.value = null
  await guarded(async () => {
    const answer = await call<unknown>(
      'POST',
      props.routes.save,
      cropping.value
        ? { stagingId: s.stagingId, x: crop.x, y: crop.y, size: crop.size }
        : { stagingId: s.stagingId },
    )
    open.value = false
    source.value = null
    done.value = tx('saved')
    emit('saved', answer)
  })
  saving.value = false
}

async function remove() {
  removing.value = true
  problem.value = null
  done.value = null
  await guarded(async () => {
    const answer = await call<unknown>('DELETE', props.routes.remove)
    done.value = tx('removed')
    emit('saved', answer)
  })
  removing.value = false
}

watch(open, (value) => {
  // closing the window without saving drops the preview (the server keeps it one hour)
  if (!value && !saving.value) source.value = null
})
</script>

<template>
  <section
    :aria-labelledby="id"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 :id="id" class="text-lg">{{ tx('title') }}</h2>
    <div
      class="flex flex-wrap items-center gap-4 rounded-lg border-2 border-dashed p-4"
      :class="dragging ? 'border-(--app-brand) bg-(--app-brand-soft)' : 'border-transparent'"
      :data-testid="`${texts}-drop`"
      @dragover.prevent="dragging = ready && !busy"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <UserAvatar v-if="cropping" :name="name" :src="current" size="lg" />
      <AgencyLogo v-else :name="name" :src="current" size="lg" />
      <div class="min-w-0 flex-1 space-y-2">
        <p class="text-sm text-(--app-text-muted)">
          {{ dragging ? tx('dropHere') : tx('help') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            class="min-h-11"
            icon="i-lucide-image-up"
            :loading="uploading"
            :disabled="!ready || busy"
            @click="choose"
          >
            {{ tx('choose') }}
          </UButton>
          <UButton
            v-if="current"
            class="min-h-11"
            color="neutral"
            variant="outline"
            icon="i-lucide-trash-2"
            :loading="removing"
            :disabled="!ready || busy"
            @click="remove"
          >
            {{ tx('remove') }}
          </UButton>
        </div>
        <input
          ref="input"
          type="file"
          :accept="ACCEPT"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          :data-testid="`${texts}-file`"
          @change="onPicked"
        />
      </div>
    </div>
    <p v-if="uploading" role="status">{{ tx('uploading') }}</p>
    <p v-if="problem && !open" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <UModal
      v-model:open="open"
      :title="tx('cropTitle')"
      :description="tx('cropHelp')"
      :dismissible="!saving"
    >
      <template #body>
        <div v-if="source" class="space-y-4">
          <div v-if="cropping" class="flex justify-center">
            <div class="relative overflow-hidden rounded-md select-none" :style="frameStyle">
              <img
                :src="source.previewUrl"
                alt=""
                class="pointer-events-none block size-full"
                draggable="false"
              />
              <div
                role="slider"
                tabindex="0"
                :aria-label="$t('avatar.cropArea')"
                :aria-valuetext="
                  $t('avatar.cropValue', {
                    x: crop.x,
                    y: crop.y,
                    size: crop.size,
                  })
                "
                :aria-valuenow="crop.size"
                :aria-valuemin="Math.min(MIN_CROP, side)"
                :aria-valuemax="side"
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + -"
                class="absolute cursor-move touch-none rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] outline-2 outline-offset-2 outline-white focus-visible:outline-(--app-brand)"
                :style="selectionStyle"
                data-testid="avatar-crop"
                @keydown="onKey"
                @pointerdown="onPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointercancel="onPointerUp"
              />
            </div>
          </div>
          <div v-if="cropping" class="flex flex-wrap items-center justify-center gap-2">
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-arrow-left"
              :aria-label="$t('avatar.moveLeft')"
              @click="move(-1, 0)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-arrow-up"
              :aria-label="$t('avatar.moveUp')"
              @click="move(0, -1)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-arrow-down"
              :aria-label="$t('avatar.moveDown')"
              @click="move(0, 1)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-arrow-right"
              :aria-label="$t('avatar.moveRight')"
              @click="move(1, 0)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-zoom-in"
              :aria-label="$t('avatar.zoomIn')"
              :disabled="!canZoomIn"
              @click="zoom(1)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-11 min-w-11"
              icon="i-lucide-zoom-out"
              :aria-label="$t('avatar.zoomOut')"
              :disabled="!canZoomOut"
              @click="zoom(-1)"
            />
          </div>
          <div v-if="cropping" class="flex items-end justify-center gap-6">
            <figure class="space-y-1 text-center">
              <div
                class="size-32 rounded-full bg-no-repeat"
                :style="previewStyle(128)"
                data-testid="avatar-preview-large"
              />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ tx('previewLarge') }}
              </figcaption>
            </figure>
            <figure class="space-y-1 text-center">
              <div class="size-8 rounded-full bg-no-repeat" :style="previewStyle(32)" />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ tx('previewSmall') }}
              </figcaption>
            </figure>
          </div>
          <!-- a logo is never cropped: whole, fitted inside the square, transparency kept -->
          <div v-else class="flex items-end justify-center gap-6">
            <figure class="space-y-1 text-center">
              <div
                class="size-32 rounded-xl border border-(--app-border) bg-(--app-surface) bg-contain bg-center bg-no-repeat"
                :style="fitStyle"
                :data-testid="`${texts}-preview-large`"
              />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ tx('previewLarge') }}
              </figcaption>
            </figure>
            <figure class="space-y-1 text-center">
              <div
                class="size-8 rounded-md border border-(--app-border) bg-(--app-surface) bg-contain bg-center bg-no-repeat"
                :style="fitStyle"
              />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ tx('previewSmall') }}
              </figcaption>
            </figure>
          </div>
          <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-11"
            :disabled="saving"
            @click="open = false"
          >
            {{ tx('cancel') }}
          </UButton>
          <UButton class="min-h-11" :loading="saving" @click="save">
            {{ tx('save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
