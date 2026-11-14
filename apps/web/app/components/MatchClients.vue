<script setup lang="ts">
/**
 * «Abbina ai clienti» (spec §14.7, plan 04 Task 5c): what a connection found, one proposed client
 * per profile. Pairs come only from the platform's own link; joining two rows is always the
 * person's choice. Nothing becomes a client without «Crea N clienti»; what is not ticked is
 * imported anyway and waits in «Sistemali». On a phone (variant B, Matteo 14/11) a switch says
 * whether the row becomes a client, and a tap on the row opens a sheet with its name and actions.
 */
import type { ImportableAccount } from '@app/contracts'
import { proposeClients } from '@app/domain'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DataColumn } from '~/components/DataTable.vue'

const props = defineProps<{ accounts: ImportableAccount[]; path: string }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const { call, failure } = useApi()
const org = useOrganization()
const { data: workspaces } = useWorkspaces()
const lastImport = useClientImport()

type Why = 'paired' | 'instagram_only' | 'facebook_only' | 'merged'
interface Row {
  key: string
  accounts: ImportableAccount[]
  name: string
  why: Why
  on: boolean
  /** «Aggiungi a un cliente esistente»: the client it goes to. */
  target: { id: string; name: string } | null
}

const IMPORTABLE = new Set(['to_import', 'imported'])
const rows = ref<Row[]>([])
const already = ref<{ key: string; accounts: ImportableAccount[]; name: string }[]>([])
const blocked = computed(() => props.accounts.filter((a) => !IMPORTABLE.has(a.state)))

