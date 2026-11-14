<script setup lang="ts">
import type { ClientProfile } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DataColumn } from '~/components/DataTable.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

/**
 * Panoramica of the client's page (spec §14.7, plan 04 Task 6a): its profiles with their state,
 * quota and last sync, and the people who work in it. Owner and Admin act on the profiles from
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
const { t, locale } = useI18n()
const { call, failure } = useApi()
const ready = useHydrated()
const { client, profiles, refreshClients } = useClientPage()
const { data: withoutClient, refresh: refreshWithoutClient } = useProfilesWithoutClient()

const list = computed(() => profiles.data.value?.items ?? [])
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

const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const iconOf = (platform: string) => PLATFORM_ICON[platform] ?? 'i-lucide-at-sign'
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const handles = (p: WorkspaceProfile) => p.accounts.map(handleOf).join(' · ')

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
/** «2 ore fa», «ieri»: how long ago, in the person's language. */
const ago = (iso: string) => {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  for (const [unit, size] of [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ] as const)
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  return rtf.format(0, 'minute')
}
const syncedText = (p: WorkspaceProfile) => {
  const d = syncedOf(p)
  return d ? ago(d) : t('client.neverSynced')
}
/** On a phone: the handles, then the quota and the last sync, short. */
const detailOf = (p: WorkspaceProfile) =>
  [
    handles(p),
    quotaText(p),
    syncedOf(p) ? t('client.syncedShort', { when: syncedText(p) }) : t('client.neverSynced'),
  ]
    .filter(Boolean)
    .join(' · ')

const columns = computed<DataColumn[]>(() => [
  { key: 'profile', label: t('client.column.profile') },
  { key: 'state', label: t('client.column.state') },
  { key: 'quota', label: t('client.column.quota') },
  { key: 'synced', label: t('client.column.synced') },
  {
    key: 'actions',
    label: t('workspaces.column.actions'),
    hideLabel: true,
    align: 'end',
    class: 'w-px px-2 whitespace-nowrap',
  },
])

// ---- the actions
const done = ref<string | null>(null)
const problem = ref<string | null>(null)
const busy = ref(false)
const integrations = computed(() => org.to('/impostazioni/integrazioni'))

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
        onSelect: () => void navigateTo(integrations.value),
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
const canManageMembers = computed(
  () => org.may.value.manageUsers || client.value?.myRole === 'manager',
)
</script>

