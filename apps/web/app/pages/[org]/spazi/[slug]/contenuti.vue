<script setup lang="ts">
import type { AccountGroupDto, CaptionTemplateDto, LabelDto } from '@app/contracts'
import { selectable } from '~/composables/usePostEditor'

/**
 * «Impostazioni dei contenuti», a tab of the client's page (spec §11.7, plan 06 Task 7, design
 * E8): the time new posts start from, the labels, the caption templates and the account groups.
 * The client's Manager and above change them (`workspace.content_settings.manage`); anyone else
 * who opens the address reads them. The time zone is the agency's, chosen by the Owner (D-58).
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const flash = useFlash()
const { client, profiles, refreshClients } = useClientPage()

useHead({
  title: () =>
    client.value
      ? t('contentSettings.titleOf', { name: client.value.name })
      : t('contentSettings.title'),
})

const clientId = computed(() => client.value?.id ?? null)
const settings = useContentSettings(clientId)
const { labels, templates, groups, failed, base } = settings
const manages = computed(
  () =>
    client.value !== null &&
    ['owner', 'admin', 'manager'].includes(client.value.myRole) &&
    !client.value.archivedAt,
)
const problem = ref<string | null>(null)

// ---- the default time of new posts
const time = ref('')
watch(
  () => client.value?.defaultPostTime,
  (v) => (time.value = v ?? ''),
  { immediate: true },
)
const timeState = ref<'idle' | 'saving' | 'saved'>('idle')
const timeProblem = ref<string | null>(null)
async function saveTime(value: string | null) {
  if (!client.value) return
  timeState.value = 'saving'
  timeProblem.value = null
  try {
    await call('PATCH', org.api(`/workspaces/${encodeURIComponent(client.value.id)}`), {
      defaultPostTime: value,
    })
    await refreshClients()
    timeState.value = 'saved'
  } catch (e) {
    timeProblem.value = failure(e).message
    timeState.value = 'idle'
  }
}
const timeChanged = computed(() => (client.value?.defaultPostTime ?? '') !== time.value)
// the agency's zone, for whoever may read the agency's settings (Owner and Admin); a Manager
// cannot, and is told «the agency's zone» rather than a zone that may be wrong
const zone = ref<string | null>(null)
onMounted(async () => {
  try {
    zone.value = (await call<{ timezone: string }>('GET', org.api('/settings'))).timezone
  } catch {
    zone.value = null
  }
})
const zoneText = computed(() => {
  if (!zone.value) return t('contentSettings.time.agency')
  if (zone.value === 'Europe/Rome') return t('contentSettings.time.rome')
  return t('contentSettings.time.zone', { zone: zone.value.replaceAll('_', ' ') })
})

// ---- the accounts, to say who a group holds
const accounts = computed(
  () =>
    new Map(
      (profiles.data.value?.items ?? []).flatMap((p) => p.accounts.map((a) => [a.id, a] as const)),
    ),
)
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const membersOf = (g: AccountGroupDto) =>
  g.accountIds
    .map((id) => accounts.value.get(id))
    .filter((a): a is ProfileAccount => a !== undefined)
    .map(handleOf)
    .join(' · ')
/** What a group skips today: accounts that left the client, accounts to reconnect. */
function groupState(g: AccountGroupDto): string | null {
  if (g.unavailableAccountIds.length > 0)
    return t(
      'contentSettings.groups.gone',
      { n: g.unavailableAccountIds.length },
      g.unavailableAccountIds.length,
    )
  const off = g.accountIds.filter((id) => {
    const a = accounts.value.get(id)
    return a !== undefined && !selectable(a)
  }).length
  return off > 0 ? t('contentSettings.groups.reconnect', { n: off }, off) : null
}

const labelCount = computed(() => {
  const list = labels.value ?? []
  const posts = list.reduce((n, l) => n + l.postCount, 0)
  return t('contentSettings.labels.count', { n: list.length, posts }, list.length)
})
const TEMPLATE_ICON: Record<CaptionTemplateDto['kind'], string> = {
  signature: 'i-lucide-signature',
  hashtags: 'i-lucide-hash',
  caption: 'i-lucide-file-text',
}
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

// ---- dialogs
const labelOpen = ref(false)
const editingLabel = ref<LabelDto | null>(null)
const templateOpen = ref(false)
const editingTemplate = ref<CaptionTemplateDto | null>(null)
const groupOpen = ref(false)
const editingGroup = ref<AccountGroupDto | null>(null)
function openLabel(l: LabelDto | null) {
  editingLabel.value = l
  labelOpen.value = true
}
function openTemplate(x: CaptionTemplateDto | null) {
  editingTemplate.value = x
  templateOpen.value = true
}
function openGroup(g: AccountGroupDto | null) {
  editingGroup.value = g
  groupOpen.value = true
}
async function saved(message: string) {
  flash.value = message
  await settings.load()
}

