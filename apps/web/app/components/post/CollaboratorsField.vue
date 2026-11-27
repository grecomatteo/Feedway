<script setup lang="ts">
import { MAX_INSTAGRAM_COLLABORATORS } from '@app/domain'
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Invita in collaborazione» (plan 09 Scelta 13, D-125): up to 3 Instagram usernames as chips,
 * written in a field and added with Enter, a space or a comma. Only Instagram: Facebook gets the
 * post without them, and a story has no field. Names already there on a story stay as chips, so
 * they can be taken off: the checks say they do not go out.
 */
const props = defineProps<{
  editor: PostEditor
  /** the client has an Instagram account: without one the row is not there */
  instagram: boolean
}>()
const e = props.editor

const story = computed(() => e.type.value === 'story')
const names = computed(() => e.collaborators.value)
const shown = computed(() => names.value.length > 0 || (props.instagram && !story.value))
const mayAdd = computed(
  () => e.editable.value && !story.value && names.value.length < MAX_INSTAGRAM_COLLABORATORS,
)

const typed = ref('')
function add() {
  const more = typedCollaborators(typed.value)
  typed.value = ''
  if (more.length === 0) return
  e.setCollaborators([...names.value, ...more])
}
function onInput() {
  // a space or a comma ends a name, as on Meta Business Suite
  if (/[\s,;]$/.test(typed.value)) add()
}
async function remove(i: number) {
  e.setCollaborators(names.value.filter((_, j) => j !== i))
  // the chip's button is gone: the focus goes to the field, or to the row when there is none
  await nextTick()
  document.getElementById('post-collaborator')?.focus()
}
</script>

<template>
  <PostEditorRow
    v-if="shown"
    heading="post-collaborators"
    :label="$t('posts.collaborators.title')"
    :detail="
      names.length > 0
        ? $t('posts.collaborators.count', {
            count: names.length,
            max: MAX_INSTAGRAM_COLLABORATORS,
          })
        : null
    "
    data-collaborators
  >
    <div class="flex flex-col gap-2">
      <ul
        v-if="names.length > 0"
        class="flex flex-wrap items-center gap-2"
        :aria-label="$t('posts.collaborators.chosen')"
      >
        <li
          v-for="(name, i) in names"
          :key="`${name}-${i}`"
          class="group inline-flex h-6 items-center gap-1 rounded-thumb border border-(--app-border-strong) bg-(--app-surface) ps-2 text-detail"
          :class="e.editable.value ? 'pe-0.5' : 'pe-2'"
          data-collaborator-chip
        >
          <span><span class="text-(--app-text-muted)">@</span>{{ name }}</span>
          <button
            v-if="e.editable.value"
            type="button"
            class="relative grid size-5 place-items-center rounded-[4px] text-(--app-text-muted) after:absolute after:-inset-2.5 after:content-[''] hover:bg-(--app-surface-sunken) hover:text-(--app-text) focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
            :aria-label="$t('posts.collaborators.remove', { name })"
            @click="remove(i)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <form
        v-if="mayAdd"
        class="flex h-control items-center gap-1 rounded-control border border-(--app-field-border) bg-(--app-surface) ps-2.5 pe-1 focus-within:border-(--app-text)"
        novalidate
        @submit.prevent="add"
      >
        <label for="post-collaborator" class="sr-only">{{ $t('posts.collaborators.label') }}</label>
        <span class="text-(--app-text-muted)" aria-hidden="true">@</span>
        <input
          id="post-collaborator"
          v-model="typed"
          type="text"
          maxlength="64"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          :placeholder="$t('posts.collaborators.placeholder')"
          aria-describedby="post-collaborators-help"
          class="h-full min-w-0 flex-1 bg-transparent outline-none! placeholder:text-(--app-text-muted)"
          @input="onInput"
          @blur="add"
        />
        <UButton
          v-show="typed.trim() !== ''"
          type="submit"
          color="neutral"
          variant="ghost"
          size="sm"
        >
          {{ $t('posts.collaborators.add') }}
        </UButton>
      </form>
      <p
        v-else-if="names.length === 0"
        class="flex min-h-control items-center text-(--app-text-muted)"
      >
        {{ $t('posts.collaborators.none') }}
      </p>
      <p
        id="post-collaborators-help"
        class="flex items-center gap-1.5 text-detail text-(--app-text-muted)"
      >
        <UIcon name="i-lucide-instagram" class="size-3.5 shrink-0" aria-hidden="true" />
        {{ story ? $t('posts.collaborators.notOnStory') : $t('posts.collaborators.onlyInstagram') }}
      </p>
    </div>
  </PostEditorRow>
</template>
