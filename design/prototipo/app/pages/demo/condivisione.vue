<script setup lang="ts">
import { SHARE_LINKS } from '~/fixtures/scenario'
import { workspace } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Link cliente · Feedway demo' })

const { state, can } = useDemo()
const LABEL = { active: 'Attivo', protected: 'Protetto da password', expired: 'Scaduto', revoked: 'Revocato', empty: 'Attivo, calendario vuoto' } as const
const links = computed(() => Object.entries(SHARE_LINKS).filter(([, l]) => state.value.client === 'all' || l.workspaceId === state.value.client))
</script>

<template>
  <div class="flex flex-col gap-5 px-4 py-5 lg:px-7">
    <header>
      <h1 class="fw-title text-[26px]">Link cliente</h1>
      <p class="max-w-2xl text-[13px] text-[var(--text-muted)]">Calendari in sola lettura da condividere con i clienti. Il cliente vede piano, anteprime e orari: niente note interne, membri o altri clienti, nessuna modifica.</p>
    </header>
    <p v-if="!can.schedule" class="rounded-lg bg-[var(--surface-sunken)] p-3 text-sm">Creare, prorogare o revocare un link spetta a Manager e Admin. Puoi aprire i link esistenti.</p>
    <ul class="grid gap-3 md:grid-cols-2">
      <li v-for="[token, l] in links" :key="token" class="fw-card flex flex-col gap-2 p-4">
        <div class="flex items-center gap-2">
          <span class="size-2.5 rounded-full" :style="{ background: workspace(l.workspaceId).color }" />
          <span class="font-semibold">{{ workspace(l.workspaceId).short }}</span>
          <span class="ml-auto"><StatusBadge :status="{ label: LABEL[l.state], icon: l.state === 'expired' || l.state === 'revoked' ? 'i-lucide-link-2-off' : l.state === 'protected' ? 'i-lucide-lock' : 'i-lucide-link', tone: l.state === 'expired' || l.state === 'revoked' ? 'neutral' : 'success' }" /></span>
        </div>
        <p class="text-xs text-[var(--text-muted)]">{{ l.expires ? `Scadenza ${l.expires}` : 'Nessuna scadenza' }} · /cliente/{{ token }}</p>
        <div class="flex flex-wrap gap-2 pt-1">
          <NuxtLink :to="`/cliente/${token}`" target="_blank" class="fw-btn !min-h-9 !text-[13px]"><UIcon name="i-lucide-external-link" class="size-4" aria-hidden="true" />Apri come il cliente<span class="sr-only"> (nuova scheda)</span></NuxtLink>
        </div>
      </li>
    </ul>
  </div>
</template>
