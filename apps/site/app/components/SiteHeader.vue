<script setup lang="ts">
import { SITE } from '~/legal'

// one orange button per page: on the form page the form's own button is the one
const route = useRoute()
const onHome = computed(() => route.path === '/')
const onDemo = computed(() => route.path.startsWith('/richiedi-una-demo'))

const ANCHORS = [
  ['prodotto', 'Prodotto'],
  ['pubblicazione', 'Pubblicazione'],
  ['cliente', 'Clienti'],
  ['domande', 'Domande'],
] as const

const scrolled = ref(false)
const current = ref('')
let observer: IntersectionObserver | undefined

function onScroll() {
  scrolled.value = window.scrollY > 8
}

function watchSections() {
  observer?.disconnect()
  current.value = ''
  if (!onHome.value) return
  // a section is current while it crosses the middle of the screen
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) current.value = e.target.id
        else if (current.value === e.target.id) current.value = ''
      }
    },
    { rootMargin: '-50% 0px -50% 0px' },
  )
  for (const [id] of ANCHORS) {
    const el = document.getElementById(id)
    if (el) observer.observe(el)
  }
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  watchSections()
})
watch(onHome, () => nextTick(watchSections))
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  observer?.disconnect()
})
</script>

<template>
  <header class="site-header" :class="{ scrolled, 'on-home': onHome }">
    <div class="wrap bar">
      <NuxtLink to="/" class="logo" aria-label="Feedway, pagina iniziale">
        <img src="/brand/feedway-horizontal-carbone.svg" alt="" width="124" height="36" />
      </NuxtLink>
      <nav v-if="onHome" aria-label="Sezioni" class="anchors">
        <a
          v-for="[id, label] in ANCHORS"
          :key="id"
          :href="`#${id}`"
          :aria-current="current === id ? 'true' : undefined"
          >{{ label }}</a
        >
      </nav>
      <div class="actions">
        <a v-if="SITE.signInUrl" :href="SITE.signInUrl" class="btn btn-outline">Accedi</a>
        <NuxtLink v-if="!onDemo" to="/richiedi-una-demo" class="btn btn-primary"
          >Richiedi una demo</NuxtLink
        >
      </div>
    </div>
  </header>
</template>
