<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CalendarPost, GridPublished } from '@app/contracts'
import type { WorkspaceProfile } from '~/composables/useActiveContext'
import type { WorkspaceView } from '~/composables/useOrganization'
import { mayMove } from '~/utils/calendar-move'
import {
  gridInstagramAccounts,
  gridSignOf,
  type GridSign,
  type GridSwapPost,
} from '~/utils/calendar-grid'

/**
 * «Griglia», the fourth view of the client's calendar (spec §11.5, plan 09 Scelta 10, Task 12):
 * how one Instagram account of the client will look, three columns cut to 3:4 as Instagram shows
 * them. The scheduled posts of the next 30 days come first, the one furthest ahead in the first
 * place, above the last 30 out, read from Instagram at every opening. Only the scheduled ones
 * move: dropped on another, or with «Scambia con…» from their «⋯», the two swap their times,
 * after a confirmation and with «Annulla» (P7). A post out never moves.
 */
const props = defineProps<{
  workspace: WorkspaceView
  profiles: WorkspaceProfile[]
  profileAccountIds: string[] | null
}>()

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()

// ---- the account: one Instagram of the client (or of the profile of the context) at a time
const accounts = computed(() => gridInstagramAccounts(props.profiles, props.profileAccountIds))
const picked = ref<string | null>(null)
const accountId = computed(() =>
  accounts.value.some((a) => a.id === picked.value)
    ? picked.value
    : (accounts.value[0]?.id ?? null),
)
const accountItems = computed(() => accounts.value.map((a) => ({ value: a.id, label: a.label })))
const chosenAccount = computed({
  get: () => accountId.value ?? undefined,
  set: (id: string | undefined) => (picked.value = id ?? null),
})

const grid = useCalendarGrid({
  workspaceId: computed(() => props.workspace.id),
  accountId,
})
const { data, status, toast, problem } = grid

// ---- the places
const keep = computed(() => {
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== '' ? { profilo } : {}
})
interface ScheduledPlace {
  kind: 'scheduled'
  post: CalendarPost
  title: string
  when: string
  thumb: string | null
  sign: GridSign | null
  movable: boolean
  to: { path: string; query: Record<string, string> }
}
interface PublishedPlace {
  kind: 'published'
  media: GridPublished
  thumb: string | null
  sign: GridSign | null
  when: string | null
}
const DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const PUBLISHED_DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long' })
const scheduled = computed<ScheduledPlace[]>(() =>
  (data.value?.scheduled ?? []).map((p) => ({
    kind: 'scheduled',
    post: p,
    title: postTitle(p, t),
    when:
      p.localDate && p.localTime
        ? `${DAY.format(new Date(`${p.localDate}T00:00:00Z`))}, ${formatTime(p.localTime)}`
        : '',
    thumb: p.thumbnail
      ? org.api(
          `/workspaces/${encodeURIComponent(p.workspaceId)}/media/${encodeURIComponent(p.thumbnail.mediaId)}/file/${p.thumbnail.variant}`,
        )
      : null,
    sign: gridSignOf(p),
    movable: p.status === 'scheduled' && mayMove(p, props.workspace, org.me.value?.id ?? null),
    to: {
      path: org.to(
        `/spazi/${encodeURIComponent(props.workspace.slug)}/post/${encodeURIComponent(p.id)}`,
      ),
      query: keep.value,
    },
  })),
)
const published = computed<PublishedPlace[]>(() => {
  const out = data.value?.published
  if (!out?.ok) return []
  return out.items.map((m) => ({
    kind: 'published',
    media: m,
    thumb: m.picture === null ? null : grid.thumbnailOf(m.picture),
    sign: gridSignOf(m),
    when: m.publishedAt ? PUBLISHED_DAY.format(new Date(m.publishedAt)) : null,
  }))
})
const SIGN_ICON: Record<GridSign, string> = {
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  video: 'i-lucide-play',
}
/**
 * The addresses of the pictures of posts out that did not arrive: their places show the sign of
 * their media. A grid read again gives new addresses, which are tried.
 */
const broken = ref(new Set<string>())
watch(accountId, () => (broken.value = new Set()))
function pictureFailed(thumb: string) {
  broken.value = new Set([...broken.value, thumb])
  // its token may have expired: the grid is read again with new ones, which are tried
  grid.refreshIfStale()
}
const unread = computed(() => {
  const out = data.value?.published
  return out && !out.ok ? out.reason : null
})

