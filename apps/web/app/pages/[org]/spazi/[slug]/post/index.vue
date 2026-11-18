<script setup lang="ts">
import type { PostResponse } from '@app/contracts'
import type { DataColumn } from '~/components/DataTable.vue'
import type { StatusTone } from '~/components/StatusDot.vue'

/**
 * «Post», a tab of the client's page (plan 06 Scelta 6, DESIGN.md «Scheda Post del cliente»): every
 * post of the client until the calendar arrives (stage 9), which keeps this list as its «Elenco».
 * «Tutti» first (Matteo 18/11), then Bozze · Programmati · Annullati, and a search on the text.
 * Everyone who sees the client reads it; the Viewer sees no thumbnails (D-72, provisional (c)).
 */
definePageMeta({ layout: 'agency' })

type Status = PostResponse['status']
type Filter = 'all' | Status

const org = useOrganization()
const route = useRoute()
const { t, locale } = useI18n()
const { client, profiles } = useClientPage()

useHead({
  title: () =>
    client.value ? t('posts.list.titleOf', { name: client.value.name }) : t('posts.list.title'),
})

const api = computed(() =>
  client.value ? org.api(`/workspaces/${encodeURIComponent(client.value.id)}`) : '',
)

// ---- every post of the client: few enough until stage 9 to read them all and filter here
const posts = ref<PostResponse[] | null>(null)
const failed = ref(false)
const PAGES = 10
async function load() {
  if (!api.value) return
  failed.value = false
  try {
    const all: PostResponse[] = []
    let before: string | null = null
    for (let page = 0; page < PAGES; page++) {
      const query: Record<string, string> = { limit: '100' }
      if (before) query['before'] = before
      const res = await $fetch<{ items: PostResponse[]; next: string | null }>(
        `${api.value}/posts`,
        { query },
      )
      all.push(...res.items)
      before = res.next
      if (!before) break
    }
    posts.value = all
  } catch {
    failed.value = true
  }
}
watch(api, () => void load(), { immediate: true })

// ---- who wrote it: the people of the client, and of the agency for whoever may read them
interface Person {
  id: string
  name: string
}
const people = ref(new Map<string, string>())
watch(
  api,
  async (path) => {
    if (!path) return
    const found = new Map<string, string>()
    const read = async (url: string, pick: (x: Record<string, string>) => Person) => {
      try {
        const res = await $fetch<{ items: Record<string, string>[] }>(url)
        for (const p of res.items.map(pick)) found.set(p.id, p.name)
      } catch {
        // without the names the column says «Una persona dell'agenzia»
      }
    }
    await Promise.all([
      read(`${path}/members`, (m) => ({ id: m['userId'] ?? '', name: m['displayName'] ?? '' })),
      org.may.value.manageUsers
        ? read(org.api('/members'), (m) => ({ id: m['id'] ?? '', name: m['displayName'] ?? '' }))
        : Promise.resolve(),
    ])
    people.value = found
  },
  { immediate: true },
)
const authorOf = (p: PostResponse) =>
  p.createdBy === org.me.value?.id
    ? t('posts.list.you')
    : (people.value.get(p.createdBy) ?? t('posts.list.someone'))

// ---- profiles: the accounts the post goes to, by their name on the platform
const accounts = computed(() => {
  const map = new Map<string, ProfileAccount>()
  for (const p of profiles.data.value?.items ?? []) for (const a of p.accounts) map.set(a.id, a)
  return map
})
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const destinationsOf = (p: PostResponse) =>
  p.destinations
    .map((d) => accounts.value.get(d.accountId))
    .filter((a): a is ProfileAccount => a !== undefined)

// ---- what a row says
const textOf = (p: PostResponse) => {
  const text = (p.caption.common || p.caption.instagram || p.caption.facebook || '').trim()
  return text ? text.replace(/\s+/g, ' ') : t('posts.list.noText')
}
const TYPE_ICON: Record<PostResponse['type'], string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
const typeOf = (p: PostResponse) =>
  p.media.length > 0 ? t(`posts.type.${p.type}`) : t('posts.list.noType')
