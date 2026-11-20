<script setup lang="ts">
import type { LabelDto, PostNoteDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Etichette» and «Note interne» (§11.7; screen 08), two rows of the editor: the client's labels
 * as chips, chosen with «+ Etichetta» and saved with the post; the internal notes of the post
 * with their author and time, and a field to write one. Notes go with the saved post, never with
 * the draft's autosave, and never to a client (§11.10). An Editor notes anyone's post and takes
 * off only their own notes.
 */
const props = defineProps<{
  editor: PostEditor
  /** the client's labels; null while they load */
  labels: LabelDto[] | null
  base: string
  /** «Gestisci le etichette»: the client's content settings, for who manages them */
  manageTo: string | null
  /** an archived client is read only (D-70) */
  archived: boolean
}>()
const { t } = useI18n()
const { call, failure } = useApi()
const e = props.editor

// ---- labels
const byId = computed(() => new Map((props.labels ?? []).map((l) => [l.id, l])))
const chosen = computed(() =>
  e.labelIds.value.map((id) => byId.value.get(id)).filter((l): l is LabelDto => l !== undefined),
)
function toggle(id: string) {
  const now = e.labelIds.value
  e.setLabels(now.includes(id) ? now.filter((x) => x !== id) : [...now, id])
}
const labelItems = computed<DropdownMenuItem[][]>(() => {
  const list = props.labels ?? []
  const groups: DropdownMenuItem[][] = [
    list.length === 0
      ? [{ label: t('posts.labels.none'), disabled: true }]
      : list.map((l) => ({
          label: l.name,
          type: 'checkbox' as const,
          checked: e.labelIds.value.includes(l.id),
          onUpdateChecked: () => toggle(l.id),
          onSelect: (ev: Event) => ev.preventDefault(),
        })),
  ]
  if (props.manageTo) groups.push([{ label: t('posts.labels.manage'), to: props.manageTo }])
  return groups
})

// ---- notes: of the saved post
const postId = computed(() => e.save.value.postId)
const notes = ref<PostNoteDto[] | null>(null)
const notesFailed = ref(false)
async function loadNotes() {
  if (!postId.value) {
    notes.value = []
    return
  }
  const asked = postId.value
  notesFailed.value = false
  try {
    const items = (
      await call<{ items: PostNoteDto[] }>(
        'GET',
        `${props.base}/posts/${encodeURIComponent(asked)}/notes`,
      )
    ).items
    // a slow answer about a post left meanwhile is thrown away
    if (postId.value === asked) notes.value = items
  } catch {
    if (postId.value === asked) notesFailed.value = true
  }
}
watch(postId, () => void loadNotes(), { immediate: true })

const draft = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)
/** writing notes: whoever writes posts in the client, on any post of it (§10.2) */
const mayWrite = computed(() => e.may.value.draft && !props.archived)
async function add() {
  if (!postId.value || draft.value.trim() === '') return
  sending.value = true
  problem.value = null
  try {
    const note = await call<PostNoteDto>(
      'POST',
      `${props.base}/posts/${encodeURIComponent(postId.value)}/notes`,
      { body: draft.value },
    )
    notes.value = [...(notes.value ?? []), note]
    draft.value = ''
  } catch (err) {
    problem.value = failure(err).message
  } finally {
    sending.value = false
  }
}
/** a note taken off does not come back: asked first (P7 of the stage 6 review) */
const removing = ref<PostNoteDto | null>(null)
async function remove(n: PostNoteDto) {
  removing.value = null
  if (!postId.value) return
  problem.value = null
  try {
    await call(
      'DELETE',
      `${props.base}/posts/${encodeURIComponent(postId.value)}/notes/${encodeURIComponent(n.id)}`,
    )
    notes.value = (notes.value ?? []).filter((x) => x.id !== n.id)
    // its button is gone: the focus goes to the field of a new note
    await nextTick()
    document.getElementById('post-note')?.focus()
  } catch (err) {
    problem.value = failure(err).message
  }
}

const org = useOrganization()
const authorOf = (n: PostNoteDto) =>
  n.authorId === org.me.value?.id ? t('posts.notes.you') : n.authorName || t('posts.list.someone')
const when = (iso: string) => formatRelative(iso, { sentence: true })
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
</script>