function propose() {
  const proposals = proposeClients(props.accounts.filter((a) => IMPORTABLE.has(a.state)))
  rows.value = proposals
    .filter((p) => !p.inClient)
    .map((p) => ({
      key: p.key,
      accounts: p.accounts,
      name: p.name,
      why: p.together,
      on: p.checked,
      target: null,
    }))
  already.value = proposals
    .filter((p) => p.inClient)
    .map((p) => ({ key: p.key, accounts: p.accounts, name: p.name }))
}
watch(() => props.accounts, propose, { immediate: true })

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const iconOf = (platform: string) => PLATFORM_ICON[platform] ?? 'i-lucide-at-sign'
const handleOf = (a: ImportableAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const avatarOf = (r: { accounts: ImportableAccount[] }) =>
  r.accounts.find((a) => a.avatarUrl)?.avatarUrl ?? null
/** Under the name on a phone: the handle of a pair, the reason for one alone. */
const detailOf = (r: Row) => {
  if (r.target) return t('clients.match.goesTo', { name: r.target.name })
  if (!r.on) return t('clients.match.notClient')
  const [first] = r.accounts
  return r.why === 'instagram_only' || r.why === 'facebook_only' || !first
    ? t(`clients.match.why.${r.why}`)
    : handleOf(first)
}

const creating = computed(() => rows.value.filter((r) => r.on && r.target === null))
const left = computed(() => rows.value.filter((r) => !r.on))
const total = computed(
  () =>
    rows.value.length +
    already.value.length +
    new Set(blocked.value.map((a) => a.pageId ?? a.externalId)).size,
)

// ---- «Unisci con…» and «Aggiungi a un cliente esistente»
const merging = ref<Row | null>(null)
const mergeOpen = computed({
  get: () => merging.value !== null,
  set: (v) => {
    if (!v) merging.value = null
  },
})
function mergeWith(other: Row) {
  const row = merging.value
  if (!row) return
  row.accounts = [...row.accounts, ...other.accounts]
  row.why = 'merged'
  row.on = true
  rows.value = rows.value.filter((r) => r !== other)
  merging.value = null
}
const placing = ref<Row | null>(null)
const placeOpen = computed({
  get: () => placing.value !== null,
  set: (v) => {
    if (!v) placing.value = null
  },
})
const activeClients = computed(() =>
  (workspaces.value?.items ?? []).filter(
    (w) => w.archivedAt === null && (w.myRole === 'owner' || w.myRole === 'admin'),
  ),
)
function placeIn(w: { id: string; name: string }) {
  const row = placing.value
  if (!row) return
  row.target = { id: w.id, name: w.name }
  row.on = true
  placing.value = null
}

/** «Rinomina» moves to the name field once the menu has closed and handed the focus back. */
function focusName(r: Row) {
  const start = performance.now()
  const step = () => {
    if (document.querySelector('[role="menu"]') && performance.now() - start < 1000)
      return requestAnimationFrame(step)
    requestAnimationFrame(() => document.getElementById(`match-name-${r.key}`)?.focus())
  }
  requestAnimationFrame(step)
}

function actions(r: Row): DropdownMenuItem[][] {
  return [
    [
      {
        label: t('clients.match.rename'),
        icon: 'i-lucide-pencil',
        onSelect: () => focusName(r),
      },
      {
        label: t('clients.match.merge'),
        icon: 'i-lucide-link',
        disabled: rows.value.length < 2,
        onSelect: () => (merging.value = r),
      },
      r.target
        ? {
            label: t('clients.match.leaveExisting'),
            icon: 'i-lucide-plus',
            onSelect: () => (r.target = null),
          }
        : {
            label: t('clients.match.existing'),
            icon: 'i-lucide-briefcase',
            onSelect: () => (placing.value = r),
          },
    ],
  ]
}

// ---- the sheet of a row, on a phone
const sheet = ref<Row | null>(null)
const sheetOpen = computed({
  get: () => sheet.value !== null,
  set: (v) => {
    if (!v) sheet.value = null
  },
})
/** The sheet keeps the name it opened with: renaming in it does not rename the sheet. */
const sheetTitle = ref('')
watch(sheet, (row) => {
  if (row) sheetTitle.value = t('clients.match.sheet', { name: row.name })
})
function fromSheet(next: 'merge' | 'existing' | 'toggle') {
  const row = sheet.value
  if (!row) return
  sheet.value = null
  if (next === 'merge') merging.value = row
  else if (next === 'existing') placing.value = row
  else {
    row.on = !row.on
    if (!row.on) row.target = null
  }
}

// the found profiles come below the guide: bring them into view, and the focus with them
const heading = ref<HTMLElement | null>(null)
// open on a computer, only the count on a phone
const alreadyOpen = ref(true)
onMounted(() => {
  alreadyOpen.value = window.matchMedia('(min-width: 768px)').matches
  heading.value?.scrollIntoView({ block: 'start' })
  heading.value?.focus({ preventScroll: true })
})

// ---- confirm
const sending = ref<'create' | 'later' | null>(null)
const problem = ref<string | null>(null)
const ids = (r: { accounts: ImportableAccount[] }) => r.accounts.map((a) => a.externalId)

async function submit(mode: 'create' | 'later') {
  // one import at a time: «Decido dopo» and «Crea» are both on screen on a phone
  if (rows.value.length === 0 || sending.value !== null) return
  sending.value = mode
  problem.value = null
  const chosen = mode === 'create'
  try {
    const result = await call<{
      created: { id: string }[]
      undo: { workspaceIds: string[]; assignments: { workspaceId: string; accountId: string }[] }
    }>('POST', props.path, {
      externalIds: rows.value.flatMap(ids),
      newWorkspaces: chosen
        ? creating.value.map((r) => ({ name: r.name.trim(), externalIds: ids(r) }))
        : [],
      assignTo: chosen
        ? rows.value
            .filter((r) => r.on && r.target !== null)
            .map((r) => ({ workspaceId: r.target!.id, externalIds: ids(r) }))
        : [],
    })
    lastImport.value =
      result.undo.workspaceIds.length + result.undo.assignments.length > 0
        ? { created: result.created.length, undo: result.undo }
        : null
    await refreshNuxtData(`workspaces-${org.slug.value}`)
    emit('done')
    await navigateTo(org.to('/spazi'))
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    sending.value = null
  }
}

const createLabel = computed(() =>
  t('clients.match.create', { n: creating.value.length }, creating.value.length),
)
const restText = computed(() => {
  const [only] = left.value
  if (left.value.length === 1 && only) return t('clients.match.restOne', { name: only.name })
  return left.value.length > 1
    ? t('clients.match.rest', { n: left.value.length }, left.value.length)
    : ''
})

const columns = computed<DataColumn[]>(() => [
  { key: 'on', label: t('clients.match.column.choose'), hideLabel: true, class: 'w-px pr-0' },
  { key: 'name', label: t('clients.match.column.client') },
  { key: 'profiles', label: t('clients.match.column.profiles') },
  { key: 'why', label: t('clients.match.column.why') },
  {
    key: 'actions',
    label: t('clients.match.column.actions'),
    hideLabel: true,
    align: 'end',
    class: 'w-px px-2',
  },
])
</script>

<template>
  <section class="space-y-4" :aria-labelledby="'match-title'">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-[0.8125rem] font-semibold">{{ $t('clients.match.step') }}</p>
        <h2
          id="match-title"
          ref="heading"
          tabindex="-1"
          class="font-display mt-1 scroll-mt-6 text-2xl outline-none md:text-[1.75rem]"
        >
          {{ $t('clients.match.title', { n: total }, total) }}
        </h2>
        <p class="mt-1 text-(--app-text-muted) max-md:hidden">{{ $t('clients.match.intro') }}</p>
        <p class="mt-1 text-(--app-text-muted) md:hidden">{{ $t('clients.match.introPhone') }}</p>
      </div>
      <UButton
        v-if="rows.length > 0"
        class="min-h-11 shrink-0 underline underline-offset-3 md:hidden"
        color="neutral"
        variant="link"
        :loading="sending === 'later'"
        :disabled="sending !== null"
        @click="submit('later')"
      >
        {{ $t('clients.match.later') }}
      </UButton>
    </div>

    <p
      v-if="rows.length === 0"
      class="rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-5 text-(--app-text-muted)"
    >
      {{ $t('clients.match.none') }}
    </p>
    <DataTable
      v-else
      :caption="$t('clients.match.caption')"
      :columns="columns"
      :rows="rows"
      :row-key="(r) => r.key"
    >
      <template #cell-on="{ row }">
        <UCheckbox
          v-model="row.on"
          :ui="{ root: 'min-h-11 items-center' }"
          :aria-label="$t('clients.match.createOf', { name: row.name })"
          @update:model-value="!$event && (row.target = null)"
        />
      </template>
      <template #cell-name="{ row }">
        <span class="flex min-w-0 items-center gap-3" :class="row.on ? '' : 'opacity-70'">
          <RowAvatar :name="row.name" :src="avatarOf(row)" />
          <UInput
            :id="`match-name-${row.key}`"
            v-model="row.name"
            class="w-56"
            :aria-label="$t('clients.match.nameOf', { name: handleOf(row.accounts[0]!) })"
            trailing-icon="i-lucide-pencil"
          />
        </span>
      </template>
      <template #cell-profiles="{ row }">
        <span class="flex flex-wrap items-center gap-x-3 text-(--app-text-muted)">
          <span
            v-for="a in row.accounts"
            :key="a.externalId"
            class="inline-flex items-center gap-1"
          >
            <UIcon :name="iconOf(a.platform)" class="size-[0.9375rem]" aria-hidden="true" />
            <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
            {{ handleOf(a) }}
          </span>
        </span>
      </template>
      <template #cell-why="{ row }">
        <span v-if="row.target" class="text-[0.8125rem] font-semibold">{{
          $t('clients.match.goesTo', { name: row.target.name })
        }}</span>
        <span
          v-else
          class="text-[0.8125rem]"
          :class="
            row.why === 'paired' || row.why === 'merged'
              ? 'text-(--app-text-muted)'
              : 'text-(--app-warning)'
          "
          >{{ $t(`clients.match.why.${row.why}`) }}</span
        >
      </template>
      <template #cell-actions="{ row }">
        <RowActions :name="row.name" :items="actions(row)" />
      </template>
      <template #mobile="{ row }">
        <li class="flex h-16 items-center gap-3 pr-3 pl-4">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            :aria-label="$t('clients.match.sheet', { name: row.name })"
            @click="sheet = row"
          >
            <RowAvatar :name="row.name" :src="avatarOf(row)" :class="row.on ? '' : 'opacity-50'" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.9375rem] leading-5 font-semibold">{{
                row.name
              }}</span>
              <span
                class="flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-[1.125rem] text-(--app-text-muted)"
              >
                <UIcon
                  v-for="a in row.accounts"
                  :key="a.externalId"
                  :name="iconOf(a.platform)"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate">{{ detailOf(row) }}</span>
              </span>
            </span>
          </button>
          <USwitch
            v-model="row.on"
            size="lg"
            :aria-label="$t('clients.match.createOf', { name: row.name })"
            @update:model-value="!$event && (row.target = null)"
          />
        </li>
      </template>
    </DataTable>

    <div
      v-if="already.length > 0"
      class="overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)"
    >
      <details class="group" :open="alreadyOpen">
        <summary
          class="flex min-h-14 cursor-pointer items-center gap-3 bg-(--app-surface-sunken) px-4 text-sm font-semibold text-(--app-text-muted)"
        >
          <span class="max-md:hidden">{{ $t('clients.match.already') }}</span>
          <span class="md:hidden">{{
            $t('clients.match.alreadyCount', { n: already.length }, already.length)
          }}</span>
        </summary>
        <ul :aria-label="$t('clients.match.already')" class="divide-y divide-(--app-border)">
          <li v-for="p in already" :key="p.key" class="flex h-16 items-center gap-3 px-4 md:h-14">
            <RowAvatar :name="p.name" :src="avatarOf(p)" />
            <span class="min-w-0">
              <span class="block truncate font-semibold">{{ p.name }}</span>
              <span class="block truncate text-[0.8125rem] text-(--app-text-muted)">{{
                p.accounts.map(handleOf).join(' · ')
              }}</span>
            </span>
          </li>
        </ul>
      </details>
    </div>

    <div
      v-if="blocked.length > 0"
      class="rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-3 text-sm"
    >
      <p class="font-semibold text-(--app-text-muted)">{{ $t('clients.match.blocked') }}</p>
      <ul class="mt-1 space-y-1">
        <li
          v-for="a in blocked"
          :key="`${a.platform}:${a.externalId}`"
          class="flex flex-wrap gap-x-2"
        >
          <span>{{ handleOf(a) }}</span>
          <span
            :class="
              a.state === 'not_importable' ? 'text-(--app-danger)' : 'text-(--app-text-muted)'
            "
            >{{ $t(`addAccount.state.${a.state}`) }}</span
          >
        </li>
      </ul>
    </div>

    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>

    <div
      v-if="rows.length > 0"
      class="flex items-center justify-between gap-3 rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-3 max-md:fixed max-md:inset-x-0 max-md:bottom-[60px] max-md:z-10 max-md:flex-col max-md:items-stretch max-md:gap-1 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:py-2.5"
    >
      <UButton
        class="min-h-11 max-md:hidden"
        color="neutral"
        variant="ghost"
        :loading="sending === 'later'"
        :disabled="sending !== null"
        @click="submit('later')"
      >
        {{ $t('clients.match.later') }}
      </UButton>
      <span class="flex items-center gap-3 max-md:flex-col max-md:items-stretch max-md:gap-1">
        <span
          v-if="restText"
          class="text-[0.8125rem] text-(--app-text-muted) max-md:order-2 max-md:text-center"
          >{{ restText }}</span
        >
        <UButton
          class="min-h-11 justify-center max-md:min-h-12 max-md:text-[0.9375rem]"
          :loading="sending === 'create'"
          :disabled="sending !== null"
          @click="submit('create')"
        >
          {{ createLabel }}
        </UButton>
      </span>
    </div>
    <div v-if="rows.length > 0" class="h-28 md:hidden" aria-hidden="true" />

    <UDrawer v-model:open="sheetOpen" :title="sheetTitle" :content="{ 'aria-label': sheetTitle }">
      <template #body>
        <div v-if="sheet" class="space-y-4">
          <div class="flex items-center gap-3">
            <RowAvatar :name="sheet.name" :src="avatarOf(sheet)" />
            <span class="flex flex-wrap gap-x-3 text-sm text-(--app-text-muted)">
              <span
                v-for="a in sheet.accounts"
                :key="a.externalId"
                class="inline-flex items-center gap-1"
              >
                <UIcon :name="iconOf(a.platform)" class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
                {{ handleOf(a) }}
              </span>
            </span>
          </div>
          <UFormField :label="$t('clients.match.column.client')" name="sheet-name">
            <UInput v-model="sheet.name" class="w-full" size="xl" />
          </UFormField>
          <div class="divide-y divide-(--app-border) border-y border-(--app-border)">
            <button
              type="button"
              class="flex min-h-13 w-full items-center gap-3 text-left text-[0.9375rem] disabled:opacity-50"
              :disabled="rows.length < 2"
              @click="fromSheet('merge')"
            >
              <UIcon
                name="i-lucide-link"
                class="size-5 text-(--app-text-muted)"
                aria-hidden="true"
              />
              {{ $t('clients.match.mergePhone') }}
              <UIcon
                name="i-lucide-chevron-right"
                class="ml-auto size-5 text-(--app-text-muted)"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="flex min-h-13 w-full items-center gap-3 text-left text-[0.9375rem]"
              @click="fromSheet('existing')"
            >
              <UIcon
                name="i-lucide-briefcase"
                class="size-5 text-(--app-text-muted)"
                aria-hidden="true"
              />
              {{ $t('clients.match.existing') }}
              <UIcon
                name="i-lucide-chevron-right"
                class="ml-auto size-5 text-(--app-text-muted)"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              class="flex min-h-13 w-full items-center gap-3 text-left text-[0.9375rem] text-(--app-warning)"
              @click="fromSheet('toggle')"
            >
              <UIcon
                :name="sheet.on ? 'i-lucide-circle-minus' : 'i-lucide-circle-plus'"
                class="size-5"
                aria-hidden="true"
              />
              {{ sheet.on ? $t('clients.match.notAClient') : $t('clients.match.makeClient') }}
            </button>
          </div>
          <UButton class="min-h-12 w-full justify-center" @click="sheet = null">
            {{ $t('clients.match.done') }}
          </UButton>
        </div>
      </template>
    </UDrawer>

    <UModal
      v-model:open="mergeOpen"
      :title="$t('clients.match.mergeTitle', { name: merging?.name ?? '' })"
      :description="$t('clients.match.mergeHelp')"
    >
      <template #body>
        <ul class="divide-y divide-(--app-border) rounded-xl border border-(--app-border)">
          <li v-for="other in rows.filter((r) => r !== merging)" :key="other.key">
            <button
              type="button"
              class="flex min-h-14 w-full items-center gap-3 px-4 text-left"
              @click="mergeWith(other)"
            >
              <RowAvatar :name="other.name" :src="avatarOf(other)" />
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ other.name }}</span>
                <span class="block truncate text-[0.8125rem] text-(--app-text-muted)">{{
                  other.accounts.map(handleOf).join(' · ')
                }}</span>
              </span>
            </button>
          </li>
        </ul>
      </template>
    </UModal>

    <UModal
      v-model:open="placeOpen"
      :title="$t('clients.match.existingTitle', { name: placing?.name ?? '' })"
    >
      <template #body>
        <p v-if="activeClients.length === 0" class="text-(--app-text-muted)">
          {{ $t('clients.match.existingNone') }}
        </p>
        <ul v-else class="divide-y divide-(--app-border) rounded-xl border border-(--app-border)">
          <li v-for="w in activeClients" :key="w.id">
            <button
              type="button"
              class="flex min-h-14 w-full items-center gap-3 px-4 text-left font-semibold"
              @click="placeIn(w)"
            >
              <RowAvatar :name="w.name" :src="w.photoUrl ?? null" />
              {{ w.name }}
            </button>
          </li>
        </ul>
      </template>
    </UModal>
  </section>
</template>
