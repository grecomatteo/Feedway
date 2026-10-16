<script setup lang="ts">
import { BULK_ROWS, MEDIA } from '~/fixtures/scenario'
import { dt } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Programmazione in blocco · Feedway demo' })

const { can } = useDemo()
const toast = useToast()
const step = ref<1 | 2 | 3>(2)
const filter = ref<'all' | 'blocked' | 'ready'>('all')
const rows = computed(() => BULK_ROWS.filter(r => filter.value === 'all' || r.status === filter.value))
const ready = BULK_ROWS.filter(r => r.status === 'ready')
const blocked = BULK_ROWS.filter(r => r.status === 'blocked')
const selected = ref<number[]>(ready.map(r => r.row))
const allVisibleSelected = computed(() => rows.value.filter(r => r.status === 'ready').every(r => selected.value.includes(r.row)))
function toggleAll() {
  const ids = rows.value.filter(r => r.status === 'ready').map(r => r.row)
  selected.value = allVisibleSelected.value ? selected.value.filter(id => !ids.includes(id)) : [...new Set([...selected.value, ...ids])]
}
const thumbs = ['forno-pane', 'forno-lab', 'forno-cornetti']
const done = ref(false)
function confirm() {
  done.value = true
  step.value = 3
  toast.add({ title: `${selected.value.length} post programmati (simulazione)`, description: `${BULK_ROWS.length - selected.value.length} righe restano bozze.`, color: 'success' })
}
</script>

<template>
  <div class="flex flex-col gap-5 px-4 py-5 lg:px-7">
    <header>
      <h1 class="fw-title text-[26px]">Programmazione in blocco</h1>
      <p class="text-[13px] text-[var(--text-muted)]">Forno Luce · file forno-ottobre.csv · 20 righe · destinazioni: Campagna cinque destinazioni</p>
    </header>

    <ol class="flex flex-wrap gap-2 text-[13px]" aria-label="Passaggi">
      <li v-for="(l, i) in ['Importa e abbina i file', 'Rivedi e correggi', 'Conferma il riepilogo']" :key="l" class="flex items-center gap-2 rounded-full border px-3 py-1.5" :class="step === i + 1 ? 'border-[var(--fw-carbone)] bg-[var(--brand-soft)] font-bold' : 'border-[var(--border)] text-[var(--text-muted)]'" :aria-current="step === i + 1 ? 'step' : undefined">
        <span class="tabular">{{ i + 1 }}</span>{{ l }}<UIcon v-if="step > i + 1" name="i-lucide-check" class="size-4 text-[var(--success)]" aria-label="completato" />
      </li>
    </ol>

    <div v-if="done" class="fw-card flex flex-col gap-2 p-5" role="status">
      <p class="fw-title text-lg">{{ selected.length }} post programmati, {{ BULK_ROWS.length - selected.length }} restano bozze</p>
      <p class="text-sm text-[var(--text-muted)]">Simulazione: nessuna pubblicazione. Nel prodotto la convalida si ripete al momento della conferma e il risultato può cambiare se lo stato cambia.</p>
      <div class="flex gap-2 pt-2"><NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary">Vai al calendario</NuxtLink><button type="button" class="fw-btn" @click="done = false; step = 2">Torna alle righe</button></div>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Filtra righe" class="flex gap-0.5 rounded-[9px] bg-[var(--surface-sunken)] p-[3px]">
          <button v-for="[v, l] in ([['all', `Tutte · ${BULK_ROWS.length}`], ['blocked', `Da sistemare · ${blocked.length}`], ['ready', `Pronte · ${ready.length}`]] as const)" :key="v" type="button" role="radio" :aria-checked="filter === v" class="rounded-[7px] border px-3 py-1.5 text-[13px]" :class="filter === v ? 'border-[var(--border)] bg-[var(--surface)] font-bold' : 'border-transparent text-[var(--text-muted)]'" @click="filter = v">{{ l }}</button>
        </div>
        <span class="flex-1" />
        <p class="text-[13px] font-semibold" aria-live="polite">{{ selected.length }} righe selezionate</p>
      </div>

      <div class="fw-card overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="bg-[var(--surface-sunken)] text-xs text-[var(--text-muted)]">
            <tr>
              <th class="w-10 px-3 py-2.5"><input type="checkbox" class="size-4 accent-[#FF762E]" :checked="allVisibleSelected" aria-label="Seleziona tutte le righe pronte visibili" @change="toggleAll"></th>
              <th class="px-3 py-2.5 font-semibold">Riga</th><th class="px-3 py-2.5 font-semibold">File</th><th class="px-3 py-2.5 font-semibold">Caption</th><th class="px-3 py-2.5 font-semibold">Data</th><th class="px-3 py-2.5 font-semibold">Controllo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.row" class="border-t border-[var(--border)]" :class="r.status === 'blocked' ? 'bg-[var(--danger-soft)]' : ''">
              <td class="px-3 py-2"><input v-model="selected" type="checkbox" :value="r.row" class="size-4 accent-[#FF762E]" :disabled="r.status === 'blocked'" :aria-label="`Seleziona riga ${r.row}`"></td>
              <td class="tabular px-3 py-2">{{ r.row }}</td>
              <td class="px-3 py-2"><span class="flex items-center gap-2"><img v-if="r.status === 'ready' || r.row !== 7" :src="MEDIA[thumbs[r.row % 3]!]" alt="" class="size-9 rounded object-cover" loading="lazy"><span v-else class="grid size-9 place-items-center rounded bg-[var(--surface)]"><UIcon name="i-lucide-file-question" class="size-4" aria-hidden="true" /></span>{{ r.filename }}</span></td>
              <td class="max-w-64 truncate px-3 py-2">{{ r.caption }}</td>
              <td class="tabular px-3 py-2">{{ dt(r.scheduledAt).toFormat('ccc d LLL, HH:mm') }}</td>
              <td class="px-3 py-2">
                <StatusBadge v-if="r.status === 'ready'" :status="{ label: 'Pronta', icon: 'i-lucide-circle-check', tone: 'success' }" plain />
                <span v-else class="block text-[13px]"><StatusBadge :status="{ label: 'Bloccata', icon: 'i-lucide-octagon-x', tone: 'danger' }" plain /><span class="mt-0.5 block text-xs">{{ r.error }}</span></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] py-3">
        <p class="min-w-0 flex-1 text-[13px]"><strong>{{ selected.length }} pronte selezionate</strong> · le altre {{ BULK_ROWS.length - selected.length }} restano bozze, comprese le {{ blocked.length }} bloccate.</p>
        <button v-if="can.schedule" type="button" class="fw-btn fw-btn--primary" :disabled="!selected.length" @click="confirm"><UIcon name="i-lucide-calendar-check" class="size-[18px]" aria-hidden="true" />Programma {{ selected.length }} post</button>
        <p v-else class="text-xs text-[var(--text-muted)]">Il tuo ruolo non può programmare: le righe restano bozze.</p>
      </div>
    </template>
  </div>
</template>
