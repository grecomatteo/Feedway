<script setup lang="ts">
import type { ClientProfile } from '@app/contracts'
import { worstLink } from '@app/domain'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Platform } from '~/components/PlatformIcons.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

// «Clienti» of the new direction (screen 14, redesign R4, spec §14.7): one row per client with
// its profiles, its next post and how many are planned, the state of the link only where someone
// has to act. No sentence under the title: the rows say which client asks for something.
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { data, status, error, refresh } = useWorkspaces()
// «Prossimo post» and «In programma», from the read «Oggi» shares (D-88.7)
const now = new Date()
const { data: activity, refresh: refreshActivity } = useClientActivity(now)
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

// ---- profiles: the first two accounts, the Instagram ones first, then «+N» for the others
const PROFILES_SHOWN = 2
const handleOf = (a: ClientProfile['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const accountsOf = (w: WorkspaceView) =>
  (w.profiles ?? [])
    .flatMap((p) => p.accounts)
    .sort((a, b) => Number(b.platform === 'instagram') - Number(a.platform === 'instagram'))
const shownAccounts = (w: WorkspaceView) => accountsOf(w).slice(0, PROFILES_SHOWN)
const moreAccounts = (w: WorkspaceView) => Math.max(accountsOf(w).length - PROFILES_SHOWN, 0)
const platformOf = (a: ClientProfile['accounts'][number]) => [a.platform as Platform]

// ---- the next post and how many are planned: «—» for a client with none
const activityOf = (w: WorkspaceView) =>
  activity.value?.items.find((a) => a.workspaceId === w.id && a.scheduled > 0) ?? null
const nextOf = (w: WorkspaceView) => {
  const a = activityOf(w)
  return a?.nextAt ? formatRelative(a.nextAt, { now }) : null
}
const plannedOf = (w: WorkspaceView) => {
  const n = activityOf(w)?.scheduled ?? 0
  return n > 0 ? t('workspaces.planned', { n }, n) : null
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

const head = computed(() => [
  t('workspaces.column.client'),
  t('workspaces.column.profiles'),
  t('workspaces.column.next'),
  t('workspaces.column.planned'),
  t('workspaces.column.link'),
  { label: t('workspaces.column.actions'), hidden: true as const },
])
/** the tools' line, with «Nuovo cliente» on a computer */
const tools = computed(() => status.value === 'success' && all.value.length > 0)
const COLUMNS = 'minmax(0, 1.4fr) minmax(0, 1.6fr) 150px 110px 150px 30px'
const pageOf = (w: WorkspaceView) => org.to(`/spazi/${w.slug}`)
/** «Ricollega» only for whoever manages the connections, only where it is the thing to do. */
const canReconnect = (w: WorkspaceView) =>
  org.may.value.manageAccounts && w.archivedAt === null && linkOf(w) === 'reconnect'
const integrations = computed(() => org.to('/impostazioni/integrazioni/meta'))

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
// «Nuovo cliente» from the client selector opens the dialog here (`?nuovo=1`)
const route = useRoute()
const router = useRouter()
function askedToAdd() {
  if (route.query['nuovo'] === undefined) return
  const query = { ...route.query }
  delete query['nuovo']
  void router.replace({ query })
  if (org.may.value.createWorkspace) startAdding()
}
onMounted(askedToAdd)
watch(() => route.query['nuovo'], askedToAdd)
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
/** its scheduled posts, which archiving takes back to draft (D-70); null while unknown */
const scheduledCount = ref<{ n: number; more: boolean } | 'unknown' | null>(null)
watch(archiving, async (w) => {
  scheduledCount.value = null
  if (!w) return
  try {
    const page = await call<{ items: unknown[]; next: string | null }>(
      'GET',
      org.api(`/workspaces/${encodeURIComponent(w.id)}/posts?status=scheduled&limit=100`),
    )
    if (archiving.value?.id === w.id)
      scheduledCount.value = { n: page.items.length, more: page.next !== null }
  } catch {
    // the dialog says it in general words
    if (archiving.value?.id === w.id) scheduledCount.value = 'unknown'
  }
})
const archiveText = computed(() => {
  const c = scheduledCount.value
  const posts =
    c === null
      ? ''
      : c === 'unknown'
        ? t('workspaces.archivePostsUnknown')
        : c.more
          ? t('workspaces.archivePostsMany', { n: c.n })
          : c.n === 0
            ? ''
            : t('workspaces.archivePosts', { n: c.n }, c.n)
  return [t('workspaces.archiveText'), posts].filter(Boolean).join(' ')
})
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
    // archiving takes its scheduled posts back to draft (D-70): the next post goes too
    await Promise.all([refresh(), refreshActivity()])
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
  // the row shows the state only: «Ricollega» comes first in «⋯», where it is the thing to do
  if (canReconnect(w))
    groups[0]?.unshift({
      label: t('workspaces.reconnect'),
      icon: 'i-lucide-link',
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
  <PageShell :data-ready="ready || undefined">
    <template #head>
      <PageHeader :title="$t('workspaces.title')">
        <!-- on a phone the action sits beside the title, on a computer in the tools' line or in
             the empty state; only a failed read keeps it here, so it does not move while loading -->
        <template v-if="org.may.value.createWorkspace" #actions>
          <UButton
            :class="error ? '' : 'md:hidden'"
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            @click="startAdding()"
          >
            {{ $t('workspaces.new') }}
          </UButton>
        </template>
      </PageHeader>
    </template>

    <div>
      <p v-if="done" role="status" class="mb-3 text-sm text-(--app-success)">{{ done }}</p>
      <p v-if="problem" role="alert" class="mb-3 text-sm text-(--app-danger)">{{ problem }}</p>

      <Toolbar v-if="tools">
        <SegmentedFilter v-model="filter" :label="$t('workspaces.show')" :options="options" />
        <SearchField v-model="query" :label="$t('workspaces.search')" />
        <span class="flex-1 max-md:hidden" />
        <UButton
          v-if="org.may.value.createWorkspace"
          class="max-md:hidden"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          @click="startAdding()"
        >
          {{ $t('workspaces.new') }}
        </UButton>
      </Toolbar>

      <TableSkeleton
        v-if="status === 'pending' || status === 'idle'"
        :label="$t('workspaces.loading')"
        :columns="[
          $t('workspaces.column.client'),
          $t('workspaces.column.profiles'),
          $t('workspaces.column.next'),
        ]"
        :rows="4"
      />
      <div
        v-else-if="error"
        role="alert"
        class="space-y-3 rounded-card border border-(--app-border) bg-(--app-surface) p-5"
      >
        <p>{{ $t('workspaces.loadError') }}</p>
        <UButton color="neutral" variant="outline" @click="() => refresh()">
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
      >
        <UButton
          v-if="org.may.value.createWorkspace"
          class="max-md:hidden"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          @click="startAdding()"
        >
          {{ $t('workspaces.new') }}
        </UButton>
      </EmptyState>
      <p
        v-else-if="visible.length === 0"
        class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
        data-clients-none
      >
        {{
          query.trim()
            ? $t('workspaces.noMatch', { q: query.trim() })
            : filter === 'archived'
              ? $t('workspaces.noArchived')
              : $t('workspaces.empty')
        }}
      </p>
      <ListSurface
        v-else
        class="max-lg:[&>[data-list-head]]:sr-only"
        :columns="COLUMNS"
        :head="head"
        :label="$t('workspaces.title')"
      >
        <ListRow
          v-for="w in visible"
          :key="w.id"
          class="max-lg:grid-cols-[minmax(0,1fr)_auto_auto]"
          :data-client="w.slug"
        >
          <span role="cell" class="flex min-w-0 items-center gap-3">
            <Avatar :name="w.name" :src="w.photoUrl" />
            <span class="min-w-0">
              <NuxtLink
                :to="pageOf(w)"
                class="block truncate font-semibold underline-offset-3 hover:underline"
                >{{ w.name }}</NuxtLink
              >
              <span class="block truncate text-detail text-(--app-text-muted) lg:hidden">{{
                nextOf(w)
                  ? $t('workspaces.nextShort', { when: nextOf(w) })
                  : $t('workspaces.nothingPlanned')
              }}</span>
            </span>
          </span>
          <span role="cell" class="flex min-w-0 items-center gap-x-3.5 max-lg:hidden">
            <template v-if="shownAccounts(w).length > 0">
              <PlatformIcons
                v-for="a in shownAccounts(w)"
                :key="a.id"
                :platforms="platformOf(a)"
                :label="handleOf(a)"
                class="min-w-0"
              />
              <span v-if="moreAccounts(w) > 0" class="text-(--app-text-muted) tabular-nums">
                <span aria-hidden="true">{{
                  $t('workspaces.moreProfiles', { n: moreAccounts(w) })
                }}</span>
                <span class="sr-only">{{
                  $t('workspaces.moreProfilesLabel', { n: moreAccounts(w) }, moreAccounts(w))
                }}</span>
              </span>
            </template>
            <span v-else class="text-(--app-text-muted)">{{ $t('workspaces.noProfile') }}</span>
          </span>
          <span
            role="cell"
            class="max-lg:hidden"
            :class="nextOf(w) ? '' : 'text-(--app-text-muted)'"
          >
            {{ nextOf(w) ?? '—' }}
          </span>
          <span role="cell" class="text-(--app-text-muted) max-lg:hidden">
            {{ plannedOf(w) ?? '—' }}
          </span>
          <span role="cell" class="min-w-0">
            <StatusDot v-if="stateOf(w)" :tone="stateOf(w)!.tone" :label="stateOf(w)!.label" />
          </span>
          <span role="cell" class="flex justify-end lg:-me-2">
            <RowActions :name="w.name" :items="actions(w)" />
          </span>
        </ListRow>
      </ListSurface>

      <p
        v-if="orphans.length > 0"
        class="mt-3 text-detail text-(--app-text-muted)"
        data-clients-orphans
      >
        {{ $t('clients.fix.notice', { n: orphans.length }, orphans.length) }}
        <button
          type="button"
          class="font-medium text-(--app-text) underline decoration-(--app-border-strong) underline-offset-3"
          @click="fixing = true"
        >
          {{ $t('clients.fix.open') }}
        </button>
      </p>
    </div>

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
        class="min-h-control font-semibold text-(--app-bg) underline underline-offset-3"
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
          <UButton type="submit" form="rename-client" class="min-h-control">
            {{ $t('account.save') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="renaming = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="archiveOpen"
      :title="$t('workspaces.archiveTitle', { name: archiving?.name ?? '' })"
      :description="archiveText"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton
            class="min-h-control"
            color="error"
            :loading="scheduledCount === null"
            @click="archive"
          >
            {{ $t('workspaces.archive') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="archiving = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
