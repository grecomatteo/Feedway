<script setup lang="ts">
// Persone, a tab of the client's page ([slug].vue holds its head): everyone who sees the client
// reads who works in it; Owner, Admin and the client's Manager change it (spec §10.2).

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
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const { client: workspace } = useClientPage()
useHead({
  title: () =>
    workspace.value
      ? t('workspaceMembers.titleOf', { name: workspace.value.name })
      : t('workspaceMembers.title'),
})
const canManage = computed(
  () =>
    (org.may.value.manageUsers || workspace.value?.myRole === 'manager') &&
    workspace.value?.archivedAt === null,
)

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
const done = useFlash()
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
  <div class="flex flex-col gap-section">
    <h2 class="sr-only">{{ $t('client.tabs.people') }}</h2>
    <ListSkeleton
      v-if="!data && !error"
      :label="$t('client.loadingPeople')"
      :rows="2"
      :action="false"
    />
    <p v-else-if="error" role="alert" class="text-(--app-danger)">{{ failure(error).message }}</p>

    <template v-else-if="data">
      <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>
      <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>

      <EmptyState
        v-if="data.items.length === 0"
        :title="$t('workspaceMembers.empty')"
        icon="i-lucide-users"
      />
      <ListSurface v-else :label="$t('workspaceMembers.listLabel')">
        <ListRow
          v-for="m in data.items"
          :key="m.userId"
          class="max-md:py-2"
          :class="canManage ? 'max-sm:grid-cols-1 max-sm:gap-y-2' : ''"
          :data-member="m.userId"
        >
          <span class="flex min-w-0 items-center gap-3">
            <Avatar kind="person" :name="m.displayName" :src="m.avatarUrl" />
            <span class="truncate font-medium">{{ m.displayName }}</span>
            <StatusDot v-if="m.status === 'disabled'" :label="$t('users.disabled')" />
          </span>
          <span v-if="canManage" class="flex items-center justify-end gap-2">
            <USelect
              :model-value="m.role"
              :items="roleItems"
              :aria-label="$t('workspaceMembers.roleOf', { name: m.displayName })"
              class="w-36 max-sm:flex-1"
              :disabled="sending"
              @update:model-value="(r) => changeRole(m, r as WorkspaceMember['role'])"
            />
            <RowActions
              :name="m.displayName"
              :items="[
                {
                  label: $t('workspaceMembers.remove'),
                  icon: 'i-lucide-user-minus',
                  color: 'error',
                  disabled: sending,
                  onSelect: () => remove(m),
                },
              ]"
            />
          </span>
          <span v-else class="text-detail text-(--app-text-muted)">{{
            $t(`roles.${m.role}`)
          }}</span>
        </ListRow>
      </ListSurface>

      <section
        v-if="org.may.value.manageUsers && workspace?.archivedAt === null"
        :aria-label="$t('workspaceMembers.addTitle')"
      >
        <SectionHead :title="$t('workspaceMembers.addTitle')" :level="3" />
        <div class="space-y-3 rounded-card border border-(--app-border) bg-(--app-surface) p-4">
          <p v-if="candidates.length === 0" class="text-detail text-(--app-text-muted)">
            {{ $t('workspaceMembers.noCandidates') }}
          </p>
          <form
            v-else
            class="flex flex-wrap items-end gap-3"
            novalidate
            @submit.prevent="addMember"
          >
            <UFormField
              :label="$t('workspaceMembers.person')"
              name="person"
              class="min-w-48 flex-1"
            >
              <USelect v-model="add.userId" :items="candidates" class="w-full" />
            </UFormField>
            <UFormField :label="$t('workspaceMembers.role')" name="role">
              <USelect v-model="add.role" :items="roleItems" class="w-36" />
            </UFormField>
            <UButton
              type="submit"
              color="neutral"
              variant="outline"
              :loading="sending"
              :disabled="add.userId === ''"
            >
              {{ $t('workspaceMembers.add') }}
            </UButton>
          </form>
          <!-- what each role may do, on request: the names alone say enough most of the time -->
          <details class="text-detail">
            <summary
              class="cursor-pointer text-(--app-text-muted) select-none hover:text-(--app-text)"
            >
              {{ $t('workspaceMembers.rolesHelp') }}
            </summary>
            <RoleExplainer class="mt-2" />
          </details>
        </div>
      </section>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
