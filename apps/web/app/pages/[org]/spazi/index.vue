<script setup lang="ts">
import type { ClientProfile } from '@app/contracts'
import { PROFILE_LINKS, worstLink } from '@app/domain'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DataColumn } from '~/components/DataTable.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

// «Clienti» in the union style (plan 04 Task 5b, spec §14.7, DESIGN.md «Elenchi e tabelle»):
// one row per client with its profiles, the state of the link only where someone has to act.
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { data, status, error, refresh } = useWorkspaces()
// the menus and the dialogs work once Vue runs the page
const ready = useHydrated()

useHead({ title: () => t('workspaces.title') })

type Link = ClientProfile['link']
const all = computed(() => data.value?.items ?? [])
const active = computed(() => all.value.filter((w) => w.archivedAt === null))
const archived = computed(() => all.value.filter((w) => w.archivedAt !== null))
const canManageMembers = (w: WorkspaceView) => org.may.value.manageUsers || w.myRole === 'manager'

// ---- the state of a client: the worst link among its profiles
const linkOf = (w: WorkspaceView): Link => worstLink((w.profiles ?? []).map((p) => p.link))
const TONE: Record<Exclude<Link, 'ok'>, StatusTone> = {
  reconnect: 'warning',
  error: 'danger',
  warning: 'warning',
}
const stateOf = (w: WorkspaceView) => {
  const link = linkOf(w)
  return link === 'ok' ? null : { link, tone: TONE[link], label: t(`workspaces.link.${link}`) }
}
/** The first client that needs someone, for the sentence at the top. */
const firstProblem = computed(() => {
  for (const link of PROFILE_LINKS.filter((l) => l !== 'ok')) {
    const w = active.value.find((c) => linkOf(c) === link)
    if (w) return { workspace: w, link }
  }
  return null
})

// ---- profiles: the first one's accounts, then «+N» for the others
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const iconOf = (platform: string) => PLATFORM_ICON[platform] ?? 'i-lucide-at-sign'
const handleOf = (a: ClientProfile['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const firstAccounts = (w: WorkspaceView) => w.profiles?.[0]?.accounts ?? []
const moreProfiles = (w: WorkspaceView) => Math.max((w.profiles?.length ?? 0) - 1, 0)
const profilesText = (w: WorkspaceView) => {
  const names = firstAccounts(w).map(handleOf).join(' · ')
  if (!names) return t('workspaces.noProfile')
  const more = moreProfiles(w)
  return more > 0 ? `${names} ${t('workspaces.moreProfiles', { n: more })}` : names
}

// ---- filter and search
const filter = ref<'active' | 'archived'>('active')
const query = ref('')
const options = computed(() => [
  { value: 'active' as const, label: t('workspaces.activeFilter'), count: active.value.length },
  {
    value: 'archived' as const,
    label: t('workspaces.archivedFilter'),
    count: archived.value.length,
  },
])
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const visible = computed(() => {
  const rows = filter.value === 'active' ? active.value : archived.value
  const q = fold(query.value.trim())
  if (!q) return rows
  return rows.filter((w) =>
    [w.name, ...(w.profiles ?? []).flatMap((p) => p.accounts.flatMap((a) => [a.name, a.username]))]
      .filter((s): s is string => Boolean(s))
      .some((s) => fold(s).includes(q.replace(/^@/, ''))),
  )
})

const columns = computed<DataColumn[]>(() => [
  { key: 'name', label: t('workspaces.column.client') },
  { key: 'profiles', label: t('workspaces.column.profiles') },
  { key: 'link', label: t('workspaces.column.link') },
  {
    key: 'actions',
    label: t('workspaces.column.actions'),
    hideLabel: true,
    align: 'end',
    class: 'w-px px-2 whitespace-nowrap',
  },
])
const pageOf = (w: WorkspaceView) => org.to(`/spazi/${w.slug}`)
/** «Ricollega» only for whoever manages the connections, only where it is the thing to do. */
const canReconnect = (w: WorkspaceView) =>
  org.may.value.manageAccounts && w.archivedAt === null && linkOf(w) === 'reconnect'
const integrations = computed(() => org.to('/impostazioni/integrazioni'))

// ---- create, from a profile or without one (spec §14.7)
const { data: withoutClient, refresh: refreshWithoutClient } = useProfilesWithoutClient()
const orphans = computed(() =>
  org.may.value.assignAccounts ? (withoutClient.value?.items ?? []) : [],
)
const adding = ref(false)
const preselect = ref<string | null>(null)
function startAdding(key: string | null = null) {
  preselect.value = key
  fixing.value = false
  adding.value = true
}
async function created(clientName: string) {
  filter.value = 'active'
  query.value = ''
  done.value = t('clients.created', { name: clientName })
  await Promise.all([refresh(), refreshWithoutClient()])
}

// ---- «Sistemali»
const fixing = ref(false)
const reload = () => Promise.all([refresh(), refreshWithoutClient()])
async function added(message: string) {
  fixing.value = false
  done.value = message
  await Promise.all([refresh(), refreshWithoutClient()])
}

// ---- «N clienti creati · Annulla», right after «Abbina ai clienti»
const lastImport = useClientImport()
const undoing = ref(false)
let undoTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  if (lastImport.value) undoTimer = setTimeout(() => (lastImport.value = null), 30_000)
})
onBeforeUnmount(() => {
  clearTimeout(undoTimer)
  lastImport.value = null
})
async function undoImport() {
  const last = lastImport.value
  if (!last) return
  undoing.value = true
  problem.value = null
  try {
    await call('POST', org.api('/workspaces/import-undo'), last.undo)
    lastImport.value = null
    done.value = last.created > 0 ? t('clients.undo.undone') : t('clients.undo.undoneAdded')
    await Promise.all([refresh(), refreshWithoutClient()])
  } catch (e) {
    // the pill stays, so «Annulla» can be tried again
    problem.value = failure(e).message
  } finally {
    undoing.value = false
  }
}

