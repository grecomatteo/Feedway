<script setup lang="ts">
import type { NotificationItem, NotificationKindName, NotificationLevel } from '@app/contracts'
import { NotificationKindName as KINDS, NotificationLevel as LEVELS } from '@app/contracts'

definePageMeta({ layout: 'agency' })

/**
 * Every notification of the person (plan 08 Task 6, §12.3): the bell shows the latest, here are
 * all of them with the filters (to read, level, kind, the client of the selector, the agency when
 * the person has more than one) and, under each, what happened outside the panel. On a phone this
 * is where «Tutte le notifiche» leads (Scelta 5).
 */
const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { list, markAll, unread, version } = useNotifications()
const { data: spaces } = useWorkspaces()

useHead({ title: () => t('notifications.title') })

const ALL = 'all'
const show = ref<'all' | 'unread'>('all')
const level = ref<NotificationLevel | typeof ALL>(ALL)
const kind = ref<NotificationKindName | typeof ALL>(ALL)
const agency = ref<'this' | typeof ALL>('this')
const many = computed(() => (org.me.value?.organizations.length ?? 0) > 1)

// the client selector narrows the list, as in the activity log
const workspaceId = computed(() => {
  const asked = route.query['spazio']
  return typeof asked === 'string'
    ? (spaces.value?.items.find((w) => w.slug === asked)?.id ?? null)
    : null
})

const shows = computed(() => [
  { value: 'all' as const, label: t('notifications.filters.all') },
  { value: 'unread' as const, label: t('notifications.filters.unread') },
])
const levels = computed(() => [
  { value: ALL, label: t('notifications.filters.anyLevel') },
  ...LEVELS.options.map((value) => ({ value, label: t(`notifications.levels.${value}`) })),
])
const kinds = computed(() => [
  { value: ALL, label: t('notifications.filters.anyKind') },
  ...KINDS.options.map((value) => ({
    value,
    label: t(`notifications.kinds.${kindKey(value)}`),
  })),
])
const agencies = computed(() => [
  {
    value: 'this' as const,
    label: t('notifications.filters.thisAgency', { name: org.organization.value?.name ?? '' }),
  },
  { value: ALL, label: t('notifications.filters.allAgencies') },
])

const items = ref<NotificationItem[]>([])
const cursor = ref<string | null>(null)
const loaded = ref(false)
const loading = ref(false)
const problem = ref<string | null>(null)
const marking = ref(false)

const filtered = computed(
  () =>
    show.value === 'unread' ||
    level.value !== ALL ||
    kind.value !== ALL ||
    workspaceId.value !== null ||
    (many.value && agency.value === 'this'),
)

// the client of `?spazio` is known only once the clients are read: no list without it first
const waiting = computed(() => typeof route.query['spazio'] === 'string' && !spaces.value)
// only the latest request writes the list: a slower one of the filters before is dropped
let latest = 0

async function load(more = false) {
  if (waiting.value) return
  const seq = ++latest
  loading.value = true
  problem.value = null
  try {
    const onlyHere = (many.value && agency.value === 'this') || workspaceId.value !== null
    const page = await list({
      unread: show.value === 'unread' ? 'true' : undefined,
      level: level.value === ALL ? undefined : level.value,
      kind: kind.value === ALL ? undefined : kind.value,
      organizationId: onlyHere ? org.organization.value?.id : undefined,
      workspaceId: workspaceId.value ?? undefined,
      cursor: more ? (cursor.value ?? undefined) : undefined,
    })
    if (seq !== latest) return
    items.value = more ? [...items.value, ...page.items] : page.items
    cursor.value = page.nextCursor
    loaded.value = true
  } catch {
    if (seq === latest) problem.value = t('notifications.loadError')
  } finally {
    if (seq === latest) loading.value = false
  }
}
onMounted(() => load())
watch([show, level, kind, agency, workspaceId, waiting, () => org.organization.value?.id], () =>
  load(),
)
// a row read in the bell's panel is read here too
watch(version, () => {
  if (!loading.value) void load()
})

async function readAll() {
  marking.value = true
  problem.value = null
  try {
    await markAll()
  } catch {
    problem.value = t('notifications.actionError')
  } finally {
    marking.value = false
  }
}
</script>

<template>
  <PageShell :data-ready="loaded || undefined">
    <template #head>
      <PageHeader :title="$t('notifications.title')">
        <template v-if="unread" #aside>
          <span aria-hidden="true">{{ unread }}</span>
          <span class="sr-only">{{ $t('notifications.unreadCount', { n: unread }, unread) }}</span>
        </template>
        <template v-if="unread" #actions>
          <UButton color="neutral" variant="outline" :loading="marking" @click="readAll">
            {{ $t('notifications.markAll') }}
          </UButton>
        </template>
      </PageHeader>
    </template>

    <div>
      <Toolbar>
        <SegmentedFilter v-model="show" :label="$t('notifications.show')" :options="shows" />
        <USelect
          v-model="level"
          :items="levels"
          :aria-label="$t('notifications.filters.level')"
          color="neutral"
          variant="outline"
          class="min-w-40 font-medium max-md:flex-1"
          data-level-filter
        />
        <USelect
          v-model="kind"
          :items="kinds"
          :aria-label="$t('notifications.filters.kind')"
          color="neutral"
          variant="outline"
          class="min-w-48 font-medium max-md:flex-1"
          data-kind-filter
        />
        <USelect
          v-if="many"
          v-model="agency"
          :items="agencies"
          :aria-label="$t('notifications.filters.agency')"
          color="neutral"
          variant="outline"
          class="min-w-44 font-medium max-md:w-full"
          data-agency-filter
        />
      </Toolbar>

      <ListSkeleton
        v-if="!loaded && !problem"
        :label="$t('account.loading')"
        :rows="4"
        :action="false"
      />
      <LoadFailed v-else-if="problem && !loaded" :text="problem" @retry="load()" />
      <EmptyState
        v-else-if="items.length === 0"
        icon="i-lucide-bell"
        :title="
          filtered
            ? show === 'unread' && level === 'all' && kind === 'all'
              ? $t('notifications.emptyUnread')
              : $t('notifications.noMatch')
            : $t('notifications.empty')
        "
        :text="filtered ? undefined : $t('notifications.emptyHelp')"
      />
      <div
        v-else
        class="rounded-card border border-(--app-border) bg-(--app-surface) px-2 py-0.5"
        data-notification-list
      >
        <NotificationList
          :items="items"
          deliveries
          :agencies="many && agency === 'all'"
          @failed="problem = $t('notifications.actionError')"
        />
      </div>

      <template v-if="loaded">
        <p v-if="problem" role="alert" class="mt-3 text-(--app-danger)">{{ problem }}</p>
        <div v-if="cursor" class="mt-3">
          <UButton color="neutral" variant="outline" :loading="loading" @click="load(true)">
            {{ $t('notifications.more') }}
          </UButton>
        </div>
      </template>
    </div>
  </PageShell>
</template>
