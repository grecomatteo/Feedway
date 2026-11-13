<script setup lang="ts">
import type { MetaReminder } from '@app/contracts'

definePageMeta({ layout: 'agency' })

type Health = 'ok' | 'warning' | 'error'
type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

interface AccountItem {
  id: string
  platform: 'instagram' | 'facebook'
  externalId: string
  name: string
  username: string | null
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
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('socialAccounts.title') })
if (!org.may.value.manageAccounts)
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })

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

// the reminders are a notice on top: if they do not load, the list still shows
const { data: reminders } = useFetch<{ items: MetaReminder[] }>(
  () => org.api('/accounts/reminders'),
  { key: () => `meta-reminders-${org.slug.value}`, server: false, lazy: true },
)

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
  error: connectionsError,
  refresh: refreshConnections,
} = useFetch<{
  items: { id: string; kind: string; status: ConnectionStatus }[]
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

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-3xl">{{ $t('socialAccounts.title') }}</h1>
        <p class="text-(--app-text-muted)">{{ $t('socialAccounts.explain') }}</p>
      </div>
      <UButton :to="org.to('/account/aggiungi')" class="min-h-11" icon="i-lucide-plus">
        {{ $t('socialAccounts.add') }}
      </UButton>
    </header>

    <MetaReminders :items="reminders?.items ?? []" />

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('socialAccounts.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('socialAccounts.loadError') }}
      </p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else>
      <p v-if="token.done" role="status" class="text-(--app-success)">{{ token.done }}</p>

      <div v-if="connectionsError" role="alert" class="space-y-3">
        <p class="text-(--app-danger)">{{ $t('socialAccounts.connectionsError') }}</p>
        <UButton
          class="min-h-11"
          color="neutral"
          variant="outline"
          @click="() => refreshConnections()"
        >
          {{ $t('account.retry') }}
        </UButton>
      </div>
      <section
        v-if="connections.length > 0"
        aria-labelledby="connections"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="connections" class="text-lg">{{ $t('socialAccounts.connections') }}</h2>
        <ul class="divide-y divide-(--app-border)">
          <li
            v-for="c in connections"
            :key="c.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div class="min-w-0 space-y-1">
              <p class="font-semibold">{{ $t(`socialAccounts.kind.${c.kind}`) }}</p>
              <p class="text-sm text-(--app-text-muted)">
                <template v-if="nextCursor === null">
                  {{ $t('socialAccounts.connectionAccounts', { n: c.accounts }, c.accounts)
                  }}<template v-if="c.inactive > 0"
                    >,
                    {{
                      $t('socialAccounts.connectionInactive', { n: c.inactive }, c.inactive)
                    }}</template
                  >
                  ·
                </template>
                <span :class="broken(c.status) ? 'text-(--app-danger)' : undefined">{{
                  $t(`socialAccounts.connectionStatus.${c.status}`)
                }}</span>
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                class="min-h-11"
                color="neutral"
                variant="outline"
                icon="i-lucide-refresh-cw"
                :disabled="broken(c.status) || waiting(c.id) || (sync.sending && sync.id !== c.id)"
                :loading="sync.sending && sync.id === c.id"
                @click="syncConnection(c.id)"
              >
                {{ $t('socialAccounts.sync') }}
              </UButton>
              <UButton
                v-if="c.kind === 'meta_system_user'"
                class="min-h-11"
                :color="broken(c.status) ? 'primary' : 'neutral'"
                :variant="broken(c.status) ? 'solid' : 'outline'"
                icon="i-lucide-key-round"
                @click="openToken(broken(c.status))"
              >
                {{
                  broken(c.status)
                    ? $t('socialAccounts.reconnect')
                    : $t('socialAccounts.replaceToken')
                }}
              </UButton>
            </div>
            <div v-if="outcomes[c.id] || waiting(c.id)" class="w-full space-y-1 text-sm">
              <p
                v-if="outcomes[c.id]"
                :role="outcomes[c.id]?.kind === 'failed' ? 'alert' : 'status'"
                :class="{
                  'text-(--app-success)': outcomes[c.id]?.kind === 'queued',
                  'text-(--app-danger)': outcomes[c.id]?.kind === 'failed',
                }"
              >
                {{ outcomes[c.id]?.message }}
              </p>
              <p v-if="waiting(c.id)" class="text-(--app-text-muted)">
                {{ $t('socialAccounts.syncAgainIn', { n: minutesLeft(c.id) }, minutesLeft(c.id)) }}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <EmptyState
        v-if="items.length === 0"
        icon="i-lucide-at-sign"
        :title="$t('socialAccounts.emptyTitle')"
        :text="$t('socialAccounts.emptyText')"
      >
        <NuxtLink :to="org.to('/account/aggiungi')" class="underline">
          {{ $t('socialAccounts.add') }}
        </NuxtLink>
      </EmptyState>
      <ul v-else class="space-y-4" :aria-label="$t('socialAccounts.list')">
        <li
          v-for="profile in profiles"
          :key="profile.key"
          class="rounded-xl border border-(--app-border) bg-(--app-surface)"
        >
          <h2 class="border-b border-(--app-border) px-4 py-3 text-base font-semibold sm:px-6">
            {{ profile.name }}
          </h2>
          <ul class="divide-y divide-(--app-border)">
            <li
              v-for="a in profile.accounts"
              :key="a.id"
              class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6"
              :data-testid="`account-${a.externalId}`"
            >
              <div class="flex min-w-0 items-start gap-3">
                <UIcon
                  :name="a.platform === 'instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
                  class="mt-0.5 size-5 shrink-0"
                  aria-hidden="true"
                />
                <div class="min-w-0 space-y-1">
                  <p class="font-semibold break-words">
                    <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}: </span>
                    {{ a.name }}
                    <span v-if="a.username" class="font-normal text-(--app-text-muted)"
                      >@{{ a.username }}</span
                    >
                  </p>
                  <p
                    v-if="a.healthMessage"
                    class="text-sm"
                    :class="
                      a.health === 'error' ? 'text-(--app-danger)' : 'text-(--app-text-muted)'
                    "
                  >
                    {{ a.healthMessage }}
                  </p>
                  <p v-if="!a.active" class="text-sm text-(--app-text-muted)">
                    <!-- only a working system user can find it again from «Aggiungi account» -->
                    <template v-if="reactivable(a)">
                      {{ $t('socialAccounts.inactiveWhy') }}
                      <NuxtLink :to="org.to('/account/aggiungi')" class="underline">{{
                        $t('addAccount.search')
                      }}</NuxtLink
                      >.
                    </template>
                    <template v-else>{{ $t('socialAccounts.inactiveOther') }}</template>
                  </p>
                  <p v-if="a.quota" class="text-sm text-(--app-text-muted)">
                    {{ $t('socialAccounts.quota', { used: a.quota.used, total: a.quota.total }) }}
                  </p>
                  <p class="text-sm text-(--app-text-muted)">
                    {{
                      a.workspaceIds.length === 0
                        ? $t('socialAccounts.noWorkspace')
                        : workspaceNames(a.workspaceIds)
                    }}
                  </p>
                </div>
              </div>
              <UBadge :color="stateOf(a).color" variant="subtle" class="self-start">
                {{ $t(`socialAccounts.state.${stateOf(a).key}`) }}
              </UBadge>
            </li>
          </ul>
        </li>
      </ul>
      <div v-if="nextCursor" class="space-y-2">
        <UButton
          class="min-h-11"
          color="neutral"
          variant="outline"
          :loading="loadingMore"
          @click="loadMore"
        >
          {{ $t('socialAccounts.more') }}
        </UButton>
        <p v-if="moreProblem" role="alert" class="text-(--app-danger)">{{ moreProblem }}</p>
      </div>

      <SystemUserTokenDialog
        v-model:open="token.open"
        :title="token.title"
        :with-reauth="withReauth"
        :path="org.api('/connections/system-user')"
        @done="tokenDone"
      />
      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
