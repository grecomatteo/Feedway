<script setup lang="ts">
import { CROP_MIN_SIDE } from '~/utils/crop-box'
import type { CropRect } from '~/utils/post-preview'

/**
 * «Ritaglia» (D-61, Scelta 5; design E5a–E5d): the photo on dark with the box of the format's
 * proportions, moved and resized with the mouse, by touch and with the keyboard (arrows 1%,
 * Maiusc+arrows 10%, + and −); the result beside it. It starts from the box saved, or the
 * middle; «Usa questo ritaglio» gives the box in fractions of the original.
 */
const props = defineProps<{
  open: boolean
  title: string
  /** what and where: «impasto.jpg · 1080×1920 · Instagram» */
  subtitle: string
  src: string | null
  width: number
  height: number
  /** width over height */
  ratio: number
  ratioLabel: string
  initial: CropRect | null
}>()
const emit = defineEmits<{ apply: [crop: CropRect]; close: [] }>()
const { t } = useI18n()

const spec = computed(() => ({
  width: props.width,
  height: props.height,
  ratio: props.ratio,
  minSide: CROP_MIN_SIDE,
}))

const area = ref<HTMLElement | null>(null)
const room = ref({ width: 560, height: 420 })
const scale = computed(() =>
  Math.min(room.value.width / props.width, room.value.height / props.height),
)
const cropper = useCropBox(spec, {
  scale,
  step: (_box, s, big) => ({ x: s.width * (big ? 0.1 : 0.01), y: s.height * (big ? 0.1 : 0.01) }),
  zoomStep: (s) => Math.min(s.width, s.height * s.ratio) * 0.05,
})
const box = cropper.box

watch(
  () => props.open,
  async (now) => {
    if (!now) return
    if (props.initial) cropper.setFractions(props.initial)
    else cropper.reset()
    await nextTick()
    measure()
  },
  { immediate: true },
)
/** The photo fits the dark area: measured on opening and when the window changes (a phone turned). */
function measure() {
  const el = area.value
  if (el) room.value = { width: el.clientWidth - 32, height: Math.min(420, el.clientWidth) }
}
onMounted(() => window.addEventListener('resize', measure))
onBeforeUnmount(() => window.removeEventListener('resize', measure))

