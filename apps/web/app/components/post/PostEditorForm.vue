<script setup lang="ts">
import type { NewPostStart } from '~/utils/new-post-address'
import type { MediaDto, PostResponse } from '@app/contracts'
import { usePostEditor } from '~/composables/usePostEditor'

/**
 * The editor's page (screens 08 and 09; design E1–E3, E6), with no side bar: a row at the top
 * with «indietro», the client, the title and the state of the save, and on a computer the
 * actions on the right; then the rows of the form (label on the left, content on the right) and
 * the preview column on the right. On a phone the actions stay in a bar at the bottom. Leaving
 * with changes not saved asks first (brief F02).
 */
const props = defineProps<{
  client: WorkspaceView
  postId: string | null
  profileKey: string | null
  /**
   * What a new post starts with, from its address (plan 09 Task 4): the day and time of the «+»
   * of the calendar, the files of «Usa in un nuovo post» or dragged from the library, a type
   */
  start?: NewPostStart | null
  profiles: WorkspaceProfile[]
  profilesLoading: boolean
  back: string
  /** opened with «Modifica» from the page of the outcome (R13): a post in preparation stays */
  editing?: boolean
}>()
const emit = defineEmits<{
  /** a post that is out or on its way: the page of the outcome takes over (Scelta 6) */
  outcome: [post: PostResponse]
}>()
const { t } = useI18n()
const flash = useFlash()

const editor = usePostEditor({
  client: computed(() => props.client),
  postId: props.postId,
  start: props.start ?? null,
  profileKey: props.profileKey,
  profiles: computed(() => props.profiles),
})
const e = editor

// the client's labels, templates and groups (§11.7, plan 06 Task 7)
const settings = useContentSettings(computed(() => props.client.id))
// a label taken off the client meanwhile would make every save fail («Etichetta non trovata»):
// the editor keeps only the labels the client still has, and reads them again on that answer
watch([settings.labels, () => e.labelIds.value], ([list, ids]) => {
  if (!list) return
  const known = new Set(list.map((l) => l.id))
  if (ids.some((id) => !known.has(id))) e.setLabels(ids.filter((id) => known.has(id)))
})
watch(
  () => (e.save.value.error ? failure(e.save.value.error).message : null),
  (message) => {
    if (message === 'Etichetta non trovata') void settings.load()
  },
)
const org = useOrganization()
// «Usa in un nuovo post» (screen 20) and a file dragged onto a day: the files of the library go
// in, in their order, as «Dalla libreria»
onMounted(async () => {
  const ids = props.postId ? [] : (props.start?.fileIds ?? [])
  if (ids.length === 0) return
  const { call } = useApi()
  const files = await Promise.all(
    ids.map((id) =>
      call<MediaDto>(
        'GET',
        org.api(
          `/workspaces/${encodeURIComponent(props.client.id)}/media/${encodeURIComponent(id)}`,
        ),
      ).catch(() => null),
    ),
  )
  // a file gone meanwhile is left out: the post starts with the others, or empty
  const found = files.filter((f): f is MediaDto => f !== null)
  if (found.length > 0) e.addFromLibrary(found)
})
/** «Gestisci…» leads to the client's content settings, for who manages them */
const manageTo = computed(() =>
  ['owner', 'admin', 'manager'].includes(props.client.myRole) && !props.client.archivedAt
    ? org.to(`/spazi/${encodeURIComponent(props.client.slug)}/contenuti`)
    : null,
)

const accounts = computed(
  () => new Map(props.profiles.flatMap((p) => p.accounts.map((a) => [a.id, a] as const))),
)
const platforms = computed(() => {
  const set = new Set<'instagram' | 'facebook'>()
  for (const id of e.destinations.value) {
    const a = accounts.value.get(id)
    if (a) set.add(a.platform)
  }
  return (['instagram', 'facebook'] as const).filter((p) => set.has(p))
})

/**
 * «Controlli» above the preview once the post has something to answer or fix: the choice that
 * keeps «Programma» off is then on the screen at any height, not under a 420 px reel. They stay
 * on top after the answer, so the option just picked does not jump away under the pointer.
 */
const checksFirst = ref(false)
watch(
  () => {
    const r = e.report.value
    return !!r && (r.unresolved.length > 0 || r.outcomes.some((o) => o.level === 'block'))
  },
  (attention) => {
    if (attention) checksFirst.value = true
  },
  { immediate: true },
)

