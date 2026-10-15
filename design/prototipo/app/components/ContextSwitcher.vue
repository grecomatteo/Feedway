<script setup lang="ts">
import { WORKSPACES } from '~/fixtures/scenario'
import { profile, profilesOf } from '~/utils/format'

// Meta-style context: the whole agency, one client, or one profile (IG + linked FB Page).
defineProps<{ compact?: boolean }>()
const { state } = useDemo()
const open = ref(false)
const query = ref('')

const current = computed(() => {
  if (state.value.client === 'all') return { title: 'Tutti i clienti', sub: 'Visione d’insieme · 3 clienti', color: '#242321', initials: 'TC' }
  const ws = WORKSPACES.find(w => w.id === state.value.client)!
  const p = state.value.profile ? profile(state.value.profile) : null
  return { title: p ? p.name : ws.short, sub: p ? `${ws.short} · profilo` : 'Tutto il cliente', color: ws.color, initials: ws.initials }
})

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return WORKSPACES.map(w => ({
    ws: w,
    profiles: profilesOf(w.id).filter(p => !q || p.name.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || p.ig?.handle.toLowerCase().includes(q)),
  })).filter(g => g.profiles.length || g.ws.name.toLowerCase().includes(q))
})

function pick(client: string, prof: string | null = null) {
  state.value.client = client
  state.value.profile = prof
  open.value = false
  query.value = ''
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', sideOffset: 6 }">
    <button type="button" class="flex w-full items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-left" :class="compact ? 'min-h-11 px-2 py-1.5' : 'p-2.5'" :aria-label="`Contesto: ${current.title}. Cambia cliente o profilo`">
      <span class="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" :style="{ background: current.color }">{{ current.initials }}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{{ current.title }}</span>
        <span v-if="!compact" class="block truncate text-[11px] text-[var(--text-muted)]">{{ current.sub }}</span>
      </span>
      <UIcon name="i-lucide-chevrons-up-down" class="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
    </button>
    <template #content>
      <div class="w-[300px] max-w-[calc(100vw-24px)] p-2 text-[var(--text)]">
        <label class="flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-2.5">
          <UIcon name="i-lucide-search" class="size-4 text-[var(--text-muted)]" aria-hidden="true" />
          <span class="sr-only">Cerca cliente o profilo</span>
          <input v-model="query" type="search" placeholder="Cerca cliente o profilo" class="min-h-10 w-full bg-transparent text-sm outline-none">
        </label>
        <ul class="mt-2 max-h-[60vh] overflow-auto" role="list">
          <li>
            <button type="button" class="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]" :aria-current="state.client === 'all' ? 'true' : undefined" @click="pick('all')">
              <UIcon name="i-lucide-layout-grid" class="size-4" aria-hidden="true" />
              <span class="flex-1 font-semibold">Tutti i clienti</span>
              <UIcon v-if="state.client === 'all'" name="i-lucide-check" class="size-4" aria-label="selezionato" />
            </button>
          </li>
          <li v-for="g in groups" :key="g.ws.id" class="mt-1 border-t border-[var(--border)] pt-1">
            <button type="button" class="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]" :aria-current="state.client === g.ws.id && !state.profile ? 'true' : undefined" @click="pick(g.ws.id)">
              <span class="grid size-6 place-items-center rounded text-[10px] font-bold text-white" :style="{ background: g.ws.color }">{{ g.ws.initials }}</span>
              <span class="flex-1"><span class="block font-semibold">{{ g.ws.short }}</span><span class="block text-[11px] text-[var(--text-muted)]">Tutto il cliente</span></span>
              <UIcon v-if="state.client === g.ws.id && !state.profile" name="i-lucide-check" class="size-4" aria-label="selezionato" />
            </button>
            <ul v-if="g.profiles.length > 1 || g.profiles[0]?.name !== g.ws.short" role="list">
              <li v-for="p in g.profiles" :key="p.id">
                <button type="button" class="flex w-full items-center gap-2 rounded-md py-1.5 pl-10 pr-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]" :aria-current="state.profile === p.id ? 'true' : undefined" @click="pick(g.ws.id, p.id)">
                  <span class="flex-1">{{ p.name }}</span>
                  <UIcon v-if="p.ig" name="i-lucide-instagram" class="size-3.5 text-[var(--text-muted)]" aria-label="Instagram" />
                  <UIcon v-if="p.fb" name="i-lucide-facebook" class="size-3.5 text-[var(--text-muted)]" aria-label="Facebook" />
                  <UIcon v-if="state.profile === p.id" name="i-lucide-check" class="size-4" aria-label="selezionato" />
                </button>
              </li>
            </ul>
          </li>
          <li v-if="!groups.length" class="px-2 py-3 text-sm text-[var(--text-muted)]">Nessun cliente o profilo trovato.</li>
        </ul>
      </div>
    </template>
  </UPopover>
</template>
