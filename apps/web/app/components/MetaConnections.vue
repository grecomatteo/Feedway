<script setup lang="ts">
/**
 * The connections of Meta in Impostazioni → Integrazioni → Meta (spec §8.3, plan 04 Task 6c):
 * each connection with «Sincronizza», «Ricollega» and «Sostituisci token», and the
 * profiles they bring. Owner and Admin (§10.2). `focusAccount` (from «Ricollega» of a client)
 * brings the connection of that account into view.
 */
const props = defineProps<{ withReauth: WithReauth; focusAccount?: string | null }>()

type Health = 'ok' | 'warning' | 'error'
type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

interface AccountItem {
  id: string
  platform: 'instagram' | 'facebook'
  externalId: string
  name: string
  username: string | null
  /** Feedway's copy of the picture; null: the initials. */
  avatarUrl: string | null
  pageId: string | null
  active: boolean
  health: Health | null
  healthMessage: string | null
  quota: { used: number; total: number; checkedAt: string } | null
  workspaceIds: string[]
  connection: { id: string; kind: string; status: ConnectionStatus } | null
}

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const addTo = computed(() => org.to('/impostazioni/integrazioni/meta/aggiungi'))

const items = ref<AccountItem[]>([])
const nextCursor = ref<string | null>(null)
const loadingMore = ref(false)
const moreProblem = ref<string | null>(null)

const { data, status, error, refresh } = useFetch<{
  items: AccountItem[]
  nextCursor: string | null
}>(() => org.api('/accounts'), {
  key: () => `accounts-${org.slug.value}`,
  server: false,
  lazy: true,
})
watch(
  data,
  (page) => {
    items.value = page?.items ?? []
    nextCursor.value = page?.nextCursor ?? null
  },
  { immediate: true },
)
async function loadMore() {
  if (nextCursor.value === null) return
  loadingMore.value = true
  moreProblem.value = null
  try {
    const page = await call<{ items: AccountItem[]; nextCursor: string | null }>(
      'GET',
      org.api(`/accounts?cursor=${encodeURIComponent(nextCursor.value)}`),
    )
    items.value = [...items.value, ...page.items]
    nextCursor.value = page.nextCursor
  } catch (e) {
    moreProblem.value = failure(e).message
  } finally {
    loadingMore.value = false
  }
}

const { data: workspaces } = useWorkspaces()
const workspaceName = (id: string) => workspaces.value?.items.find((w) => w.id === id)?.name
function workspaceNames(ids: string[]) {
  const names = ids.map((id) => workspaceName(id)).filter(Boolean)
  // the names arrive with the workspaces: until then, how many
  return names.length === ids.length
    ? t('socialAccounts.workspaces', { names: names.join(', ') })
    : t('socialAccounts.workspaceCount', { n: ids.length }, ids.length)
}

/** The profile of §3: an Instagram and the Page Meta links to it share the page id. */
const profiles = computed(() => {
  const groups = new Map<string, AccountItem[]>()
  for (const a of items.value) {
    const key = a.pageId ?? a.id
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  return [...groups.entries()].map(([key, accounts]) => ({
    key,
    name: (accounts.find((a) => a.platform === 'facebook') ?? accounts[0])?.name ?? '',
    accounts,
  }))
})

// every connection, a new one without accounts too; the list is not paged (a few per agency)
const {
  data: connectionList,
  status: connectionsStatus,
  error: connectionsError,
  refresh: refreshConnections,
} = useFetch<{
  items: {
    id: string
    kind: string
    status: ConnectionStatus
    syncRetryAfterSeconds: number | null
    expiresAt: string | null
    businessName: string | null
    createdAt: string
  }[]
}>(() => org.api('/connections'), {
  key: () => `connections-${org.slug.value}`,
  server: false,
  lazy: true,
})

/** The connections, with how many of the loaded accounts each one carries, active or not. */
const connections = computed(() =>
  (connectionList.value?.items ?? []).map((c) => {
    const mine = items.value.filter((a) => a.connection?.id === c.id)
    const inactive = mine.filter((a) => !a.active).length
    return { ...c, accounts: mine.length - inactive, inactive }
  }),
)

function stateOf(a: AccountItem): {
  key: string
  color: 'success' | 'warning' | 'error' | 'neutral'
} {
  if (!a.active) return { key: 'inactive', color: 'neutral' }
  if (a.connection?.status === 'expired' || a.connection?.status === 'revoked')
    return { key: 'reconnect', color: 'error' }
  if (a.health === 'error') return { key: 'error', color: 'error' }
  if (a.health === 'warning') return { key: 'warning', color: 'warning' }
  if (a.health === null) return { key: 'unchecked', color: 'neutral' }
  return { key: 'ok', color: 'success' }
}
const broken = (s: ConnectionStatus) => s === 'expired' || s === 'revoked'
const STATE_TONE = {
  ok: 'success',
  warning: 'warning',
  error: 'danger',
  reconnect: 'warning',
  unchecked: 'neutral',
  inactive: 'neutral',
} as const
const toneOf = (a: AccountItem) => STATE_TONE[stateOf(a).key as keyof typeof STATE_TONE]
const connectionHead = computed(() => [
  t('socialAccounts.col.connection'),
  t('socialAccounts.col.profiles'),
  t('socialAccounts.col.expires'),
  t('socialAccounts.col.state'),
  { label: t('users.col.actions'), hidden: true as const },
])
const profileHead = computed(() => [
  t('socialAccounts.col.profile'),
  t('socialAccounts.col.clients'),
  t('socialAccounts.col.state'),
])
const reactivable = (a: AccountItem) =>
  a.connection?.kind === 'meta_system_user' && !broken(a.connection.status)

/**
 * «Sincronizza»: one sync of a connection every few minutes (the server's limit). After a click,
 * the button waits as long as the server says, and the message counts down.
 */
const sync = reactive({ id: '', sending: false })
/** The last answer of each connection: announced once, while the countdown below it is not. */
const outcomes = reactive<
  Record<string, { kind: 'queued' | 'tooSoon' | 'failed'; message: string }>
>({})
const waitUntil = reactive<Record<string, number>>({})
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 5_000)
})
onBeforeUnmount(() => clearInterval(clock))
const minutesLeft = (id: string) =>
  Math.ceil(Math.max(0, (waitUntil[id] ?? 0) - now.value) / 60_000)
