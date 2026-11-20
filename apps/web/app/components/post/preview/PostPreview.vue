<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'
import {
  feedFrameRatio,
  frameAnswers,
  framing,
  previewTabs,
  type PreviewItem,
  type PreviewView,
} from '~/utils/post-preview'

/**
 * «Anteprima» (§11.3; screens 08–10): a tab for each way the post goes out on the chosen accounts
 * («Feed · Griglia · Facebook»), the account of the tab when there is more than one, the post in
 * the platform's interface as the app shows it, after the choices and the crops; for reels and
 * stories the zones the app covers. A file dropped here joins the post
 * (Task 6).
 */
const props = defineProps<{
  editor: PostEditor
  accounts: Map<string, ProfileAccount>
  /** the copies are read from the library, Editor and up: the Viewer sees none (D-72) */
  showFiles: boolean
  /** the height kept free around a reel or a story's frame (the column and the action bar) */
  reserve?: string
  /** a reel or a story's frame is never wider than this (the column: 236 px, screen 09) */
  width?: string
  /** in the column: «Anteprima» as a heading, with the tabs on its line on the right */
  heading?: string
}>()
const { t, locale } = useI18n()
const e = props.editor

const report = computed(() => e.report.value)
const tabs = computed(() => previewTabs(report.value?.destinations ?? []))
/** «Griglia» shows the profile's grid of the Instagram feed or reel (screens 08 and 09) */
type Choice = PreviewView | 'instagram_grid'
const gridOf = computed(() =>
  tabs.value.find((x) => x.view === 'instagram_feed' || x.view === 'instagram_reel'),
)
const choices = computed<Choice[]>(() =>
  tabs.value.flatMap((x): Choice[] => (x === gridOf.value ? [x.view, 'instagram_grid'] : [x.view])),
)
const choice = ref<Choice | null>(null)
watch(
  choices,
  (list) => {
    if (!choice.value || !list.includes(choice.value)) choice.value = list[0] ?? null
  },
  { immediate: true },
)
const grid = computed(() => choice.value === 'instagram_grid')
/** the view drawn: the grid draws the Instagram feed's or reel's file */
const view = computed<PreviewView | null>(() =>
  grid.value ? (gridOf.value?.view ?? null) : (choice.value as PreviewView | null),
)
/** «Feed · Griglia · Facebook», with the platforms' icons when both are there */
const options = computed(() => {
  const icons = choices.value.some((c) => c.startsWith('facebook'))
  const ICON = { instagram: 'i-lucide-instagram', facebook: 'i-lucide-facebook' }
  return choices.value.map((c) => ({
    value: c,
    label: t(`posts.preview.short.${c}`),
    icon: !icons
      ? undefined
      : c === 'instagram_grid'
        ? 'i-lucide-layout-grid'
        : ICON[c.startsWith('instagram') ? 'instagram' : 'facebook'],
  }))
})
const tab = computed(() => tabs.value.find((x) => x.view === view.value))
const accountId = ref<string | null>(null)
watch(
  tab,
  (now) => {
    if (!now?.accountIds.includes(accountId.value ?? ''))
      accountId.value = now?.accountIds[0] ?? null
  },
  { immediate: true },
)
const account = computed(() => (accountId.value ? props.accounts.get(accountId.value) : undefined))
const destination = computed(() =>
  report.value?.destinations.find((d) => d.accountId === accountId.value),
)
const platform = computed(() => (view.value?.startsWith('instagram') ? 'instagram' : 'facebook'))
const vertical = computed(
  () =>
    !grid.value &&
    view.value !== null &&
    view.value !== 'instagram_feed' &&
    view.value !== 'facebook_post',
)
/** the grid's first place: the reel's cover or the post's first file, cut to 3:4 */
const gridItem = computed(() => {
  const first = indices.value[0]
  if (first === undefined) return undefined
  const item = itemOf(first, 3 / 4, 'fill')
  if (view.value !== 'instagram_reel') return item
  const poster = coverImage.value ?? item.poster
  return { ...item, video: false, src: poster, poster: null }
})
const zones = ref(true)

