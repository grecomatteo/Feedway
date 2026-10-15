<script setup lang="ts">
import { INITIAL_POSTS, MEDIA, SHARE_LINKS } from '~/data/scenario'
import { TYPE_LABEL, capitalize, dt, hhmm, workspace } from '~/utils/format'

// Public read-only view: it uses the fixture directly, never the demo's private state.
const route = useRoute()
const link = computed(() => SHARE_LINKS[route.params.token as string])
const ws = computed(() => (link.value ? workspace(link.value.workspaceId) : null))
useHead({ title: () => (ws.value ? `Piano di ${ws.value.short}` : 'Link non valido'), meta: [{ name: 'robots', content: 'noindex' }] })

const password = ref('')
const unlocked = ref(false)
const wrong = ref(false)
function unlock() {
  wrong.value = password.value !== 'forma2026'
  unlocked.value = !wrong.value
}
const posts = computed(() => (link.value && link.value.state !== 'empty'
  ? INITIAL_POSTS.filter(p => p.workspaceId === link.value!.workspaceId && p.status !== 'draft' && p.scheduledAt >= '2026-10-15').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  : []))
const days = computed(() => [...new Set(posts.value.map(p => p.scheduledAt.slice(0, 10)))])
</script>

<template>
  <div class="min-h-dvh bg-[var(--bg)]">
    <header class="flex items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3">
      <span class="text-sm font-semibold">Studio Aurora</span>
      <span class="text-[var(--border-strong)]">/</span>
      <span v-if="ws" class="flex items-center gap-2 text-sm font-semibold"><span class="size-2.5 rounded-full" :style="{ background: ws.color }" />{{ ws.short }}</span>
      <span class="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]"><UIcon name="i-lucide-eye" class="size-4" aria-hidden="true" />Sola lettura</span>
    </header>

    <main class="mx-auto max-w-3xl px-5 py-8">
      <div v-if="!link || link.state === 'revoked'" class="text-center" role="alert">
        <UIcon name="i-lucide-link-2-off" class="mx-auto size-8 text-[var(--text-muted)]" aria-hidden="true" />
        <h1 class="fw-title mt-3 text-2xl">Questo link non è più attivo</h1>
        <p class="mt-2 text-sm text-[var(--text-muted)]">L'agenzia lo ha revocato. Chiedi a chi te l'ha inviato un nuovo link.</p>
      </div>
      <div v-else-if="link.state === 'expired'" class="text-center" role="alert">
        <UIcon name="i-lucide-calendar-x" class="mx-auto size-8 text-[var(--text-muted)]" aria-hidden="true" />
        <h1 class="fw-title mt-3 text-2xl">Questo link è scaduto</h1>
        <p class="mt-2 text-sm text-[var(--text-muted)]">Era valido fino al {{ link.expires }}. Chiedi all'agenzia di prorogarlo o di inviarne uno nuovo.</p>
      </div>
      <form v-else-if="link.state === 'protected' && !unlocked" class="mx-auto flex max-w-sm flex-col gap-3" @submit.prevent="unlock">
        <h1 class="fw-title text-2xl">Calendario protetto</h1>
        <label class="text-sm font-semibold" for="pw">Password ricevuta dall'agenzia</label>
        <input id="pw" v-model="password" type="password" class="fw-input" autocomplete="off" :aria-invalid="wrong" aria-describedby="pw-hint">
        <p v-if="wrong" id="pw-hint" class="text-sm text-[var(--danger)]" role="alert">Password non corretta. Riprova o chiedi all'agenzia.</p>
        <p v-else id="pw-hint" class="text-xs text-[var(--text-muted)]">Demo: la password è forma2026.</p>
        <button type="submit" class="fw-btn fw-btn--primary">Apri il calendario</button>
      </form>
      <template v-else>
        <h1 class="fw-title text-2xl">Piano dei contenuti · {{ ws?.short }}</h1>
        <p class="mt-1 text-sm text-[var(--text-muted)]">Orari in Europe/Rome. Questa pagina mostra solo ciò che l'agenzia ha programmato.</p>
        <p v-if="!posts.length" class="mt-8 rounded-xl bg-[var(--surface-sunken)] p-6 text-center text-sm">Non ci sono ancora contenuti programmati. Il piano apparirà qui.</p>
        <section v-for="d in days" :key="d" class="mt-6">
          <h2 class="text-[13px] font-bold uppercase text-[var(--text-muted)]">{{ capitalize(dt(d + 'T12:00:00').toFormat('cccc d LLLL')) }}</h2>
          <article v-for="p in posts.filter(x => x.scheduledAt.startsWith(d))" :key="p.id" class="fw-card mt-2 flex gap-4 p-3">
            <img :src="MEDIA[p.media]" alt="" class="h-28 w-24 rounded-lg object-cover" loading="lazy">
            <div><p class="tabular font-bold">{{ hhmm(p.scheduledAt) }} · {{ TYPE_LABEL[p.type] }}</p><p class="mt-1 text-sm">{{ p.caption }}</p></div>
          </article>
        </section>
      </template>
      <p class="mt-12 text-center text-xs text-[var(--text-muted)]">Prototipo Feedway con dati fittizi.</p>
    </main>
  </div>
</template>
