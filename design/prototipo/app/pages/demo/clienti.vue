<script setup lang="ts">
import { WORKSPACES } from '~/fixtures/scenario'
import { profilesOf } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Clienti · Feedway demo' })

const { state, can } = useDemo()
const toast = useToast()
const visible = computed(() => WORKSPACES.filter(w => state.value.client === 'all' || w.id === state.value.client))
function saved(name: string, t: string) {
  toast.add({ title: `Orario predefinito di ${name}: ${t}`, description: 'Lo trovi già compilato quando programmi un nuovo post.', color: 'success' })
}
</script>

<template>
  <div class="flex flex-col gap-5 px-4 py-5 lg:px-7">
    <header>
      <h1 class="fw-title text-[26px]">Clienti</h1>
      <p class="max-w-2xl text-[13px] text-[var(--text-muted)]">Impostazioni di ogni cliente. Nel prototipo c'è solo l'orario predefinito; profili, fasce orarie, etichette e modelli arrivano con le tappe successive.</p>
    </header>
    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <li v-for="w in visible" :key="w.id" class="fw-card flex flex-col gap-3 p-4">
        <div class="flex items-center gap-3">
          <span class="grid size-10 place-items-center rounded-lg text-sm font-bold text-white" :style="{ background: w.color }">{{ w.initials }}</span>
          <div class="min-w-0 flex-1">
            <p class="fw-title truncate text-base">{{ w.short }}</p>
            <p class="text-xs text-[var(--text-muted)]">{{ profilesOf(w.id).length }} profili · {{ w.accounts.length }} account</p>
          </div>
        </div>
        <label class="text-[13px] font-semibold">Orario predefinito per i nuovi post
          <input
            v-model="state.defaultTimes[w.id]" type="time" class="fw-input mt-1 w-36" :disabled="!can.plan"
            :aria-describedby="`hint-${w.id}`" @change="saved(w.short, state.defaultTimes[w.id]!)"
          >
        </label>
        <p :id="`hint-${w.id}`" class="text-xs text-[var(--text-muted)]">{{ can.plan ? 'Proposto quando programmi; puoi sempre cambiarlo nel singolo post.' : 'Lo può cambiare un Manager o un Admin.' }}</p>
      </li>
    </ul>
  </div>
</template>
