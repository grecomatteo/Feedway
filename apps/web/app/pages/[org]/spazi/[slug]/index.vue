<script setup lang="ts">
import type { AgendaPost, ClientProfile } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Platform } from '~/components/PlatformIcons.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

/**
 * Panoramica of the client's page (screen 16, spec §14.7): on the left its next posts and its
 * profiles with what they published in 24 hours, the last sync and the link only where someone
 * has to act; on the right the latest files and who works in it. Owner and Admin act on the profiles from
 * «⋯»: «Ricollega» (to Integrazioni), «Sostituisci profilo» (one in no client takes its place),
 * «Togli dal cliente» (the account stays, back in «Sistemali» if in no other client).
 */
interface Member {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: 'manager' | 'publisher' | 'editor' | 'viewer'
  status: 'active' | 'disabled'
}

const org = useOrganization()
const context = useContextQuery()
const { t } = useI18n()
const { call, failure } = useApi()
const ready = useHydrated()
const { client, profiles, refreshClients } = useClientPage()
const { data: withoutClient, refresh: refreshWithoutClient } = useProfilesWithoutClient()

const list = computed(() => instagramFirst(profiles.data.value?.items ?? []))
const archived = computed(() => (client.value?.archivedAt ?? null) !== null)
/** The actions on the profiles: Owner and Admin, on a client that is not archived (§10.2). */
const canChange = computed(() => org.may.value.assignAccounts && !archived.value)
const orphans = computed(() => (canChange.value ? (withoutClient.value?.items ?? []) : []))

// ---- the state of a profile: its link, as «Clienti» shows it
type Link = ClientProfile['link']
const linkOf = (p: WorkspaceProfile): Link =>
  client.value?.profiles?.find((c) => c.key === p.key)?.link ?? 'ok'
const TONE: Record<Link, StatusTone> = {
  ok: 'neutral',
  reconnect: 'warning',
  error: 'danger',
  warning: 'warning',
}
const stateOf = (p: WorkspaceProfile) => {
  const link = linkOf(p)
  return {
    link,
    tone: TONE[link],
    label: link === 'ok' ? t('client.linked') : t(`workspaces.link.${link}`),
  }
}

const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name

// ---- quota (what the platform lets it publish in a day) and the last sync
const quotaOf = (p: WorkspaceProfile) => p.accounts.find((a) => a.quota)?.quota ?? null
const quotaText = (p: WorkspaceProfile) => {
  const q = quotaOf(p)
  return q ? t('client.quota', { used: q.used, total: q.total }) : null
}
const syncedOf = (p: WorkspaceProfile) =>
  p.accounts
    .map((a) => a.lastSyncedAt ?? null)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1) ?? null
const syncedText = (p: WorkspaceProfile) => {
  const d = syncedOf(p)
  return d ? formatRelative(d, { now }) : t('client.neverSynced')
}
/** «Instagram», «Pagina Facebook», or both for an Instagram and its Page. */
const kindOf = (p: WorkspaceProfile) => {
  const platforms = new Set(p.accounts.map((a) => a.platform))
  if (platforms.size > 1) return t('clients.new.kind.both')
  return platforms.has('facebook')
    ? t('clients.new.kind.facebook')
    : t('clients.new.kind.instagram')
}
const mainOf = (p: WorkspaceProfile) =>
  (p.accounts.find((a) => a.platform === 'instagram') ?? p.accounts[0]) as ProfileAccount
const profileHead = computed(() => [
  t('client.column.profile'),
  t('client.column.quota'),
  t('client.column.synced'),
  t('client.column.state'),
  { label: t('workspaces.column.actions'), hidden: true as const },
])

// ---- the next posts: the three that go out first, from now
const now = new Date()
const clientIdRef = computed(() => client.value?.id ?? null)
const agenda = useFetch<{ items: AgendaPost[] }>(() => org.api('/agenda'), {
  key: () => `client-next-${org.slug.value}-${clientIdRef.value ?? ''}`,
  query: computed(() => ({
    from: now.toISOString(),
    to: new Date(now.getTime() + 42 * 86_400_000).toISOString(),
    ...(clientIdRef.value ? { workspaceId: clientIdRef.value } : {}),
  })),
  server: false,
  lazy: true,
  immediate: false,
  watch: false,
})
watch(
  clientIdRef,
  (id) => {
    // an archived client has nothing planned, and the agenda does not know it (404)
    if (id && client.value?.archivedAt === null) void agenda.refresh()
  },
  { immediate: true },
)
const nextPosts = computed(() =>
  archived.value ? [] : (agenda.data.value?.items ?? []).slice(0, 3),
)
const TYPE_ICON: Record<AgendaPost['type'], string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
const postThumb = (p: AgendaPost) =>
  p.thumbnail
    ? org.api(
        `/workspaces/${encodeURIComponent(p.workspaceId)}/media/${encodeURIComponent(p.thumbnail.mediaId)}/file/${p.thumbnail.variant}`,
      )
    : null