<template>
  <div class="space-y-8" :data-ready="ready || undefined">
    <p v-if="done" role="status" class="text-sm text-(--app-success)">{{ done }}</p>
    <p v-if="problem && !pickOpen" role="alert" class="text-sm text-(--app-danger)">
      {{ problem }}
    </p>

    <section aria-labelledby="client-profiles" class="space-y-3">
      <div class="flex min-h-11 items-center justify-between gap-3">
        <h2 id="client-profiles" class="text-lg">{{ $t('client.profiles') }}</h2>
        <UButton
          v-if="canChange && orphans.length > 0"
          class="min-h-11"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          @click="picking = { replace: null }"
        >
          {{ $t('client.add') }}
        </UButton>
      </div>

      <TableSkeleton
        v-if="!profiles.data.value && !profiles.error.value"
        :label="$t('client.loading')"
        :columns="[
          $t('client.column.profile'),
          $t('client.column.state'),
          $t('client.column.quota'),
          $t('client.column.synced'),
        ]"
        :rows="2"
      />
      <div
        v-else-if="profiles.error.value"
        role="alert"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-card) p-5"
      >
        <p>{{ $t('workspaceAccounts.loadError') }}</p>
        <UButton
          class="min-h-11"
          color="neutral"
          variant="outline"
          @click="() => profiles.refresh()"
        >
          {{ $t('account.retry') }}
        </UButton>
      </div>
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
      <DataTable
        v-else
        :caption="$t('client.profiles')"
        :columns="columns"
        :rows="list"
        :row-key="(p) => p.key"
      >
        <template #cell-profile="{ row }">
          <span class="flex min-w-0 items-center gap-3">
            <RowAvatar :name="name(row)" :src="profilePhoto(row)" />
            <span class="min-w-0">
              <span class="block truncate text-[0.9375rem] font-semibold">{{ name(row) }}</span>
              <span class="flex gap-x-3 text-[0.8125rem] text-(--app-text-muted)">
                <span
                  v-for="a in row.accounts"
                  :key="a.id"
                  class="inline-flex min-w-0 items-center gap-1"
                >
                  <UIcon :name="iconOf(a.platform)" class="size-3.5 shrink-0" aria-hidden="true" />
                  <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
                  <span class="truncate">{{ handleOf(a) }}</span>
                </span>
              </span>
            </span>
          </span>
        </template>
        <template #cell-state="{ row }">
          <StatusDot :tone="stateOf(row).tone" :label="stateOf(row).label" />
        </template>
        <template #cell-quota="{ row }">
          <span class="text-(--app-text-muted) tabular-nums">{{ quotaText(row) ?? '—' }}</span>
        </template>
        <template #cell-synced="{ row }">
          <span
            class="text-(--app-text-muted)"
            :title="syncedOf(row) ? new Date(syncedOf(row)!).toLocaleString(locale) : undefined"
            >{{ syncedText(row) }}</span
          >
        </template>
        <template #cell-actions="{ row }">
          <span class="flex items-center justify-end gap-1">
            <UButton
              v-if="org.may.value.manageAccounts && stateOf(row).link === 'reconnect'"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :to="integrations"
              :aria-label="$t('workspaces.reconnectOf', { name: name(row) })"
            >
              {{ $t('workspaces.reconnect') }}
            </UButton>
            <RowActions v-if="canChange" :name="name(row)" :items="actions(row)" />
          </span>
        </template>
        <template #mobile="{ row }">
          <DataRow :name="name(row)" :src="profilePhoto(row)" :detail="detailOf(row)">
            <template v-if="stateOf(row).link !== 'ok'" #detail>
              <span class="flex min-w-0 items-center gap-2">
                <StatusDot :tone="stateOf(row).tone" :label="stateOf(row).label" />
                <span class="truncate">{{ detailOf(row) }}</span>
              </span>
            </template>
            <template v-if="canChange" #actions>
              <RowActions :name="name(row)" :items="actions(row)" />
            </template>
          </DataRow>
        </template>
      </DataTable>
    </section>

    <section aria-labelledby="client-people" class="space-y-3">
      <div class="flex min-h-11 items-center justify-between gap-3">
        <h2 id="client-people" class="text-lg">{{ $t('client.people') }}</h2>
        <UButton
          v-if="canManageMembers && client"
          class="min-h-11"
          color="neutral"
          variant="ghost"
          trailing-icon="i-lucide-arrow-right"
          :to="org.to(`/spazi/${client.slug}/membri`)"
        >
          {{ $t('client.managePeople') }}
        </UButton>
      </div>
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
        class="rounded-xl border border-(--app-border) bg-(--app-card) px-4 py-5 text-(--app-text-muted)"
      >
        {{ $t('client.noPeople') }}
      </p>
      <DataList v-else-if="members" :label="$t('client.people')">
        <DataRow
          v-for="m in members.items"
          :key="m.userId"
          :name="m.displayName"
          :detail="
            m.status === 'disabled'
              ? `${$t(`roles.${m.role}`)} · ${$t('users.disabled')}`
              : $t(`roles.${m.role}`)
          "
        >
          <template #avatar><UserAvatar :name="m.displayName" :src="m.avatarUrl" /></template>
        </DataRow>
      </DataList>
    </section>

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
          <UButton class="min-h-11" color="error" :loading="busy" @click="remove">
            {{ $t('client.remove') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="removing = null">
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