const previewOpen = ref(false)
/** One preview at a time: the column from 1024 px, the full screen below (design E3b). */
const wide = ref(false)
/** The actions in the row at the top from 768 px, in the bar at the bottom below: in one place
 *  only, so a button is never there twice. The editor runs only in the browser (ClientOnly). */
const desktop = ref(window.matchMedia('(min-width: 48rem)').matches)
let wideQuery: MediaQueryList | null = null
let desktopQuery: MediaQueryList | null = null
const onWide = () => {
  wide.value = wideQuery?.matches ?? false
  if (wide.value) previewOpen.value = false
}
const onDesktop = () => (desktop.value = desktopQuery?.matches ?? false)
onMounted(() => {
  wideQuery = window.matchMedia('(min-width: 1024px)')
  desktopQuery = window.matchMedia('(min-width: 48rem)')
  onWide()
  onDesktop()
  wideQuery.addEventListener('change', onWide)
  desktopQuery.addEventListener('change', onDesktop)
})
onBeforeUnmount(() => {
  wideQuery?.removeEventListener('change', onWide)
  desktopQuery?.removeEventListener('change', onDesktop)
})

/** A draft is named by the first line of its text (B12); without one «Nuovo post» until it is
 *  saved, then «Bozza senza testo» (D-102.5). */
const title = computed(() => {
  if (e.status.value === 'scheduled') return t('posts.editor.scheduledTitle')
  if (e.status.value === 'cancelled') return t('posts.editor.cancelledTitle')
  const text = e.caption.common || e.caption.instagram || e.caption.facebook || ''
  const first = text.trim().split('\n')[0]?.trim()
  if (first) return first
  return e.save.value.postId ? t('posts.editor.untitledDraft') : t('posts.editor.newTitle')
})
/** Why this person reads the post and does not change it. */
const readOnly = computed(() => {
  if (e.loadState.value !== 'ready' || e.editable.value) return null
  if (props.client.archivedAt) return t('posts.editor.archived')
  if (!e.may.value.draft) return t('posts.editor.viewer')
  if (e.status.value === 'cancelled') return t('posts.editor.cancelled')
  if (e.status.value === 'scheduled') return t('posts.editor.scheduledEditor')
  return t('posts.editor.notYours')
})

function goto(section: string) {
  const el = document.getElementById(section)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // the ids are on the headings: the first control is in their section, and in «Controlli» the
  // first one of a choice still to make or of a block, not of a warning already answered
  const area = el?.closest('section') ?? el
  const control = 'button:not([disabled]), input:not([disabled]), textarea'
  const pending = [...(area?.querySelectorAll<HTMLElement>('[data-unresolved]') ?? [])]
  const target =
    pending.map((o) => o.querySelector<HTMLElement>(control)).find(Boolean) ??
    area?.querySelector<HTMLElement>(control)
  target?.focus({ preventScroll: true })
}

/** «Salva ed esci»: leaving saves the draft first, and asks if it cannot (below). */
function exit() {
  void navigateTo(props.back)
}

/** «Programma»: back to the client's posts, with «Programmato per … · Apri» (screen 12). */
const notice = useNotice()
async function schedule() {
  const p = await e.schedule()
  if (!p) return
  const w = e.when.value
  notice.show({
    message: w
      ? t('posts.actions.scheduledFor', { when: formatWallSentence(w.localDate, w.localTime) })
      : t('posts.actions.scheduledShort'),
    linkLabel: t('posts.actions.open'),
    to: org.to(`/spazi/${encodeURIComponent(props.client.slug)}/post/${encodeURIComponent(p.id)}`),
  })
  await navigateTo(props.back)
}
// «Modifica» from the page of the outcome: the focus goes to the editor's title, not to the
// page's body, once the post is read (R13)
const heading = useTemplateRef<HTMLElement>('heading')
watch(
  () => e.loadState.value,
  (state) => {
    if (props.editing && state === 'ready') void nextTick(() => heading.value?.focus())
  },
  { immediate: true },
)
// a post past «Programmato» is read on the page of the outcome, not changed here; one in
// preparation opened with «Modifica» stays while no destination has started (R13)
watch(
  () => e.post.value,
  (p) => {
    if (p && opensOnOutcome(p) && !(props.editing && isPanelEditable(p))) emit('outcome', p)
  },
)