const waiting = (id: string) => minutesLeft(id) > 0
function wait(id: string, seconds: number | null) {
  // without the server's answer, the same 5 minutes it uses
  waitUntil[id] = Date.now() + (seconds ?? 300) * 1000
  now.value = Date.now()
}
// a page opened after a sync knows the wait from the server, before any click
watch(connectionList, (list) => {
  for (const c of list?.items ?? [])
    if (c.syncRetryAfterSeconds !== null) {
      const until = Date.now() + c.syncRetryAfterSeconds * 1000
      if (until > (waitUntil[c.id] ?? 0)) waitUntil[c.id] = until
    }
  now.value = Date.now()
})
async function syncConnection(id: string) {
  if (sync.sending || waiting(id)) return
  Object.assign(sync, { id, sending: true })
  delete outcomes[id]
  try {
    const answer = await call<{ retryAfterSeconds: number }>(
      'POST',
      org.api(`/connections/${id}/sync`),
    )
    wait(id, answer.retryAfterSeconds)
    outcomes[id] = { kind: 'queued', message: t('socialAccounts.syncQueued') }
  } catch (e) {
    const f = failure(e)
    if (f.code === 'RATE_LIMITED') {
      wait(id, f.retryAfter)
      outcomes[id] = { kind: 'tooSoon', message: t('socialAccounts.syncTooSoon') }
    } else outcomes[id] = { kind: 'failed', message: f.message }
  } finally {
    sync.sending = false
  }
}

const token = reactive({ open: false, title: '', done: '' })
function openToken(reconnect: boolean) {
  Object.assign(token, {
    open: true,
    title: reconnect ? t('socialAccounts.reconnect') : t('socialAccounts.replaceToken'),
    done: '',
  })
}
async function tokenDone(outcome: 'connected' | 'replaced') {
  Object.assign(sync, { id: '', sending: false })
  for (const id of Object.keys(outcomes)) delete outcomes[id]
  token.done = t(`socialAccounts.tokenDone.${outcome}`)
  await Promise.all([
    refresh(),
    refreshConnections(),
    refreshNuxtData(`meta-reminders-${org.slug.value}`),
  ])
}

