<script setup lang="ts">
definePageMeta({ layout: 'agency' })

type WorkspaceRole = 'manager' | 'publisher' | 'editor' | 'viewer'
interface Member {
  id: string
  displayName: string
  name: string
  email: string
  orgRole: 'owner' | 'admin' | 'member'
  status: 'active' | 'disabled'
  avatarUrl?: string | null
  secondFactorConfigured: boolean
  workspaces: { id: string; name: string; role: WorkspaceRole }[]
  lastLoginAt: string | null
  anonymizationScheduledFor: string | null
}
interface Invite {
  id: string
  email: string
  orgRole: 'owner' | 'admin' | 'member'
  memberships: { workspaceId: string; role: WorkspaceRole }[]
  expiresAt: string
}

const org = useOrganization()
const session = useSession()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const { data: spaces } = useWorkspaces()

useHead({ title: () => t('users.title') })
if (!org.may.value.manageUsers) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const { data, status, error, refresh } = useFetch<{ items: Member[] }>(() => org.api('/members'), {
  key: () => `members-${org.slug.value}`,
  server: false,
  lazy: true,
})
const { data: invites, refresh: refreshInvites } = useFetch<{ items: Invite[] }>(
  () => org.api('/invites'),
  { key: () => `invites-${org.slug.value}`, server: false, lazy: true },
)
const myId = computed(() => org.me.value?.id ?? '')
const isOwner = computed(() => org.role.value === 'owner')
const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
const spaceName = (id: string) => spaces.value?.items.find((w) => w.id === id)?.name ?? ''

// ---- one action at a time, with its outcome
const busy = ref<string | null>(null)
const problem = ref<string | null>(null)
const done = ref<string | null>(null)
const resetUrl = ref<{ name: string; url: string } | null>(null)
async function act(key: string, action: () => Promise<void>, message: string) {
  busy.value = key
  problem.value = null
  done.value = null
  // a reset link is shown only right after it is made
  resetUrl.value = null
  try {
    await withReauth(action)
    done.value = message
    await Promise.all([refresh(), refreshInvites()])
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    busy.value = null
  }
}
const memberPath = (m: Member, tail: string) =>
  org.api(`/members/${encodeURIComponent(m.id)}${tail}`)
const changeRole = (m: Member, role: 'admin' | 'member') =>
  act(
    m.id,
    async () => {
      await call('PUT', memberPath(m, '/role'), { role })
    },
    t('users.roleChanged', { name: m.displayName }),
  )
const disable = (m: Member) =>
  act(
    m.id,
    async () => {
      await call('POST', memberPath(m, '/disable'))
    },
    t('users.disabledDone', { name: m.displayName }),
  )
const enable = (m: Member) =>
  act(
    m.id,
    async () => {
      await call('POST', memberPath(m, '/enable'))
    },
    t('users.enabledDone', { name: m.displayName }),
  )
const resetLink = (m: Member) =>
  act(
    m.id,
    async () => {
      const r = await call<{ url: string }>('POST', memberPath(m, '/password-reset-link'))
      resetUrl.value = { name: m.displayName, url: r.url }
    },
    t('users.resetReady', { name: m.displayName }),
  )
const resend = (i: Invite) =>
  act(
    i.id,
    async () => {
      await call('POST', org.api(`/invites/${encodeURIComponent(i.id)}/resend`))
    },
    t('users.inviteResent', { email: i.email }),
  )
const revoke = (i: Invite) =>
  act(
    i.id,
    async () => {
      await call('DELETE', org.api(`/invites/${encodeURIComponent(i.id)}`))
    },
    t('users.inviteRevoked', { email: i.email }),
  )
// the link lives on screen only while it is needed
onBeforeUnmount(() => {
  resetUrl.value = null
})

// ---- invite
const inviteOpen = ref(false)
const activeSpaces = computed(() =>
  (spaces.value?.items ?? []).filter((w) => w.archivedAt === null),
)
async function inviteSent(email: string) {
  done.value = t('users.invite.sent', { email })
  await refreshInvites()
}