/** «Pubblica subito» (Scelta 2, screen 11): asks first, with what goes out where. */
const asking = ref(false)
const going = computed(() =>
  (e.report.value?.destinations ?? []).flatMap((d) => {
    const a = accounts.value.get(d.accountId)
    if (!a) return []
    return [
      {
        id: a.id,
        platform: a.platform,
        name: a.platform === 'instagram' && a.username ? `@${a.username}` : a.name,
        what: d.format && d.platform ? e.whatGoesOut(d.platform, d.format, d.media) : '',
      },
    ]
  }),
)
async function publishNow() {
  asking.value = false
  const p = await e.publishNow()
  if (p) emit('outcome', p)
}

const confirm = ref<null | 'cancel' | 'remove' | 'leave'>(null)
let leaveTo: (() => void) | null = null
async function confirmed() {
  const what = confirm.value
  confirm.value = null
  if (what === 'cancel') {
    if (await e.cancel()) flash.value = t('posts.actions.cancelled')
  } else if (what === 'remove') {
    if (await e.remove()) await navigateTo(props.back)
  } else if (what === 'leave') leaveTo?.()
}

// leaving: a draft saves first; if it cannot (no network, conflict) or a scheduled post has
// changes, the person is asked. «Esci lo stesso» goes again where the person was going, and
// this time the guard lets it pass (P1 of the stage 6 review, option (a)): from the browser's
// «Indietro» that adds an entry to the history.
let allowLeave = false
onBeforeRouteLeave(async (to, _from, next) => {
  e.leaving(true)
  if (allowLeave) return next()
  if (e.status.value === 'draft' && e.editable.value) await e.flush()
  const s = e.save.value
  const lost =
    s.dirty && (s.status === 'failed' || s.status === 'conflict' || e.status.value !== 'draft')
  if (!lost || !e.editable.value) return next()
  leaveTo = () => {
    allowLeave = true
    // a navigation stopped elsewhere leaves the editor asking again next time
    void navigateTo(to.fullPath).finally(() => (allowLeave = false))
  }
  confirm.value = 'leave'
  e.leaving(false)
  next(false)
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (e.save.value.dirty && e.editable.value) event.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
const confirmText = computed(() => {
  switch (confirm.value) {
    case 'cancel':
      return {
        title: t('posts.confirm.cancelTitle'),
        text: t('posts.confirm.cancelText'),
        ok: t('posts.actions.cancel'),
      }
    case 'remove':
      return {
        title: t('posts.confirm.removeTitle'),
        text: t('posts.confirm.removeText'),
        ok: t('posts.actions.delete'),
      }
    case 'leave':
      return {
        title: t('posts.confirm.leaveTitle'),
        text: t('posts.confirm.leaveText'),
        ok: t('posts.confirm.leave'),
      }
    default:
      return null
  }
})
</script>

<template>
  <div
    class="flex min-h-dvh min-w-0 flex-col"
    :data-ready="e.loadState.value === 'ready' || undefined"
  >
    <header
      class="sticky top-0 z-30 flex h-14 min-w-0 items-center gap-3 border-b border-(--app-border) bg-(--app-surface) px-5 max-md:h-13 max-md:gap-1 max-md:ps-1 max-md:pe-2"
      data-editor-bar
    >
      <UButton
        :to="back"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-arrow-left"
        class="shrink-0"
        :aria-label="$t('posts.editor.backTo', { name: client.name })"
      />
      <span class="flex min-w-0 shrink items-center gap-2 max-lg:hidden">
        <Avatar :name="client.name" :src="client.photoUrl" :size="22" />
        <span class="truncate text-(--app-text-muted)">{{ client.name }}</span>
      </span>
      <span class="h-5 w-px shrink-0 bg-(--app-border-strong) max-lg:hidden" aria-hidden="true" />
      <h1
        ref="heading"
        tabindex="-1"
        class="min-w-0 shrink truncate text-[0.9375rem] leading-5 tracking-[-0.01em] outline-none max-md:text-base"
      >
        {{ title }}
      </h1>
      <PostActionBar
        v-if="desktop && e.loadState.value === 'ready'"
        placement="top"
        :editor="editor"
        :accounts-count="e.destinations.value.length"
        @schedule="schedule"
        @publish-now="asking = true"
        @cancel="confirm = 'cancel'"
        @remove="confirm = 'remove'"
        @exit="exit"
        @goto="goto"
      >
        <UButton
          v-if="!wide"
          color="neutral"
          variant="ghost"
          icon="i-lucide-eye"
          class="shrink-0"
          @click="previewOpen = true"
        >
          {{ $t('posts.preview.open') }}
        </UButton>
      </PostActionBar>
      <template v-else>
        <span class="flex-1" />
        <UButton
          v-if="e.loadState.value === 'ready'"
          color="neutral"
          variant="ghost"
          icon="i-lucide-eye"
          class="shrink-0"
          @click="previewOpen = true"
        >
          {{ $t('posts.preview.open') }}
        </UButton>
      </template>
    </header>

    <div class="flex-1 px-8 pt-2 pb-20 max-md:px-gutter max-md:pt-0 max-md:pb-8">
      <p v-if="e.loadState.value === 'loading'" class="sr-only" role="status">
        {{ $t('posts.editor.loading') }}
      </p>
      <div v-if="e.loadState.value === 'loading'" class="mx-auto max-w-[42.5rem] pt-5">
        <ListSkeleton />
      </div>
      <div
        v-else-if="e.loadState.value === 'missing'"
        role="alert"
        class="mx-auto flex max-w-[42.5rem] flex-col gap-3 pt-5"
      >
        <p>{{ $t('posts.editor.missing') }}</p>
        <NuxtLink :to="back" class="self-start underline">{{
          $t('posts.editor.backToPosts')
        }}</NuxtLink>
      </div>
      <div
        v-else-if="e.loadState.value === 'error'"
        role="alert"
        class="mx-auto flex max-w-[42.5rem] flex-col gap-3 pt-5"
      >
        <p>{{ $t('posts.editor.loadFailed') }}</p>
      </div>
      <div
        v-else
        class="grid grid-cols-[minmax(0,42.5rem)] justify-center gap-x-10 lg:grid-cols-[minmax(0,42.5rem)_23.75rem] xl:gap-x-16 max-md:grid-cols-1"
      >
        <div class="min-w-0">
          <div
            v-if="
              flash ||
              readOnly ||
              e.save.value.status === 'conflict' ||
              e.actionProblem.value ||
              (!e.may.value.publish && e.editable.value) ||
              settings.failed.value
            "
            class="flex flex-col gap-3 pt-5"
          >
            <p v-if="flash" role="status" class="text-(--app-success)">{{ flash }}</p>
            <p
              v-if="readOnly"
              role="note"
              class="rounded-card border border-(--app-border) bg-(--app-surface-sunken) px-4 py-3"
            >
              {{ readOnly }}
            </p>
            <p
              v-if="e.save.value.status === 'conflict'"
              role="alert"
              class="rounded-card border-2 border-(--app-danger) px-4 py-3"
            >
              {{ $t('posts.save.conflictText') }}
            </p>
            <p
              v-if="e.actionProblem.value"
              role="alert"
              class="rounded-card border-2 border-(--app-danger) px-4 py-3"
            >
              {{ e.actionProblem.value }}
            </p>
            <p
              v-if="!e.may.value.publish && e.editable.value"
              class="rounded-card bg-(--app-surface-sunken) px-4 py-3"
            >
              {{ $t('posts.editor.editorOnly') }}
            </p>
            <p
              v-if="settings.failed.value"
              role="alert"
              class="flex flex-wrap items-center gap-2 rounded-card bg-(--app-surface-sunken) px-4 py-2"
            >
              {{ $t('posts.contentSettingsFailed') }}
              <UButton color="neutral" variant="link" @click="settings.load()">
                {{ $t('account.retry') }}
              </UButton>
            </p>
          </div>
          <div>
            <PostPlanNote :editor="editor" :client="client" />
            <PostTypePicker
              :type="e.type.value"
              :kinds="e.kinds.value"
              :disabled="!e.editable.value"
              @choose="e.chooseType($event)"
            />
            <PostMediaList :editor="editor" :client="client" />
            <PostCoverPicker v-if="e.type.value === 'reel'" :editor="editor" :client="client" />
            <PostCaptionEditor
              :editor="editor"
              :platforms="platforms"
              :templates="settings.templates.value"
              :manage-to="manageTo"
            />
            <PostDestinationPicker
              :editor="editor"
              :client="client"
              :profiles="profiles"
              :loading="profilesLoading"
              :groups="settings.groups.value"
            />
            <PostWhenPicker :editor="editor" :client="client" />
            <PostLabelsAndNotes
              :editor="editor"
              :labels="settings.labels.value"
              :base="settings.base.value"
              :manage-to="manageTo"
              :archived="client.archivedAt !== null"
            />
            <!-- «Controlli»: under the preview from 1024 px, the last row of the form below -->
            <PostDestinationSummary
              v-if="!wide"
              :editor="editor"
              :accounts="accounts"
              :show-files="client.myRole !== 'viewer'"
              @goto="goto"
            />
          </div>
        </div>
        <!-- the preview, as on Meta (§11.3, Task 6), and «Controlli» under it: beside the form
             from 1024 px, scrolling on its own when taller than the screen (so it takes the
             keyboard's focus too) -->
        <aside
          :aria-label="$t('posts.preview.title')"
          class="sticky top-14 hidden max-h-[calc(100dvh-3.5rem)] min-w-0 flex-col gap-5 self-start overflow-y-auto pt-[1.375rem] pb-8 [scrollbar-width:thin] lg:flex"
          data-editor-column
          tabindex="0"
        >
          <template v-if="wide">
            <PostDestinationSummary
              v-if="checksFirst"
              placement="column"
              :editor="editor"
              :accounts="accounts"
              :show-files="client.myRole !== 'viewer'"
              data-checks-first
              @goto="goto"
            />
            <PostPreview
              :editor="editor"
              :accounts="accounts"
              :show-files="client.myRole !== 'viewer'"
              :heading="$t('posts.preview.title')"
              width="14.75rem"
              reserve="22rem"
              feed-reserve="20rem"
            />
            <PostDestinationSummary
              v-if="!checksFirst"
              placement="column"
              :editor="editor"
              :accounts="accounts"
              :show-files="client.myRole !== 'viewer'"
              @goto="goto"
            />
          </template>
        </aside>
      </div>
    </div>
    <PostActionBar
      v-if="!desktop && e.loadState.value === 'ready'"
      :editor="editor"
      :accounts-count="e.destinations.value.length"
      @schedule="schedule"
      @publish-now="asking = true"
      @cancel="confirm = 'cancel'"
      @remove="confirm = 'remove'"
      @exit="exit"
      @goto="goto"
    />

    <!-- on a phone the preview takes the whole screen, with «← Modifica» (screen 10) -->
    <UModal
      v-model:open="previewOpen"
      fullscreen
      :title="$t('posts.preview.title')"
      :description="$t('posts.preview.approximate')"
      :ui="{ header: 'hidden', body: 'p-0 sm:p-0' }"
    >
      <template #body>
        <div
          class="sticky top-0 z-10 flex h-13 items-center gap-1 border-b border-(--app-border) bg-(--app-surface) ps-1 pe-5"
          data-preview-bar
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="previewOpen = false"
          >
            {{ $t('posts.preview.back') }}
          </UButton>
          <span class="flex-1" />
          <p class="font-display text-base font-semibold tracking-[-0.01em]" aria-hidden="true">
            {{ $t('posts.preview.title') }}
          </p>
        </div>
        <div class="mx-auto w-full max-w-[26.25rem] p-4">
          <PostPreview
            :editor="editor"
            :accounts="accounts"
            :show-files="client.myRole !== 'viewer'"
            reserve="13rem"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="asking"
      :title="$t('posts.confirm.publishTitle')"
      :description="$t('posts.confirm.publishText')"
      :ui="{ description: 'sr-only' }"
    >
      <template #body>
        <ul
          class="divide-y divide-(--app-border) rounded-card border border-(--app-border)"
          data-publish-now-list
        >
          <li v-for="d in going" :key="d.id" class="flex min-h-11 items-center gap-3 px-3 py-2">
            <PlatformIcons :platforms="[d.platform]" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ d.name }}</span>
            <span class="shrink-0 text-detail text-(--app-text-muted)">{{ d.what }}</span>
          </li>
        </ul>
        <p class="mt-4 text-(--app-text-muted)">{{ $t('posts.confirm.publishText') }}</p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton color="neutral" variant="outline" class="min-h-control" @click="asking = false">
            {{ $t('posts.confirm.back') }}
          </UButton>
          <UButton
            icon="i-lucide-send"
            class="min-h-control"
            :loading="e.acting.value === 'publishNow'"
            data-publish-now-confirm
            @click="publishNow"
          >
            {{ $t('posts.confirm.publish') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="confirm !== null"
      :title="confirmText?.title"
      :description="confirmText?.text"
      @update:open="
        (v: boolean) => {
          if (!v) confirm = null
        }
      "
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton color="neutral" variant="ghost" class="min-h-control" @click="confirm = null">
            {{ $t('posts.confirm.stay') }}
          </UButton>
          <UButton
            :color="confirm === 'leave' ? 'primary' : 'error'"
            class="min-h-control"
            @click="confirmed"
          >
            {{ confirmText?.ok }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
