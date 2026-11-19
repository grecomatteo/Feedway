<script setup lang="ts">
import type { PostResponse } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Platform } from '~/components/PlatformIcons.vue'
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
const { t } = useI18n()
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
/** «Marco B.»: the first name and the initial of the last one, as the screen shows them. */
const shortName = (full: string) => {
  const [first, ...rest] = full.trim().split(/\s+/)
  const last = rest.at(-1)
  return last ? `${first ?? ''} ${Array.from(last)[0] ?? ''}.` : (first ?? full)
}
const authorOf = (p: PostResponse) => {
  if (p.createdBy === org.me.value?.id) return t('posts.list.you')
  const name = people.value.get(p.createdBy)
  return name ? shortName(name) : t('posts.list.someone')
}

// ---- labels: the client's, by id (§11.7); one deleted since is simply not shown
const clientId = computed(() => client.value?.id ?? null)
const { labels } = useContentSettings(clientId)
const labelsById = computed(() => new Map((labels.value ?? []).map((l) => [l.id, l])))
const labelsOf = (p: PostResponse) =>
  p.labelIds.map((id) => labelsById.value.get(id)).filter((l) => l !== undefined)

// ---- profiles: the accounts the post goes to, by their name on the platform
const accounts = computed(() => {
  const map = new Map<string, ProfileAccount>()
  for (const p of profiles.data.value?.items ?? []) for (const a of p.accounts) map.set(a.id, a)
  return map
})
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
/** «Carosello · 3 file», «Foto», «Senza file» */
const typeOf = (p: PostResponse) => {
  if (p.media.length === 0) return t('posts.list.noType')
  const type = t(`posts.type.${p.type}`)
  return p.type === 'carousel' ? `${type} · ${t('client.files', { n: p.media.length })}` : type
}
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
  // «oggi, 18:00» for what is still to come; a past date or a wall date keeps «ven 20 nov, 8:00»,
  // since a past day without its hour would lose it
  return p.scheduledAt && new Date(p.scheduledAt).getTime() >= Date.now()
    ? formatRelative(p.scheduledAt, { timeZone: p.timezone })
    : formatWallShort(p.when.localDate, p.when.localTime)
}
const PLATFORMS: Platform[] = ['instagram', 'facebook']
const platformsOf = (p: PostResponse) =>
  PLATFORMS.filter((pl) => destinationsOf(p).some((a) => a.platform === pl))
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

const head = computed(() => [
  t('posts.list.column.post'),
  t('posts.list.column.when'),
  t('posts.list.column.profiles'),
  t('posts.list.column.state'),
  t('posts.list.column.author'),
  { label: t('workspaces.column.actions'), hidden: true as const },
])
const COLUMNS = 'minmax(0, 1fr) 150px 60px 140px 110px 30px'
const keep = computed(() => {
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== '' ? { profilo } : {}
})
const base = computed(() =>
  org.to(`/spazi/${encodeURIComponent(String(route.params['slug']))}/post`),
)
const pageOf = (p: PostResponse) => ({ path: `${base.value}/${p.id}`, query: keep.value })
const actions = (p: PostResponse): DropdownMenuItem[] => [
  {
    label: t('workspaces.open'),
    icon: 'i-lucide-arrow-right',
    onSelect: () => void navigateTo(pageOf(p)),
  },
]
const mayDraft = computed(
  () => client.value !== null && client.value.myRole !== 'viewer' && !client.value.archivedAt,
)
</script>

<template>
  <section
    aria-labelledby="posts-title"
    class="flex flex-col"
    :data-ready="posts !== null || failed || undefined"
  >
    <h2 id="posts-title" class="sr-only">{{ $t('posts.list.title') }}</h2>
    <p
      v-if="failed"
      role="alert"
      class="flex min-h-row flex-wrap items-center gap-3 rounded-card border border-(--app-border) bg-(--app-surface) px-4"
    >
      <span class="flex-1 text-(--app-danger)">{{ $t('posts.list.failed') }}</span>
      <UButton color="neutral" variant="outline" @click="load">
        {{ $t('posts.list.retry') }}
      </UButton>
    </p>
    <TableSkeleton
      v-else-if="posts === null"
      :label="$t('posts.list.loading')"
      :columns="head.slice(0, 5).map((h) => (typeof h === 'string' ? h : h.label))"
      :action="false"
    />
    <EmptyState
      v-else-if="posts.length === 0"
      :title="$t('posts.list.empty')"
      icon="i-lucide-square-pen"
    >
      <UButton
        v-if="mayDraft"
        color="neutral"
        variant="outline"
        icon="i-lucide-plus"
        class="mt-2"
        :to="{ path: `${base}/nuovo`, query: keep }"
      >
        {{ $t('client.newPost') }}
      </UButton>
    </EmptyState>
    <template v-else>
      <Toolbar>
        <SegmentedFilter
          v-model="filter"
          :label="$t('posts.list.filter.label')"
          :options="options"
        />
        <SearchField v-model="query" :label="$t('posts.list.search')" />
      </Toolbar>
      <p
        v-if="visible.length === 0"
        class="flex min-h-row items-center rounded-card border border-(--app-border) bg-(--app-surface) px-4 text-(--app-text-muted)"
        role="status"
      >
        {{ query ? $t('posts.list.noMatch') : $t(`posts.list.none.${filter}`) }}
      </p>
      <ListSurface v-else :columns="COLUMNS" :head="head" :label="$t('posts.list.title')">
        <ListRow
          v-for="row in visible"
          :key="row.id"
          class="max-md:grid-cols-[minmax(0,1fr)_auto]"
          :data-post="row.id"
        >
          <span role="cell" class="flex min-w-0 items-center gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
            >
              <img v-if="thumbOf(row)" :src="thumbOf(row)!" alt="" class="size-full object-cover" />
              <UIcon v-else :name="TYPE_ICON[row.type]" class="size-4" aria-hidden="true" />
            </span>
            <span class="min-w-0">
              <NuxtLink
                :to="pageOf(row)"
                class="block truncate font-medium underline-offset-3 hover:underline"
                >{{ textOf(row) }}</NuxtLink
              >
              <span
                class="flex min-w-0 items-center gap-x-3 truncate text-detail text-(--app-text-muted)"
              >
                <span class="max-md:hidden">{{ typeOf(row) }}</span>
                <span class="md:hidden">{{ whenOf(row) ?? $t('posts.list.noDate') }}</span>
                <span
                  v-for="l in labelsOf(row)"
                  :key="l.id"
                  class="inline-flex min-w-0 items-center gap-1.5"
                  data-label
                >
                  <ContentLabelDot :color="l.color" /><span class="truncate">{{ l.name }}</span>
                </span>
              </span>
            </span>
          </span>
          <span
            role="cell"
            class="max-md:hidden"
            :class="row.when ? '' : 'text-(--app-text-muted)'"
          >
            {{ whenOf(row) ?? $t('posts.list.noDate') }}
          </span>
          <span role="cell" class="max-md:hidden">
            <PlatformIcons v-if="platformsOf(row).length > 0" :platforms="platformsOf(row)" />
            <span v-else class="text-(--app-text-muted)">—</span>
          </span>
          <span role="cell">
            <StatusDot :label="stateOf(row).label" :tone="stateOf(row).tone" />
          </span>
          <span role="cell" class="truncate text-(--app-text-muted) max-md:hidden">{{
            authorOf(row)
          }}</span>
          <span role="cell" class="flex justify-end max-md:hidden md:-me-2">
            <RowActions :name="textOf(row)" :items="actions(row)" />
          </span>
        </ListRow>
      </ListSurface>
    </template>
  </section>
</template>