// ---- the list: who is active, the open invites, who is suspended
type Tab = 'active' | 'invites' | 'disabled'
const tab = ref<Tab>('active')
const query = ref('')
const matches = (...texts: string[]) => {
  const q = query.value.trim().toLocaleLowerCase('it')
  return q === '' || texts.some((x) => x.toLocaleLowerCase('it').includes(q))
}
const members = computed(() => data.value?.items ?? [])
const active = computed(() => members.value.filter((m) => m.status === 'active'))
const suspended = computed(() => members.value.filter((m) => m.status !== 'active'))
const openInvites = computed(() => invites.value?.items ?? [])
const tabs = computed(() => [
  { value: 'active' as const, label: t('users.tabs.active'), count: active.value.length },
  { value: 'invites' as const, label: t('users.tabs.invites'), count: openInvites.value.length },
  { value: 'disabled' as const, label: t('users.tabs.disabled'), count: suspended.value.length },
])
const shownMembers = computed(() =>
  (tab.value === 'disabled' ? suspended.value : active.value).filter((m) =>
    matches(m.displayName, m.name, m.email),
  ),
)
const shownInvites = computed(() => openInvites.value.filter((i) => matches(i.email)))

/** «Owner», «Admin», or the roles a Member has on their clients («Editor»). */
function roleOf(m: { orgRole: Member['orgRole']; roles: WorkspaceRole[] }): string {
  if (m.orgRole !== 'member') return t(`roles.${m.orgRole}`)
  const distinct = [...new Set(m.roles)]
  return distinct.length === 0 ? t('roles.member') : distinct.map((r) => t(`roles.${r}`)).join(', ')
}
/** «Tutti» for Owner and Admin, the names of the clients for a Member. */
function clientsOf(m: { orgRole: Member['orgRole']; names: string[] }): string {
  if (m.orgRole !== 'member') return t('users.allClients')
  return m.names.length === 0 ? t('users.noClients') : m.names.join(', ')
}
const memberRole = (m: Member) =>
  roleOf({ orgRole: m.orgRole, roles: m.workspaces.map((w) => w.role) })
const memberClients = (m: Member) =>
  clientsOf({ orgRole: m.orgRole, names: m.workspaces.map((w) => w.name) })
const inviteRole = (i: Invite) =>
  roleOf({ orgRole: i.orgRole, roles: i.memberships.map((ms) => ms.role) })
const inviteClients = (i: Invite) =>
  clientsOf({ orgRole: i.orgRole, names: i.memberships.map((ms) => spaceName(ms.workspaceId)) })
const lastSeen = (m: Member) =>
  m.id === myId.value
    ? t('users.now')
    : m.lastLoginAt
      ? formatRelative(m.lastLoginAt)
      : t('users.never')

/** While one action runs the others wait: a second reset link would void the one shown. */
const locked = <T extends object>(items: T[]) =>
  items.map((item) => ({ ...item, disabled: busy.value !== null }))
function memberActions(m: Member) {
  const items: { label: string; icon?: string; color?: 'error'; onSelect: () => void }[] = []
  if (m.id === myId.value) {
    if (isOwner.value)
      items.push({
        label: t('transfer.button'),
        icon: 'i-lucide-crown',
        onSelect: () => (transferOpen.value = true),
      })
    return locked(items)
  }
  if (m.orgRole === 'owner') return items
  if (isOwner.value && m.status === 'active')
    items.push(
      m.orgRole === 'admin'
        ? {
            label: t('users.makeMember'),
            icon: 'i-lucide-user',
            onSelect: () => changeRole(m, 'member'),
          }
        : {
            label: t('users.makeAdmin'),
            icon: 'i-lucide-user-cog',
            onSelect: () => changeRole(m, 'admin'),
          },
    )
  items.push({ label: t('users.reset'), icon: 'i-lucide-key-round', onSelect: () => resetLink(m) })
  items.push(
    m.status === 'active'
      ? {
          label: t('users.disable'),
          icon: 'i-lucide-user-x',
          color: 'error',
          onSelect: () => disable(m),
        }
      : { label: t('users.enable'), icon: 'i-lucide-user-check', onSelect: () => enable(m) },
  )
  return locked(items)
}
const inviteActions = (i: Invite) =>
  locked([
    { label: t('users.resend'), icon: 'i-lucide-send', onSelect: () => resend(i) },
    { label: t('users.revoke'), icon: 'i-lucide-x', onSelect: () => revoke(i) },
  ])

