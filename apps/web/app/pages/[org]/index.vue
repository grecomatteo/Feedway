<script setup lang="ts">
/**
 * «Oggi» (D-81, screens 02 and 03): three questions in this order. What needs a hand («Da
 * sistemare», with the button that fixes each problem, or one calm line when nothing does), what
 * goes out («In uscita»: the week in a strip, then today and tomorrow, or the day picked in the
 * strip), what was left half done («Bozze da finire») and the clients worked on last. With a
 * client in the selector the page is about that client only.
 */
import type { AgendaIssue, AgendaPost, DraftToFinish } from '@app/contracts'

definePageMeta({ layout: 'agency' })

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const toast = useToast()
const { workspace, visible } = useActiveContext()
const newPost = useNewPost()
// the Owner sees where the first setup stopped (spec §8.1), until an account is imported
const setup = useFirstSetup()
useHead({ title: () => t('today.title') })

const workspaceId = computed(() => workspace.value?.id ?? null)
const { now, from, agenda, drafts, clients } = useAgenda(workspaceId)
const issuesRead = useAgendaIssues()
// the issues may have changed since the sidebar read them
onMounted(() => void issuesRead.refresh())

const clientOf = (id: string) => visible.value.find((w) => w.id === id) ?? null
const clientName = (id: string) => clientOf(id)?.name ?? ''
const clientPage = (id: string, tail = '') => {
  const w = clientOf(id)
  return w ? org.to(`/spazi/${encodeURIComponent(w.slug)}${tail}`) : org.to('/spazi')
}
const postPage = (workspaceId: string, postId: string) =>
  clientPage(workspaceId, `/post/${encodeURIComponent(postId)}`)

// ---- what a row shows
const TYPE_ICON: Record<AgendaPost['type'], string> = {
  photo: 'i-lucide-image',
  carousel: 'i-lucide-gallery-horizontal-end',
  reel: 'i-lucide-clapperboard',
  story: 'i-lucide-circle-dashed',
}
const thumbOf = (p: { workspaceId: string; thumbnail: AgendaPost['thumbnail'] }) =>
  p.thumbnail
    ? org.api(
        `/workspaces/${encodeURIComponent(p.workspaceId)}/media/${encodeURIComponent(p.thumbnail.mediaId)}/file/${p.thumbnail.variant}`,
      )
    : null
const textOf = (p: { text: string }) => p.text || t('posts.list.noText')

// ---- Da sistemare
const issues = computed(() => issuesOf(issuesRead.data.value?.items ?? [], workspaceId.value))
const issueKey = (i: AgendaIssue) =>
  i.kind === 'profile' ? `${i.workspaceId}-${i.profileKey}` : i.mediaId
const issueTitle = (i: AgendaIssue) =>
  i.kind === 'profile'
    ? t(`today.issues.profile.${i.link}`, { name: i.name })
    : t('today.issues.media', { name: i.name })
const issueDetail = (i: AgendaIssue) => {
  const client = clientName(i.workspaceId)
  if (i.kind === 'media')
    return `${client} · ${formatRelative(i.failedAt, { sentence: true, now })}`
  const where = t(`today.issues.where.${i.platform}`)
  return `${client} · ${t('today.issues.scheduled', { n: i.scheduled, where }, i.scheduled)}`
}
const retrying = ref<string | null>(null)
async function retry(i: AgendaIssue & { kind: 'media' }) {
  retrying.value = i.mediaId
  try {
    await call(
      'POST',
      org.api(
        `/workspaces/${encodeURIComponent(i.workspaceId)}/media/${encodeURIComponent(i.mediaId)}/retry`,
      ),
    )
    toast.add({ title: t('today.issues.retried', { name: i.name }), color: 'success' })
    await issuesRead.refresh()
  } catch (error) {
    toast.add({ title: failure(error).message, color: 'error' })
  } finally {
    retrying.value = null
  }
}

