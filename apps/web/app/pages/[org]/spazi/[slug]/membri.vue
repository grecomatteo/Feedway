<script setup lang="ts">
definePageMeta({ layout: 'agency' })

interface WorkspaceMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: 'manager' | 'publisher' | 'editor' | 'viewer'
  status: 'active' | 'disabled'
}
interface OrgMember {
  id: string
  displayName: string
  status: 'active' | 'disabled'
  orgRole: 'owner' | 'admin' | 'member'
}

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const { data: spaces, status: spacesStatus } = useWorkspaces()

const workspace = computed(
  () => spaces.value?.items.find((w) => w.slug === route.params['slug']) ?? null,
)
const missing = computed(() => spacesStatus.value === 'success' && workspace.value === null)
useHead({ title: () => workspace.value?.name ?? t('workspaceMembers.title') })

const path = computed(() =>
  workspace.value ? org.api(`/workspaces/${encodeURIComponent(workspace.value.id)}/members`) : '',
)
const { data, error, refresh } = useFetch<{ items: WorkspaceMember[] }>(path, {
  server: false,
  lazy: true,
  immediate: false,
  watch: false,
})
watch(
  path,
  (p) => {
    if (p) void refresh()
  },
  { immediate: true },
)

// the people of the agency, to add one: only Owner and Admin read that list
const { data: orgMembers } = useFetch<{ items: OrgMember[] }>(() => org.api('/members'), {
  server: false,
  lazy: true,
  immediate: org.may.value.manageUsers,
})
const candidates = computed(() => {
  const inside = new Set((data.value?.items ?? []).map((m) => m.userId))
  return (orgMembers.value?.items ?? [])
    .filter((m) => m.status === 'active' && m.orgRole === 'member' && !inside.has(m.id))
    .map((m) => ({ value: m.id, label: m.displayName }))
})
const roleItems = computed(() =>
  (['manager', 'publisher', 'editor', 'viewer'] as const).map((r) => ({
    value: r,
    label: t(`roles.${r}`),
  })),
)

const add = reactive({ userId: '', role: 'editor' as WorkspaceMember['role'] })
const sending = ref(false)
const problem = ref<string | null>(null)
const done = ref<string | null>(null)
async function run(action: () => Promise<void>, message: string) {
  sending.value = true
  problem.value = null
  done.value = null
  try {
    await withReauth(action)
    done.value = message
    await refresh()
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
const addMember = () =>
  run(async () => {
    await call('POST', path.value, { userId: add.userId, role: add.role })
    add.userId = ''
  }, t('workspaceMembers.added'))
const changeRole = (m: WorkspaceMember, role: WorkspaceMember['role']) =>
  run(
    () =>
      call('PUT', `${path.value}/${encodeURIComponent(m.userId)}`, { role }).then(() => undefined),
    t('workspaceMembers.roleChanged', { name: m.displayName }),
  )
const remove = (m: WorkspaceMember) =>
  run(
    () => call('DELETE', `${path.value}/${encodeURIComponent(m.userId)}`).then(() => undefined),
    t('workspaceMembers.removed', { name: m.displayName }),
  )
const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <NuxtLink :to="org.to('/spazi')" class="text-sm text-(--app-text-muted) underline">
        {{ $t('workspaces.title') }}
      </NuxtLink>
      <h1 class="text-3xl">
        {{
          workspace
            ? $t('workspaceMembers.titleOf', { name: workspace.name })
            : $t('workspaceMembers.title')
        }}
      </h1>
    </header>

    <p v-if="missing" role="alert">{{ $t('workspaceMembers.missing') }}</p>
    <p v-else-if="!data && !error" role="status">{{ $t('account.loading') }}</p>
    <p v-else-if="error" role="alert" class="text-(--app-danger)">{{ failure(error).message }}</p>

    <template v-else-if="data">
      <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>
      <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>

      <EmptyState
        v-if="data.items.length === 0"
        :title="$t('workspaceMembers.empty')"
        icon="i-lucide-users"
      />
      <ul v-else class="space-y-2" :aria-label="$t('workspaceMembers.listLabel')">
        <li
          v-for="m in data.items"
          :key="m.userId"
          class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-3"
        >
          <span class="flex items-center gap-2">
            <UserAvatar :name="m.displayName" :src="m.avatarUrl" />
            <span>{{ m.displayName }}</span>
            <UBadge v-if="m.status === 'disabled'" color="neutral" variant="subtle">
              {{ $t('users.disabled') }}
            </UBadge>
          </span>
          <span class="flex flex-wrap items-center gap-2">
            <USelect
              :model-value="m.role"
              :items="roleItems"
              :aria-label="$t('workspaceMembers.roleOf', { name: m.displayName })"
              class="min-w-36"
              size="xl"
              :disabled="sending"
              @update:model-value="(r) => changeRole(m, r as WorkspaceMember['role'])"
            />
            <UButton
              class="min-h-11"
              color="neutral"
              variant="ghost"
              :disabled="sending"
              :aria-label="$t('workspaceMembers.removeOf', { name: m.displayName })"
              @click="remove(m)"
            >
              {{ $t('workspaceMembers.remove') }}
            </UButton>
          </span>
        </li>
      </ul>

      <section
        v-if="org.may.value.manageUsers"
        aria-labelledby="add-member"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="add-member" class="text-lg">{{ $t('workspaceMembers.addTitle') }}</h2>
        <p v-if="candidates.length === 0" class="text-sm text-(--app-text-muted)">
          {{ $t('workspaceMembers.noCandidates') }}
        </p>
        <form v-else class="flex flex-wrap items-end gap-3" novalidate @submit.prevent="addMember">
          <UFormField :label="$t('workspaceMembers.person')" name="person" class="min-w-48 flex-1">
            <USelect v-model="add.userId" :items="candidates" class="w-full" size="xl" />
          </UFormField>
          <UFormField :label="$t('workspaceMembers.role')" name="role">
            <USelect v-model="add.role" :items="roleItems" class="min-w-36" size="xl" />
          </UFormField>
          <UButton type="submit" class="min-h-11" :loading="sending" :disabled="add.userId === ''">
            {{ $t('workspaceMembers.add') }}
          </UButton>
        </form>
        <RoleExplainer />
      </section>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
