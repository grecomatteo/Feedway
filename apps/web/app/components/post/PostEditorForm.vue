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
  el?.querySelector<HTMLElement>('button:not([disabled]), input, textarea')?.focus({
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
      <h1 class="text-[1.625rem] leading-tight md:text-[1.875rem]">{{ title }}</h1>
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
          <PostCaptionEditor :editor="editor" :platforms="platforms" />
          <PostDestinationPicker :editor="editor" :profiles="profiles" :loading="profilesLoading" />
          <PostWhenPicker :editor="editor" :client="client" />
          <p
            v-if="!e.may.value.publish && e.editable.value"
            class="rounded-lg bg-(--app-surface-sunken) px-4 py-3 text-sm"
          >
            {{ $t('posts.editor.editorOnly') }}
          </p>
          <PostDestinationSummary :editor="editor" :accounts="accounts" @goto="goto" />
        </div>
        <!-- the preview, as on Meta: Task 6 -->
        <aside
          :aria-label="$t('posts.preview.title')"
          class="sticky top-6 hidden w-80 shrink-0 flex-col gap-3 self-start lg:flex 2xl:w-90"
        >
          <h2 class="text-lg">{{ $t('posts.preview.title') }}</h2>
          <div
            class="flex aspect-[9/16] w-full items-center justify-center rounded-[2rem] border-4 border-(--app-text) bg-(--app-surface-sunken) p-6 text-center text-sm text-(--app-text-muted)"
          >
            {{ $t('posts.preview.soon') }}
          </div>
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
