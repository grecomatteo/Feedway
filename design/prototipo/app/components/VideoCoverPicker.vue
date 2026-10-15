<script setup lang="ts">
// Reel cover: a frame of the video (thumb_offset on Meta) or a custom image (cover_url).
// Everything stays in the browser: files are read with object URLs, nothing is uploaded.
const props = defineProps<{ src: string, fileName: string }>()
const cover = defineModel<string | null>('cover', { default: null })
const source = defineModel<'frame' | 'image'>('source', { default: 'frame' })

const video = ref<HTMLVideoElement>()
const duration = ref(0)
const offset = ref(0)
const playable = ref(true)
const customName = ref('')

function onMeta() {
  duration.value = video.value?.duration ?? 0
  playable.value = true
  if (source.value === 'frame') seek(Math.min(1, duration.value / 2))
}
function onError() { playable.value = false }

function seek(t: number) {
  offset.value = t
  if (video.value) video.value.currentTime = t
}
function capture() {
  const v = video.value
  if (!v || !v.videoWidth || source.value !== 'frame') return
  const c = document.createElement('canvas')
  c.width = 360; c.height = Math.round(360 * v.videoHeight / v.videoWidth)
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
  try { cover.value = c.toDataURL('image/jpeg', 0.75) }
  catch { cover.value = null }
}
function onImage(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  customName.value = f.name
  source.value = 'image'
  const r = new FileReader()
  r.onload = () => { cover.value = r.result as string }
  r.readAsDataURL(f)
}
function useFrame() { source.value = 'frame'; customName.value = ''; nextTick(capture) }
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
watch(() => props.src, () => { playable.value = true })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-4">
      <div class="w-[180px] shrink-0">
        <p class="mb-1.5 text-xs font-semibold">Rivedi il video</p>
        <video
          v-show="playable" ref="video" :src="src" controls playsinline preload="metadata"
          class="aspect-[9/16] w-full rounded-lg bg-black object-contain" :aria-label="`Anteprima di ${fileName}`"
          @loadedmetadata="onMeta" @seeked="capture" @error="onError"
        />
        <div v-if="!playable" class="grid aspect-[9/16] w-full place-items-center rounded-lg bg-[var(--surface-sunken)] p-3 text-center text-xs" role="alert">
          <span><UIcon name="i-lucide-film" class="mx-auto mb-2 size-6 text-[var(--text-muted)]" aria-hidden="true" />Questo browser non riesce a riprodurre {{ fileName }} (spesso succede con i .mov HEVC dell'iPhone). Nel prodotto vedrai l'anteprima della versione MP4 convertita dal server.</span>
        </div>
      </div>

      <fieldset class="min-w-60 flex-1">
        <legend class="text-[13px] font-bold">Copertina del reel</legend>
        <label class="mt-2 flex items-center gap-2 text-[13px]"><input type="radio" class="accent-[#242321]" :checked="source === 'frame'" :disabled="!playable" @change="useFrame">Un fotogramma del video</label>
        <div v-if="source === 'frame'" class="ml-6 mt-2">
          <label class="block text-xs font-semibold" for="cover-offset">Momento: {{ fmt(offset) }} di {{ fmt(duration) }}</label>
          <input id="cover-offset" type="range" min="0" :max="duration || 0" step="0.1" :value="offset" :disabled="!playable || !duration" class="mt-1 w-full accent-[#FF762E]" @input="seek(Number(($event.target as HTMLInputElement).value))">
        </div>
        <label class="mt-3 flex items-center gap-2 text-[13px]"><input type="radio" class="accent-[#242321]" :checked="source === 'image'" @change="source = 'image'">Un'immagine tua</label>
        <div v-if="source === 'image'" class="ml-6 mt-2 flex flex-wrap items-center gap-2">
          <label class="fw-btn !min-h-9 cursor-pointer !text-[13px]">
            <UIcon name="i-lucide-image-up" class="size-4" aria-hidden="true" />{{ customName ? 'Cambia immagine' : 'Scegli un\'immagine' }}
            <input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" @change="onImage">
          </label>
          <span v-if="customName" class="text-xs text-[var(--text-muted)]">{{ customName }}</span>
          <p class="basis-full text-xs text-[var(--text-muted)]">JPG o PNG, ideale 1080×1920. Su Facebook la copertina personalizzata dei reel va ancora verificata con un account di prova.</p>
        </div>
      </fieldset>
    </div>

    <div v-if="cover" class="flex flex-wrap items-end gap-4" aria-label="Come appare la copertina">
      <figure>
        <img :src="cover" alt="Copertina nel reel" class="aspect-[9/16] w-24 rounded-lg object-cover">
        <figcaption class="mt-1 text-[11px] text-[var(--text-muted)]">Reel 9:16</figcaption>
      </figure>
      <figure>
        <img :src="cover" alt="Copertina nella griglia del profilo" class="aspect-[3/4] w-24 rounded-lg object-cover">
        <figcaption class="mt-1 text-[11px] text-[var(--text-muted)]">Griglia profilo (ritaglio)</figcaption>
      </figure>
      <figure>
        <img :src="cover" alt="Copertina quadrata" class="aspect-square w-24 rounded-lg object-cover">
        <figcaption class="mt-1 text-[11px] text-[var(--text-muted)]">Ritaglio quadrato</figcaption>
      </figure>
      <p class="max-w-56 text-[11px] text-[var(--text-muted)]">Tieni testi e volti al centro: nella griglia i bordi vengono tagliati.</p>
    </div>
  </div>
</template>
