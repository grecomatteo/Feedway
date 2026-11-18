<script setup lang="ts">
import { usePostEditor } from '~/composables/usePostEditor'

/**
 * The editor's page body (design E1–E3, E6): the blocks in their order, the preview column on
 * the right (Task 6), the bar of the actions fixed at the bottom. Leaving with changes not saved
 * asks first (brief F02).
 */
const props = defineProps<{
  client: WorkspaceView
  postId: string | null
  profileKey: string | null
  profiles: WorkspaceProfile[]
  profilesLoading: boolean
  back: string
}>()
const { t } = useI18n()
const flash = useFlash()

const editor = usePostEditor({
  client: computed(() => props.client),
  postId: props.postId,
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

const previewOpen = ref(false)
/** One preview at a time: the column from 1024 px, the full screen below (design E3b). */
const wide = ref(false)
let wideQuery: MediaQueryList | null = null
const onWide = () => {
  wide.value = wideQuery?.matches ?? false
  if (wide.value) previewOpen.value = false
}
onMounted(() => {
  wideQuery = window.matchMedia('(min-width: 1024px)')
  onWide()
  wideQuery.addEventListener('change', onWide)
})
onBeforeUnmount(() => wideQuery?.removeEventListener('change', onWide))

const title = computed(() => {
  if (!props.postId && !e.save.value.postId) return t('posts.editor.newTitle')
  if (e.status.value === 'scheduled') return t('posts.editor.scheduledTitle')
  if (e.status.value === 'cancelled') return t('posts.editor.cancelledTitle')
  return t('posts.editor.editTitle')
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
  // the ids are on the headings: the first control is in their section
  const area = el?.closest('section') ?? el
  area?.querySelector<HTMLElement>('button:not([disabled]), input, textarea')?.focus({
    preventScroll: true,
  })
}

async function schedule() {
  const p = await e.schedule()
  if (p) flash.value = t('posts.actions.scheduled')
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
// changes, the person is asked
onBeforeRouteLeave(async (_to, _from, next) => {
  e.leaving(true)
  if (e.status.value === 'draft' && e.editable.value) await e.flush()
  const s = e.save.value
  const lost =
    s.dirty && (s.status === 'failed' || s.status === 'conflict' || e.status.value !== 'draft')
  if (!lost || !e.editable.value) return next()
  leaveTo = () => next()
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
  <div class="flex min-w-0 flex-col gap-header">
    <header class="flex flex-col gap-1">
      <NuxtLink
        :to="back"
        class="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-(--app-text-muted) hover:text-(--app-text)"
      >
        <UIcon name="i-lucide-arrow-left" class="size-4" aria-hidden="true" />
        {{ client.name }}
      </NuxtLink>
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-[1.625rem] leading-tight md:text-[1.875rem]">{{ title }}</h1>
        <UButton
          v-if="e.loadState.value === 'ready'"
          color="neutral"
          variant="outline"
          icon="i-lucide-smartphone"
          class="min-h-11 lg:hidden"
          @click="previewOpen = true"
        >
          {{ $t('posts.preview.open') }}
        </UButton>
      </div>
    </header>

    <p v-if="e.loadState.value === 'loading'" class="sr-only" role="status">
      {{ $t('posts.editor.loading') }}
    </p>
    <ListSkeleton v-if="e.loadState.value === 'loading'" />
    <div v-else-if="e.loadState.value === 'missing'" role="alert" class="flex flex-col gap-3">
      <p>{{ $t('posts.editor.missing') }}</p>
      <NuxtLink :to="back" class="self-start underline">{{
        $t('posts.editor.backToPosts')
      }}</NuxtLink>
    </div>
    <div v-else-if="e.loadState.value === 'error'" role="alert" class="flex flex-col gap-3">
      <p>{{ $t('posts.editor.loadFailed') }}</p>
    </div>
    <template v-else>
      <p v-if="flash" role="status" class="text-sm text-(--app-success)">{{ flash }}</p>
      <p
        v-if="readOnly"
        role="note"
        class="rounded-lg border border-(--app-border) bg-(--app-surface-sunken) px-4 py-3 text-sm"
      >
        {{ readOnly }}
      </p>
      <p
        v-if="e.save.value.status === 'conflict'"
        role="alert"
        class="rounded-lg border-2 border-(--app-danger) px-4 py-3 text-sm"
      >
        {{ $t('posts.save.conflictText') }}
      </p>
      <p
        v-if="e.actionProblem.value"
        role="alert"
        class="rounded-lg border-2 border-(--app-danger) px-4 py-3 text-sm"
      >
        {{ e.actionProblem.value }}
      </p>
      <div class="flex min-w-0 gap-10">
        <div class="flex w-full max-w-[45rem] min-w-0 flex-col gap-section">
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
            :profiles="profiles"
            :loading="profilesLoading"
            :groups="settings.groups.value"
          />
          <PostWhenPicker :editor="editor" :client="client" />
          <p
            v-if="!e.may.value.publish && e.editable.value"
            class="rounded-lg bg-(--app-surface-sunken) px-4 py-3 text-sm"
          >
            {{ $t('posts.editor.editorOnly') }}
          </p>
          <p
            v-if="settings.failed.value"
            role="alert"
            class="flex flex-wrap items-center gap-2 rounded-lg bg-(--app-surface-sunken) px-4 py-2 text-sm"
          >
            {{ $t('posts.contentSettingsFailed') }}
            <UButton color="neutral" variant="link" class="min-h-11" @click="settings.load()">
              {{ $t('account.retry') }}
            </UButton>
          </p>
          <PostLabelsAndNotes
            :editor="editor"
            :labels="settings.labels.value"
            :base="settings.base.value"
            :manage-to="manageTo"
            :archived="client.archivedAt !== null"
          />
          <PostDestinationSummary
            :editor="editor"
            :accounts="accounts"
            :show-files="client.myRole !== 'viewer'"
            @goto="goto"
          />
        </div>
        <!-- the preview, as on Meta (§11.3, Task 6): always beside the form from 1024 px -->
        <aside
          :aria-label="$t('posts.preview.title')"
          class="sticky top-6 hidden w-80 shrink-0 flex-col gap-3 self-start lg:flex 2xl:w-90"
        >
          <h2 class="text-lg">{{ $t('posts.preview.title') }}</h2>
          <PostPreview
            v-if="wide"
            :editor="editor"
            :accounts="accounts"
            :show-files="client.myRole !== 'viewer'"
          />
        </aside>
      </div>
      <PostActionBar
        :editor="editor"
        :accounts-count="e.destinations.value.length"
        @schedule="schedule"
        @cancel="confirm = 'cancel'"
        @remove="confirm = 'remove'"
        @goto="goto"
      />
    </template>

    <!-- on a phone the preview takes the whole screen, with «← Modifica» (design E3b) -->
    <UModal
      v-model:open="previewOpen"
      fullscreen
      :title="$t('posts.preview.title')"
      :description="$t('posts.preview.approximate')"
      :ui="{ header: 'hidden', body: 'p-4 sm:p-6' }"
    >
      <template #body>
        <div class="mx-auto flex w-full max-w-90 flex-col gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            class="min-h-11 self-start"
            @click="previewOpen = false"
          >
            {{ $t('posts.preview.back') }}
          </UButton>
          <PostPreview
            :editor="editor"
            :accounts="accounts"
            :show-files="client.myRole !== 'viewer'"
            reserve="15rem"
          />
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
          <UButton color="neutral" variant="ghost" class="min-h-11" @click="confirm = null">
            {{ $t('posts.confirm.stay') }}
          </UButton>
          <UButton
            :color="confirm === 'leave' ? 'primary' : 'error'"
            class="min-h-11"
            @click="confirmed"
          >
            {{ confirmText?.ok }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