/** «Carosello · 3 file», «Foto», «Senza file» */
const postKind = (p: AgendaPost) => {
  if (p.mediaCount === 0) return t('posts.list.noType')
  const type = t(`posts.type.${p.type}`)
  return p.type === 'carousel' ? `${type} · ${t('client.files', { n: p.mediaCount })}` : type
}
const postWhen = (p: AgendaPost) => formatRelative(p.scheduledAt, { timeZone: p.timezone, now })
const postsPage = computed(() =>
  client.value ? org.to(`/spazi/${encodeURIComponent(client.value.slug)}/post`) : '',
)
const postPage = (p: AgendaPost) => `${postsPage.value}/${encodeURIComponent(p.id)}`
const platformsOf = (p: AgendaPost) => p.platforms as Platform[]

// ---- the actions
const done = useFlash()
const problem = ref<string | null>(null)
const busy = ref(false)
/** «Ricollega»: the connection of the profile, in the Integrazioni entry of its platform. */
const reconnectTo = (p: WorkspaceProfile) => ({
  path: org.to('/impostazioni/integrazioni/meta'),
  query: { ...context.value, ...(p.accounts[0] ? { account: p.accounts[0].id } : {}) },
})

async function change(remove: string[], add: string[], message: string) {
  const c = client.value
  if (!c || busy.value) return false
  busy.value = true
  problem.value = null
  done.value = null
  try {
    await call('POST', org.api(`/workspaces/${encodeURIComponent(c.id)}/accounts/replace`), {
      remove,
      add,
    })
    done.value = message
    return true
  } catch (e) {
    problem.value = failure(e).message
    return false
  } finally {
    busy.value = false
    await Promise.all([profiles.refresh(), refreshClients(), refreshWithoutClient()])
  }
}

// «Togli dal cliente», after a question
const removing = ref<WorkspaceProfile | null>(null)
const removeOpen = computed({
  get: () => removing.value !== null,
  set: (v) => {
    if (!v) removing.value = null
  },
})
async function remove() {
  const p = removing.value
  const c = client.value
  if (!p || !c) return
  removing.value = null
  await change(
    p.accounts.map((a) => a.id),
    [],
    t('client.removed', { name: profileName(p), client: c.name }),
  )
}

// «Sostituisci profilo» and «Aggiungi profilo»: a profile in no client
const picking = ref<{ replace: WorkspaceProfile | null } | null>(null)
const pickOpen = computed({
  get: () => picking.value !== null,
  set: (v) => {
    if (!v) picking.value = null
  },
})
async function picked(key: string) {
  const chosen = orphans.value.find((p) => p.key === key)
  const old = picking.value?.replace ?? null
  const c = client.value
  if (!chosen || !c) return
  const ok = await change(
    old ? old.accounts.map((a) => a.id) : [],
    chosen.accounts.map((a) => a.id),
    old
      ? t('client.replaced', { name: chosen.name, old: profileName(old) })
      : t('client.added', { name: chosen.name, client: c.name }),
  )
  if (ok) picking.value = null
}

function actions(p: WorkspaceProfile): DropdownMenuItem[][] {
  const groups: DropdownMenuItem[][] = []
  if (org.may.value.manageAccounts)
    groups.push([
      {
        label: t('workspaces.reconnect'),
        icon: 'i-lucide-link',
        onSelect: () => void navigateTo(reconnectTo(p)),
      },
    ])
  groups.push([
    {
      label: t('client.replace'),
      icon: 'i-lucide-replace',
      onSelect: () => (picking.value = { replace: p }),
    },
    {
      label: t('client.remove'),
      icon: 'i-lucide-unlink',
      color: 'error',
      onSelect: () => (removing.value = p),
    },
  ])
  return groups
}
const name = (p: WorkspaceProfile) => profileName(p)
const reconnects = (p: WorkspaceProfile) =>
  org.may.value.manageAccounts && stateOf(p).link === 'reconnect'

