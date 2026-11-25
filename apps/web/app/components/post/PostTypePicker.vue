<script setup lang="ts">
import { typeHint, typeOptions, type PostType } from '~/utils/post-editor'

/**
 * «Tipo» (D-60, §11.2 point 2; screen 08): the four types on one line, none chosen with no file.
 * The types that do not go with the files are off; why is one sentence under them, written for
 * the files there are («Con 2 file si può fare solo un carosello.»), read with every button off.
 */
const props = defineProps<{
  type: PostType | null
  kinds: { kind: 'image' | 'video' | null }[]
  disabled?: boolean
}>()
const emit = defineEmits<{ choose: [PostType] }>()

const options = computed(() => typeOptions(props.kinds))
const hint = computed(() => typeHint(props.kinds))
const someOff = computed(() => options.value.some((o) => !o.enabled))
</script>

<template>
  <PostEditorRow heading="post-type" :label="$t('posts.type.title')">
    <div
      role="group"
      :aria-label="$t('posts.type.title')"
      class="flex gap-0.5 rounded-control border border-(--app-border) bg-(--app-surface-sunken) p-[3px]"
    >
      <button
        v-for="o in options"
        :key="o.type"
        type="button"
        :aria-pressed="type === o.type"
        :aria-disabled="!o.enabled || disabled"
        :aria-describedby="!o.enabled && hint ? 'post-type-why' : undefined"
        :data-type="o.type"
        class="inline-flex h-7 min-w-0 flex-1 items-center max-md:flex-auto justify-center gap-1.5 rounded-[5px] px-2.5 font-medium whitespace-nowrap text-(--app-text-muted) max-md:h-9 max-md:px-1.5"
        :class="[
          type === o.type
            ? 'bg-(--app-surface) font-semibold text-(--app-text) shadow-[var(--app-shadow-1),0_0_0_1px_var(--app-border)]'
            : '',
          !o.enabled || disabled ? 'cursor-not-allowed opacity-55' : 'hover:text-(--app-text)',
        ]"
        @click="o.enabled && !disabled && emit('choose', o.type)"
      >
        <UIcon :name="POST_TYPE_ICON[o.type]" class="size-4 shrink-0" aria-hidden="true" />
        {{ $t(`posts.type.${o.type}`) }}
      </button>
    </div>
    <p
      v-if="hint && someOff"
      id="post-type-why"
      class="mt-2 flex items-center gap-1.5 text-detail text-(--app-text-muted)"
    >
      <UIcon name="i-lucide-info" class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ $t(`posts.type.hint.${hint.key}`, { n: hint.n }) }}</span>
    </p>
  </PostEditorRow>
</template>