/** «Ricollega» of a client: the connection of its account, once both lists are in. */
const focused = ref<string | null>(null)
watch(
  [() => props.focusAccount, items, connectionList],
  async () => {
    if (focused.value !== null || !props.focusAccount || !connectionList.value) return
    const account = items.value.find((a) => a.id === props.focusAccount)
    // not in the pages loaded yet: the next one (the list is paged by 50)
    if (!account && nextCursor.value !== null && !loadingMore.value && !moreProblem.value) {
      await loadMore()
      return
    }
    const id = account?.connection?.id
    if (!id) return
    focused.value = id
    await nextTick()
    const el = document.getElementById(`collegamento-${id}`)
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <div class="flex flex-col gap-8">
    <p v-if="token.done" role="status" class="text-(--app-success)">{{ token.done }}</p>

    <!-- the connections (screen 25): each with its sync, or «Ricollega» when it broke -->
    <SettingsGroup :title="$t('socialAccounts.connections')" bare>
      <TableSkeleton
        v-if="connectionsStatus === 'pending' || connectionsStatus === 'idle'"
        :label="$t('socialAccounts.loading')"
        :columns="[$t('socialAccounts.col.connection'), $t('socialAccounts.col.profiles')]"
        :rows="2"
      />
      <LoadFailed
        v-else-if="connectionsError"
        :text="$t('socialAccounts.connectionsError')"
        @retry="refreshConnections()"
      />
      <p
        v-else-if="connections.length === 0"
        class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
      >
        {{ $t('socialAccounts.noConnections') }}
      </p>
      <ListSurface
        v-else
        columns="minmax(0,1fr) 64px 120px 110px 148px"
        :head="connectionHead"
        :label="$t('socialAccounts.connections')"
        class="max-md:[&>[data-list-head]]:sr-only"
      >
        <ListRow
          v-for="c in connections"
          :id="`collegamento-${c.id}`"
          :key="c.id"
          :data-connection="c.id"
          :tabindex="focused === c.id ? -1 : undefined"
          :aria-current="focused === c.id ? 'true' : undefined"
          class="aria-[current=true]:ring-2 aria-[current=true]:ring-(--app-focus) aria-[current=true]:ring-inset max-md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <span role="cell" class="flex min-w-0 items-center gap-3">
            <UIcon name="i-lucide-facebook" class="size-[18px] shrink-0" aria-hidden="true" />
            <span class="min-w-0">
              <span class="block truncate font-semibold">{{
                c.businessName ?? $t(`socialAccounts.kind.${c.kind}`)
              }}</span>
              <span class="block truncate text-detail text-(--app-text-muted)">
                <!-- with the Business as the title, the kind moves here (B11 of the redesign review) -->
                <template v-if="c.businessName !== null"
                  >{{ $t(`socialAccounts.kind.${c.kind}`) }} ·
                </template>
                <template v-if="broken(c.status) || c.status === 'pending'">{{
                  $t(`socialAccounts.connectionStatus.${c.status}`)
                }}</template>
                <template v-else>{{
                  $t('socialAccounts.since', { when: formatDate(c.createdAt) })
                }}</template>
              </span>
            </span>
          </span>
          <span role="cell" class="tabular-nums max-md:hidden">
            <template v-if="nextCursor === null">
              {{ c.accounts
              }}<span v-if="c.inactive > 0" class="text-(--app-text-muted)">
                ·
                {{ $t('socialAccounts.connectionInactive', { n: c.inactive }, c.inactive) }}</span
              >
            </template>
          </span>
          <span role="cell" class="text-(--app-text-muted) max-md:hidden">
            {{ c.expiresAt ? formatRelative(c.expiresAt) : $t('socialAccounts.neverExpires') }}
          </span>
          <span role="cell" class="max-md:hidden">
            <StatusDot
              v-if="broken(c.status)"
              tone="warning"
              :label="$t(`socialAccounts.connectionState.${c.status}`)"
            />
          </span>
          <span role="cell" class="flex items-center justify-end gap-1 md:-me-2">
            <UButton
              v-if="broken(c.status) && c.kind === 'meta_system_user'"
              color="neutral"
              variant="outline"
              size="sm"
              @click="openToken(true)"
            >
              {{ $t('socialAccounts.reconnect') }}
            </UButton>
            <template v-else>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                :aria-label="$t('socialAccounts.sync')"
                :disabled="broken(c.status) || waiting(c.id) || (sync.sending && sync.id !== c.id)"
                :loading="sync.sending && sync.id === c.id"
                @click="syncConnection(c.id)"
              >
                <span class="max-md:hidden">{{ $t('socialAccounts.sync') }}</span>
              </UButton>
              <RowActions
                v-if="c.kind === 'meta_system_user'"
                :name="c.businessName ?? $t(`socialAccounts.kind.${c.kind}`)"
                :items="[
                  {
                    label: $t('socialAccounts.replaceToken'),
                    icon: 'i-lucide-key-round',
                    onSelect: () => openToken(false),
                  },
                ]"
              />
            </template>
          </span>
          <span
            v-if="outcomes[c.id] || waiting(c.id)"
            role="cell"
            class="col-span-full -mt-2 pb-3 text-detail"
          >
            <span
              v-if="outcomes[c.id]"
              class="block"
              :role="outcomes[c.id]?.kind === 'failed' ? 'alert' : 'status'"
              :class="{
                'text-(--app-success)': outcomes[c.id]?.kind === 'queued',
                'text-(--app-danger)': outcomes[c.id]?.kind === 'failed',
              }"
            >
              {{ outcomes[c.id]?.message }}
            </span>
            <span v-if="waiting(c.id)" class="block text-(--app-text-muted)">
              {{ $t('socialAccounts.syncAgainIn', { n: minutesLeft(c.id) }, minutesLeft(c.id)) }}
            </span>
          </span>
        </ListRow>
      </ListSurface>
    </SettingsGroup>

    <slot />

    <!-- the profiles the connections bring, with their clients and state -->
    <SettingsGroup :title="$t('socialAccounts.list')" bare>
      <TableSkeleton
        v-if="status === 'pending' || status === 'idle'"
        :label="$t('socialAccounts.loading')"
        :columns="[$t('socialAccounts.col.profile'), $t('socialAccounts.col.clients')]"
        :rows="3"
      />
      <LoadFailed v-else-if="error" :text="$t('socialAccounts.loadError')" @retry="refresh()" />
      <EmptyState
        v-else-if="items.length === 0"
        icon="i-lucide-at-sign"
        :title="$t('socialAccounts.emptyTitle')"
        :text="$t('socialAccounts.emptyText')"
      >
        <NuxtLink :to="addTo" class="underline">
          {{ $t('socialAccounts.add') }}
        </NuxtLink>
      </EmptyState>
      <ListSurface
        v-else
        columns="minmax(0,1.4fr) minmax(0,1fr) 150px"
        :head="profileHead"
        :label="$t('socialAccounts.list')"
        class="max-md:[&>[data-list-head]]:sr-only"
      >
        <template v-for="profile in profiles" :key="profile.key">
          <ListRow
            v-for="a in profile.accounts"
            :key="a.id"
            class="py-2 max-md:grid-cols-[minmax(0,1fr)_auto]"
            :data-testid="`account-${a.externalId}`"
          >
            <span role="cell" class="flex min-w-0 items-center gap-3">
              <RowAvatar :name="a.name" :src="a.avatarUrl" />
              <span class="min-w-0">
                <span class="flex min-w-0 items-center gap-1.5 font-semibold">
                  <UIcon
                    :name="a.platform === 'instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
                    class="size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}: </span>
                  <span class="truncate">{{ a.name }}</span>
                  <span v-if="a.username" class="truncate font-normal text-(--app-text-muted)"
                    >@{{ a.username }}</span
                  >
                </span>
                <span
                  v-if="a.healthMessage"
                  class="block text-detail"
                  :class="a.health === 'error' ? 'text-(--app-danger)' : 'text-(--app-text-muted)'"
                >
                  {{ a.healthMessage }}
                </span>
                <span v-if="!a.active" class="block text-detail text-(--app-text-muted)">
                  <!-- only a working system user can find it again from «Aggiungi account» -->
                  <template v-if="reactivable(a)">
                    {{ $t('socialAccounts.inactiveWhy') }}
                    <NuxtLink :to="addTo" class="underline">{{ $t('addAccount.search') }}</NuxtLink
                    >.
                  </template>
                  <template v-else>{{ $t('socialAccounts.inactiveOther') }}</template>
                </span>
                <span v-if="a.quota" class="block text-detail text-(--app-text-muted)">
                  {{ $t('socialAccounts.quota', { used: a.quota.used, total: a.quota.total }) }}
                </span>
                <span class="block text-detail text-(--app-text-muted) md:hidden">
                  {{
                    a.workspaceIds.length === 0
                      ? $t('socialAccounts.noWorkspace')
                      : workspaceNames(a.workspaceIds)
                  }}
                </span>
              </span>
            </span>
            <span role="cell" class="truncate text-(--app-text-muted) max-md:hidden">
              {{
                a.workspaceIds.length === 0
                  ? $t('socialAccounts.noWorkspace')
                  : workspaceNames(a.workspaceIds)
              }}
            </span>
            <span role="cell">
              <StatusDot :tone="toneOf(a)" :label="$t(`socialAccounts.state.${stateOf(a).key}`)" />
            </span>
          </ListRow>
        </template>
      </ListSurface>
      <div v-if="nextCursor" class="mt-3 space-y-2">
        <UButton color="neutral" variant="outline" :loading="loadingMore" @click="loadMore">
          {{ $t('socialAccounts.more') }}
        </UButton>
        <p v-if="moreProblem" role="alert" class="text-(--app-danger)">{{ moreProblem }}</p>
      </div>
    </SettingsGroup>

    <SystemUserTokenDialog
      v-model:open="token.open"
      :title="token.title"
      :with-reauth="props.withReauth"
      :path="org.api('/connections/system-user')"
      @done="tokenDone"
    />
  </div>
</template>
