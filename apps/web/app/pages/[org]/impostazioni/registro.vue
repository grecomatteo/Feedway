<script setup lang="ts">
definePageMeta({ layout: 'agency' })

/**
 * Registro attività inside Impostazioni (screen 26): who did what and when, on which client. The
 * filter groups the actions of what is loaded (the server filters one action at a time), the
 * search reads the same rows; «Mostra altre» loads the next ones.
 */

interface AuditItem {
  id: string
  authorName: string
  action: string
  source: 'panel' | 'api' | 'mcp' | 'system'
  workspaceId: string | null
  createdAt: string
}

const org = useOrganization()
const route = useRoute()
const { t, te } = useI18n()
const { call, failure } = useApi()
const { data: spaces } = useWorkspaces()

useHead({ title: () => t('audit.title') })
if (!org.may.value.viewAudit) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

// the context switcher filters the log by workspace
const workspaceId = computed(() => {
  const asked = route.query['spazio']
  return typeof asked === 'string'
    ? (spaces.value?.items.find((w) => w.slug === asked)?.id ?? null)
    : null
})
const items = ref<AuditItem[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const loaded = ref(false)
const problem = ref<string | null>(null)

async function load(more = false) {
  loading.value = true
  problem.value = null
  try {
    const query = new URLSearchParams({ limit: '50' })
    if (workspaceId.value) query.set('workspaceId', workspaceId.value)
    if (more && cursor.value) query.set('cursor', cursor.value)
    const r = await call<{ items: AuditItem[]; nextCursor: string | null }>(
      'GET',
      `${org.api('/audit-log')}?${query.toString()}`,
    )
    items.value = more ? [...items.value, ...r.items] : r.items
    cursor.value = r.nextCursor
    loaded.value = true
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    loading.value = false
  }
}
onMounted(() => load())
watch(workspaceId, () => load())

const actionLabel = (action: string) =>
  te(`audit.actions.${action.replaceAll('.', '_')}`)
    ? t(`audit.actions.${action.replaceAll('.', '_')}`)
    : action

type Kind = 'all' | 'posts' | 'people' | 'connections'
const KINDS: Record<Exclude<Kind, 'all'>, RegExp> = {
  posts: /^(post|media)\./,
  people: /^(user|auth|session|workspace\.member)/,
  connections: /^(connection|accounts?|integration)\./,
}
const kind = ref<Kind>('all')
const query = ref('')
const kinds = computed(() =>
  (['all', 'posts', 'people', 'connections'] as const).map((value) => ({
    value,
    label: t(`audit.kinds.${value}`),
  })),
)
const clientOf = (item: AuditItem) =>
  item.workspaceId
    ? (spaces.value?.items.find((w) => w.id === item.workspaceId)?.name ?? null)
    : null
const shown = computed(() => {
  const q = query.value.trim().toLocaleLowerCase('it')
  return items.value.filter((item) => {
    if (kind.value !== 'all' && !KINDS[kind.value].test(item.action)) return false
    if (q === '') return true
    return [item.authorName, actionLabel(item.action), clientOf(item) ?? ''].some((x) =>
      x.toLocaleLowerCase('it').includes(q),
    )
  })
})
const head = computed(() => [
  t('audit.col.when'),
  t('audit.col.who'),
  t('audit.col.what'),
  t('audit.col.client'),
])
</script>

<template>
  <SettingsShell wide :data-ready="loaded || undefined">
    <div>
      <Toolbar>
        <SegmentedFilter v-model="kind" :label="$t('audit.show')" :options="kinds" />
        <SearchField v-model="query" :label="$t('audit.search')" />
      </Toolbar>
      <TableSkeleton
        v-if="!loaded && !problem"
        :label="$t('account.loading')"
        :columns="head"
        :rows="5"
      />
      <LoadFailed v-else-if="problem && !loaded" :text="problem" @retry="load()" />
      <p
        v-else-if="shown.length === 0"
        class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
      >
        {{ items.length === 0 ? $t('audit.empty') : $t('audit.noMatch') }}
      </p>
      <ListSurface
        v-else
        columns="120px 150px minmax(0,1fr) 150px"
        :head="head"
        :label="$t('audit.title')"
        class="max-md:[&>[data-list-head]]:sr-only"
      >
        <ListRow
          v-for="item in shown"
          :key="item.id"
          class="max-md:grid-cols-1 max-md:py-2.5"
          data-audit-row
        >
          <span role="cell" class="text-(--app-text-muted) max-md:hidden">
            <time :datetime="item.createdAt">{{ formatRelative(item.createdAt) }}</time>
          </span>
          <span role="cell" class="truncate font-medium max-md:hidden">{{ item.authorName }}</span>
          <span role="cell" class="min-w-0">
            <span
              ><span class="font-semibold md:hidden">{{ `${item.authorName} ` }}</span
              >{{ actionLabel(item.action) }}</span
            >
            <span class="block text-detail text-(--app-text-muted) md:hidden"
              >{{ formatRelative(item.createdAt)
              }}<template v-if="clientOf(item)"> · {{ clientOf(item) }}</template></span
            >
          </span>
          <span role="cell" class="truncate text-(--app-text-muted) max-md:hidden">{{
            clientOf(item) ?? '—'
          }}</span>
        </ListRow>
      </ListSurface>
      <!-- outside the list: a filter that finds nothing among the rows loaded can find older ones -->
      <template v-if="loaded">
        <p v-if="problem" role="alert" class="mt-3 text-(--app-danger)">{{ problem }}</p>
        <div v-if="cursor" class="mt-3">
          <UButton color="neutral" variant="outline" :loading="loading" @click="load(true)">
            {{ $t('audit.more') }}
          </UButton>
        </div>
      </template>
    </div>
  </SettingsShell>
</template>