// under 1280 px the fourth column (last sign-in, expiry) goes, as the author's column of the posts:
// beside the sidebar the page is too narrow for six (D-102). The narrow grid is in the template.
const COLUMNS = 'minmax(180px,1.6fr) 112px minmax(96px,1fr) 140px 170px 30px'
const memberHead = computed(() => [
  t('users.col.person'),
  t('users.col.role'),
  t('users.col.clients'),
  t('users.col.lastLogin'),
  { label: t('users.col.status'), hidden: true as const },
  { label: t('users.col.actions'), hidden: true as const },
])
const inviteHead = computed(() => [
  t('users.col.email'),
  t('users.col.role'),
  t('users.col.clients'),
  t('users.col.expires'),
  { label: t('users.col.status'), hidden: true as const },
  { label: t('users.col.actions'), hidden: true as const },
])
const ready = computed(() => data.value !== undefined && invites.value !== undefined)

// ---- ownership
const transferOpen = ref(false)
const transferCandidates = computed(() =>
  (data.value?.items ?? []).filter(
    (m) => m.orgRole === 'admin' && m.status === 'active' && m.secondFactorConfigured,
  ),
)
async function transferred() {
  // a role change signs the person out everywhere (spec §10.3): sign in again, then come back
  const view = await session.load()
  if (view.state === 'signed_out') {
    // nothing of this session stays in memory for whoever signs in next on this device
    clearNuxtData()
    return navigateTo({ path: '/accedi', query: { avviso: 'ruolo', dopo: org.to('/utenti') } })
  }
  done.value = t('transfer.done')
  await refresh()
}
</script>

