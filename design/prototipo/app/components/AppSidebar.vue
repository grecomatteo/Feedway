<script setup lang="ts">
import { AGENCY } from '~/fixtures/scenario'

const { state } = useDemo()
const route = useRoute()
const nav = [
  { to: '/demo/calendario', icon: 'i-lucide-calendar-days', label: 'Calendario' },
  { to: '/demo/piano', icon: 'i-lucide-calendar-range', label: 'Piano editoriale' },
  { to: '/demo/post-elenco', icon: 'i-lucide-file-text', label: 'Post', soon: true },
  { to: '/demo/libreria', icon: 'i-lucide-images', label: 'Libreria', soon: true },
  { to: '/demo/import', icon: 'i-lucide-table-properties', label: 'In blocco' },
  { to: '/demo/clienti', icon: 'i-lucide-briefcase', label: 'Clienti', soon: true },
]
const manage = [
  { to: '/demo/account', icon: 'i-lucide-at-sign', label: 'Account social', soon: true },
  { to: '/demo/team', icon: 'i-lucide-users', label: 'Team e ruoli' },
  { to: '/demo/condivisione', icon: 'i-lucide-link', label: 'Link cliente' },
]
const active = (to: string) => route.path.startsWith(to) || (to === '/demo/calendario' && route.path.startsWith('/demo/post/'))
</script>

<template>
  <nav aria-label="Navigazione principale" class="flex h-full w-[232px] shrink-0 flex-col gap-1 border-r border-[var(--border)] bg-[var(--nav-bg)] px-3 py-5">
    <NuxtLink to="/demo/calendario" class="px-1 pb-3"><FwLogo :variant="state.dark ? 'bianco' : 'carbone'" :width="138" /></NuxtLink>
    <div class="px-2 pb-3">
      <div class="text-[11px] font-semibold tracking-wider text-[var(--text-muted)]">AGENZIA</div>
      <div class="text-sm font-semibold">{{ AGENCY.name }}</div>
    </div>
    <ContextSwitcher />
    <div class="h-3" />
    <template v-for="group in [nav, manage]" :key="group[0]!.to">
      <div v-if="group === manage" class="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-[var(--text-muted)]">GESTIONE</div>
      <NuxtLink
        v-for="item in group" :key="item.to" :to="item.soon ? undefined : item.to"
        :aria-current="active(item.to) ? 'page' : undefined"
        :aria-disabled="item.soon ? 'true' : undefined"
        class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
        :class="[active(item.to) ? 'bg-[var(--brand-soft)] font-semibold' : '', item.soon ? 'cursor-default text-[var(--text-muted)]' : 'hover:bg-[var(--surface-sunken)]']"
      >
        <UIcon :name="item.icon" class="size-[18px] text-[var(--text-muted)]" aria-hidden="true" />
        <span class="flex-1">{{ item.label }}</span>
        <span v-if="item.soon" class="sr-only">(non disponibile nel prototipo)</span>
      </NuxtLink>
    </template>
    <div class="flex-1" />
    <div class="flex items-center gap-2.5 px-2.5 py-2 text-sm"><UIcon name="i-lucide-circle-user" class="size-[18px] text-[var(--text-muted)]" aria-hidden="true" />Giulia R. · {{ state.role }}</div>
  </nav>
</template>