const handle = computed(() => {
  const a = account.value
  if (!a) return ''
  return a.platform === 'instagram' && a.username ? a.username : a.name
})
const accountLabel = (id: string) => {
  const a = props.accounts.get(id)
  if (!a) return t('posts.summary.unknownAccount')
  const name = a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
  return `${name} · ${t(`rules.platforms.${a.platform}`)}`
}

/** The files of the destination, in its order, each in its frame after its answer. */
const answers = computed(() =>
  frameAnswers(report.value?.outcomes ?? [], e.choices.value, platform.value),
)
const byId = computed(() => new Map(e.files.value.map((f) => [f.id, f])))
function itemOf(index: number, frameRatio: number, fallback: 'fill' | 'contain'): PreviewItem {
  const id = e.reportMedia.value[index]
  const file = id ? byId.value.get(id) : undefined
  const video = file?.kind === 'video'
  const image = file?.variants.includes('ig_feed') ? 'ig_feed' : 'thumbnail'
  const ready = file && file.status === 'ready' && props.showFiles
  return {
    index,
    name: file?.name ?? t('posts.media.unnamed'),
    video,
    src: ready
      ? video
        ? file.variants.includes('preview')
          ? e.fileUrl(file.id, 'preview')
          : null
        : file.variants.includes(image)
          ? e.fileUrl(file.id, image)
          : null
      : null,
    poster:
      ready && video && file.variants.includes('thumbnail')
        ? e.fileUrl(file.id, 'thumbnail')
        : null,
    framing: framing(
      { width: file?.width ?? null, height: file?.height ?? null },
      frameRatio,
      answers.value.get(index) ?? null,
      fallback,
    ),
  }
}
const indices = computed(() => destination.value?.media ?? [])
const feedRatio = computed(() => {
  const first = indices.value[0]
  const id = first === undefined ? undefined : e.reportMedia.value[first]
  const file = id ? byId.value.get(id) : undefined
  return feedFrameRatio(file, first === undefined ? null : (answers.value.get(first) ?? null))
})
/** a reel's cover chosen as an image: the video starts from it (D-60) */
const coverImage = computed(() => (props.showFiles ? e.coverSrc.value : null))
const items = computed(() =>
  vertical.value
    ? indices.value.slice(0, 1).map((i) => {
        const item = itemOf(i, 9 / 16, 'contain')
        return coverImage.value && view.value?.endsWith('_reel')
          ? { ...item, poster: coverImage.value }
          : item
      })
    : indices.value.map((i) =>
        itemOf(i, view.value === 'instagram_feed' ? feedRatio.value : 1, 'fill'),
      ),
)
const coverMs = computed(() =>
  e.cover.value?.source === 'frame' ? e.cover.value.offsetMs : undefined,
)