const px = (n: number) => `${String(n * scale.value)}px`
const frameStyle = computed(() => ({ width: px(props.width), height: px(props.height) }))
const boxStyle = computed(() => ({
  left: px(box.value.x),
  top: px(box.value.y),
  width: px(box.value.width),
  height: px(box.value.height),
}))
const pct = (n: number) => Math.round(n * 100)
/** the box's width as a share of the largest box */
const size = computed(() =>
  pct(box.value.width / Math.min(props.width, props.height * props.ratio)),
)
const valueText = computed(() =>
  t('posts.crop.value', {
    x: pct(box.value.x / props.width),
    y: pct(box.value.y / props.height),
    size: size.value,
  }),
)
/** The result: the box shown at the width of its panel. */
const RESULT = 200
const resultStyle = computed(() => {
  const k = RESULT / box.value.width
  return {
    width: `${String(RESULT)}px`,
    height: `${String(RESULT / props.ratio)}px`,
    backgroundImage: props.src ? `url("${props.src}")` : undefined,
    backgroundSize: `${String(props.width * k)}px ${String(props.height * k)}px`,
    backgroundPosition: `${String(-box.value.x * k)}px ${String(-box.value.y * k)}px`,
  }
})
const corners = ['nw', 'ne', 'sw', 'se'] as const
const cornerClass = {
  nw: '-top-1.5 -left-1.5 cursor-nwse-resize',
  ne: '-top-1.5 -right-1.5 cursor-nesw-resize',
  sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
  se: '-right-1.5 -bottom-1.5 cursor-nwse-resize',
}
function apply() {
  const f = cropper.fractions.value
  if (f) emit('apply', f)
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :description="subtitle"
    :ui="{ content: 'sm:max-w-4xl max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none' }"
    @update:open="
      (v: boolean) => {
        if (!v) emit('close')
      }
    "
  >
    <template #body>
      <div class="flex flex-col gap-6 md:flex-row">
        <div
          ref="area"
          class="flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[#1c1b19] p-4"
        >
          <div class="relative touch-none select-none" :style="frameStyle" data-crop-frame>
            <img
              v-if="src"
              :src="src"
              alt=""
              class="pointer-events-none block size-full"
              draggable="false"
            />
            <div
              role="slider"
              tabindex="0"
              :aria-label="t('posts.crop.area', { ratio: ratioLabel })"
              :aria-valuetext="valueText"
              :aria-valuenow="size"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + -"
              class="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] outline-3 outline-offset-2 outline-transparent focus-visible:outline-(--app-brand)"
              :style="boxStyle"
              data-crop-box
              @keydown="cropper.onKey"
              @pointerdown="cropper.onPointerDown($event)"
              @pointermove="cropper.onPointerMove"
              @pointerup="cropper.onPointerUp"
              @pointercancel="cropper.onPointerUp"
            >
              <span
                class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
                aria-hidden="true"
              >
                <span v-for="n in 9" :key="n" class="border border-white/35" />
              </span>
              <span
                v-for="c in corners"
                :key="c"
                class="absolute size-4 rounded-sm border-2 border-white bg-(--app-brand)"
                :class="cornerClass[c]"
                aria-hidden="true"
                :data-corner="c"
                @pointerdown="cropper.onPointerDown($event, c)"
                @pointermove="cropper.onPointerMove"
                @pointerup="cropper.onPointerUp"
                @pointercancel="cropper.onPointerUp"
              />
            </div>
          </div>
        </div>
        <div class="flex w-full shrink-0 flex-col gap-4 md:w-60">
          <div class="flex flex-col gap-2 max-md:hidden">
            <h3 class="text-sm font-semibold">
              {{ t('posts.crop.result', { ratio: ratioLabel }) }}
            </h3>
            <div
              class="max-w-full rounded-md bg-(--app-surface-sunken) bg-no-repeat"
              :style="resultStyle"
              data-crop-result
            />
          </div>
          <div class="flex flex-col gap-2 text-sm max-md:hidden">
            <h3 class="font-semibold">{{ t('posts.crop.keyboard') }}</h3>
            <p><kbd class="kbd">← ↑ → ↓</kbd> {{ t('posts.crop.keyMove') }}</p>
            <p><kbd class="kbd">Maiusc + frecce</kbd> {{ t('posts.crop.keyMoveBig') }}</p>
            <p><kbd class="kbd">+ −</kbd> {{ t('posts.crop.keySize') }}</p>
          </div>
          <p class="text-sm text-(--app-text-muted)">
            <span class="max-md:hidden">{{ t('posts.crop.mouse', { ratio: ratioLabel }) }}</span>
            <span class="md:hidden">{{ t('posts.crop.touch', { ratio: ratioLabel }) }}</span>
          </p>
          <div class="flex gap-2">
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-control min-w-control"
              icon="i-lucide-zoom-in"
              :aria-label="t('posts.crop.smaller')"
              :disabled="!cropper.canZoomIn.value"
              @click="cropper.zoom(1)"
            />
            <UButton
              color="neutral"
              variant="outline"
              class="min-h-control min-w-control"
              icon="i-lucide-zoom-out"
              :aria-label="t('posts.crop.larger')"
              :disabled="!cropper.canZoomOut.value"
              @click="cropper.zoom(-1)"
            />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-3">
        <UButton
          color="neutral"
          variant="ghost"
          trailing-icon="i-lucide-rotate-ccw"
          class="min-h-control"
          @click="cropper.reset()"
        >
          {{ t('posts.crop.center') }}
        </UButton>
        <div class="flex gap-3">
          <UButton color="neutral" variant="outline" class="min-h-control" @click="emit('close')">
            {{ t('posts.crop.cancel') }}
          </UButton>
          <UButton icon="i-lucide-check" class="min-h-control" data-crop-apply @click="apply">
            {{ t('posts.crop.apply') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.kbd {
  border: 1px solid var(--app-border);
  border-radius: 0.375rem;
  background: var(--app-surface-sunken);
  padding: 0.0625rem 0.375rem;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  margin-right: 0.375rem;
}
</style>
