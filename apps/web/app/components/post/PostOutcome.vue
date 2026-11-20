<script setup lang="ts">
import type { PostOutcomeResponse, PostResponse } from '@app/contracts'

/**
 * The page of the outcome (plan 07 Scelta 6, screen 13): a post out or on its way, read only.
 * On the left its files, its text, its labels, its type and who wrote it; on the right «Esito»,
 * a row per destination with its state, «Apri su Instagram» or the reason in words, and what can
 * be done («Riprova», «Segna come verificato», «Annulla su questo account»); under it «Attività».
 * A post in pause says so at the top, with «Riprendi» and «Annulla» for whoever manages the
 * posts of others (P5). While a destination is on its way, the page reads itself every 10 seconds.
 * «Modifica per Facebook» and «Duplica» of the screen come later (D-101, stage 9).
 */
const props = defineProps<{
  client: WorkspaceView
  post: PostResponse
  profiles: WorkspaceProfile[]
  back: string
}>()
const { t, te } = useI18n()
const org = useOrganization()
const { call, failure } = useApi()

const api = computed(() => org.api(`/workspaces/${encodeURIComponent(props.client.id)}`))
const postApi = computed(() => `${api.value}/posts/${encodeURIComponent(current.value.id)}`)

const current = ref<PostResponse>(props.post)
const outcome = ref<PostOutcomeResponse | null>(null)
const loadFailed = ref(false)
const problem = ref<string | null>(null)
const busy = ref<string | null>(null)

async function read() {
  try {
    const [p, o] = await Promise.all([
      call<PostResponse>('GET', postApi.value),
      call<PostOutcomeResponse>('GET', `${postApi.value}/outcome`),
    ])
    current.value = p
    outcome.value = o
    loadFailed.value = false
  } catch {
    loadFailed.value = true
  }
}