// ---- In uscita: the week in a strip, then today and tomorrow or the day picked
const WEEKDAY = new Intl.DateTimeFormat('it-IT', { weekday: 'short' }) // «lun»
const posts = computed(() => agenda.data.value?.items ?? [])
const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const day = dayStart(from, i)
    const own = posts.value.filter((p) => sameDay(new Date(p.scheduledAt), day))
    return {
      key: day.toISOString(),
      day,
      today: sameDay(day, now),
      past: day < dayStart(now),
      weekday: sameDay(day, now) ? t('today.week.today') : WEEKDAY.format(day),
      number: day.getDate(),
      posts: own,
    }
  }),
)
const picked = ref<string | null>(null)
function pick(key: string, today: boolean) {
  picked.value = today || picked.value === key ? null : key
}
const STATUS_BAR: Record<AgendaPost['status'], string> = {
  scheduled: 'bg-(--app-info)',
  draft: 'bg-(--app-neutral-dot)',
  cancelled: 'bg-(--app-neutral-dot)',
}
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** The groups of the list: today and tomorrow, or the day picked in the strip. */
const groups = computed(() => {
  const wanted = picked.value ? [new Date(picked.value)] : [dayStart(now), dayStart(now, 1)]
  return wanted.map((day, i) => {
    const long = formatDay(day, { now }) // «venerdì 20 novembre»
    const short = long.split(' ').slice(0, 2).join(' ') // «venerdì 20»
    let label = capitalised(short)
    if (!picked.value && i === 0) label = t('today.list.today')
    if (!picked.value && i === 1) label = t('today.list.tomorrow', { day: short })
    return {
      key: day.toISOString(),
      label,
      posts: posts.value.filter((p) => sameDay(new Date(p.scheduledAt), day)),
    }
  })
})
const nothingListed = computed(() => groups.value.every((g) => g.posts.length === 0))
const timeOf = (p: AgendaPost) => formatTime(p.scheduledAt, { timeZone: p.timezone })

// ---- Bozze da finire
const draftItems = computed(() => drafts.data.value?.items ?? [])
const missingOf = (d: DraftToFinish) =>
  d.missing.length === 0 ? t('today.drafts.ready') : t(`today.drafts.missing.${d.missing[0]}`)
const allDrafts = computed(() =>
  workspaceId.value
    ? { path: clientPage(workspaceId.value, '/post'), query: { stato: 'draft' } }
    : null,
)

// ---- Clienti recenti
const recent = computed(() =>
  (clients.data.value?.items ?? []).filter((c) => clientOf(c.workspaceId) !== null).slice(0, 4),
)

const skeletonRows = [0, 1, 2]
const agendaLoading = computed(
  () => agenda.status.value === 'pending' || agenda.status.value === 'idle',
)
// every read has answered (for the measures and the comparisons)
const settled = (s: string) => s === 'success' || s === 'error'
const ready = computed(
  () =>
    settled(agenda.status.value) &&
    settled(drafts.status.value) &&
    settled(clients.status.value) &&
    settled(issuesRead.status.value),
)
</script>