// ---- who works in it
const membersPath = computed(() =>
  client.value ? org.api(`/workspaces/${encodeURIComponent(client.value.id)}/members`) : '',
)
const {
  data: members,
  error: membersError,
  refresh: refreshMembers,
} = useFetch<{ items: Member[] }>(membersPath, {
  server: false,
  lazy: true,
  immediate: false,
  watch: false,
})
watch(
  membersPath,
  (p) => {
    if (p) void refreshMembers()
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-section" :data-ready="ready || undefined">
    <p v-if="done" role="status" class="text-sm text-(--app-success)">{{ done }}</p>
    <p v-if="problem && !pickOpen" role="alert" class="text-sm text-(--app-danger)">
      {{ problem }}
    </p>

    <div
      class="grid items-start gap-8 max-md:gap-7 min-[1360px]:grid-cols-[minmax(0,1fr)_340px]"
      data-overview
    >
      <div class="flex min-w-0 flex-col gap-8 max-md:gap-7">
        <!-- Prossimi post -->
        <section :aria-label="$t('client.nextPosts')" data-next-posts>
          <SectionHead :title="$t('client.nextPosts')">
            <NuxtLink
              v-if="postsPage"
              :to="postsPage"
              class="text-detail underline underline-offset-3"
              >{{ $t('client.allPosts') }}</NuxtLink
            >
          </SectionHead>
          <ListSkeleton
            v-if="
              !archived && (agenda.status.value === 'pending' || agenda.status.value === 'idle')
            "
            :label="$t('client.loadingPosts')"
            :rows="2"
            :action="false"
          />
          <p
            v-else-if="!archived && agenda.error.value"
            role="alert"
            class="flex min-h-row flex-wrap items-center gap-3 rounded-card border border-(--app-border) bg-(--app-surface) px-4"
          >
            <span class="flex-1">{{ $t('client.postsError') }}</span>
            <UButton color="neutral" variant="outline" @click="() => agenda.refresh()">
              {{ $t('account.retry') }}
            </UButton>
          </p>
          <p
            v-else-if="nextPosts.length === 0"
            class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
          >
            {{ $t('client.noNextPosts') }}
          </p>
          <ListSurface
            v-else
            columns="minmax(0, 1fr) 150px 56px 124px"
            :label="$t('client.nextPosts')"
          >
            <ListRow
              v-for="p in nextPosts"
              :key="p.id"
              class="max-md:grid-cols-[minmax(0,1fr)_auto]"
              :data-post="p.id"
            >
              <span class="flex min-w-0 items-center gap-3">
                <span
                  class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
                >
                  <img
                    v-if="postThumb(p)"
                    :src="postThumb(p)!"
                    alt=""
                    class="size-full object-cover"
                  />
                  <UIcon v-else :name="TYPE_ICON[p.type]" class="size-4" aria-hidden="true" />
                </span>
                <span class="min-w-0">
                  <NuxtLink
                    :to="postPage(p)"
                    class="block truncate font-medium underline-offset-3 hover:underline"
                    >{{ p.text || $t('posts.list.noText') }}</NuxtLink
                  >
                  <span class="block truncate text-detail text-(--app-text-muted)">
                    <span class="max-md:hidden">{{ postKind(p) }}</span>
                    <span class="md:hidden">{{ postWhen(p) }}</span>
                  </span>
                </span>
              </span>
              <span class="max-md:hidden">{{ postWhen(p) }}</span>
              <PlatformIcons :platforms="platformsOf(p)" class="max-md:hidden" />
              <StatusDot status="scheduled" :label="$t('posts.list.state.scheduled')" />
            </ListRow>
          </ListSurface>
        </section>

        <!-- Profili -->
        <section :aria-label="$t('client.profiles')" data-client-profiles>
          <SectionHead
            :title="$t('client.profiles')"
            :count="profiles.data.value ? list.length : null"
          >
            <UButton
              v-if="canChange && orphans.length > 0"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              @click="picking = { replace: null }"
            >
              {{ $t('client.add') }}
            </UButton>
          </SectionHead>
          <ListSkeleton
            v-if="!profiles.data.value && !profiles.error.value"
            :label="$t('client.loading')"
            :rows="2"
            :action="false"
          />
          <p
            v-else-if="profiles.error.value"
            role="alert"
            class="flex min-h-row flex-wrap items-center gap-3 rounded-card border border-(--app-border) bg-(--app-surface) px-4"
          >
            <span class="flex-1">{{ $t('workspaceAccounts.loadError') }}</span>
            <UButton color="neutral" variant="outline" @click="() => profiles.refresh()">
              {{ $t('account.retry') }}
            </UButton>
          </p>
          <EmptyState
            v-else-if="list.length === 0"
            icon="i-lucide-at-sign"
            :title="$t('client.noProfiles')"
            :text="
              archived
                ? $t('workspaceAccounts.emptyArchived')
                : canChange
                  ? orphans.length > 0
                    ? $t('client.noProfilesAdd')
                    : $t('client.noProfilesNone')
                  : $t('workspaceAccounts.emptyMember')
            "
          />
          <ListSurface
            v-else
            columns="minmax(0, 1fr) 150px 170px 110px 30px"
            :head="profileHead"
            :label="$t('client.profiles')"
          >
            <ListRow
              v-for="row in list"
              :key="row.key"
              class="max-md:grid-cols-[minmax(0,1fr)_auto_auto]"
              :data-profile="row.key"
            >
              <span role="cell" class="flex min-w-0 items-center gap-3">
                <PlatformIcons
                  :platforms="[mainOf(row).platform]"
                  class="shrink-0 text-(--app-text)"
                />
                <span class="min-w-0">
                  <span class="block truncate font-semibold">{{ handleOf(mainOf(row)) }}</span>
                  <span class="block truncate text-detail text-(--app-text-muted)">{{
                    kindOf(row)
                  }}</span>
                </span>
              </span>
              <span role="cell" class="tabular-nums max-md:hidden">{{
                quotaText(row) ?? '—'
              }}</span>
              <span
                role="cell"
                class="text-(--app-text-muted) max-md:hidden"
                :title="syncedOf(row) ? formatShort(syncedOf(row)!) : undefined"
                >{{ syncedText(row) }}</span
              >
              <span role="cell" class="min-w-0">
                <UButton
                  v-if="reconnects(row)"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :to="reconnectTo(row)"
                  :aria-label="$t('workspaces.reconnectOf', { name: name(row) })"
                >
                  {{ $t('workspaces.reconnect') }}
                </UButton>
                <StatusDot
                  v-else-if="stateOf(row).link !== 'ok'"
                  :tone="stateOf(row).tone"
                  :label="stateOf(row).label"
                />
              </span>
              <span role="cell" class="flex justify-end md:-me-2">
                <RowActions v-if="canChange" :name="name(row)" :items="actions(row)" />
              </span>
            </ListRow>
          </ListSurface>
        </section>
      </div>

      <div class="flex min-w-0 flex-col gap-8 max-md:gap-7">
        <RecentFiles v-if="client && usesLibrary(client)" :key="client.id" :workspace="client" />

        <!-- Chi ci lavora -->
        <section :aria-label="$t('client.people')" data-client-people>
          <SectionHead :title="$t('client.people')">
            <NuxtLink
              v-if="client"
              :to="org.to(`/spazi/${client.slug}/membri`)"
              class="text-detail underline underline-offset-3"
              >{{ $t('client.tabs.people') }}</NuxtLink
            >
          </SectionHead>
          <ListSkeleton
            v-if="!members && !membersError"
            :label="$t('client.loadingPeople')"
            :rows="2"
            :action="false"
          />
          <p v-else-if="membersError" role="alert" class="text-(--app-danger)">
            {{ failure(membersError).message }}
          </p>
          <p
            v-else-if="members && members.items.length === 0"
            class="rounded-card border border-(--app-border) bg-(--app-surface) px-4 py-4 text-(--app-text-muted)"
          >
            {{ $t('client.noPeople') }}
          </p>
          <ListSurface v-else-if="members" :label="$t('client.people')">
            <ListRow v-for="m in members.items" :key="m.userId" class="px-3.5">
              <span class="flex min-w-0 items-center gap-3">
                <Avatar kind="person" :name="m.displayName" :src="m.avatarUrl" />
                <span class="truncate font-medium">{{ m.displayName }}</span>
              </span>
              <span class="text-detail text-(--app-text-muted)">{{
                m.status === 'disabled'
                  ? `${$t(`roles.${m.role}`)} · ${$t('users.disabled')}`
                  : $t(`roles.${m.role}`)
              }}</span>
            </ListRow>
          </ListSurface>
        </section>
      </div>
    </div>

    <UModal
      v-model:open="removeOpen"
      :title="
        $t('client.removeTitle', {
          name: removing ? profileName(removing) : '',
          client: client?.name ?? '',
        })
      "
      :description="$t('client.removeText')"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton class="min-h-control" color="error" :loading="busy" @click="remove">
            {{ $t('client.remove') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="removing = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <ProfilePicker
      v-model:open="pickOpen"
      :title="
        picking?.replace
          ? $t('client.replaceTitle', { name: profileName(picking.replace) })
          : $t('client.addTitle', { client: client?.name ?? '' })
      "
      :description="picking?.replace ? $t('client.replaceHelp') : $t('client.addHelp')"
      :confirm="picking?.replace ? $t('client.replace') : $t('client.add')"
      :profiles="orphans"
      :busy="busy"
      :problem="pickOpen ? problem : null"
      @pick="picked"
    />
  </div>
</template>
