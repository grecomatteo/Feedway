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
async function close() {
  adding.value = false
  draft.value = ''
  await nextTick()
  addButton.value?.$el.focus()
}
function add() {
  const tag = draft.value.trim().slice(0, props.maxLength)
  const known = props.modelValue.some((x) => x.toLowerCase() === tag.toLowerCase())
  if (tag && !known && props.modelValue.length < props.max) {
    emit('update:modelValue', [...props.modelValue, tag])
  }
  void close()
}
function remove(tag: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((x) => x !== tag),
  )
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span :id="listId" class="sr-only">{{ t('library.detail.tags') }}</span>
    <ul v-if="modelValue.length > 0" :aria-labelledby="listId" class="contents">
      <li
        v-for="tag in modelValue"
        :key="tag"
        class="group inline-flex h-6 max-w-full items-center gap-1 rounded-[6px] border border-(--app-border-strong) bg-(--app-card) px-2 text-[0.8125rem]"
      >
        <span class="truncate">{{ tag }}</span>
        <button
          v-if="!readOnly"
          type="button"
          class="sr-only -mr-1 items-center justify-center rounded-[4px] text-(--app-text-muted) group-hover:not-sr-only group-hover:flex group-hover:size-4 hover:bg-(--app-nav-hover) hover:text-(--app-text) focus-visible:not-sr-only focus-visible:flex focus-visible:size-4 [@media(hover:none)]:not-sr-only [@media(hover:none)]:flex [@media(hover:none)]:size-4"
          :aria-label="t('library.detail.removeTag', { tag })"
          @click="remove(tag)"
        >
          <UIcon name="i-lucide-x" class="size-3" />
        </button>
      </li>
    </ul>
    <template v-if="!readOnly && modelValue.length < max">
      <input
        v-if="adding"
        ref="field"
        v-model="draft"
        type="text"
        :maxlength="maxLength"
        :aria-label="t('library.detail.newTag')"
        :placeholder="t('library.detail.newTag')"
        class="h-7.5 w-36 rounded-control border border-(--app-border-strong) bg-(--app-card) px-2 text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-(--app-focus)"
        @keydown.enter.prevent="add"
        @keydown.esc.stop.prevent="close"
        @blur="draft.trim() ? add() : (adding = false)"
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
        class="h-7.5 px-2.5 text-[0.8125rem] font-medium"
        @click="open"
      />
    </template>
    <span v-if="readOnly && modelValue.length === 0" class="text-(--app-text-muted)">—</span>
  </div>
</template>
