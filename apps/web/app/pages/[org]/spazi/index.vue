<script setup lang="ts">
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { data, status, error, refresh } = useWorkspaces()

useHead({ title: () => t('workspaces.title') })

const active = computed(() => (data.value?.items ?? []).filter((w) => w.archivedAt === null))
const archived = computed(() => (data.value?.items ?? []).filter((w) => w.archivedAt !== null))
const canManageMembers = (w: WorkspaceView) => org.may.value.manageUsers || w.myRole === 'manager'

// ---- create: the field opens on request, as the first row of the list
const adding = ref(false)
const name = ref('')
const creating = ref(false)
const createProblem = ref<string | null>(null)
function startAdding() {
  adding.value = true
  createProblem.value = null
}
function stopAdding() {
  adding.value = false
  name.value = ''
  createProblem.value = null
}
async function create() {
  creating.value = true
  createProblem.value = null
  try {
    await call('POST', org.api('/workspaces'), { name: name.value })
    stopAdding()
    await refresh()
  } catch (e) {
    createProblem.value = failure(e).message
  } finally {
    creating.value = false
  }
}

// ---- rename and archive
const editing = ref<string | null>(null)
const newName = ref('')
const rowProblem = ref<{ id: string; message: string } | null>(null)
const done = ref<string | null>(null)
function startRename(w: WorkspaceView) {
  editing.value = w.id
  newName.value = w.name
  rowProblem.value = null
}
async function rename(w: WorkspaceView) {
  try {
    await call('PATCH', org.api(`/workspaces/${encodeURIComponent(w.id)}`), { name: newName.value })
    editing.value = null
    done.value = t('workspaces.renamed')
    await refresh()
  } catch (e) {
    rowProblem.value = { id: w.id, message: failure(e).message }
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
  try {
    await call('POST', org.api(`/workspaces/${encodeURIComponent(w.id)}/archive`))
    done.value = t('workspaces.archived', { name: w.name })
    archiving.value = null
    await refresh()
  } catch (e) {
    rowProblem.value = { id: w.id, message: failure(e).message }
    archiving.value = null
  }
}

// ---- one visible action per row, the others in «⋯»
function moreActions(w: WorkspaceView) {
  const groups: { label: string; icon: string; color?: 'error'; onSelect: () => void }[][] = []
  if (canManageMembers(w))
    groups.push([
      {
        label: t('workspaces.members'),
        icon: 'i-lucide-users',
        onSelect: () => void navigateTo(org.to(`/spazi/${w.slug}/membri`)),
      },
    ])
  if (org.may.value.createWorkspace) {
    groups.push([
      { label: t('workspaces.rename'), icon: 'i-lucide-pencil', onSelect: () => startRename(w) },
    ])
    groups.push([
      {
        label: t('workspaces.archive'),
        icon: 'i-lucide-archive',
        color: 'error',
        onSelect: () => (archiving.value = w),
      },
    ])
  }
  return groups
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div class="min-w-0 space-y-1">
        <h1 class="text-3xl">{{ $t('workspaces.title') }}</h1>
        <p class="text-(--app-text-muted)">{{ $t('workspaces.explain') }}</p>
      </div>
      <UButton
        v-if="org.may.value.createWorkspace && !adding"
        class="min-h-11"
        icon="i-lucide-plus"
        @click="startAdding"
      >
        {{ $t('workspaces.new') }}
      </UButton>
    </header>

    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <form
      v-if="adding"
      class="flex flex-wrap items-end gap-3 rounded-xl border border-(--app-border-strong) bg-(--app-surface) p-4"
      novalidate
      @submit.prevent="create"
    >
      <UFormField
        :label="$t('workspaces.newName')"
        name="workspace-name"
        class="min-w-48 flex-1"
        :error="createProblem ?? undefined"
      >
        <UInput v-model="name" class="w-full" size="xl" autofocus />
      </UFormField>
      <div class="flex gap-2">
        <UButton type="submit" class="min-h-11" :loading="creating">
          {{ $t('workspaces.create') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="stopAdding">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </form>

    <ListSkeleton
      v-if="status === 'pending' || status === 'idle'"
      :label="$t('workspaces.loading')"
      :rows="4"
    />
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <EmptyState
      v-else-if="active.length === 0"
      :title="$t('workspaces.empty')"
      :text="
        org.may.value.createWorkspace ? $t('workspaces.emptyCreate') : $t('workspaces.emptyAsk')
      "
      icon="i-lucide-briefcase"
    />
    <ul
      v-else
      class="divide-y divide-(--app-border) rounded-xl border border-(--app-border) bg-(--app-surface)"
      :aria-label="$t('workspaces.title')"
    >
      <li v-for="w in active" :key="w.id" class="px-4 py-2">
        <form
          v-if="editing === w.id"
          class="flex flex-wrap items-end gap-2 py-2"
          novalidate
          @submit.prevent="rename(w)"
        >
          <UFormField :label="$t('workspaces.rename')" name="rename" class="min-w-48 flex-1">
            <UInput v-model="newName" class="w-full" size="xl" autofocus />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" class="min-h-11">{{ $t('account.save') }}</UButton>
            <UButton class="min-h-11" color="neutral" variant="ghost" @click="editing = null">
              {{ $t('security.cancel') }}
            </UButton>
          </div>
        </form>
        <div v-else class="flex min-h-12 items-center gap-3">
          <RowAvatar :name="w.name" />
          <div class="min-w-0 flex-1">
            <NuxtLink
              :to="org.to(`/spazi/${w.slug}/account`)"
              class="block truncate font-semibold hover:underline"
            >
              {{ w.name }}
            </NuxtLink>
            <p class="truncate text-sm text-(--app-text-muted)">
              {{ $t('workspaces.yourRole', { role: $t(`roles.${w.myRole}`) }) }}
            </p>
          </div>
          <UButton
            class="min-h-11 min-w-11 justify-center"
            color="neutral"
            variant="outline"
            icon="i-lucide-at-sign"
            :to="org.to(`/spazi/${w.slug}/account`)"
            :aria-label="$t('workspaces.accountsOf', { name: w.name })"
          >
            <span class="hidden sm:inline">{{ $t('workspaces.accounts') }}</span>
          </UButton>
          <UDropdownMenu
            v-if="moreActions(w).length > 0"
            :items="moreActions(w)"
            :content="{ align: 'end' }"
          >
            <UButton
              class="min-h-11 min-w-11 justify-center"
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              :aria-label="$t('workspaces.moreOf', { name: w.name })"
            />
          </UDropdownMenu>
        </div>
        <p v-if="rowProblem?.id === w.id" role="alert" class="pb-2 text-sm text-(--app-danger)">
          {{ rowProblem.message }}
        </p>
      </li>
    </ul>

    <details
      v-if="archived.length > 0"
      class="group rounded-xl border border-(--app-border) bg-(--app-surface-sunken)"
    >
      <summary
        class="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <h2 class="text-base">
          {{ $t('workspaces.archivedCount', { n: archived.length }) }}
        </h2>
      </summary>
      <ul class="divide-y divide-(--app-border) border-t border-(--app-border)">
        <li
          v-for="w in archived"
          :key="w.id"
          class="flex min-h-16 items-center gap-3 px-4 py-2 text-(--app-text-muted)"
        >
          <RowAvatar :name="w.name" />
          <span class="min-w-0 flex-1 truncate">{{ w.name }}</span>
        </li>
      </ul>
    </details>

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