// ---- rename and archive
const done = ref<string | null>(null)
const problem = ref<string | null>(null)
const renaming = ref<WorkspaceView | null>(null)
const newName = ref('')
const renameProblem = ref<string | null>(null)
const renameOpen = computed({
  get: () => renaming.value !== null,
  set: (v) => {
    if (!v) renaming.value = null
  },
})
function startRename(w: WorkspaceView) {
  renaming.value = w
  newName.value = w.name
  renameProblem.value = null
}
async function rename() {
  const w = renaming.value
  if (!w) return
  try {
    await call('PATCH', org.api(`/workspaces/${encodeURIComponent(w.id)}`), { name: newName.value })
    renaming.value = null
    done.value = t('workspaces.renamed')
    await refresh()
  } catch (e) {
    renameProblem.value = failure(e).message
  }
}
const archiving = ref<WorkspaceView | null>(null)
const archiveOpen = computed({
  get: () => archiving.value !== null,
  set: (v) => {
    if (!v) archiving.value = null
  },
})
async function archive() {
  const w = archiving.value
  if (!w) return
  problem.value = null
  try {
    await call('POST', org.api(`/workspaces/${encodeURIComponent(w.id)}/archive`))
    done.value = t('workspaces.archived', { name: w.name })
    await refresh()
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    archiving.value = null
  }
}

function actions(w: WorkspaceView): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = [
    [
      {
        label: t('workspaces.open'),
        icon: 'i-lucide-arrow-right',
        onSelect: () => void navigateTo(pageOf(w)),
      },
    ],
  ]
  // on a phone the row has no room for the button: «Ricollega» comes first in «⋯»
  if (canReconnect(w))
    groups[0]?.unshift({
      label: t('workspaces.reconnect'),
      icon: 'i-lucide-link',
      class: 'md:hidden',
      onSelect: () => void navigateTo(integrations.value),
    })
  if (canManageMembers(w))
    groups[0]?.push({
      label: t('workspaces.members'),
      icon: 'i-lucide-users',
      onSelect: () => void navigateTo(org.to(`/spazi/${w.slug}/membri`)),
    })
  if (org.may.value.createWorkspace && w.archivedAt === null)
    groups.push([
      { label: t('workspaces.rename'), icon: 'i-lucide-pencil', onSelect: () => startRename(w) },
      {
        label: t('workspaces.archive'),
        icon: 'i-lucide-archive',
        color: 'error',
        onSelect: () => (archiving.value = w),
      },
    ])
  return groups
}
</script>

