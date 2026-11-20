<script setup lang="ts">
// Tags as chips with «+ Tag» (screen 20): the button opens a small field, Enter adds, Escape
// closes. Each chip has its «×», shown on hover and keyboard focus (always on touch screens).
const props = withDefaults(
  defineProps<{ modelValue: string[]; readOnly?: boolean; max?: number; maxLength?: number }>(),
  { readOnly: false, max: 20, maxLength: 40 },
)
const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>()
const { t } = useI18n()
const listId = useId()
const fullId = useId()

const adding = ref(false)
const draft = ref('')
const field = ref<HTMLInputElement | null>(null)
const addButton = ref<{ $el: HTMLElement } | null>(null)

async function open() {
  adding.value = true
  draft.value = ''
  await nextTick()
  field.value?.focus()
}
const root = ref<HTMLElement | null>(null)
const full = computed(() => props.modelValue.length >= props.max)

async function close(refocus = true) {
  adding.value = false
  draft.value = ''
  if (!refocus) return
  await nextTick()
  addButton.value?.$el.focus()
}
function add(refocus = true) {
  const tag = draft.value.trim().slice(0, props.maxLength)
  const known = props.modelValue.some((x) => x.toLowerCase() === tag.toLowerCase())
  if (tag && !known && !full.value) {
    emit('update:modelValue', [...props.modelValue, tag])
  }
  void close(refocus)
}
// on blur the person went somewhere else: add what was written, leave the focus where it went
function leave() {
  if (draft.value.trim()) add(false)
  else adding.value = false
}
async function remove(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
  // the removed «×» takes the focus with it: give it to the next chip, the previous, or «+ Tag»
  await nextTick()
  const left = root.value?.querySelectorAll<HTMLElement>('[data-remove-tag]') ?? []
  const next = left[Math.min(index, left.length - 1)]
  if (next) next.focus()
  else addButton.value?.$el.focus()
}
</script>

<template>
  <div ref="root" class="flex flex-wrap items-center gap-2">
    <span :id="listId" class="sr-only">{{ t('library.detail.tags') }}</span>
    <ul v-if="modelValue.length > 0" :aria-labelledby="listId" class="contents">
      <li
        v-for="(tag, i) in modelValue"
        :key="tag"
        class="group inline-flex h-6 max-w-full items-center gap-1 rounded-[6px] border border-(--app-border-strong) bg-(--app-surface) px-2 text-[0.8125rem]"
      >
        <span class="truncate">{{ tag }}</span>
        <button
          v-if="!readOnly"
          type="button"
          class="sr-only -mr-1 items-center justify-center rounded-[4px] text-(--app-text-muted) group-hover:not-sr-only group-hover:flex group-hover:size-4 hover:bg-(--app-nav-hover) hover:text-(--app-text) focus-visible:not-sr-only focus-visible:flex focus-visible:size-4 [@media(hover:none)]:not-sr-only [@media(hover:none)]:flex [@media(hover:none)]:size-4"
          :aria-label="t('library.detail.removeTag', { tag })"
          data-remove-tag
          @click="remove(i)"
        >
          <UIcon name="i-lucide-x" class="size-3" />
        </button>
      </li>
    </ul>
    <template v-if="!readOnly">
      <input
        v-if="adding"
        ref="field"
        v-model="draft"
        type="text"
        :maxlength="maxLength"
        :aria-label="t('library.detail.newTag')"
        :placeholder="t('library.detail.newTag')"
        class="h-7.5 w-36 rounded-control border border-(--app-border-strong) bg-(--app-surface) px-2 text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-(--app-focus)"
        @keydown.enter.prevent="add()"
        @keydown.esc.stop.prevent="close()"
        @blur="leave"
      />
      <UButton
        v-else
        ref="addButton"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-plus"
        :label="t('library.detail.addTag')"
        :aria-label="t('library.detail.addTagLong')"
        :disabled="full"
        :aria-describedby="full ? fullId : undefined"
        class="h-7.5 px-2.5 text-[0.8125rem] font-medium"
        @click="open"
      />
      <span v-if="full" :id="fullId" class="text-[0.8125rem] text-(--app-text-muted)">
        {{ t('library.detail.tagsFull', { n: max }) }}
      </span>
    </template>
    <span v-if="readOnly && modelValue.length === 0" class="text-(--app-text-muted)">—</span>
  </div>
</template>