<template>
  <PageShell v-if="org.organization.value" :title="$t('today.title')">
    <template #aside>{{ formatDay(now, { now }) }}</template>

    <section
      v-if="setup.step.value !== null && setup.step.value !== 6"
      aria-labelledby="first-setup"
      class="space-y-3 rounded-card border border-(--app-brand) bg-(--app-brand-soft) p-4 sm:p-6"
    >
      <h2 id="first-setup">{{ $t('firstSetup.title') }}</h2>
      <p class="max-w-prose">{{ $t('firstSetup.home', { n: setup.step.value }) }}</p>
      <UButton
        :to="org.to('/configurazione')"
        color="neutral"
        variant="outline"
        icon="i-lucide-arrow-right"
      >
        {{ $t('firstSetup.resume') }}
      </UButton>
    </section>

    <div class="flex flex-col gap-7 max-md:gap-6" :data-ready="ready || undefined">
      <!-- Da sistemare: a row for each problem; nothing to fix is one calm line (screen 03) -->
      <section v-if="issues.length > 0" :aria-label="$t('today.issues.title')" data-today-issues>
        <SectionHead :title="$t('today.issues.title')" :count="issues.length" />
        <ListSurface columns="20px minmax(0, 1fr) auto" :label="$t('today.issues.title')">
          <ListRow
            v-for="i in issues"
            :key="issueKey(i)"
            class="max-md:py-2.5"
            :style="{ columnGap: '12px' }"
            :data-issue="i.kind"
          >
            <UIcon
              :name="i.kind === 'profile' ? 'i-lucide-unplug' : 'i-lucide-triangle-alert'"
              class="size-[18px] text-(--app-warning-dot)"
              aria-hidden="true"
            />
            <span class="min-w-0">
              <span class="block font-medium">{{ issueTitle(i) }}</span>
              <span class="block truncate text-detail text-(--app-text-muted)">{{
                issueDetail(i)
              }}</span>
            </span>
            <template v-if="i.kind === 'profile'">
              <UButton
                v-if="org.may.value.manageAccounts"
                :to="org.to('/impostazioni/integrazioni/meta')"
                color="neutral"
                variant="outline"
                size="sm"
                :aria-label="$t('today.issues.reconnectOf', { name: i.name })"
                >{{ $t('workspaces.reconnect') }}</UButton
              >
              <UButton
                v-else
                :to="clientPage(i.workspaceId)"
                color="neutral"
                variant="outline"
                size="sm"
                >{{ $t('today.issues.openClient') }}</UButton
              >
            </template>
            <UButton
              v-else-if="i.retryable"
              color="neutral"
              variant="outline"
              size="sm"
              :loading="retrying === i.mediaId"
              :aria-label="$t('today.issues.retryOf', { name: i.name })"
              @click="retry(i)"
              >{{ $t('today.issues.retry') }}</UButton
            >
            <UButton
              v-else
              :to="clientPage(i.workspaceId, '/libreria')"
              color="neutral"
              variant="outline"
              size="sm"
              >{{ $t('today.issues.openLibrary') }}</UButton
            >
          </ListRow>
        </ListSurface>
      </section>
      <p
        v-else-if="issuesRead.data.value"
        class="flex items-center gap-2 text-(--app-text-muted)"
        data-today-calm
      >
        <UIcon
          name="i-lucide-circle-check"
          class="size-4 text-(--app-success)"
          aria-hidden="true"
        />
        {{ $t('today.issues.none') }}
      </p>

      <div class="grid items-start gap-8 max-lg:gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
        <!-- In uscita -->
        <section
          :aria-label="$t('today.out.title')"
          :aria-busy="agendaLoading || undefined"
          data-today-out
        >
          <SectionHead :title="$t('today.out.title')" />
          <div class="rounded-card border border-(--app-border) bg-(--app-surface)">
            <div
              class="grid grid-cols-7 border-b border-(--app-border)"
              role="group"
              :aria-label="$t('today.week.label')"
              data-week
            >
              <button
                v-for="d in days"
                :key="d.key"
                type="button"
                :aria-pressed="picked === d.key"
                :aria-label="
                  $t(
                    'today.week.dayLabel',
                    { day: formatDay(d.day, { now }), n: d.posts.length },
                    d.posts.length,
                  )
                "
                class="relative border-s border-(--app-border) px-3.5 pt-2.5 pb-3 text-start first:border-s-0 hover:bg-(--app-nav-hover) aria-pressed:bg-(--app-nav-hover) max-md:px-0 max-md:pt-2 max-md:pb-2.5 max-md:text-center"
                :data-today="d.today || undefined"
                @click="pick(d.key, d.today)"
              >
                <span class="block text-caption text-(--app-text-muted)">{{ d.weekday }}</span>
                <span
                  class="mt-0.5 flex items-baseline gap-1.5 text-[15px] leading-5 font-semibold tabular-nums max-md:justify-center"
                  :class="d.past ? 'text-(--app-text-muted)' : ''"
                >
                  {{ d.number }}
                  <span class="text-caption font-normal text-(--app-text-muted) max-md:hidden">{{
                    d.posts.length === 0
                      ? $t('today.week.free')
                      : $t('today.week.posts', { n: d.posts.length }, d.posts.length)
                  }}</span>
                </span>
                <span
                  class="mt-2 flex h-1 gap-[3px] overflow-hidden max-md:justify-center max-md:h-[5px]"
                >
                  <i
                    v-for="p in d.posts"
                    :key="p.id"
                    class="block w-3.5 shrink-0 rounded-[2px] max-md:size-[5px] max-md:rounded-full"
                    :class="STATUS_BAR[p.status]"
                  />
                </span>
                <span
                  v-if="d.today"
                  class="absolute inset-x-0 -bottom-px h-0.5 bg-(--app-brand)"
                  aria-hidden="true"
                  data-accent
                />
              </button>
            </div>

            <!-- the skeletons say nothing to a screen reader: the section is busy meanwhile -->
            <div v-if="agendaLoading" aria-hidden="true">
              <div
                v-for="n in skeletonRows"
                :key="n"
                class="flex min-h-row items-center gap-3.5 px-4"
              >
                <USkeleton class="h-4 w-11" />
                <USkeleton class="size-10 rounded-thumb" />
                <USkeleton class="h-4 flex-1" />
              </div>
            </div>
            <div
              v-else-if="agenda.error.value"
              role="alert"
              class="flex min-h-row items-center justify-between gap-3 px-4"
            >
              <span class="text-(--app-text-muted)">{{ $t('today.out.failed') }}</span>
              <UButton color="neutral" variant="outline" size="sm" @click="agenda.refresh()">{{
                $t('today.out.again')
              }}</UButton>
            </div>
            <div
              v-else-if="nothingListed"
              class="flex min-h-row items-center justify-between gap-3 px-4"
              data-today-empty
            >
              <span class="text-(--app-text-muted)">{{
                picked ? $t('today.out.emptyDay') : $t('today.out.empty')
              }}</span>
              <UButton
                v-if="newPost.allowed.value"
                :to="newPost.link.value"
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                class="shrink-0"
                >{{ $t('client.newPost') }}</UButton
              >
            </div>
            <template v-else>
              <section
                v-for="(g, gi) in groups"
                :key="g.key"
                :aria-label="g.label"
                :class="gi > 0 ? 'mt-1.5 border-t border-(--app-border)' : ''"
                data-day-group
              >
                <h3 class="px-4 pt-3.5 pb-1.5 text-caption font-medium text-(--app-text-muted)">
                  {{ g.label }}
                </h3>
                <p v-if="g.posts.length === 0" class="px-4 pb-3 text-(--app-text-muted)">
                  {{ $t('today.out.none') }}
                </p>
                <ul v-else>
                  <li
                    v-for="p in g.posts"
                    :key="p.id"
                    class="grid min-h-row grid-cols-[48px_40px_minmax(0,1fr)_150px_56px_124px] items-center gap-x-3.5 px-4 max-md:grid-cols-[44px_40px_minmax(0,1fr)] max-md:gap-x-3 max-md:px-3.5"
                    :data-post="p.id"
                  >
                    <span class="font-semibold tabular-nums">{{ timeOf(p) }}</span>
                    <span
                      class="flex size-10 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
                    >
                      <img
                        v-if="thumbOf(p)"
                        :src="thumbOf(p)!"
                        alt=""
                        class="size-full object-cover"
                      />
                      <UIcon v-else :name="TYPE_ICON[p.type]" class="size-4" aria-hidden="true" />
                    </span>
                    <span class="min-w-0">
                      <NuxtLink
                        :to="postPage(p.workspaceId, p.id)"
                        class="block truncate font-medium underline-offset-3 hover:underline"
                        >{{ textOf(p) }}</NuxtLink
                      >
                      <span
                        class="hidden items-center justify-between gap-2.5 text-detail text-(--app-text-muted) max-md:flex"
                      >
                        <span class="truncate">{{ clientName(p.workspaceId) }}</span>
                        <StatusDot
                          status="scheduled"
                          :label="$t('posts.list.state.scheduled')"
                          class="shrink-0"
                        />
                      </span>
                    </span>
                    <span class="truncate text-(--app-text-muted) max-md:hidden">{{
                      clientName(p.workspaceId)
                    }}</span>
                    <PlatformIcons :platforms="p.platforms" class="max-md:hidden" />
                    <StatusDot
                      status="scheduled"
                      :label="$t('posts.list.state.scheduled')"
                      class="max-md:hidden"
                    />
                  </li>
                </ul>
              </section>
            </template>
          </div>
        </section>

        <div class="flex min-w-0 flex-col gap-7">
          <!-- Bozze da finire -->
          <section
            v-if="draftItems.length > 0"
            :aria-label="$t('today.drafts.title')"
            data-today-drafts
          >
            <SectionHead
              :title="$t('today.drafts.title')"
              :count="drafts.data.value?.total ?? null"
            >
              <NuxtLink
                v-if="allDrafts"
                :to="allDrafts"
                class="text-detail underline underline-offset-3"
                >{{ $t('today.drafts.all') }}</NuxtLink
              >
            </SectionHead>
            <ListSurface :label="$t('today.drafts.title')">
              <ListRow v-for="d in draftItems" :key="d.id" class="px-3.5">
                <span class="flex min-w-0 items-center gap-3">
                  <span
                    class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline)"
                  >
                    <img
                      v-if="thumbOf(d)"
                      :src="thumbOf(d)!"
                      alt=""
                      class="size-full object-cover"
                    />
                    <UIcon v-else name="i-lucide-image" class="size-4" aria-hidden="true" />
                  </span>
                  <span class="min-w-0">
                    <NuxtLink
                      :to="postPage(d.workspaceId, d.id)"
                      class="block truncate font-medium underline-offset-3 hover:underline"
                      >{{ textOf(d) }}</NuxtLink
                    >
                    <span class="block truncate text-detail text-(--app-text-muted)"
                      >{{ clientName(d.workspaceId) }} · {{ missingOf(d) }}</span
                    >
                  </span>
                </span>
                <span class="text-detail text-(--app-text-muted)">{{
                  formatRelative(d.updatedAt, { time: false, now })
                }}</span>
              </ListRow>
            </ListSurface>
          </section>

          <!-- Clienti recenti: only across the clients -->
          <section
            v-if="workspaceId === null && recent.length > 0"
            :aria-label="$t('today.clients.title')"
            data-today-clients
          >
            <SectionHead :title="$t('today.clients.title')">
              <NuxtLink :to="org.to('/spazi')" class="text-detail underline underline-offset-3">{{
                $t('today.clients.all')
              }}</NuxtLink>
            </SectionHead>
            <ListSurface :label="$t('today.clients.title')">
              <ListRow v-for="c in recent" :key="c.workspaceId" class="px-3.5">
                <span class="flex min-w-0 items-center gap-3">
                  <Avatar
                    :name="clientName(c.workspaceId)"
                    :src="clientOf(c.workspaceId)?.photoUrl"
                  />
                  <NuxtLink
                    :to="clientPage(c.workspaceId)"
                    class="truncate font-medium underline-offset-3 hover:underline"
                    >{{ clientName(c.workspaceId) }}</NuxtLink
                  >
                </span>
                <span class="text-detail text-(--app-text-muted)">{{
                  c.scheduled === 0
                    ? $t('today.clients.none')
                    : $t('today.clients.scheduled', { n: c.scheduled }, c.scheduled)
                }}</span>
              </ListRow>
            </ListSurface>
          </section>
        </div>
      </div>
    </div>
  </PageShell>
</template>
