<script setup lang="ts">
import type { DataColumn } from '~/components/DataTable.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

/**
 * Trial page of the shared list components (plan 04, Task 5a), only for the automated tests:
 * the server answers 404 outside them (server/middleware/07.test-pages.ts). Fixed data, no API.
 */
useHead({ title: 'Componenti' })

interface Client {
  id: string
  name: string
  profiles: string
  people: number
  status: { tone: StatusTone; label: string } | null
  archived: boolean
}

const clients: Client[] = [
  {
    id: 'c1',
    name: 'Forno Luce',
    profiles: '@fornoluce +1',
    people: 3,
    status: null,
    archived: false,
  },
  {
    id: 'c2',
    name: 'Pizzeria Da Gino',
    profiles: '@dagino +1',
    people: 1,
    status: { tone: 'warning', label: 'Da ricollegare' },
    archived: false,
  },
  {
    id: 'c3',
    name: 'Studio Riva',
    profiles: '@studioriva',
    people: 2,
    status: { tone: 'danger', label: 'Con problema' },
    archived: false,
  },
  { id: 'c4', name: 'Cantina Monteverde', profiles: '', people: 2, status: null, archived: true },
]

const filter = ref<'active' | 'archived'>('active')
const query = ref('')
const loading = ref(false)
const lastAction = ref('')
// the tests start once Vue runs the page: before that, the menus do not open
const ready = useHydrated()

const visible = computed(() =>
  clients.filter(
    (c) =>
      c.archived === (filter.value === 'archived') &&
      c.name.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
)
const options = computed(() => [
  { value: 'active' as const, label: 'Attivi', count: clients.filter((c) => !c.archived).length },
  {
    value: 'archived' as const,
    label: 'Archiviati',
    count: clients.filter((c) => c.archived).length,
  },
])
const columns: DataColumn[] = [
  { key: 'name', label: 'Cliente' },
  { key: 'profiles', label: 'Profili' },
  { key: 'status', label: 'Collegamento' },
  { key: 'people', label: 'Persone', align: 'end' },
  { key: 'actions', label: 'Azioni', hideLabel: true, align: 'end', class: 'w-13 px-2' },
]
const actions = (c: Client) => [
  {
    label: 'Apri',
    icon: 'i-lucide-arrow-right',
    onSelect: () => (lastAction.value = `Apri ${c.name}`),
  },
  {
    label: 'Rinomina',
    icon: 'i-lucide-pencil',
    onSelect: () => (lastAction.value = `Rinomina ${c.name}`),
  },
  {
    label: 'Archivia',
    icon: 'i-lucide-archive',
    onSelect: () => (lastAction.value = `Archivia ${c.name}`),
  },
]
const tones: { tone: StatusTone; label: string }[] = [
  { tone: 'neutral', label: 'Funziona' },
  { tone: 'success', label: 'Confermato' },
  { tone: 'info', label: 'Programmato' },
  { tone: 'warning', label: 'Da ricollegare' },
  { tone: 'danger', label: 'Con problema' },
]
</script>

<template>
  <div class="space-y-8" :data-ready="ready || undefined">
    <PageHeader title="Clienti">
      <template #summary>
        3 clienti.
        <NuxtLink to="#c2" class="underline underline-offset-3">Pizzeria Da Gino</NuxtLink>
        ha un profilo da ricollegare.
      </template>
      <template #actions>
        <UButton icon="i-lucide-plus" aria-label="Nuovo cliente">
          <span class="max-md:hidden">Nuovo cliente</span>
        </UButton>
      </template>
    </PageHeader>

    <section aria-label="Tabella" class="space-y-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-center">
        <SegmentedFilter v-model="filter" label="Mostra" :options="options" class="self-start" />
        <SearchField v-model="query" label="Cerca un cliente o un profilo" />
        <UButton color="neutral" variant="outline" @click="loading = !loading">
          {{ loading ? 'Mostra i dati' : 'Mostra il caricamento' }}
        </UButton>
      </div>
      <TableSkeleton
        v-if="loading"
        label="Caricamento dei clienti"
        :columns="['Cliente', 'Profili', 'Collegamento', 'Persone']"
      />
      <DataTable v-else caption="Clienti" :columns="columns" :rows="visible" :row-key="(c) => c.id">
        <template #cell-name="{ row }">
          <span class="flex items-center gap-3">
            <RowAvatar :name="row.name" />
            <NuxtLink :to="`#${row.id}`" class="font-semibold hover:underline">{{
              row.name
            }}</NuxtLink>
          </span>
        </template>
        <template #cell-profiles="{ row }">
          <span class="text-(--app-text-muted)">{{ row.profiles || 'Nessun profilo' }}</span>
        </template>
        <template #cell-status="{ row }">
          <StatusDot v-if="row.status" :tone="row.status.tone" :label="row.status.label" />
        </template>
        <template #cell-people="{ row }">
          <span class="tabular-nums">{{ row.people }}</span>
        </template>
        <template #cell-actions="{ row }">
          <RowActions :name="row.name" :items="actions(row)" />
        </template>
        <template #mobile="{ row }">
          <DataRow :name="row.name" :to="`#${row.id}`" :detail="row.profiles || 'Nessun profilo'">
            <template v-if="row.status" #detail>
              <StatusDot :tone="row.status.tone" :label="row.status.label" />
            </template>
            <template #actions><RowActions :name="row.name" :items="actions(row)" /></template>
          </DataRow>
        </template>
      </DataTable>
      <p role="status" class="text-sm">{{ lastAction }}</p>
    </section>

    <section aria-label="Elenco" class="space-y-4">
      <DataList label="Profili">
        <DataRow name="@fornoluce" detail="Instagram · sincronizzato 12 min fa">
          <template #actions
            ><RowActions name="@fornoluce" :items="actions(clients[0]!)"
          /></template>
        </DataRow>
        <DataRow name="Pizzeria Da Gino" detail="Pagina">
          <template #status><StatusDot tone="warning" label="Da ricollegare" /></template>
          <template #actions>
            <UButton color="neutral" variant="outline" size="sm">Ricollega</UButton>
          </template>
        </DataRow>
      </DataList>
      <ListSkeleton label="Caricamento dei profili" :rows="2" />
    </section>

    <section aria-label="Stati" class="flex flex-wrap gap-4">
      <StatusDot v-for="s in tones" :key="s.tone" :tone="s.tone" :label="s.label" />
    </section>
  </div>
</template>