/** The day as the apps write it, from the date chosen. */
const at = computed(() => {
  const w = e.when.value
  if (!w) return null
  return new Date(`${w.localDate}T12:00:00Z`)
})
const day = computed(() =>
  at.value
    ? new Intl.DateTimeFormat(locale.value, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(at.value)
    : '',
)
const fbWhen = computed(() =>
  at.value && e.when.value
    ? t('posts.preview.fbWhen', {
        day: new Intl.DateTimeFormat(locale.value, {
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        }).format(at.value),
        time: e.when.value.localTime,
      })
    : '',
)
/** the file the feed's carousel shows: «Sposta prima/dopo» under the frame move it */
const feedAt = ref(0)
// another tab or account starts from the first file; fewer files never leave it past the last
watch([view, accountId], () => (feedAt.value = 0))
watch(
  () => items.value.length,
  (n) => (feedAt.value = Math.min(feedAt.value, Math.max(0, n - 1))),
)
const canMove = computed(
  () =>
    view.value === 'instagram_feed' && items.value.length > 1 && e.editable.value && fresh.value,
)
function moveShown(by: -1 | 1) {
  const item = items.value[feedAt.value]
  if (!item) return
  move(item.index, by)
  feedAt.value += by
}

/** The report was made on the files as they are now: its positions can be moved. */
const fresh = computed(() => e.reportMedia.value.join() === e.files.value.map((f) => f.id).join())
/** The file shown goes before or after its neighbour in the preview, not in the whole list. */
function move(index: number, by: -1 | 1) {
  if (!fresh.value) return
  const pos = indices.value.indexOf(index)
  const id = e.reportMedia.value[index]
  const neighbour = indices.value[pos + by]
  const other = neighbour === undefined ? undefined : e.reportMedia.value[neighbour]
  const entry = e.entries.value.find((x) => x.file?.id === id)
  const to = e.entries.value.findIndex((x) => x.file?.id === other)
  if (entry && to >= 0) e.moveTo(entry.key, to)
}

// a file dropped on the preview joins the post, as on the files' area (Task 6)
const dropping = ref(false)
function drop(event: DragEvent) {
  dropping.value = false
  const list = Array.from(event.dataTransfer?.files ?? [])
  if (list.length > 0) void e.addFiles(list)
}
function over(event: DragEvent) {
  if (!e.editable.value || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dropping.value = true
}
</script>

<template>
  <div
    class="relative flex flex-col gap-3"
    data-preview
    @dragover="over"
    @dragleave="dropping = false"
    @drop.prevent="drop"
  >
    <div
      v-if="heading || (tabs.length > 0 && choice)"
      class="flex min-h-control flex-wrap items-center gap-2"
      data-preview-tools
    >
      <h2 v-if="heading" class="flex-1">{{ heading }}</h2>
      <SegmentedFilter
        v-if="tabs.length > 0 && choice"
        v-model="choice"
        :wide="!heading"
        :class="heading ? '' : 'w-full'"
        :label="t('posts.preview.tabs')"
        :options="options"
      />
    </div>
    <template v-if="tabs.length > 0 && view && choice">
      <label v-if="tab && tab.accountIds.length > 1" class="flex flex-col gap-1 text-sm">
        <span class="sr-only">{{ t('posts.preview.account') }}</span>
        <select
          v-model="accountId"
          class="min-h-11 rounded-lg border border-(--app-border) bg-(--app-surface) px-3"
          data-preview-account
        >
          <option v-for="id in tab.accountIds" :key="id" :value="id">
            {{ accountLabel(id) }}
          </option>
        </select>
      </label>
      <PostPreviewFrame :vertical="vertical" :reserve="reserve" :width="width">
        <PostPreviewInstagramGrid
          v-if="grid"
          :name="handle"
          :item="gridItem"
          :kind="view === 'instagram_reel' ? 'reel' : items.length > 1 ? 'carousel' : null"
        />
        <PostPreviewInstagramFeed
          v-else-if="view === 'instagram_feed'"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :items="items"
          :frame-ratio="feedRatio"
          :caption="destination?.caption ?? ''"
          v-model:at="feedAt"
          :day="day"
        />
        <PostPreviewFacebookPost
          v-else-if="view === 'facebook_post'"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :items="items"
          :caption="destination?.caption ?? ''"
          :when="fbWhen"
        />
        <PostPreviewVerticalPost
          v-else
          :view="view"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :item="items[0]"
          :caption="destination?.caption ?? ''"
          :zones="zones"
          :start-ms="view.endsWith('_reel') ? coverMs : undefined"
        />
      </PostPreviewFrame>
      <USwitch v-if="vertical" v-model="zones" :label="t('posts.preview.zones')" class="min-h-11" />
      <div v-if="canMove && !grid" class="flex flex-wrap gap-2" data-preview-move>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-arrow-left"
          :label="t('posts.preview.moveBefore')"
          :disabled="feedAt === 0"
          @click="moveShown(-1)"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-lucide-arrow-right"
          :label="t('posts.preview.moveAfter')"
          :disabled="feedAt === items.length - 1"
          @click="moveShown(1)"
        />
      </div>
    </template>
    <div
      v-else
      class="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-(--app-border) p-6 text-center text-sm text-(--app-text-muted)"
      data-preview-empty
    >
      <UIcon name="i-lucide-eye" class="size-6" aria-hidden="true" />
      <p>{{ e.checking.value ? t('posts.preview.loading') : t('posts.preview.empty') }}</p>
    </div>
    <p v-if="!heading" class="text-detail text-(--app-text-muted)">
      {{ t('posts.preview.approximate') }}
    </p>
    <div
      v-if="dropping"
      class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-(--app-brand) bg-(--app-brand-soft)/90 text-sm font-semibold"
    >
      {{ t('posts.preview.dropHere') }}
    </div>
  </div>
</template>
