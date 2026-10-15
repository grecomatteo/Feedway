<script setup lang="ts">
definePageMeta({ layout: 'demo' })
useHead({ title: 'Team e ruoli · Feedway demo' })

// Roles and matrix follow the approved specification (§10.1–10.2); rows marked 1.5 come from §18.4.
const roles = [
  { name: 'Owner', level: 'Agenzia', text: 'Titolare: vede e gestisce tutto, nomina gli Admin. Uno per agenzia.' },
  { name: 'Admin', level: 'Agenzia', text: 'Gestisce persone, clienti e account social di tutta l’agenzia.' },
  { name: 'Manager', level: 'Cliente', text: 'Responsabile di un cliente: programma, gestisce il team del cliente e i link.' },
  { name: 'Publisher', level: 'Cliente', text: 'Crea e programma i propri post; riprova solo i propri.' },
  { name: 'Editor', level: 'Cliente', text: 'Prepara bozze e carica media; un Manager o Publisher le programma.' },
  { name: 'Viewer', level: 'Cliente', text: 'Consulta calendario e storico, senza modificare.' },
]
type Cell = boolean | string
const R = ['Owner', 'Admin', 'Manager', 'Publisher', 'Editor', 'Viewer']
const rows: { label: string, cells: Cell[], v15?: boolean }[] = [
  { label: 'Vedere calendario e post del cliente', cells: [true, true, true, true, true, true] },
  { label: 'Caricare media e usare la libreria', cells: [true, true, true, true, true, false] },
  { label: 'Creare bozze e note sui post', cells: [true, true, true, true, true, false] },
  { label: 'Programmare e pubblicare, anche in blocco', cells: [true, true, true, true, false, false] },
  { label: 'Modificare o annullare post di altri', cells: [true, true, true, false, false, false] },
  { label: 'Riprovare pubblicazioni fallite', cells: [true, true, true, 'solo propri', false, false] },
  { label: 'Etichette, modelli, fasce orarie, gruppi di account', cells: [true, true, true, false, false, false] },
  { label: 'Gestire il team del cliente e invitare', cells: [true, true, 'ruoli inferiori', false, false, false] },
  { label: 'Creare e revocare link cliente', cells: [true, true, true, false, false, false] },
  { label: 'Creare clienti, aggiungere account Meta', cells: [true, true, false, false, false, false] },
  { label: 'Impostazioni, brand e integrazioni dell’agenzia', cells: [true, 'sola lettura', false, false, false, false] },
  { label: 'To-do e note personali', cells: [true, true, true, true, true, false], v15: true },
  { label: 'Creare attività del cliente', cells: [true, true, true, true, true, false], v15: true },
  { label: 'Assegnare attività ad altri', cells: [true, true, true, 'impostazione agenzia', 'impostazione agenzia', false], v15: true },
  { label: 'Modificare attività di altri', cells: [true, true, true, false, false, false], v15: true },
]
const team = [
  { name: 'Giulia R.', org: 'Owner', spaces: 'Tutti i clienti' },
  { name: 'Marco T.', org: 'Member', spaces: 'Manager di Forno Luce · Publisher di Studio Forma e Orto Vivo' },
  { name: 'Sara L.', org: 'Member', spaces: 'Editor di Forno Luce e Orto Vivo' },
  { name: 'Luca B.', org: 'Member', spaces: 'Viewer di Studio Forma' },
]
const show15 = ref(true)
</script>

<template>
  <div class="flex flex-col gap-8 px-4 py-5 lg:px-7">
    <header>
      <h1 class="fw-title text-[26px]">Team e ruoli</h1>
      <p class="max-w-3xl text-[13px] text-[var(--text-muted)]">Due livelli: il ruolo nell'agenzia (Owner, Admin, Member) e il ruolo in ogni cliente (Manager, Publisher, Editor, Viewer). Una persona può avere ruoli diversi in clienti diversi. Prototipo: inviti e modifiche non sono attivi.</p>
    </header>

    <section aria-labelledby="h-ruoli">
      <h2 id="h-ruoli" class="fw-title text-lg">I ruoli in breve</h2>
      <ul class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="r in roles" :key="r.name" class="fw-card p-4">
          <p class="flex items-center gap-2"><span class="fw-title text-base">{{ r.name }}</span><span class="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{{ r.level }}</span></p>
          <p class="mt-1 text-[13px]">{{ r.text }}</p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="h-team">
      <h2 id="h-team" class="fw-title text-lg">Persone di Studio Aurora</h2>
      <ul class="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <li v-for="p in team" :key="p.name" class="flex flex-wrap items-center gap-3 px-4 py-3">
          <span class="grid size-9 place-items-center rounded-full bg-[var(--surface-sunken)] text-xs font-bold" aria-hidden="true">{{ p.name.split(' ').map(x => x[0]).join('') }}</span>
          <span class="min-w-40 flex-1"><span class="block text-sm font-semibold">{{ p.name }}</span><span class="block text-xs text-[var(--text-muted)]">{{ p.spaces }}</span></span>
          <span class="fw-badge bg-[var(--surface-sunken)] text-[var(--text-muted)]">{{ p.org }}</span>
        </li>
      </ul>
    </section>

    <section aria-labelledby="h-matrice">
      <div class="flex flex-wrap items-center gap-3">
        <h2 id="h-matrice" class="fw-title flex-1 text-lg">Chi può fare cosa</h2>
        <label class="flex items-center gap-2 text-[13px] font-semibold"><input v-model="show15" type="checkbox" class="size-4 accent-[#FF762E]">Mostra le funzioni della versione 1.5</label>
      </div>
      <div class="fw-card mt-3 overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <caption class="sr-only">Permessi per ruolo</caption>
          <thead class="bg-[var(--surface-sunken)] text-xs text-[var(--text-muted)]">
            <tr><th scope="col" class="px-4 py-2.5 font-semibold">Permesso</th><th v-for="r in R" :key="r" scope="col" class="px-3 py-2.5 text-center font-semibold">{{ r }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows.filter(x => show15 || !x.v15)" :key="row.label" class="border-t border-[var(--border)]" :class="row.v15 ? 'bg-[var(--info-soft)]/40' : ''">
              <th scope="row" class="px-4 py-2.5 font-medium">{{ row.label }}<span v-if="row.v15" class="ml-2 rounded-full bg-[var(--info-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--info)]">1.5</span></th>
              <td v-for="(c, i) in row.cells" :key="i" class="px-3 py-2.5 text-center">
                <UIcon v-if="c === true" name="i-lucide-check" class="size-4 text-[var(--success)]" aria-label="sì" />
                <span v-else-if="c === false" class="text-[var(--text-muted)]" aria-label="no">—</span>
                <span v-else class="text-xs">{{ c }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-[var(--text-muted)]">Note sui post: «solo per me» le vede solo chi le scrive; «per il team» le vede chi lavora sul cliente. Il cliente non le vede mai. Le attività assegnabili e i to-do arrivano nella versione 1.5.</p>
    </section>
  </div>
</template>
