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

// ---- create
const name = ref('')
const creating = ref(false)
const createProblem = ref<string | null>(null)
async function create() {
  creating.value = true
  createProblem.value = null
  try {
    await call('POST', org.api('/workspaces'), { name: name.value })
    name.value = ''
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
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('workspaces.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('workspaces.explain') }}</p>
    </header>

    <form
      v-if="org.may.value.createWorkspace"
      class="flex flex-wrap items-end gap-3"
      novalidate
      @submit.prevent="create"
    >
      <UFormField
        :label="$t('workspaces.newName')"
        name="workspace-name"
        class="min-w-0 flex-1"
        :error="createProblem ?? undefined"
      >
        <UInput v-model="name" class="w-full" size="xl" />
      </UFormField>
      <UButton type="submit" class="min-h-11" icon="i-lucide-plus" :loading="creating">
        {{ $t('workspaces.create') }}
      </UButton>
    </form>

    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
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
    <ul v-else class="space-y-2" :aria-label="$t('workspaces.title')">
      <li
        v-for="w in active"
        :key="w.id"
        class="space-y-2 rounded-xl border border-(--app-border) bg-(--app-surface) p-4"
      >
        <form
          v-if="editing === w.id"
          class="flex flex-wrap items-end gap-2"
          novalidate
          @submit.prevent="rename(w)"
        >
          <UFormField :label="$t('workspaces.rename')" name="rename" class="min-w-0 flex-1">
            <UInput v-model="newName" class="w-full" size="xl" />
          </UFormField>
          <UButton type="submit" class="min-h-11">{{ $t('account.save') }}</UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="editing = null">
            {{ $t('security.cancel') }}
          </UButton>
        </form>
        <div v-else class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold">{{ w.name }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <RoleBadge :role="w.myRole" />
            <UButton
              v-if="canManageMembers(w)"
              class="min-h-11"
              color="neutral"
              variant="outline"
              :to="org.to(`/spazi/${w.slug}/membri`)"
              :aria-label="$t('workspaces.membersOf', { name: w.name })"
            >
              {{ $t('workspaces.members') }}
            </UButton>
            <template v-if="org.may.value.createWorkspace">
              <UButton
                class="min-h-11"
                color="neutral"
                variant="ghost"
                :aria-label="$t('workspaces.renameOf', { name: w.name })"
                @click="startRename(w)"
              >
                {{ $t('workspaces.rename') }}
              </UButton>
              <UButton
                class="min-h-11"
                color="neutral"
                variant="ghost"
                :aria-label="$t('workspaces.archiveOf', { name: w.name })"
                @click="archiving = w"
              >
                {{ $t('workspaces.archive') }}
              </UButton>
            </template>
          </div>
        </div>
        <p v-if="rowProblem?.id === w.id" role="alert" class="text-sm text-(--app-danger)">
          {{ rowProblem.message }}
        </p>
      </li>
    </ul>

    <section v-if="archived.length > 0" aria-labelledby="archived" class="space-y-2">
      <h2 id="archived" class="text-lg">{{ $t('workspaces.archivedTitle') }}</h2>
      <ul class="space-y-1 text-(--app-text-muted)">
        <li v-for="w in archived" :key="w.id">{{ w.name }}</li>
      </ul>
    </section>

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
