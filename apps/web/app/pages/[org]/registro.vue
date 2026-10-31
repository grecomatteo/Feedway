<script setup lang="ts">
definePageMeta({ layout: 'agency' })

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
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('audit.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('audit.explain') }}</p>
    </header>

    <p v-if="!loaded && !problem" role="status">{{ $t('account.loading') }}</p>
    <div v-else-if="problem && !loaded" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ problem }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="load()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <EmptyState
      v-else-if="items.length === 0"
      :title="$t('audit.empty')"
      icon="i-lucide-scroll-text"
    />
    <template v-else>
      <ol
        class="divide-y divide-(--app-border) rounded-xl border border-(--app-border) bg-(--app-surface)"
        :aria-label="$t('audit.title')"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
        >
          <span>
            <span class="font-semibold">{{ item.authorName }}</span>
            {{ actionLabel(item.action) }}
          </span>
          <time :datetime="item.createdAt" class="text-sm text-(--app-text-muted)">
            {{ formatDate(item.createdAt, true) }}
          </time>
        </li>
      </ol>
      <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
      <UButton
        v-if="cursor"
        class="min-h-11"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="load(true)"
      >
        {{ $t('audit.more') }}
      </UButton>
    </template>
  </div>
</template>