// ---- reading itself again while something moves (Scelta 6; notifications come with stage 8)
const moving = computed(() =>
  (outcome.value?.destinations ?? current.value.destinations).some((d) => isTargetMoving(d.status)),
)
let timer: ReturnType<typeof setInterval> | null = null
function tick() {
  if (document.visibilityState === 'visible' && moving.value && busy.value === null) void read()
}
onMounted(() => {
  void read()
  timer = setInterval(tick, 10_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// ---- who may do what (§10.2, P5, P6)
const role = computed(() => props.client.myRole)
const archived = computed(() => props.client.archivedAt !== null)
const manager = computed(() => ['owner', 'admin', 'manager'].includes(role.value))
const publisher = computed(() => manager.value || role.value === 'publisher')
const mayRetry = computed(
  () =>
    !archived.value &&
    (manager.value || (publisher.value && current.value.createdBy === org.me.value?.id)),
)
const mayCancel = computed(() => !archived.value && publisher.value)
const mayManage = computed(() => !archived.value && manager.value)

// ---- the accounts, by id
const accounts = computed(
  () => new Map(props.profiles.flatMap((p) => p.accounts.map((a) => [a.id, a] as const))),
)
const accountName = (id: string) => {
  const a = accounts.value.get(id)
  if (!a) return t('posts.outcome.unknownAccount')
  return a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
}
const platformName = (id: string) =>
  accounts.value.get(id)?.platform === 'facebook' ? 'Facebook' : 'Instagram'

const CANCELLABLE = new Set(['scheduled', 'preparing', 'ready', 'retrying', 'failed'])
const rows = computed(() =>
  (outcome.value?.destinations ?? []).map((d) => {
    const a = accounts.value.get(d.accountId)
    const state = targetStateOf(d.status, t)
    const reason =
      d.status === 'failed' && d.errorCode
        ? t(
            te(`posts.outcome.reason.${d.errorCode}`)
              ? `posts.outcome.reason.${d.errorCode}`
              : 'posts.outcome.reason.meta_error',
            { platform: platformName(d.accountId) },
          )
        : d.status === 'problem'
          ? t(
              te(`posts.outcome.problem.${d.problem ?? ''}`)
                ? `posts.outcome.problem.${d.problem ?? ''}`
                : 'posts.outcome.problem.failed',
              { platform: platformName(d.accountId) },
            )
          : d.status === 'retrying' && d.nextAttemptAt
            ? t('posts.outcome.retryAt', { time: formatTime(d.nextAttemptAt) })
            : d.status === 'unknown'
              ? t('posts.outcome.searching', { platform: platformName(d.accountId) })
              : null
    return {
      ...d,
      platform: a?.platform ?? 'instagram',
      name: accountName(d.accountId),
      state: state.label,
      tone: state.tone,
      reason,
      canRetry: mayRetry.value && (d.status === 'failed' || d.status === 'problem'),
      canVerify: mayRetry.value && d.status === 'problem',
      canCancel: mayCancel.value && CANCELLABLE.has(d.status) && current.value.status !== 'paused',
      openLabel: t('posts.outcome.open', { platform: platformName(d.accountId) }),
    }
  }),
)

// ---- the left column
const showsFiles = computed(() => role.value !== 'viewer')
const tiles = computed(() =>
  current.value.media
    .filter((m) => m.status !== 'deleted')
    .map((m) => {
      const variant = ['preview', 'ig_feed', 'thumbnail'].find((v) => m.variants.includes(v))
      return {
        id: m.id,
        kind: m.kind,
        src: variant ? `${api.value}/media/${encodeURIComponent(m.id)}/file/${variant}` : null,
      }
    }),
)
const text = computed(() => {
  const c = current.value.caption
  return c.common || c.instagram || c.facebook || ''
})
const title = computed(() => {
  const first = text.value.trim().split('\n')[0]?.trim()
  return first || t(`posts.type.${current.value.type}`)
})
const settings = useContentSettings(computed(() => props.client.id))
const labels = computed(() => {
  const byId = new Map((settings.labels.value ?? []).map((l) => [l.id, l]))
  return current.value.labelIds.flatMap((id) => byId.get(id) ?? [])
})
const author = computed(
  () =>
    [...(outcome.value?.activity ?? [])].reverse().find((a) => a.kind === 'post.created')
      ?.actorName ?? null,
)
const meta = computed(() => {
  const p = current.value
  const parts = [t(`posts.type.${p.type}`)]
  if (p.media.length > 1) parts.push(t('client.files', { n: p.media.length }))
  if (author.value) parts.push(t('posts.outcome.by', { name: author.value }))
  return parts.join(' · ')
})
// «Pubblica subito» leaves the post scheduled for now until the worker takes it
const state = computed(() =>
  current.value.status === 'scheduled'
    ? { label: t('posts.state.publishing'), tone: 'info' as const }
    : postStateOf(current.value, t),
)
const when = computed(() =>
  current.value.scheduledAt
    ? formatRelative(current.value.scheduledAt, { timeZone: current.value.timezone })
    : null,
)

// ---- the activity
// in the post's zone, as «Esito» above: never a mix of two clocks on one page
const at = (iso: string) => {
  const timeZone = current.value.timezone
  const near = formatRelative(iso, { timeZone })
  return near.includes(':') ? near : formatShort(iso, { timeZone })
}
const activity = computed(() =>
  (outcome.value?.activity ?? []).map((a, i) => ({
    key: `${a.at}-${String(i)}`,
    at: at(a.at),
    text: t(`posts.outcome.activity.${a.kind.replace('.', '_')}`, {
      name: a.actorName ?? t('posts.list.someone'),
      account: a.accountId ? accountName(a.accountId) : '',
      platform: a.accountId ? platformName(a.accountId) : '',
    }),
  })),
)

// ---- what a person does
async function act(key: string, path: string, body?: unknown) {
  busy.value = key
  problem.value = null
  try {
    current.value = await call<PostResponse>('POST', `${postApi.value}/${path}`, body)
    await read()
    return true
  } catch (error) {
    problem.value = failure(error).message
    return false
  } finally {
    busy.value = null
  }
}
const destination = (accountId: string, what: string) =>
  `destinations/${encodeURIComponent(accountId)}/${what}`

/** «Riprova» after an uncertain call asks first: Meta may have published it (Scelta 7). */
const checkFirst = ref<string | null>(null)
function retry(row: (typeof rows.value)[number]) {
  if (row.errorCode === 'uncertain_not_found') checkFirst.value = row.accountId
  else void act(`retry-${row.accountId}`, destination(row.accountId, 'retry'))
}
async function retryAnyway() {
  const id = checkFirst.value
  checkFirst.value = null
  if (id) await act(`retry-${id}`, destination(id, 'retry'))
}
const verify = (accountId: string) =>
  act(`verified-${accountId}`, destination(accountId, 'verified'))
const cancelOne = ref<string | null>(null)
async function cancelConfirmed() {
  const id = cancelOne.value
  cancelOne.value = null
  if (id) await act(`cancel-${id}`, destination(id, 'cancel'))
}

// ---- the pause (P5): «Riprendi» asks a new day and time when the old one passed
const resumeWhen = ref<{ localDate: string; localTime: string } | null>(null)
async function resume() {
  busy.value = 'resume'
  problem.value = null
  try {
    current.value = await call<PostResponse>('POST', `${postApi.value}/resume`, {
      version: current.value.version,
      ...(resumeWhen.value ? { when: resumeWhen.value } : {}),
    })
    resumeWhen.value = null
    await read()
  } catch (error) {
    const f = failure(error)
    if (f.reason === 'paused_time_passed' && !resumeWhen.value)
      resumeWhen.value = { localDate: '', localTime: '' }
    else problem.value = f.message
  } finally {
    busy.value = null
  }
}
const resumeDate = computed({
  get: () => resumeWhen.value?.localDate ?? '',
  set: (v: string) => {
    if (resumeWhen.value) resumeWhen.value.localDate = v
  },
})
const resumeTime = computed({
  get: () => resumeWhen.value?.localTime ?? '',
  set: (v: string) => {
    if (resumeWhen.value) resumeWhen.value.localTime = v.slice(0, 5)
  },
})
const today = new Date().toISOString().slice(0, 10)
const cancelPaused = ref(false)
async function cancelPausedConfirmed() {
  cancelPaused.value = false
  await act('cancel-paused', 'cancel-paused', { version: current.value.version })
}
const paused = computed(() => current.value.status === 'paused')

useHead({ title: () => `${title.value} · ${props.client.name}` })
</script>

<template>
  <PageShell>
    <div class="flex flex-col gap-6" :data-ready="outcome ? '' : undefined">
      <div class="flex min-w-0 flex-col gap-2">
        <NuxtLink
          :to="back"
          class="inline-flex items-center gap-1.5 self-start text-detail text-(--app-text-muted) hover:text-(--app-text)"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4" aria-hidden="true" />
          {{ $t('posts.outcome.back', { name: client.name }) }}
        </NuxtLink>
        <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <h1 class="min-w-0 truncate text-title" data-outcome-title>{{ title }}</h1>
          <StatusDot :label="state.label" :tone="state.tone" data-outcome-state />
        </div>
      </div>

      <p v-if="problem" role="alert" class="rounded-card border-2 border-(--app-danger) px-4 py-3">
        {{ problem }}
      </p>

      <!-- a post in pause (§10.4, P5): who manages the posts of others resumes or cancels it -->
      <section
        v-if="paused"
        class="flex flex-col gap-3 rounded-card border border-(--app-warning-soft) bg-(--app-warning-soft) px-4 py-3"
        data-outcome-paused
      >
        <p>
          <strong class="font-semibold">{{ $t('posts.outcome.pausedTitle') }}</strong>
          {{ $t('posts.outcome.pausedText') }}
        </p>
        <template v-if="mayManage">
          <div
            v-if="resumeWhen"
            class="flex flex-wrap items-center gap-2.5"
            data-outcome-resume-when
          >
            <p class="w-full text-detail">{{ $t('posts.outcome.resumeWhen') }}</p>
            <DayField v-model="resumeDate" :label="$t('posts.when.day')" :today="today" />
            <TimeField v-model="resumeTime" :label="$t('posts.when.time')" />
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-play"
              :loading="busy === 'resume'"
              :disabled="!!resumeWhen && (!resumeWhen.localDate || !resumeWhen.localTime)"
              data-outcome-resume
              @click="resume"
            >
              {{ $t('posts.outcome.resume') }}
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              :loading="busy === 'cancel-paused'"
              @click="cancelPaused = true"
            >
              {{ $t('posts.outcome.cancelPaused') }}
            </UButton>
          </div>
        </template>
        <p v-else class="text-detail">{{ $t('posts.outcome.pausedAskManager') }}</p>
      </section>

      <div
        class="grid grid-cols-[minmax(0,1fr)_25rem] items-start gap-x-16 gap-y-8 max-lg:grid-cols-1"
      >
        <!-- the post as it went -->
        <section class="flex min-w-0 flex-col gap-4" :aria-label="$t('posts.outcome.thePost')">
          <ul
            v-if="showsFiles && tiles.length > 0"
            class="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
            data-outcome-files
          >
            <li
              v-for="tile in tiles"
              :key="tile.id"
              class="relative aspect-[4/5] w-45 shrink-0 overflow-hidden rounded-control bg-(--app-surface-sunken) max-md:w-36"
            >
              <img
                v-if="tile.src"
                :src="tile.src"
                alt=""
                class="size-full object-cover"
                loading="lazy"
              />
              <UIcon
                v-if="tile.kind === 'video'"
                name="i-lucide-play"
                class="absolute top-2 left-2 size-4 text-white drop-shadow"
                aria-hidden="true"
              />
            </li>
          </ul>
          <p v-if="text" class="max-w-[35rem] whitespace-pre-line" data-outcome-text>
            {{ text }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-detail text-(--app-text-muted)">
            <span
              v-for="l in labels"
              :key="l.id"
              class="inline-flex h-6 items-center gap-1.5 rounded-thumb border border-(--app-border-strong) bg-(--app-surface) px-2 text-(--app-text)"
            >
              <ContentLabelDot :color="l.color" />
              {{ l.name }}
            </span>
            <span>{{ meta }}</span>
          </div>
        </section>

        <div class="flex min-w-0 flex-col gap-8">
          <!-- «Esito»: one row per destination -->
          <section aria-labelledby="outcome-heading" class="flex flex-col gap-3">
            <div class="flex items-baseline justify-between gap-3">
              <h2 id="outcome-heading" class="font-semibold">{{ $t('posts.outcome.title') }}</h2>
              <span v-if="when" class="text-detail text-(--app-text-muted)">{{ when }}</span>
            </div>
            <LoadFailed
              v-if="loadFailed && !outcome"
              :text="$t('posts.outcome.loadFailed')"
              @retry="read"
            />
            <ListSkeleton v-else-if="!outcome" />
            <ul
              v-else
              class="divide-y divide-(--app-border) rounded-card border border-(--app-border) bg-(--app-surface)"
              data-outcome-list
            >
              <li
                v-for="row in rows"
                :key="row.accountId"
                class="flex gap-3 px-4 py-3.5"
                :data-outcome-row="row.accountId"
                :data-status="row.status"
              >
                <PlatformIcons :platforms="[row.platform]" class="mt-0.5 self-start" />
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div class="flex min-w-0 items-center justify-between gap-3">
                    <span class="min-w-0 truncate font-medium">{{ row.name }}</span>
                    <StatusDot :label="row.state" :tone="row.tone" />
                  </div>
                  <a
                    v-if="row.permalink"
                    :href="row.permalink"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="self-start text-detail underline decoration-(--app-border-strong) underline-offset-3 hover:decoration-current"
                    data-outcome-link
                  >
                    {{ row.openLabel }}
                  </a>
                  <p v-if="row.reason" class="text-detail text-(--app-text)" data-outcome-reason>
                    {{ row.reason }}
                  </p>
                  <div
                    v-if="row.canRetry || row.canVerify || row.canCancel"
                    class="flex flex-wrap gap-2 pt-1"
                  >
                    <UButton
                      v-if="row.canRetry"
                      color="neutral"
                      variant="outline"
                      size="sm"
                      icon="i-lucide-rotate-cw"
                      class="max-md:min-h-control"
                      :loading="busy === `retry-${row.accountId}`"
                      data-outcome-retry
                      @click="retry(row)"
                    >
                      {{ $t('posts.outcome.retry') }}
                    </UButton>
                    <UButton
                      v-if="row.canVerify"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-check"
                      class="max-md:min-h-control"
                      :loading="busy === `verified-${row.accountId}`"
                      @click="verify(row.accountId)"
                    >
                      {{ $t('posts.outcome.markVerified') }}
                    </UButton>
                    <UButton
                      v-if="row.canCancel"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      class="max-md:min-h-control"
                      :loading="busy === `cancel-${row.accountId}`"
                      @click="cancelOne = row.accountId"
                    >
                      {{ $t('posts.outcome.cancelOne') }}
                    </UButton>
                  </div>
                </div>
              </li>
            </ul>
          </section>

          <!-- «Attività», from the log and from the calls -->
          <section
            v-if="activity.length > 0"
            aria-labelledby="activity-heading"
            class="flex flex-col gap-3"
          >
            <h2 id="activity-heading" class="font-semibold">
              {{ $t('posts.outcome.activityTitle') }}
            </h2>
            <ol class="flex flex-col gap-2.5 text-detail" data-outcome-activity>
              <li
                v-for="a in activity"
                :key="a.key"
                class="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
              >
                <span class="text-(--app-text-muted) tabular-nums">{{ a.at }}</span>
                <span>{{ a.text }}</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </div>

    <UModal
      :open="checkFirst !== null"
      :title="$t('posts.outcome.checkFirstTitle')"
      :description="$t('posts.outcome.checkFirstText')"
      @update:open="(v: boolean) => !v && (checkFirst = null)"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-control"
            @click="checkFirst = null"
          >
            {{ $t('posts.confirm.back') }}
          </UButton>
          <UButton class="min-h-control" @click="retryAnyway">
            {{ $t('posts.outcome.retry') }}
          </UButton>
        </div>
      </template>
    </UModal>
    <UModal
      :open="cancelOne !== null"
      :title="
        $t('posts.outcome.cancelOneTitle', { account: cancelOne ? accountName(cancelOne) : '' })
      "
      :description="$t('posts.outcome.cancelOneText')"
      @update:open="(v: boolean) => !v && (cancelOne = null)"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-control"
            @click="cancelOne = null"
          >
            {{ $t('posts.confirm.back') }}
          </UButton>
          <UButton color="error" class="min-h-control" @click="cancelConfirmed">
            {{ $t('posts.outcome.cancelOne') }}
          </UButton>
        </div>
      </template>
    </UModal>
    <UModal
      v-model:open="cancelPaused"
      :title="$t('posts.outcome.cancelPausedTitle')"
      :description="$t('posts.outcome.cancelPausedText')"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-control"
            @click="cancelPaused = false"
          >
            {{ $t('posts.confirm.back') }}
          </UButton>
          <UButton color="error" class="min-h-control" @click="cancelPausedConfirmed">
            {{ $t('posts.outcome.cancelPaused') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
