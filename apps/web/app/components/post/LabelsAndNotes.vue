<script setup lang="ts">
import type { LabelDto, PostNoteDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Etichette e note» (§11.7, design E1): the client's labels as pills, chosen with «+ Etichetta»
 * and saved with the post; the internal notes of the post with their author and time, and a row
 * to write one. Notes go with the saved post, never with the draft's autosave, and never to a
 * client (§11.10). An Editor notes anyone's post and takes off only their own notes.
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
const { t, locale } = useI18n()
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
  notesFailed.value = false
  try {
    notes.value = (
      await call<{ items: PostNoteDto[] }>(
        'GET',
        `${props.base}/posts/${encodeURIComponent(postId.value)}/notes`,
      )
    ).items
  } catch {
    notesFailed.value = true
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
async function remove(n: PostNoteDto) {
  if (!postId.value) return
  problem.value = null
  try {
    await call(
      'DELETE',
      `${props.base}/posts/${encodeURIComponent(postId.value)}/notes/${encodeURIComponent(n.id)}`,
    )
    notes.value = (notes.value ?? []).filter((x) => x.id !== n.id)
  } catch (err) {
    problem.value = failure(err).message
  }
}

const org = useOrganization()
const authorOf = (n: PostNoteDto) =>
  n.authorId === org.me.value?.id ? t('posts.notes.you') : n.authorName || t('posts.list.someone')
function when(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return t('posts.notes.today', { time })
  const day = d.toLocaleDateString(locale.value, { day: 'numeric', month: 'long' })
  return t('posts.notes.on', { day, time })
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
</script>

<template>
  <section aria-labelledby="post-labels-notes" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id="post-labels-notes" class="text-lg">{{ $t('posts.labels.title') }}</h2>
      <p class="text-sm text-(--app-text-muted)">{{ $t('posts.labels.agencyOnly') }}</p>
    </div>

    <ul class="flex flex-wrap items-center gap-2" :aria-label="$t('posts.labels.chosen')">
      <li
        v-for="l in chosen"
        :key="l.id"
        class="inline-flex min-h-9 items-center gap-2 rounded-full border border-(--app-border) bg-(--app-card) pr-1 pl-3 text-sm"
      >
        <ContentLabelDot :color="l.color" />
        {{ l.name }}
        <UButton
          v-if="e.editable.value"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          class="size-8 justify-center rounded-full"
          :aria-label="$t('posts.labels.remove', { name: l.name })"
          @click="toggle(l.id)"
        />
      </li>
      <li v-if="e.editable.value">
        <UDropdownMenu :items="labelItems" :content="{ align: 'start' }">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            class="min-h-9 rounded-full"
            :loading="labels === null"
          >
            {{ $t('posts.labels.add') }}
          </UButton>
        </UDropdownMenu>
      </li>
      <li v-else-if="chosen.length === 0" class="text-sm text-(--app-text-muted)">
        {{ $t('posts.labels.noneOnPost') }}
      </li>
    </ul>

    <div class="overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)">
      <p v-if="notesFailed" role="alert" class="px-4 py-3 text-sm text-(--app-danger)">
        {{ $t('posts.notes.loadError') }}
        <UButton color="neutral" variant="link" class="min-h-10" @click="loadNotes">
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
            class="size-10 shrink-0 justify-center"
            :aria-label="$t('posts.notes.remove')"
            @click="remove(n)"
          />
        </li>
      </ul>
      <form
        v-if="mayWrite"
        class="flex items-center gap-2 border-t border-(--app-border) px-2 first:border-t-0"
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
          class="min-h-12 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-(--app-text-muted) disabled:cursor-not-allowed"
        />
        <UButton
          type="submit"
          color="neutral"
          variant="ghost"
          class="min-h-11"
          :loading="sending"
          :disabled="!postId || draft.trim() === ''"
        >
          {{ $t('posts.notes.add') }}
        </UButton>
      </form>
      <p v-else-if="!notes || notes.length === 0" class="px-4 py-3 text-sm text-(--app-text-muted)">
        {{ $t('posts.notes.empty') }}
      </p>
    </div>
    <p v-if="problem" role="alert" class="text-sm text-(--app-danger)">{{ problem }}</p>
  </section>
</template>
