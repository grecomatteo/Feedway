<script setup lang="ts">
// The page's one moment (taste-skill, impeccable): a post leaves for five destinations and each
// one turns «Confermato» in turn, while one fails with its reason. It plays once when it comes
// into view; without JavaScript, or with reduced motion, it shows the end state at once.
type Status = 'scheduled' | 'publishing' | 'verifying' | 'confirmed' | 'failed'

const DESTINATIONS = [
  { platform: 'instagram', name: '@fornoluce', end: 'confirmed' },
  { platform: 'facebook', name: 'Forno Luce', end: 'confirmed' },
  { platform: 'instagram', name: '@fornoluce.bistrot', end: 'confirmed' },
  { platform: 'facebook', name: 'Forno Luce Bistrot', end: 'failed' },
  { platform: 'instagram', name: '@fornoluce.lab', end: 'confirmed' },
] as const

const LABELS: Record<Status, string> = {
  scheduled: 'Programmato',
  publishing: 'In pubblicazione',
  verifying: 'In verifica',
  confirmed: 'Confermato',
  failed: 'Non uscito',
}

const statuses = ref<Status[]>(DESTINATIONS.map((d) => d.end))
const root = ref<HTMLElement>()
const played = ref(false)
const timers: ReturnType<typeof setTimeout>[] = []

function play() {
  played.value = true
  statuses.value = DESTINATIONS.map(() => 'scheduled')
  DESTINATIONS.forEach((d, i) => {
    const start = 500 + i * 450
    timers.push(setTimeout(() => (statuses.value[i] = 'publishing'), start))
    timers.push(setTimeout(() => (statuses.value[i] = 'verifying'), start + 700))
    timers.push(setTimeout(() => (statuses.value[i] = d.end), start + 1500))
  })
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  statuses.value = DESTINATIONS.map(() => 'scheduled')
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && !played.value) {
        play()
        observer.disconnect()
      }
    },
    { threshold: 0.5 },
  )
  if (root.value) observer.observe(root.value)
  onBeforeUnmount(() => {
    observer.disconnect()
    timers.forEach(clearTimeout)
  })
})

const confirmed = computed(() => statuses.value.filter((s) => s === 'confirmed').length)
const done = computed(() => statuses.value.every((s) => s === 'confirmed' || s === 'failed'))
</script>

<template>
  <div ref="root" class="outcome">
    <div class="outcome-post">
      <img src="/shots/pane.webp" alt="" width="96" height="120" loading="lazy" decoding="async" />
      <div>
        <p class="outcome-title">Il pane del lunedì è appena uscito dal forno</p>
        <p class="outcome-meta">Forno Luce · Carosello, 2 foto · oggi, 12:00</p>
        <p class="outcome-sum" aria-live="polite">
          <template v-if="done">{{ confirmed }} confermati · 1 non uscito</template>
          <template v-else>Pubblicazione in corso…</template>
        </p>
      </div>
    </div>
    <ul class="outcome-list">
      <li v-for="(d, i) in DESTINATIONS" :key="d.name" :data-status="statuses[i]">
        <SiteIcon :name="d.platform" />
        <span class="outcome-name">{{ d.name }}</span>
        <span class="outcome-status"><i aria-hidden="true" />{{ LABELS[statuses[i]!] }}</span>
        <p v-if="statuses[i] === 'failed'" class="outcome-why">
          Il permesso per questa Pagina è scaduto. Ricollegala e premi «Riprova»: Feedway pubblica
          solo qui, le altre quattro non escono due volte.
        </p>
      </li>
    </ul>
  </div>
</template>
