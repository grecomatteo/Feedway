<script setup lang="ts">
import type { PostOutcomeResponse, PostResponse } from '@app/contracts'
import { outcomeTabs, type OutcomeVersion } from '~/utils/outcome-preview'
import { clampFeedRatio, type PreviewItem, type PreviewView } from '~/utils/post-preview'

/**
 * The post as it went out (plan 08 Task 10, D-120 request 1): the editor's preview, read only.
 * A tab for each way it went out, and the account when the accounts of a tab received different
 * things; a carousel pages with the arrows (also of the keyboard), a reel or a story plays in its
 * frame from the cover that went out, the covered zones off. The files are the copies that were
 * published while they are kept, then the originals, and the page says so.
 */
const props = defineProps<{
  preview: NonNullable<PostOutcomeResponse['preview']>
  post: PostResponse
  accounts: Map<string, ProfileAccount>
  /** `/api/v1/orgs/{org}/workspaces/{id}` */
  api: string
  /** the Viewer sees no file (D-72) */
  showFiles: boolean
}>()
const { t, locale } = useI18n()

const tabs = computed(() => outcomeTabs(props.preview.versions))
const byId = computed(() => new Map(props.preview.versions.map((v) => [v.accountId, v])))
const view = ref<PreviewView | null>(null)
watch(
  tabs,
  (list) => {
    if (!view.value || !list.some((x) => x.view === view.value)) view.value = list[0]?.view ?? null
  },
  { immediate: true },
)
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
const version = computed<OutcomeVersion | undefined>(() =>
  accountId.value ? byId.value.get(accountId.value) : undefined,
)
const account = computed(() => (accountId.value ? props.accounts.get(accountId.value) : undefined))
const platform = computed(() => (view.value?.startsWith('instagram') ? 'instagram' : 'facebook'))
const vertical = computed(
  () => view.value !== null && view.value !== 'instagram_feed' && view.value !== 'facebook_post',
)

const options = computed(() => {
  const icons = tabs.value.some((x) => x.view.startsWith('facebook'))
  return tabs.value.map((x) => ({
    value: x.view,
    label: t(`posts.preview.short.${x.view}`),
    icon: icons
      ? x.view.startsWith('instagram')
        ? 'i-lucide-instagram'
        : 'i-lucide-facebook'
      : undefined,
  }))
})
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

// ---- the files: the copy published, or the original's copy for the panel
const media = computed(() => new Map(props.post.media.map((m) => [m.id, m])))
const fileUrl = (mediaId: string, variant: string) =>
  `${props.api}/media/${encodeURIComponent(mediaId)}/file/${variant}`
const copyUrl = (mediaId: string, copyId: string) =>
  `${props.api}/media/${encodeURIComponent(mediaId)}/copies/${encodeURIComponent(copyId)}`
/** the original's best copy for the panel: the MP4 of a video, the feed's JPEG of a photo */
function originalUrl(mediaId: string, video: boolean): string | null {
  const variants = media.value.get(mediaId)?.variants ?? []
  const order = video ? ['preview'] : ['ig_feed', 'preview', 'thumbnail']
  const found = order.find((v) => variants.includes(v))
  return found ? fileUrl(mediaId, found) : null
}
const thumbnailOf = (mediaId: string) =>
  media.value.get(mediaId)?.variants.includes('thumbnail') ? fileUrl(mediaId, 'thumbnail') : null

const files = computed(() => version.value?.files ?? [])
const first = computed(() => files.value[0])
/** the feed's frame: the first file's proportions, as Instagram (a copy is already cut) */
const feedRatio = computed(() =>
  first.value?.width && first.value.height
    ? clampFeedRatio(first.value.width / first.value.height)
    : 1,
)
/** the cover that went out: the copy, or (copies gone) the image chosen or the video's frame */
const cover = computed(() => {
  const c = version.value?.cover
  if (!c || !props.showFiles) return null
  if (c.copyId) return { src: copyUrl(c.mediaId, c.copyId), startMs: c.offsetMs ?? undefined }
  if (c.offsetMs !== null) return { src: null, startMs: c.offsetMs }
  // an image chosen as the cover is not among the post's files: its thumbnail, every image has one
  return { src: fileUrl(c.mediaId, 'thumbnail'), startMs: undefined }
})
const items = computed<PreviewItem[]>(() =>
  files.value.slice(0, vertical.value ? 1 : undefined).map((f, index) => {
    const video = f.kind === 'video'
    const src = !props.showFiles
      ? null
      : f.copyId
        ? copyUrl(f.mediaId, f.copyId)
        : originalUrl(f.mediaId, video)
    const poster = video && props.showFiles ? (cover.value?.src ?? thumbnailOf(f.mediaId)) : null
    return {
      index,
      name: media.value.get(f.mediaId)?.originalName ?? t('posts.media.unnamed'),
      video,
      src,
      poster,
      // a copy is the file as it went out: whole in a reel's frame, filling the feed's
      framing: { mode: vertical.value ? 'contain' : 'fill', crop: null },
    }
  }),
)

const fbWhen = computed(() => {
  const at = props.post.scheduledAt
  if (!at) return ''
  const zone = { timeZone: props.post.timezone }
  return t('posts.preview.fbWhen', {
    day: new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'long', ...zone }).format(
      new Date(at),
    ),
    time: new Intl.DateTimeFormat(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
      ...zone,
    }).format(new Date(at)),
  })
})
const feedAt = ref(0)
watch([view, accountId], () => (feedAt.value = 0))
</script>

<template>
  <div class="flex flex-col gap-3" data-outcome-preview>
    <div class="flex min-h-control flex-wrap items-center gap-2">
      <h2 class="flex-1 font-semibold">{{ t('posts.outcome.asItWent') }}</h2>
      <SegmentedFilter
        v-if="tabs.length > 1 && view"
        v-model="view"
        :label="t('posts.preview.tabs')"
        :options="options"
      />
    </div>
    <template v-if="tab && view && version">
      <label v-if="tab.differ" class="flex flex-col gap-1 text-sm">
        <span class="sr-only">{{ t('posts.preview.account') }}</span>
        <select
          v-model="accountId"
          class="min-h-11 rounded-lg border border-(--app-border) bg-(--app-surface) px-3 md:min-h-control"
          data-outcome-account
        >
          <option v-for="id in tab.accountIds" :key="id" :value="id">
            {{ accountLabel(id) }}
          </option>
        </select>
      </label>
      <PostPreviewFrame :app="platform" :vertical="vertical" reserve="14rem" width="20rem">
        <PostPreviewInstagramFeed
          v-if="view === 'instagram_feed'"
          v-model:at="feedAt"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :items="items"
          :frame-ratio="feedRatio"
          :caption="version.caption"
        />
        <PostPreviewFacebookPost
          v-else-if="view === 'facebook_post'"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :items="items"
          :caption="version.caption"
          :when="fbWhen"
        />
        <PostPreviewVerticalPost
          v-else
          :view="view"
          :name="handle"
          :avatar="account?.avatarUrl ?? null"
          :item="items[0]"
          :caption="version.caption"
          :zones="false"
          :start-ms="view.endsWith('_reel') && !cover?.src ? cover?.startMs : undefined"
        />
      </PostPreviewFrame>
    </template>
    <p
      v-if="preview.originals && showFiles"
      class="text-detail text-(--app-text-muted)"
      data-outcome-originals
    >
      {{ t('posts.outcome.originals') }}
    </p>
  </div>
</template>