<template>
  <PostEditorRow heading="post-labels" :label="$t('posts.labels.title')">
    <ul
      class="flex min-h-control flex-wrap items-center gap-2"
      :aria-label="$t('posts.labels.chosen')"
    >
      <li
        v-for="l in chosen"
        :key="l.id"
        class="group inline-flex h-6 items-center gap-1.5 rounded-thumb border border-(--app-border-strong) bg-(--app-surface) ps-2 text-detail"
        :class="e.editable.value ? 'pe-0.5' : 'pe-2'"
        data-label-chip
      >
        <ContentLabelDot :color="l.color" />
        {{ l.name }}
        <!-- the × on hover or focus where there is a mouse (screen 08), always on a touch screen -->
        <button
          v-if="e.editable.value"
          type="button"
          class="relative grid size-5 place-items-center rounded-[4px] text-(--app-text-muted) after:absolute after:-inset-2.5 after:content-[''] hover:bg-(--app-surface-sunken) hover:text-(--app-text) focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
          :aria-label="$t('posts.labels.remove', { name: l.name })"
          @click="toggle(l.id)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" aria-hidden="true" />
        </button>
      </li>
      <li v-if="e.editable.value">
        <UDropdownMenu :items="labelItems" :content="{ align: 'start' }">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-plus"
            :loading="labels === null"
          >
            {{ $t('posts.labels.add') }}
          </UButton>
        </UDropdownMenu>
      </li>
      <li v-else-if="chosen.length === 0" class="text-(--app-text-muted)">
        {{ $t('posts.labels.noneOnPost') }}
      </li>
    </ul>
  </PostEditorRow>
  <PostEditorRow heading="post-notes" :label="$t('posts.notes.title')">
    <div class="flex flex-col gap-2.5">
      <div
        v-if="notesFailed || (notes && notes.length > 0)"
        class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
      >
        <p v-if="notesFailed" role="alert" class="px-4 py-3 text-sm text-(--app-danger)">
          {{ $t('posts.notes.loadError') }}
          <UButton color="neutral" variant="link" class="min-h-control" @click="loadNotes">
            {{ $t('account.retry') }}
          </UButton>
        </p>
        <ul v-else-if="notes && notes.length > 0" class="divide-y divide-(--app-border)">
          <li v-for="n in notes" :key="n.id" class="flex gap-3 px-4 py-3">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--app-surface-sunken) text-xs font-semibold"
              aria-hidden="true"
              >{{ initials(n.authorName) }}</span
            >
            <div class="min-w-0 flex-1">
              <p class="text-xs text-(--app-text-muted)">
                {{ authorOf(n) }} · <time :datetime="n.createdAt">{{ when(n.createdAt) }}</time>
              </p>
              <p class="text-sm break-words whitespace-pre-line">{{ n.body }}</p>
            </div>
            <UButton
              v-if="n.canDelete && !archived"
              color="neutral"
              variant="ghost"
              icon="i-lucide-trash-2"
              class="size-11 shrink-0 justify-center"
              :aria-label="$t('posts.notes.remove')"
              @click="removing = n"
            />
          </li>
        </ul>
      </div>
      <form
        v-if="mayWrite"
        class="flex h-control items-center gap-1 rounded-control border border-(--app-field-border) bg-(--app-surface) ps-2.5 pe-1 focus-within:border-(--app-text)"
        novalidate
        @submit.prevent="add"
      >
        <label for="post-note" class="sr-only">{{ $t('posts.notes.label') }}</label>
        <input
          id="post-note"
          v-model="draft"
          type="text"
          maxlength="2000"
          :disabled="!postId"
          :placeholder="postId ? $t('posts.notes.placeholder') : $t('posts.notes.beforeDraft')"
          class="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--app-text-muted) disabled:cursor-not-allowed"
        />
        <!-- only once there is something to add (screen 08: an empty field); Enter adds too -->
        <UButton
          v-show="draft.trim() !== '' || sending"
          type="submit"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="sending"
          :disabled="!postId || draft.trim() === ''"
        >
          {{ $t('posts.notes.add') }}
        </UButton>
      </form>
      <p
        v-else-if="!notes || notes.length === 0"
        class="flex min-h-control items-center text-(--app-text-muted)"
      >
        {{ $t('posts.notes.empty') }}
      </p>
      <p v-if="problem" role="alert" class="text-sm text-(--app-danger)">{{ problem }}</p>
      <UModal
        :open="removing !== null"
        :title="$t('posts.notes.removeTitle')"
        :description="$t('posts.notes.removeText')"
        @update:open="
          (v: boolean) => {
            if (!v) removing = null
          }
        "
      >
        <template #footer>
          <div class="flex w-full flex-wrap justify-end gap-3">
            <UButton color="neutral" variant="ghost" class="min-h-control" @click="removing = null">
              {{ $t('posts.notes.keep') }}
            </UButton>
            <UButton color="error" class="min-h-control" @click="removing && remove(removing)">
              {{ $t('posts.notes.remove') }}
            </UButton>
          </div>
        </template>
      </UModal>
    </div>
  </PostEditorRow>
</template>
