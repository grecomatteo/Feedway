<script setup lang="ts">
import { captionParts } from '@app/domain'
import { shortCaption } from '~/utils/post-preview'

/**
 * The text of a platform as its app shows it: cut after a few lines with «… altro», hashtags
 * and mentions coloured as the counters read them (§11.3).
 */
const props = defineProps<{
  text: string
  limits: { chars: number; lines: number }
  /** Instagram writes the account's name in bold before the text */
  name?: string
  more: string
  /** the colour of hashtags and mentions */
  tone: 'instagram' | 'facebook' | 'light'
}>()
const open = ref(false)
watch(
  () => props.text,
  () => (open.value = false),
)
const cut = computed(() => shortCaption(props.text, props.limits))
const parts = computed(() => captionParts(open.value ? props.text : cut.value.text))
const toneClass = computed(
  () =>
    ({
      instagram: 'text-[#00376b]',
      facebook: 'text-[#385898]',
      light: 'font-semibold text-white',
    })[props.tone],
)
</script>

<template>
  <p class="text-[0.78125rem] leading-snug break-words whitespace-pre-line" data-preview-caption>
    <span v-if="name" class="font-semibold">{{ name }} </span>
    <template v-for="(p, i) in parts" :key="i">
      <span v-if="p.kind === 'text'">{{ p.text }}</span>
      <span v-else :class="toneClass" :data-mark="p.kind">{{ p.text }}</span>
    </template>
    <template v-if="cut.cut && !open">
      …
      <button
        type="button"
        class="opacity-70 hover:underline"
        :aria-expanded="false"
        @click="open = true"
      >
        {{ more }}
      </button>
    </template>
  </p>
</template>
