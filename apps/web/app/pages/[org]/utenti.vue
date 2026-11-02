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
  secondFactorConfigured: boolean
  workspaces: { id: string; name: string; role: WorkspaceRole }[]
  lastLoginAt: string | null
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

function rolesText(m: Member): string {
  if (m.orgRole !== 'member') return t('users.allClients')
  if (m.workspaces.length === 0) return t('users.noClients')
  return m.workspaces
    .map((w) => t('users.roleIn', { role: t(`roles.${w.role}`), name: w.name }))
    .join(', ')
}

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

const roleItems = computed(() => [
  { value: 'member', label: t('roles.member') },
  { value: 'admin', label: t('roles.admin') },
])

// ---- invite
const inviteOpen = ref(false)
const NONE = 'none'
const invite = reactive({
  email: '',
  orgRole: 'member' as 'member' | 'admin',
  roles: {} as Record<string, WorkspaceRole | typeof NONE>,
})
const inviteState = reactive({ sending: false, problem: null as string | null, field: '' })
const workspaceRoleItems = computed(() => [
  { value: NONE, label: t('users.invite.noAccess') },
  ...(['manager', 'publisher', 'editor', 'viewer'] as const).map((r) => ({
    value: r,
    label: t(`roles.${r}`),
  })),
])
const activeSpaces = computed(() =>
  (spaces.value?.items ?? []).filter((w) => w.archivedAt === null),
)
watch(inviteOpen, (open) => {
  if (!open) return
  Object.assign(invite, { email: '', orgRole: 'member', roles: {} })
  Object.assign(inviteState, { problem: null, field: '' })
})
async function sendInvite() {
  inviteState.sending = true
  inviteState.problem = null
  try {
    const memberships =
      invite.orgRole === 'member'
        ? Object.entries(invite.roles)
            .filter(([, role]) => role !== NONE)
            .map(([workspaceId, role]) => ({ workspaceId, role }))
        : []
    // inviting an Admin is sensitive: the server asks for a recent confirmation
    await withReauth(async () => {
      await call('POST', org.api('/invites'), {
        email: invite.email.trim(),
        orgRole: invite.orgRole,
        memberships,
      })
    })
    done.value = t('users.invite.sent', { email: invite.email.trim() })
    inviteOpen.value = false
    await refreshInvites()
  } catch (e) {
    if (e instanceof ReauthCancelled) return
    const f = failure(e)
    inviteState.problem = f.message
    inviteState.field = f.field ?? ''
  } finally {
    inviteState.sending = false
  }
}

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
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-3xl">{{ $t('users.title') }}</h1>
        <p v-if="data" class="text-(--app-text-muted)">
          {{
            $t('users.count', { people: data.items.length, invites: invites?.items.length ?? 0 })
          }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="isOwner"
          class="min-h-11"
          color="neutral"
          variant="outline"
          @click="transferOpen = true"
        >
          {{ $t('transfer.button') }}
        </UButton>
        <UButton class="min-h-11" icon="i-lucide-user-plus" @click="inviteOpen = true">
          {{ $t('users.invite.button') }}
        </UButton>
      </div>
    </header>

    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>
    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <CopyLinkField
      v-if="resetUrl"
      :url="resetUrl.url"
      :label="$t('users.resetLinkFor', { name: resetUrl.name })"
    />

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <div
      v-else-if="data"
      class="relative overflow-x-auto rounded-xl border border-(--app-border) bg-(--app-surface)"
    >
      <table class="w-full min-w-[44rem] text-left text-sm">
        <caption class="sr-only">
          {{
            $t('users.title')
          }}
        </caption>
        <thead class="bg-(--app-surface-sunken) text-(--app-text-muted)">
          <tr>
            <th scope="col" class="px-4 py-2 font-normal">{{ $t('users.col.person') }}</th>
            <th scope="col" class="px-4 py-2 font-normal">{{ $t('users.col.agency') }}</th>
            <th scope="col" class="px-4 py-2 font-normal">{{ $t('users.col.clients') }}</th>
            <th scope="col" class="px-4 py-2 font-normal">{{ $t('users.col.status') }}</th>
            <th scope="col" class="px-4 py-2 font-normal">{{ $t('users.col.lastLogin') }}</th>
            <th scope="col" class="px-4 py-2 font-normal">
              <span class="sr-only">{{ $t('users.col.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in data.items" :key="m.id" class="border-t border-(--app-border)">
            <th scope="row" class="px-4 py-2 font-normal">
              <span class="flex items-center gap-2">
                <UserAvatar :name="m.displayName" :src="m.avatarUrl" />
                <span>
                  <span class="block font-semibold">{{ m.displayName }}</span>
                  <span class="block text-(--app-text-muted)">{{ m.email }}</span>
                </span>
              </span>
            </th>
            <td class="px-4 py-2">
              <USelect
                v-if="isOwner && m.orgRole !== 'owner' && m.id !== myId"
                :model-value="m.orgRole"
                :items="roleItems"
                :aria-label="$t('users.roleOf', { name: m.displayName })"
                size="xl"
                class="min-w-32"
                :disabled="busy !== null"
                @update:model-value="(r) => changeRole(m, r as 'admin' | 'member')"
              />
              <span v-else>{{ $t(`roles.${m.orgRole}`) }}</span>
            </td>
            <td class="px-4 py-2">{{ rolesText(m) }}</td>
            <td class="px-4 py-2">
              <UBadge :color="m.status === 'active' ? 'success' : 'neutral'" variant="subtle">
                {{ m.status === 'active' ? $t('users.active') : $t('users.disabled') }}
              </UBadge>
            </td>
            <td class="px-4 py-2">
              {{ m.lastLoginAt ? formatDate(m.lastLoginAt, true) : $t('users.never') }}
            </td>
            <td class="px-4 py-2">
              <div
                v-if="m.id !== myId && m.orgRole !== 'owner'"
                class="flex flex-wrap justify-end gap-1"
              >
                <UButton
                  class="min-h-11"
                  color="neutral"
                  variant="ghost"
                  :disabled="busy !== null"
                  :aria-label="$t('users.resetOf', { name: m.displayName })"
                  @click="resetLink(m)"
                >
                  {{ $t('users.reset') }}
                </UButton>
                <UButton
                  v-if="m.status === 'active'"
                  class="min-h-11"
                  color="error"
                  variant="ghost"
                  :disabled="busy !== null"
                  :aria-label="$t('users.disableOf', { name: m.displayName })"
                  @click="disable(m)"
                >
                  {{ $t('users.disable') }}
                </UButton>
                <UButton
                  v-else
                  class="min-h-11"
                  color="neutral"
                  variant="ghost"
                  :disabled="busy !== null"
                  :aria-label="$t('users.enableOf', { name: m.displayName })"
                  @click="enable(m)"
                >
                  {{ $t('users.enable') }}
                </UButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section
      v-if="invites && invites.items.length > 0"
      aria-labelledby="open-invites"
      class="space-y-2"
    >
      <h2 id="open-invites" class="text-lg">{{ $t('users.invitesTitle') }}</h2>
      <ul class="space-y-2">
        <li
          v-for="i in invites.items"
          :key="i.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-(--app-border) bg-(--app-surface) p-3"
        >
          <span>
            <span class="font-semibold">{{ i.email }}</span>
            <span class="block text-sm text-(--app-text-muted)">
              {{ $t(`roles.${i.orgRole}`) }}
              <template v-if="i.memberships.length > 0">
                ·
                {{
                  i.memberships
                    .map((ms) =>
                      $t('users.roleIn', {
                        role: $t(`roles.${ms.role}`),
                        name: spaceName(ms.workspaceId),
                      }),
                    )
                    .join(', ')
                }}
              </template>
              · {{ $t('users.inviteExpires', { when: formatDate(i.expiresAt, true) }) }}
            </span>
          </span>
          <span class="flex gap-1">
            <UButton
              class="min-h-11"
              color="neutral"
              variant="ghost"
              :disabled="busy !== null"
              :aria-label="$t('users.resendOf', { email: i.email })"
              @click="resend(i)"
            >
              {{ $t('users.resend') }}
            </UButton>
            <UButton
              class="min-h-11"
              color="neutral"
              variant="ghost"
              :disabled="busy !== null"
              :aria-label="$t('users.revokeOf', { email: i.email })"
              @click="revoke(i)"
            >
              {{ $t('users.revoke') }}
            </UButton>
          </span>
        </li>
      </ul>
    </section>

    <UModal
      v-model:open="inviteOpen"
      :title="$t('users.invite.title')"
      :description="$t('users.invite.explain')"
    >
      <template #body>
        <form class="space-y-4" novalidate @submit.prevent="sendInvite">
          <UFormField
            :label="$t('signIn.email')"
            name="invite-email"
            required
            :error="inviteState.field === 'email' ? (inviteState.problem ?? undefined) : undefined"
          >
            <UInput
              v-model="invite.email"
              type="email"
              autocomplete="off"
              class="w-full"
              size="xl"
            />
          </UFormField>
          <UFormField :label="$t('users.invite.agencyRole')" name="invite-role">
            <URadioGroup
              v-model="invite.orgRole"
              :items="[
                {
                  value: 'member',
                  label: $t('roles.member'),
                  description: $t('roleExplain.member'),
                },
                { value: 'admin', label: $t('roles.admin'), description: $t('roleExplain.admin') },
              ]"
              :ui="{ item: 'min-h-11 items-start py-1' }"
            />
          </UFormField>
          <fieldset v-if="invite.orgRole === 'member'" class="space-y-3">
            <legend class="text-sm font-medium">{{ $t('users.invite.clients') }}</legend>
            <p v-if="activeSpaces.length === 0" class="text-sm text-(--app-text-muted)">
              {{ $t('users.invite.noClients') }}
            </p>
            <UFormField
              v-for="w in activeSpaces"
              :key="w.id"
              :label="w.name"
              :name="`role-${w.id}`"
            >
              <USelect
                :model-value="invite.roles[w.id] ?? NONE"
                :items="workspaceRoleItems"
                class="w-full"
                size="xl"
                @update:model-value="(r) => (invite.roles[w.id] = r as WorkspaceRole)"
              />
            </UFormField>
            <RoleExplainer />
          </fieldset>
          <p
            v-if="inviteState.problem && inviteState.field !== 'email'"
            role="alert"
            class="text-(--app-danger)"
          >
            {{ inviteState.problem }}
          </p>
          <div class="flex flex-wrap gap-3">
            <UButton type="submit" class="min-h-11" :loading="inviteState.sending">
              {{ $t('users.invite.send') }}
            </UButton>
            <UButton class="min-h-11" color="neutral" variant="ghost" @click="inviteOpen = false">
              {{ $t('security.cancel') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <TransferOwnershipDialog
      v-model:open="transferOpen"
      :candidates="transferCandidates"
      :with-reauth="withReauth"
      :path="org.api('/ownership-transfer')"
      @done="transferred"
    />
    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </div>
</template>
