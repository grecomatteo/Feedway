<script setup lang="ts">
import type { AvatarSource, Me } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

/**
 * "Foto profilo": choose or drop a photo, crop a square (by dragging, with the buttons or the
 * keyboard), see it at both sizes, save. The server removes EXIF and GPS and checks the type
 * from the bytes; the checks here only spare a useless upload.
 */
const props = defineProps<{ me: Me }>()
const emit = defineEmits<{ saved: [me: Me] }>()

const { t } = useI18n()
const { call, failure } = useApi()
const ready = useHydrated()

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
const source = ref<AvatarSource | null>(null)
const crop = reactive({ x: 0, y: 0, size: 0 })
const open = ref(false)

const busy = computed(() => uploading.value || saving.value || removing.value)

function choose() {
  input.value?.click()
}

function precheck(file: File): string | null {
  if (file.size > MAX_BYTES) return t('avatar.tooLarge')
  if (file.type !== '' && !/^image\//.test(file.type) && !KNOWN.test(file.name))
    return t('avatar.wrongType')
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
  try {
    const form = new FormData()
    form.append('file', file, file.name)
    const answer = await call<AvatarSource>('POST', '/api/v1/me/avatar', form)
    source.value = answer
    const side = Math.min(answer.width, answer.height)
    crop.size = side
    crop.x = Math.floor((answer.width - side) / 2)
    crop.y = Math.floor((answer.height - side) / 2)
    open.value = true
  } catch (e) {
    problem.value = messageOf(failure(e))
  } finally {
    uploading.value = false
  }
}

function messageOf(f: ApiFailure): string {
  if (f.code === 'FILE_TOO_LARGE' || f.code === 'REQUEST_TOO_LARGE') return t('avatar.tooLarge')
  if (f.code === 'UNSUPPORTED_FILE_TYPE') return t('avatar.wrongType')
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
  try {
    const me = await call<Me>('POST', '/api/v1/me/avatar/crop', {
      stagingId: s.stagingId,
      x: crop.x,
      y: crop.y,
      size: crop.size,
    })
    open.value = false
    source.value = null
    done.value = t('avatar.saved')
    emit('saved', me)
  } catch (e) {
    problem.value = messageOf(failure(e))
  } finally {
    saving.value = false
  }
}

async function remove() {
  removing.value = true
  problem.value = null
  done.value = null
  try {
    const me = await call<Me>('DELETE', '/api/v1/me/avatar')
    done.value = t('avatar.removed')
    emit('saved', me)
  } catch (e) {
    problem.value = messageOf(failure(e))
  } finally {
    removing.value = false
  }
}

watch(open, (value) => {
  // closing the window without saving drops the preview (the server keeps it one hour)
  if (!value && !saving.value) source.value = null
})
</script>

<template>
  <section
    aria-labelledby="account-avatar"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 id="account-avatar" class="text-lg">{{ $t('avatar.title') }}</h2>
    <div
      class="flex flex-wrap items-center gap-4 rounded-lg border-2 border-dashed p-4"
      :class="dragging ? 'border-(--app-brand) bg-(--app-brand-soft)' : 'border-transparent'"
      data-testid="avatar-drop"
      @dragover.prevent="dragging = ready && !busy"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <UserAvatar :name="props.me.displayName" :src="props.me.avatarUrl" size="lg" />
      <div class="min-w-0 flex-1 space-y-2">
        <p class="text-sm text-(--app-text-muted)">
          {{ dragging ? $t('avatar.dropHere') : $t('avatar.help') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton
            class="min-h-11"
            icon="i-lucide-image-up"
            :loading="uploading"
            :disabled="!ready || busy"
            @click="choose"
          >
            {{ $t('avatar.choose') }}
          </UButton>
          <UButton
            v-if="props.me.avatarUrl"
            class="min-h-11"
            color="neutral"
            variant="outline"
            icon="i-lucide-trash-2"
            :loading="removing"
            :disabled="!ready || busy"
            @click="remove"
          >
            {{ $t('avatar.remove') }}
          </UButton>
        </div>
        <input
          ref="input"
          type="file"
          :accept="ACCEPT"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          data-testid="avatar-file"
          @change="onPicked"
        />
      </div>
    </div>
    <p v-if="uploading" role="status">{{ $t('avatar.uploading') }}</p>
    <p v-if="problem && !open" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <UModal
      v-model:open="open"
      :title="$t('avatar.cropTitle')"
      :description="$t('avatar.cropHelp')"
      :dismissible="!saving"
    >
      <template #body>
        <div v-if="source" class="space-y-4">
          <div class="flex justify-center">
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
          <div class="flex flex-wrap items-center justify-center gap-2">
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
          <div class="flex items-end justify-center gap-6">
            <figure class="space-y-1 text-center">
              <div
                class="size-32 rounded-full bg-no-repeat"
                :style="previewStyle(128)"
                data-testid="avatar-preview-large"
              />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ $t('avatar.previewLarge') }}
              </figcaption>
            </figure>
            <figure class="space-y-1 text-center">
              <div class="size-8 rounded-full bg-no-repeat" :style="previewStyle(32)" />
              <figcaption class="text-sm text-(--app-text-muted)">
                {{ $t('avatar.previewSmall') }}
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
            {{ $t('avatar.cancel') }}
          </UButton>
          <UButton class="min-h-11" :loading="saving" @click="save">
            {{ $t('avatar.save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