// ---- swapping two scheduled posts
const swapPostOf = (s: ScheduledPlace): GridSwapPost => ({
  id: s.post.id,
  version: s.post.version,
  title: s.title,
  when: s.when,
  thumb: s.thumb,
})
const movable = computed(() => scheduled.value.filter((s) => s.movable))
const dialog = reactive({
  open: false,
  post: null as GridSwapPost | null,
  other: null as GridSwapPost | null,
})
const others = computed(() =>
  movable.value.filter((s) => s.post.id !== dialog.post?.id).map(swapPostOf),
)
function askSwap(s: ScheduledPlace, other: ScheduledPlace | null) {
  Object.assign(dialog, {
    open: true,
    post: swapPostOf(s),
    other: other ? swapPostOf(other) : null,
  })
}
async function swap(a: GridSwapPost, b: GridSwapPost) {
  // closed either way: a refusal is said above the grid, which is read again
  await grid.swap(a, b)
  dialog.open = false
}
function actionsOf(s: ScheduledPlace): DropdownMenuItem[][] {
  if (!s.movable || movable.value.length < 2) return []
  return [
    [
      {
        label: t('calendar.grid.swapAction'),
        icon: 'i-lucide-arrow-left-right',
        onSelect: () => askSwap(s, null),
      },
    ],
  ]
}

// dragging, on a computer: a scheduled post onto another
const lifted = ref<string | null>(null)
const over = ref<string | null>(null)
const draggable = (s: ScheduledPlace) => s.movable && movable.value.length > 1
function lift(event: DragEvent, s: ScheduledPlace) {
  if (!draggable(s)) {
    event.preventDefault()
    return
  }
  lifted.value = s.post.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', s.post.id)
  }
}
function settle() {
  lifted.value = null
  over.value = null
}
function dragOver(event: DragEvent, s: ScheduledPlace) {
  if (!lifted.value || lifted.value === s.post.id || !s.movable) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  over.value = s.post.id
}
function leave(event: DragEvent, s: ScheduledPlace) {
  const to = event.relatedTarget
  if (
    over.value === s.post.id &&
    !(to instanceof Node && (event.currentTarget as Node).contains(to))
  )
    over.value = null
}
function drop(event: DragEvent, s: ScheduledPlace) {
  event.preventDefault()
  const from = scheduled.value.find((x) => x.post.id === lifted.value)
  settle()
  if (from && from.post.id !== s.post.id && s.movable) askSwap(from, s)
}

/** a post out opens on Instagram; without its page it is only a picture */
function publishedLabel(p: PublishedPlace) {
  const out = p.when
    ? t('calendar.grid.publishedOn', { when: p.when })
    : t('calendar.grid.publishedItem')
  return p.media.permalink ? `${out}, ${t('calendar.grid.openOnInstagram')}` : out
}