const showsThumbs = computed(() => client.value !== null && client.value.myRole !== 'viewer')
const thumbOf = (p: PostResponse) => {
  if (!showsThumbs.value) return null
  const f = p.media.find((m) => m.status !== 'deleted')
  if (!f) return null
  const variant = f.variants.includes('thumbnail')
    ? 'thumbnail'
    : f.kind === 'image' && f.variants.includes('ig_feed')
      ? 'ig_feed'
      : null
  return variant ? `${api.value}/media/${encodeURIComponent(f.id)}/file/${variant}` : null
}
/** «lunedì 24 novembre, 18:00»: the day and time in the post's zone, as the editor says them. */
const whenOf = (p: PostResponse) => {
  if (!p.when) return null
  const day = new Intl.DateTimeFormat(locale.value, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${p.when.localDate}T12:00:00Z`))
  return `${day} · ${p.when.localTime}`
}
const STATE: Record<Status, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  cancelled: 'neutral',
}
const stateOf = (p: PostResponse) => ({
  label: t(`posts.list.state.${p.status}`),
  tone: STATE[p.status],
})

// ---- filter and search
const filter = ref<Filter>('all')
const query = ref('')
const countOf = (s: Status) => (posts.value ?? []).filter((p) => p.status === s).length
const options = computed(() => [
  { value: 'all' as const, label: t('posts.list.filter.all'), count: posts.value?.length ?? 0 },
  { value: 'draft' as const, label: t('posts.list.filter.draft'), count: countOf('draft') },
  {
    value: 'scheduled' as const,
    label: t('posts.list.filter.scheduled'),
    count: countOf('scheduled'),
  },
  {
    value: 'cancelled' as const,
    label: t('posts.list.filter.cancelled'),
    count: countOf('cancelled'),
  },
])
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const visible = computed(() => {
  const rows = (posts.value ?? []).filter(
    (p) => filter.value === 'all' || p.status === filter.value,
  )
  const q = fold(query.value.trim()).replace(/^@/, '')
  if (!q) return rows
  return rows.filter((p) =>
    [
      p.caption.common,
      p.caption.instagram,
      p.caption.facebook,
      ...destinationsOf(p).flatMap((a) => [a.name, a.username]),
    ]
      .filter((s): s is string => Boolean(s))
      .some((s) => fold(s).includes(q)),
  )
})

const columns = computed<DataColumn[]>(() => [
  { key: 'post', label: t('posts.list.column.post') },
  { key: 'when', label: t('posts.list.column.when'), class: 'whitespace-nowrap' },
  { key: 'profiles', label: t('posts.list.column.profiles') },
  { key: 'state', label: t('posts.list.column.state') },
  { key: 'author', label: t('posts.list.column.author') },
])
const keep = computed(() => {
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== '' ? { profilo } : {}
})
const base = computed(() =>
  org.to(`/spazi/${encodeURIComponent(String(route.params['slug']))}/post`),
)
const pageOf = (p: PostResponse) => ({ path: `${base.value}/${p.id}`, query: keep.value })
const mayDraft = computed(
  () => client.value !== null && client.value.myRole !== 'viewer' && !client.value.archivedAt,
)
</script>

<template>
  <section aria-labelledby="posts-title" class="flex flex-col gap-4">
    <h2 id="posts-title" class="sr-only">{{ $t('posts.list.title') }}</h2>
    <p v-if="failed" role="alert" class="flex flex-wrap items-center gap-3 text-(--app-danger)">
      {{ $t('posts.list.failed') }}
      <UButton color="neutral" variant="outline" class="min-h-11" @click="load">
        {{ $t('posts.list.retry') }}
      </UButton>
    </p>
    <TableSkeleton
      v-else-if="posts === null"
      :label="$t('posts.list.loading')"
      :columns="columns.map((c) => c.label)"
      :action="false"
    />
    <EmptyState
      v-else-if="posts.length === 0"
      :title="$t('posts.list.empty')"
      icon="i-lucide-square-pen"
    >
      <UButton
        v-if="mayDraft"
        icon="i-lucide-plus"
        class="mt-2 min-h-11"
        :to="{ path: `${base}/nuovo`, query: keep }"
      >
        {{ $t('client.newPost') }}
      </UButton>
    </EmptyState>
    <template v-else>
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="-mx-gutter overflow-x-auto px-gutter sm:mx-0 sm:px-0">
          <SegmentedFilter
            v-model="filter"
            :label="$t('posts.list.filter.label')"
            :options="options"
          />
        </div>
        <SearchField v-model="query" :label="$t('posts.list.search')" />
      </div>
      <p v-if="visible.length === 0" class="text-(--app-text-muted)" role="status">
        {{ query ? $t('posts.list.noMatch') : $t(`posts.list.none.${filter}`) }}
      </p>
      <DataTable
        v-else
        :caption="$t('posts.list.title')"
        :columns="columns"
        :rows="visible"
        :row-key="(p) => p.id"
      >
        <template #cell-post="{ row }">
          <div class="flex min-w-0 items-center gap-3 py-2" :data-post="row.id">
            <span
              class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-(--app-surface-sunken) text-(--app-text-muted)"
            >
              <img v-if="thumbOf(row)" :src="thumbOf(row)!" alt="" class="size-full object-cover" />
              <UIcon v-else :name="TYPE_ICON[row.type]" class="size-4" aria-hidden="true" />
            </span>
            <span class="min-w-0">
              <NuxtLink
                :to="pageOf(row)"
                class="line-clamp-1 max-w-[28rem] font-semibold underline-offset-3 hover:underline"
                >{{ textOf(row) }}</NuxtLink
              >
              <span class="block text-[0.8125rem] text-(--app-text-muted)">{{ typeOf(row) }}</span>
            </span>
          </div>
        </template>
        <template #cell-when="{ row }">
          <span :class="row.status === 'scheduled' ? '' : 'text-(--app-text-muted)'">
            {{ whenOf(row) ?? $t('posts.list.noDate') }}
          </span>
        </template>
        <template #cell-profiles="{ row }">
          <span v-if="destinationsOf(row).length === 0" class="text-(--app-text-muted)">
            {{ $t('posts.list.noProfiles') }}
          </span>
          <span v-else class="flex flex-col gap-0.5">
            <span
              v-for="a in destinationsOf(row)"
              :key="a.id"
              class="inline-flex items-center gap-1.5"
            >
              <UIcon
                :name="PLATFORM_ICON[a.platform] ?? 'i-lucide-at-sign'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
              <span class="truncate">{{ handleOf(a) }}</span>
            </span>
          </span>
        </template>
        <template #cell-state="{ row }">
          <StatusDot :label="stateOf(row).label" :tone="stateOf(row).tone" />
        </template>
        <template #cell-author="{ row }">
          <span class="text-(--app-text-muted)">{{ authorOf(row) }}</span>
        </template>
        <template #mobile="{ row }">
          <DataRow :name="textOf(row)" :to="pageOf(row)" :data-post="row.id">
            <template #avatar>
              <span
                class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-(--app-surface-sunken) text-(--app-text-muted)"
              >
                <img
                  v-if="thumbOf(row)"
                  :src="thumbOf(row)!"
                  alt=""
                  class="size-full object-cover"
                />
                <UIcon v-else :name="TYPE_ICON[row.type]" class="size-4" aria-hidden="true" />
              </span>
            </template>
            <template #detail>
              {{ typeOf(row) }} · {{ whenOf(row) ?? $t('posts.list.noDate') }}
            </template>
            <template #status>
              <StatusDot :label="stateOf(row).label" :tone="stateOf(row).tone" />
            </template>
          </DataRow>
        </template>
      </DataTable>
    </template>
  </section>
</template>