<template>
  <div :data-ready="ready || undefined">
    <PageHeader :title="$t('workspaces.title')">
      <template v-if="status === 'success' && active.length > 0" #summary>
        {{ $t('workspaces.count', { n: active.length }, active.length) }}
        <i18n-t v-if="firstProblem" :keypath="`workspaces.problem.${firstProblem.link}`" tag="span">
          <template #name>
            <NuxtLink
              :to="pageOf(firstProblem.workspace)"
              class="text-(--app-text) underline underline-offset-3"
              >{{ firstProblem.workspace.name }}</NuxtLink
            >
          </template>
        </i18n-t>
      </template>
      <template v-if="org.may.value.createWorkspace" #actions>
        <UButton
          class="min-h-11"
          icon="i-lucide-plus"
          :aria-label="$t('workspaces.new')"
          @click="startAdding()"
        >
          <span class="max-md:hidden">{{ $t('workspaces.new') }}</span>
        </UButton>
      </template>
    </PageHeader>

    <div
      v-if="orphans.length > 0"
      class="mb-4 flex flex-wrap items-center gap-3 rounded-[10px] bg-(--app-brand-soft) px-4 py-3 text-sm"
    >
      <UIcon name="i-lucide-link" class="size-[1.125rem] shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{
        $t('clients.fix.notice', { n: orphans.length }, orphans.length)
      }}</span>
      <UButton
        class="min-h-9 bg-(--app-surface)"
        color="neutral"
        variant="outline"
        @click="fixing = true"
      >
        {{ $t('clients.fix.open') }}
      </UButton>
    </div>

    <p v-if="done" role="status" class="mb-4 text-sm text-(--app-success)">{{ done }}</p>
    <p v-if="problem" role="alert" class="mb-4 text-sm text-(--app-danger)">{{ problem }}</p>

    <div
      v-if="status !== 'error' && all.length > 0"
      class="mb-4 flex flex-col gap-3 md:flex-row md:items-center"
    >
      <SegmentedFilter
        v-model="filter"
        :label="$t('workspaces.show')"
        :options="options"
        class="self-start"
      />
      <SearchField v-model="query" :label="$t('workspaces.search')" />
    </div>

    <TableSkeleton
      v-if="status === 'pending' || status === 'idle'"
      :label="$t('workspaces.loading')"
      :columns="[
        $t('workspaces.column.client'),
        $t('workspaces.column.profiles'),
        $t('workspaces.column.link'),
      ]"
      :rows="4"
    />
    <div
      v-else-if="error"
      role="alert"
      class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-card) p-5"
    >
      <p>{{ $t('workspaces.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <EmptyState
      v-else-if="all.length === 0"
      :title="$t('workspaces.empty')"
      :text="
        org.may.value.createWorkspace ? $t('workspaces.emptyCreate') : $t('workspaces.emptyAsk')
      "
      icon="i-lucide-briefcase"
    />
    <p
      v-else-if="visible.length === 0"
      class="rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-5 text-(--app-text-muted)"
    >
      {{
        query.trim()
          ? $t('workspaces.noMatch', { q: query.trim() })
          : filter === 'archived'
            ? $t('workspaces.noArchived')
            : $t('workspaces.empty')
      }}
    </p>
    <DataTable
      v-else
      :caption="$t('workspaces.title')"
      :columns="columns"
      :rows="visible"
      :row-key="(w) => w.id"
    >
      <template #cell-name="{ row }">
        <span class="flex min-w-0 items-center gap-3">
          <RowAvatar :name="row.name" :src="row.photoUrl" />
          <NuxtLink
            :to="pageOf(row)"
            class="truncate text-[0.9375rem] font-semibold underline-offset-3 hover:underline"
            >{{ row.name }}</NuxtLink
          >
        </span>
      </template>
      <template #cell-profiles="{ row }">
        <span
          v-if="firstAccounts(row).length > 0"
          class="flex items-center gap-x-3 text-(--app-text-muted)"
        >
          <span
            v-for="a in firstAccounts(row)"
            :key="a.id"
            class="inline-flex min-w-0 items-center gap-1"
          >
            <UIcon
              :name="iconOf(a.platform)"
              class="size-[0.9375rem] shrink-0"
              aria-hidden="true"
            />
            <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
            <span class="truncate">{{ handleOf(a) }}</span>
          </span>
          <span v-if="moreProfiles(row) > 0" class="tabular-nums">
            <span aria-hidden="true">{{
              $t('workspaces.moreProfiles', { n: moreProfiles(row) })
            }}</span>
            <span class="sr-only">{{
              $t('workspaces.moreProfilesLabel', { n: moreProfiles(row) }, moreProfiles(row))
            }}</span>
          </span>
        </span>
        <span v-else class="text-(--app-text-muted)">{{ $t('workspaces.noProfile') }}</span>
      </template>
      <template #cell-link="{ row }">
        <StatusDot v-if="stateOf(row)" :tone="stateOf(row)!.tone" :label="stateOf(row)!.label" />
      </template>
      <template #cell-actions="{ row }">
        <span class="flex items-center justify-end gap-1">
          <UButton
            v-if="canReconnect(row)"
            color="neutral"
            variant="outline"
            class="min-h-11"
            :to="integrations"
            :aria-label="$t('workspaces.reconnectOf', { name: row.name })"
          >
            {{ $t('workspaces.reconnect') }}
          </UButton>
          <RowActions :name="row.name" :items="actions(row)" />
        </span>
      </template>
      <template #mobile="{ row }">
        <DataRow :name="row.name" :to="pageOf(row)" :src="row.photoUrl" :detail="profilesText(row)">
          <template v-if="stateOf(row)" #detail>
            <span class="flex min-w-0 items-center gap-2">
              <StatusDot :tone="stateOf(row)!.tone" :label="stateOf(row)!.label" />
              <span class="truncate">{{ profilesText(row) }}</span>
            </span>
          </template>
          <template #actions>
            <RowActions :name="row.name" :items="actions(row)" />
          </template>
        </DataRow>
      </template>
    </DataTable>

    <NewClientDialog
      v-model:open="adding"
      :profiles="orphans"
      :preselect="preselect"
      @created="created"
    />
    <FixProfiles
      v-model:open="fixing"
      :profiles="orphans"
      :clients="active"
      @create="startAdding"
      @added="added"
      @changed="reload"
    />
    <div
      v-if="lastImport"
      role="status"
      class="fixed bottom-7 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-[10px] bg-(--app-text) px-4 py-2 text-sm text-(--app-bg) max-md:bottom-[76px] max-md:w-[calc(100%-2rem)]"
    >
      <span class="flex-1">{{
        lastImport.created > 0
          ? $t('clients.undo.created', { n: lastImport.created }, lastImport.created)
          : $t(
              'clients.undo.added',
              { n: lastImport.undo.assignments.length },
              lastImport.undo.assignments.length,
            )
      }}</span>
      <UButton
        class="min-h-11 font-semibold text-(--app-bg) underline underline-offset-3"
        color="neutral"
        variant="link"
        :loading="undoing"
        @click="undoImport"
      >
        {{ $t('clients.undo.action') }}
      </UButton>
    </div>

    <UModal
      v-model:open="renameOpen"
      :title="$t('workspaces.renameTitle', { name: renaming?.name ?? '' })"
    >
      <template #body>
        <form id="rename-client" novalidate @submit.prevent="rename">
          <UFormField
            :label="$t('workspaces.newNameOf')"
            name="rename"
            :error="renameProblem ?? undefined"
          >
            <UInput v-model="newName" class="w-full" size="xl" autofocus />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton type="submit" form="rename-client" class="min-h-11">
            {{ $t('account.save') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="renaming = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="archiveOpen"
      :title="$t('workspaces.archiveTitle', { name: archiving?.name ?? '' })"
      :description="$t('workspaces.archiveText')"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton class="min-h-11" color="error" @click="archive">
            {{ $t('workspaces.archive') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="archiving = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