const loading = computed(() => status.value === 'pending' && data.value === null)
const failed = computed(() => status.value === 'error')
const name = computed(() => {
  const a = data.value?.account
  if (!a) return accounts.value.find((x) => x.id === accountId.value)?.label ?? ''
  return a.username ? `@${a.username}` : a.name
})
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-stack"
    data-calendar-grid
    :data-ready="data !== null || failed || undefined"
  >
    <p v-if="accounts.length === 0" class="text-(--app-text-muted)" role="status" data-grid-none>
      {{ $t('calendar.grid.noAccount') }}
    </p>
    <template v-else>
      <div class="flex flex-col items-start gap-1.5">
        <USelect
          v-if="accounts.length > 1"
          v-model="chosenAccount"
          :items="accountItems"
          :aria-label="$t('calendar.grid.account')"
          icon="i-lucide-instagram"
          class="min-w-56 max-md:w-full"
          data-grid-account
        />
        <h2
          v-else
          class="flex items-center gap-2 text-[14px] leading-5 font-semibold"
          data-grid-account-name
        >
          <UIcon name="i-lucide-instagram" class="size-4" aria-hidden="true" />
          {{ name }}
        </h2>
        <p class="max-w-[75ch] text-(--app-text-muted)" data-grid-hint>
          <template v-if="movable.length > 1">
            <!-- a touch screen does not drag: only «Scambia con…» -->
            <span class="pointer-coarse:hidden">{{ $t('calendar.grid.hintMove') }}</span>
            <span class="hidden pointer-coarse:inline">{{
              $t('calendar.grid.hintMoveTouch')
            }}</span>
          </template>
          <template v-else>{{ $t('calendar.grid.hint') }}</template>
        </p>
      </div>

      <LoadFailed v-if="failed" :text="$t('calendar.grid.failedRead')" @retry="grid.load()" />
      <template v-else>
        <p
          v-if="unread"
          class="flex items-start gap-2 text-(--app-text-muted)"
          role="status"
          data-grid-unread
          :data-reason="unread"
        >
          <UIcon
            name="i-lucide-info"
            class="mt-0.5 size-4 shrink-0"
            :class="unread === 'unavailable' ? '' : 'text-(--app-warning)'"
            aria-hidden="true"
          />
          <span>
            {{ $t(`calendar.grid.unread.${unread}`) }}
            <UButton
              v-if="unread === 'unavailable'"
              color="neutral"
              variant="link"
              class="px-0 underline underline-offset-3"
              @click="grid.load()"
              >{{ $t('calendar.grid.retry') }}</UButton
            >
          </span>
        </p>
        <p
          v-if="problem"
          role="alert"
          class="flex items-start gap-2 text-(--app-danger)"
          data-grid-problem
        >
          <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {{ problem }}
        </p>
        <p
          v-if="!loading && scheduled.length === 0"
          class="text-(--app-text-muted)"
          role="status"
          data-grid-no-scheduled
        >
          {{ $t('calendar.grid.noScheduled') }}
        </p>

        <ul
          class="grid w-full max-w-[38rem] grid-cols-3 gap-0.5 overflow-hidden rounded-card"
          :aria-label="$t('calendar.grid.label', { name })"
          :aria-busy="loading || undefined"
          data-grid
        >
          <template v-if="loading">
            <li
              v-for="i in 9"
              :key="i"
              class="aspect-[3/4] animate-pulse bg-(--app-surface-sunken)"
              aria-hidden="true"
            />
          </template>
          <template v-else>
            <li
              v-for="s in scheduled"
              :key="s.post.id"
              class="group/place relative aspect-[3/4] min-w-0"
              :class="over === s.post.id ? 'outline-2 -outline-offset-2 outline-(--app-brand)' : ''"
              data-grid-scheduled
              :data-post="s.post.id"
              :data-movable="draggable(s) || undefined"
              @dragover="dragOver($event, s)"
              @dragleave="leave($event, s)"
              @drop="drop($event, s)"
            >
              <NuxtLink
                :to="s.to"
                :aria-label="`${s.when}, ${$t(`posts.type.${s.post.type}`)}, ${s.title}`"
                class="block size-full overflow-hidden bg-(--app-surface-sunken) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus)"
                :class="[
                  draggable(s) ? 'cursor-grab active:cursor-grabbing' : '',
                  lifted === s.post.id ? 'opacity-40' : '',
                ]"
                :draggable="draggable(s) ? 'true' : 'false'"
                @dragstart="lift($event, s)"
                @dragend="settle"
              >
                <img
                  v-if="s.thumb"
                  :src="s.thumb"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="size-full object-cover"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-(--app-text-muted)"
                  aria-hidden="true"
                >
                  <PostTypeIcon :type="s.post.type" class="text-[22px]" />
                </span>
                <!-- the time on a dark ground: a scheduled place is told from one out at once -->
                <span
                  class="absolute inset-x-0 bottom-0 flex items-end bg-linear-to-t from-black/60 to-transparent px-2 pt-6 pb-1.5 text-caption font-semibold text-white tabular-nums"
                  aria-hidden="true"
                  >{{ s.when }}</span
                >
                <UIcon
                  v-if="s.sign"
                  :name="SIGN_ICON[s.sign]"
                  class="absolute top-1.5 right-1.5 size-4 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
                  aria-hidden="true"
                />
              </NuxtLink>
              <div
                v-if="actionsOf(s).length > 0"
                class="absolute top-1 left-1 rounded-control bg-(--app-surface) opacity-0 shadow-1 group-hover/place:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
                data-grid-actions
              >
                <RowActions :name="s.title" :items="actionsOf(s)" compact />
              </div>
            </li>
            <li
              v-for="p in published"
              :key="p.media.id"
              class="relative aspect-[3/4] min-w-0 bg-(--app-surface-sunken)"
              data-grid-published
              :data-media="p.media.id"
            >
              <component
                :is="p.media.permalink ? 'a' : 'span'"
                :href="p.media.permalink ?? undefined"
                :target="p.media.permalink ? '_blank' : undefined"
                :rel="p.media.permalink ? 'noopener noreferrer' : undefined"
                :role="p.media.permalink ? undefined : 'img'"
                :aria-label="publishedLabel(p)"
                class="block size-full overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--app-focus)"
              >
                <img
                  v-if="p.thumb && !broken.has(p.thumb)"
                  :src="p.thumb"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="size-full object-cover"
                  @error="pictureFailed(p.thumb)"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-(--app-text-muted)"
                  aria-hidden="true"
                >
                  <UIcon name="i-lucide-image-off" class="size-5" />
                </span>
                <UIcon
                  v-if="p.sign"
                  :name="SIGN_ICON[p.sign]"
                  class="absolute top-1.5 right-1.5 size-4 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]"
                  aria-hidden="true"
                />
              </component>
            </li>
          </template>
        </ul>
      </template>
    </template>

    <CalendarGridSwapDialog
      v-model:open="dialog.open"
      :post="dialog.post"
      :other="dialog.other"
      :others="others"
      :busy="grid.swapping.value"
      @swap="swap"
    />
    <Toast
      v-model:open="toast.open"
      :message="toast.message"
      :action-label="toast.action || undefined"
      @action="grid.runUndo"
    />
  </section>
</template>