<template>
  <PageShell :data-ready="ready || undefined">
    <template #head>
      <PageHeader :title="$t('users.title')">
        <template #actions>
          <UButton
            class="md:hidden"
            color="neutral"
            variant="outline"
            icon="i-lucide-user-plus"
            @click="inviteOpen = true"
          >
            {{ $t('users.invite.button') }}
          </UButton>
        </template>
      </PageHeader>
    </template>

    <div>
      <p v-if="done" role="status" class="mb-3 text-sm text-(--app-success)">{{ done }}</p>
      <p v-if="problem" role="alert" class="mb-3 text-sm text-(--app-danger)">{{ problem }}</p>
      <CopyLinkField
        v-if="resetUrl"
        class="mb-3"
        :url="resetUrl.url"
        :label="$t('users.resetLinkFor', { name: resetUrl.name })"
      />

      <Toolbar>
        <SegmentedFilter v-model="tab" :label="$t('users.show')" :options="tabs" />
        <SearchField v-model="query" :label="$t('users.search')" />
        <span class="flex-1 max-md:hidden" />
        <UButton
          class="max-md:hidden"
          color="neutral"
          variant="outline"
          icon="i-lucide-user-plus"
          @click="inviteOpen = true"
        >
          {{ $t('users.invite.button') }}
        </UButton>
      </Toolbar>

      <TableSkeleton
        v-if="status === 'pending' || status === 'idle'"
        :label="$t('account.loading')"
        :columns="[$t('users.col.person'), $t('users.col.role'), $t('users.col.clients')]"
        :rows="4"
      />
      <LoadFailed v-else-if="error" :text="$t('users.loadError')" @retry="refresh()" />

      <template v-else-if="tab === 'invites'">
        <p
          v-if="shownInvites.length === 0"
          class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
        >
          {{ query.trim() ? $t('users.noMatch', { q: query.trim() }) : $t('users.noInvites') }}
        </p>
        <ListSurface
          v-else
          :columns="COLUMNS"
          :head="inviteHead"
          :label="$t('users.invitesTitle')"
          class="max-md:[&>[data-list-head]]:sr-only md:max-xl:[&>[data-list-head]]:grid-cols-[minmax(180px,1.6fr)_112px_minmax(96px,1fr)_170px_30px] md:max-xl:[&>[data-list-head]>:nth-child(4)]:hidden"
        >
          <ListRow
            v-for="i in shownInvites"
            :key="i.id"
            class="max-md:grid-cols-[minmax(0,1fr)_auto_auto] md:max-xl:grid-cols-[minmax(180px,1.6fr)_112px_minmax(96px,1fr)_170px_30px]"
            data-invite-row
          >
            <span role="cell" class="flex min-w-0 items-center gap-3">
              <Avatar :name="i.email" kind="person" />
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ i.email }}</span>
                <span class="block truncate text-detail text-(--app-text-muted)">{{
                  $t('users.inviteExpires', { when: formatDate(i.expiresAt, { time: true }) })
                }}</span>
              </span>
            </span>
            <span role="cell" class="max-md:text-detail max-md:text-(--app-text-muted)">{{
              inviteRole(i)
            }}</span>
            <span role="cell" class="truncate max-md:hidden">{{ inviteClients(i) }}</span>
            <span role="cell" class="truncate text-(--app-text-muted) max-xl:hidden">{{
              formatRelative(i.expiresAt)
            }}</span>
            <span role="cell" class="max-md:hidden" />
            <span role="cell" class="flex justify-end md:-me-2">
              <RowActions :name="i.email" :items="inviteActions(i)" />
            </span>
          </ListRow>
        </ListSurface>
      </template>

      <template v-else-if="data">
        <p
          v-if="shownMembers.length === 0"
          class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
        >
          {{
            query.trim()
              ? $t('users.noMatch', { q: query.trim() })
              : tab === 'disabled'
                ? $t('users.noDisabled')
                : $t('users.noActive')
          }}
        </p>
        <ListSurface
          v-else
          :columns="COLUMNS"
          :head="memberHead"
          :label="$t('users.title')"
          class="max-md:[&>[data-list-head]]:sr-only md:max-xl:[&>[data-list-head]]:grid-cols-[minmax(180px,1.6fr)_112px_minmax(96px,1fr)_170px_30px] md:max-xl:[&>[data-list-head]>:nth-child(4)]:hidden"
        >
          <ListRow
            v-for="m in shownMembers"
            :key="m.id"
            class="max-md:grid-cols-[minmax(0,1fr)_auto_auto] md:max-xl:grid-cols-[minmax(180px,1.6fr)_112px_minmax(96px,1fr)_170px_30px]"
            data-member-row
          >
            <span role="cell" class="flex min-w-0 items-center gap-3">
              <!-- the whole name in the people's list: two «Giulia» are told apart (D-99) -->
              <UserAvatar :name="m.name" :src="m.avatarUrl" />
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ m.name }}</span>
                <span class="block truncate text-detail text-(--app-text-muted)">{{
                  m.email
                }}</span>
              </span>
            </span>
            <span role="cell" class="max-md:text-detail max-md:text-(--app-text-muted)">{{
              memberRole(m)
            }}</span>
            <span role="cell" class="truncate max-md:hidden">{{ memberClients(m) }}</span>
            <span role="cell" class="truncate text-(--app-text-muted) max-xl:hidden">{{
              lastSeen(m)
            }}</span>
            <span role="cell" class="min-w-0 max-md:hidden">
              <span v-if="m.id === myId" class="text-(--app-text-muted)">{{
                $t('users.you')
              }}</span>
              <template v-else-if="m.status !== 'active'">
                <StatusDot :label="$t('users.disabled')" />
                <span
                  v-if="m.anonymizationScheduledFor"
                  class="block text-caption text-(--app-text-muted)"
                  >{{
                    $t('users.anonymizationScheduled', {
                      date: formatDate(m.anonymizationScheduledFor),
                    })
                  }}</span
                >
              </template>
              <StatusDot
                v-else-if="!m.secondFactorConfigured"
                tone="warning"
                :label="$t('users.noSecondFactor')"
              />
            </span>
            <span role="cell" class="flex justify-end md:-me-2">
              <RowActions
                v-if="memberActions(m).length > 0"
                :name="m.name"
                :items="memberActions(m)"
              />
            </span>
          </ListRow>
        </ListSurface>
      </template>
    </div>

    <InviteDialog
      v-model:open="inviteOpen"
      :clients="activeSpaces"
      :with-reauth="withReauth"
      @sent="inviteSent"
    />
    <TransferOwnershipDialog
      v-model:open="transferOpen"
      :candidates="transferCandidates"
      :with-reauth="withReauth"
      :path="org.api('/ownership-transfer')"
      @done="transferred"
    />
    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </PageShell>
</template>