// ---- deleting, after a confirmation
const removing = ref<null | { path: string; title: string; text: string; done: string }>(null)
const removingOpen = computed({
  get: () => removing.value !== null,
  set: (v) => {
    if (!v) removing.value = null
  },
})
const deleting = ref(false)
async function confirmRemove() {
  const r = removing.value
  if (!r) return
  deleting.value = true
  problem.value = null
  try {
    await call('DELETE', `${base.value}/${r.path}`)
    removing.value = null
    await saved(r.done)
  } catch (e) {
    problem.value = failure(e).message
    removing.value = null
  } finally {
    deleting.value = false
  }
}
const removeLabel = (l: LabelDto) =>
  (removing.value = {
    path: `labels/${encodeURIComponent(l.id)}`,
    title: t('contentSettings.labels.removeTitle', { name: l.name }),
    text: t('contentSettings.labels.removeText', { n: l.postCount }, l.postCount),
    done: t('contentSettings.removed', { name: l.name }),
  })
const removeTemplate = (x: CaptionTemplateDto) =>
  (removing.value = {
    path: `caption-templates/${encodeURIComponent(x.id)}`,
    title: t('contentSettings.templates.removeTitle', { name: x.name }),
    text: t('contentSettings.templates.removeText'),
    done: t('contentSettings.removed', { name: x.name }),
  })
const removeGroup = (g: AccountGroupDto) =>
  (removing.value = {
    path: `account-groups/${encodeURIComponent(g.id)}`,
    title: t('contentSettings.groups.removeTitle', { name: g.name }),
    text: t('contentSettings.groups.removeText'),
    done: t('contentSettings.removed', { name: g.name }),
  })
const actions = (edit: () => void, remove: () => void) => [
  { label: t('contentSettings.edit'), icon: 'i-lucide-pencil', onSelect: edit },
  {
    label: t('contentSettings.remove'),
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: remove,
  },
]
</script>

