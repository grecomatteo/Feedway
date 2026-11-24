<script setup lang="ts">
import type { AccountGroupDto, CaptionTemplateDto, LabelDto } from '@app/contracts'
import { selectable } from '~/composables/usePostEditor'

/**
 * «Impostazioni dei contenuti», a tab of the client's page (spec §11.7, plan 06 Task 7, design
 * E8): the time new posts start from, the usual times (plan 09 Task 9), the labels, the caption templates and the account groups.
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
    // the choice goes back to what is saved, so picking it again retries
    time.value = client.value?.defaultPostTime ?? ''
  }
}
const timeChanged = computed(() => (client.value?.defaultPostTime ?? '') !== time.value)
// the time as a choice of its own, every quarter of an hour (no field of the browser, D-86.3);
// a time saved before at another minute stays among the choices
const NONE = 'none'
const timeChoice = computed({
  get: () => time.value || NONE,
  set: (v: string) => {
    time.value = v === NONE ? '' : v
    if (timeChanged.value) void saveTime(time.value || null)
  },
})
const timeItems = computed(() => {
  const quarters = Array.from(
    { length: 96 },
    (_, i) =>
      `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
  )
  const saved = client.value?.defaultPostTime
  const all = saved && !quarters.includes(saved) ? [...quarters, saved].sort() : quarters
  return [
    { value: NONE, label: t('contentSettings.time.noneChoice') },
    ...all.map((v) => ({ value: v, label: formatTime(v) })),
  ]
})
// the agency's zone, for whoever may read the agency's settings (Owner and Admin); a Manager
// cannot, and is told «the agency's zone» rather than a zone that may be wrong
// (undefined while it is read, null when it cannot be read)
const zone = ref<string | null | undefined>(undefined)
onMounted(async () => {
  try {
    zone.value = (await call<{ timezone: string }>('GET', org.api('/settings'))).timezone
  } catch {
    zone.value = null
  }
})
/** the zone of whoever reads the page: the line about the agency's zone only when it differs */
// (read in the browser: the server's zone is not the person's)
const own = ref<string | null | undefined>(undefined)
onMounted(() => {
  try {
    own.value = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    own.value = null
  }
})
const zoneText = computed(() => {
  if (own.value === undefined || zone.value === undefined || zone.value === own.value) return null
  if (zone.value === null) return t('contentSettings.time.agency')
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
const groupAccounts = (g: AccountGroupDto) =>
  g.accountIds
    .map((id) => accounts.value.get(id))
    .filter((a): a is ProfileAccount => a !== undefined)
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
  <div
    class="flex flex-col gap-8 max-md:gap-7 md:max-w-[760px]"
    :data-ready="(labels && templates && groups) || failed || undefined"
    data-content-settings
  >
    <h2 class="sr-only">{{ $t('client.tabs.content') }}</h2>
    <p v-if="flash" role="status" class="text-(--app-success)">{{ flash }}</p>
    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="client && !manages" class="text-(--app-text-muted)">
      {{ client.archivedAt ? $t('contentSettings.archived') : $t('contentSettings.readOnly') }}
    </p>

    <!-- Orario abituale -->
    <section :aria-label="$t('contentSettings.time.title')" data-content-time>
      <SectionHead :title="$t('contentSettings.time.title')" :level="3" />
      <div class="rounded-card border border-(--app-border) bg-(--app-surface)">
        <SettingsRow :label="$t('contentSettings.time.label')">
          <USelect
            v-model="timeChoice"
            :items="timeItems"
            icon="i-lucide-clock"
            class="w-44"
            :disabled="!manages || timeState === 'saving'"
            :aria-label="$t('contentSettings.time.label')"
            :loading="timeState === 'saving'"
          />
          <span v-if="zoneText" class="text-detail text-(--app-text-muted)">{{ zoneText }}</span>
          <span
            v-if="timeState === 'saved' && !timeChanged"
            role="status"
            class="text-detail text-(--app-success)"
          >
            {{ $t('contentSettings.savedShort') }}
          </span>
        </SettingsRow>
      </div>
      <p v-if="timeProblem" role="alert" class="mt-2 text-sm text-(--app-danger)">
        {{ timeProblem }}
      </p>
    </section>

    <ContentTimeSlots v-if="base" :base="base" :manages="manages" />

    <LoadFailed v-if="failed" :text="$t('contentSettings.loadError')" @retry="settings.load()" />

    <!-- nothing was read: no «0» and no «Nuova…» under the error (D, state 4) -->
    <template v-if="!failed">
      <!-- Etichette -->
      <section :aria-label="$t('contentSettings.labels.title')" data-content-labels>
        <SectionHead
          :title="$t('contentSettings.labels.title')"
          :count="labels ? labels.length : null"
          :level="3"
        >
          <UButton
            v-if="manages"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            @click="openLabel(null)"
          >
            {{ $t('contentSettings.labels.new') }}
          </UButton>
        </SectionHead>
        <ListSkeleton v-if="!labels && !failed" :rows="2" :action="false" />
        <EmptyState
          v-else-if="!failed && labels && labels.length === 0"
          :title="$t('contentSettings.labels.empty')"
          :text="$t('contentSettings.labels.emptyText')"
          icon="i-lucide-tag"
        />
        <ListSurface
          v-else-if="labels && (labels.length || !failed)"
          columns="minmax(0, 1fr) 100px 30px"
          :label="$t('contentSettings.labels.title')"
        >
          <ListRow
            v-for="l in labels"
            :key="l.id"
            class="max-md:grid-cols-[minmax(0,1fr)_auto_auto]"
          >
            <span class="min-w-0">
              <span
                class="inline-flex max-w-full items-center gap-1.5 rounded-control border border-(--app-border-strong) px-2 py-0.5 text-detail"
                data-label
              >
                <ContentLabelDot :color="l.color" /><span class="truncate">{{ l.name }}</span>
              </span>
            </span>
            <span class="text-(--app-text-muted) tabular-nums">{{
              $t('contentSettings.labels.posts', { n: l.postCount }, l.postCount)
            }}</span>
            <span class="flex justify-end md:-me-2">
              <RowActions
                v-if="manages"
                :name="l.name"
                :items="
                  actions(
                    () => openLabel(l),
                    () => removeLabel(l),
                  )
                "
              />
            </span>
          </ListRow>
        </ListSurface>
      </section>

      <!-- Modelli -->
      <section :aria-label="$t('contentSettings.templates.title')" data-content-templates>
        <SectionHead
          :title="$t('contentSettings.templates.title')"
          :count="templates ? templates.length : null"
          :level="3"
        >
          <UButton
            v-if="manages"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            @click="openTemplate(null)"
          >
            {{ $t('contentSettings.templates.new') }}
          </UButton>
        </SectionHead>
        <ListSkeleton v-if="!templates && !failed" :rows="2" :action="false" />
        <EmptyState
          v-else-if="!failed && templates && templates.length === 0"
          :title="$t('contentSettings.templates.empty')"
          :text="$t('contentSettings.templates.emptyText')"
          icon="i-lucide-file-text"
        />
        <ListSurface
          v-else-if="templates && (templates.length || !failed)"
          columns="110px minmax(0, 1fr) 30px"
          :label="$t('contentSettings.templates.title')"
        >
          <ListRow
            v-for="x in templates"
            :key="x.id"
            class="max-md:grid-cols-[88px_minmax(0,1fr)_auto]"
          >
            <span class="truncate text-(--app-text-muted)" :title="x.name">{{
              $t(`contentSettings.templates.kind.${x.kind}`)
            }}</span>
            <span class="min-w-0">
              <span class="block truncate">{{ oneLine(x.body) }}</span>
              <span class="sr-only">{{ x.name }}</span>
            </span>
            <span class="flex justify-end md:-me-2">
              <RowActions
                v-if="manages"
                :name="x.name"
                :items="
                  actions(
                    () => openTemplate(x),
                    () => removeTemplate(x),
                  )
                "
              />
            </span>
          </ListRow>
        </ListSurface>
      </section>

      <!-- Gruppi di account -->
      <section :aria-label="$t('contentSettings.groups.title')" data-content-groups>
        <SectionHead
          :title="$t('contentSettings.groups.title')"
          :count="groups ? groups.length : null"
          :level="3"
        >
          <UButton
            v-if="manages"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            :disabled="accounts.size === 0"
            @click="openGroup(null)"
          >
            {{ $t('contentSettings.groups.new') }}
          </UButton>
        </SectionHead>
        <ListSkeleton v-if="!groups && !failed" :rows="2" :action="false" />
        <EmptyState
          v-else-if="!failed && groups && groups.length === 0"
          :title="$t('contentSettings.groups.empty')"
          :text="
            accounts.size === 0
              ? $t('contentSettings.groups.noAccounts')
              : $t('contentSettings.groups.emptyText')
          "
          icon="i-lucide-users"
        />
        <ListSurface
          v-else-if="groups && (groups.length || !failed)"
          columns="minmax(0, 1fr) auto 30px"
          :label="$t('contentSettings.groups.title')"
        >
          <ListRow v-for="g in groups" :key="g.id">
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ g.name }}</span>
              <StatusDot
                v-if="groupState(g)"
                tone="warning"
                :label="groupState(g) ?? ''"
                class="text-detail"
              />
            </span>
            <span class="flex min-w-0 items-center gap-3 text-(--app-text-muted) max-md:hidden">
              <PlatformIcons
                v-for="a in groupAccounts(g)"
                :key="a.id"
                :platforms="[a.platform]"
                :label="handleOf(a)"
              />
              <span v-if="groupAccounts(g).length === 0">—</span>
            </span>
            <span class="flex justify-end md:-me-2">
              <RowActions
                v-if="manages"
                :name="g.name"
                :items="
                  actions(
                    () => openGroup(g),
                    () => removeGroup(g),
                  )
                "
              />
            </span>
          </ListRow>
        </ListSurface>
      </section>
    </template>

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