<template>
  <div class="flex flex-col gap-section">
    <h2 class="sr-only">{{ $t('client.tabs.content') }}</h2>
    <p v-if="flash" role="status" class="text-(--app-success)">{{ flash }}</p>
    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="client && !manages" class="text-(--app-text-muted)">
      {{ client.archivedAt ? $t('contentSettings.archived') : $t('contentSettings.readOnly') }}
    </p>

    <!-- Orario predefinito -->
    <section aria-labelledby="cs-time" class="flex flex-col gap-3">
      <div>
        <h3 id="cs-time" class="text-lg">{{ $t('contentSettings.time.title') }}</h3>
        <p class="text-sm text-(--app-text-muted)">
          {{ $t('contentSettings.time.text', { name: client?.name ?? '' }) }}
        </p>
      </div>
      <form
        class="flex flex-wrap items-center gap-3"
        novalidate
        @submit.prevent="saveTime(time || null)"
      >
        <label for="cs-time-input" class="sr-only">{{ $t('contentSettings.time.label') }}</label>
        <UInput
          id="cs-time-input"
          v-model="time"
          type="time"
          size="xl"
          class="w-40"
          :disabled="!manages"
        />
        <span class="text-sm text-(--app-text-muted)">{{ zoneText }}</span>
        <template v-if="manages">
          <UButton
            v-if="timeChanged"
            type="submit"
            class="min-h-control"
            :loading="timeState === 'saving'"
          >
            {{ $t('contentSettings.save') }}
          </UButton>
          <UButton
            v-else-if="client?.defaultPostTime"
            color="neutral"
            variant="ghost"
            class="min-h-control"
            :loading="timeState === 'saving'"
            @click="saveTime(null)"
          >
            {{ $t('contentSettings.time.clear') }}
          </UButton>
          <span
            v-if="timeState === 'saved' && !timeChanged"
            role="status"
            class="text-sm text-(--app-success)"
          >
            {{ $t('contentSettings.savedShort') }}
          </span>
        </template>
      </form>
      <p v-if="!client?.defaultPostTime && !timeChanged" class="text-sm text-(--app-text-muted)">
        {{ $t('contentSettings.time.none') }}
      </p>
      <p v-if="timeProblem" role="alert" class="text-sm text-(--app-danger)">{{ timeProblem }}</p>
    </section>

    <p v-if="failed" role="alert" class="space-y-2">
      <span class="block text-(--app-danger)">{{ $t('contentSettings.loadError') }}</span>
      <UButton class="min-h-control" color="neutral" variant="outline" @click="settings.load()">
        {{ $t('account.retry') }}
      </UButton>
    </p>

    <!-- Etichette -->
    <section aria-labelledby="cs-labels" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="cs-labels" class="text-lg">{{ $t('contentSettings.labels.title') }}</h3>
          <p class="text-sm text-(--app-text-muted)">
            {{ labels ? labelCount : $t('contentSettings.labels.text') }}
          </p>
        </div>
        <UButton
          v-if="manages"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="min-h-control"
          @click="openLabel(null)"
        >
          {{ $t('contentSettings.labels.new') }}
        </UButton>
      </div>
      <ListSkeleton v-if="!labels && !failed" :rows="2" :action="false" />
      <EmptyState
        v-else-if="labels && labels.length === 0"
        :title="$t('contentSettings.labels.empty')"
        :text="$t('contentSettings.labels.emptyText')"
        icon="i-lucide-tag"
      />
      <DataList v-else-if="labels" :label="$t('contentSettings.labels.title')">
        <DataRow
          v-for="l in labels"
          :key="l.id"
          :name="l.name"
          :detail="$t('contentSettings.labels.posts', { n: l.postCount }, l.postCount)"
        >
          <template #avatar>
            <span class="flex size-8 items-center justify-center"
              ><ContentLabelDot :color="l.color"
            /></span>
          </template>
          <template v-if="manages" #actions>
            <RowActions
              :name="l.name"
              :items="
                actions(
                  () => openLabel(l),
                  () => removeLabel(l),
                )
              "
            />
          </template>
        </DataRow>
      </DataList>
    </section>

    <!-- Modelli -->
    <section aria-labelledby="cs-templates" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="cs-templates" class="text-lg">{{ $t('contentSettings.templates.title') }}</h3>
          <p class="text-sm text-(--app-text-muted)">{{ $t('contentSettings.templates.text') }}</p>
        </div>
        <UButton
          v-if="manages"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="min-h-control"
          @click="openTemplate(null)"
        >
          {{ $t('contentSettings.templates.new') }}
        </UButton>
      </div>
      <ListSkeleton v-if="!templates && !failed" :rows="2" :action="false" />
      <EmptyState
        v-else-if="templates && templates.length === 0"
        :title="$t('contentSettings.templates.empty')"
        :text="$t('contentSettings.templates.emptyText')"
        icon="i-lucide-file-text"
      />
      <DataList v-else-if="templates" :label="$t('contentSettings.templates.title')">
        <DataRow
          v-for="x in templates"
          :key="x.id"
          :name="x.name"
          :detail="`${$t(`contentSettings.templates.kind.${x.kind}`)} · ${oneLine(x.body)}`"
        >
          <template #avatar>
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-md bg-(--app-surface-sunken)"
            >
              <UIcon :name="TEMPLATE_ICON[x.kind]" class="size-4" aria-hidden="true" />
            </span>
          </template>
          <template v-if="manages" #actions>
            <RowActions
              :name="x.name"
              :items="
                actions(
                  () => openTemplate(x),
                  () => removeTemplate(x),
                )
              "
            />
          </template>
        </DataRow>
      </DataList>
    </section>

    <!-- Gruppi di account -->
    <section aria-labelledby="cs-groups" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="cs-groups" class="text-lg">{{ $t('contentSettings.groups.title') }}</h3>
          <p class="text-sm text-(--app-text-muted)">{{ $t('contentSettings.groups.text') }}</p>
        </div>
        <UButton
          v-if="manages"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="min-h-control"
          :disabled="accounts.size === 0"
          @click="openGroup(null)"
        >
          {{ $t('contentSettings.groups.new') }}
        </UButton>
      </div>
      <ListSkeleton v-if="!groups && !failed" :rows="2" :action="false" />
      <EmptyState
        v-else-if="groups && groups.length === 0"
        :title="$t('contentSettings.groups.empty')"
        :text="
          accounts.size === 0
            ? $t('contentSettings.groups.noAccounts')
            : $t('contentSettings.groups.emptyText')
        "
        icon="i-lucide-users"
      />
      <DataList v-else-if="groups" :label="$t('contentSettings.groups.title')">
        <DataRow v-for="g in groups" :key="g.id" :name="g.name" :detail="membersOf(g) || '—'">
          <template v-if="groupState(g)" #status>
            <StatusDot tone="warning" :label="groupState(g) ?? ''" />
          </template>
          <template v-if="manages" #actions>
            <RowActions
              :name="g.name"
              :items="
                actions(
                  () => openGroup(g),
                  () => removeGroup(g),
                )
              "
            />
          </template>
        </DataRow>
      </DataList>
    </section>

    <template v-if="manages && base">
      <ContentLabelDialog
        v-model:open="labelOpen"
        :base="base"
        :label="editingLabel"
        @saved="saved($t('contentSettings.savedOne', { name: $event.name }))"
      />
      <ContentTemplateDialog
        v-model:open="templateOpen"
        :base="base"
        :template="editingTemplate"
        @saved="saved($t('contentSettings.savedOne', { name: $event.name }))"
      />
      <ContentGroupDialog
        v-model:open="groupOpen"
        :base="base"
        :group="editingGroup"
        :profiles="profiles.data.value?.items ?? []"
        @saved="saved($t('contentSettings.savedOne', { name: $event.name }))"
      />
    </template>
    <UModal v-model:open="removingOpen" :title="removing?.title ?? ''">
      <template #body>
        <p>{{ removing?.text }}</p>
      </template>
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton color="error" class="min-h-control" :loading="deleting" @click="confirmRemove">
            {{ $t('contentSettings.remove') }}
          </UButton>
          <UButton class="min-h-control" color="neutral" variant="ghost" @click="removing = null">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
