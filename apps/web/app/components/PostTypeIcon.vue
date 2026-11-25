<script setup lang="ts">
import type { PostType } from '~/utils/post-editor'

/**
 * The format of a post as its icon (photo, carousel, reel, story), the one of «Nuovo post».
 * With `named` it says the format to a screen reader and on hover; without, it is decoration
 * beside a text that already says it. The size comes from the class (`size-4` by default).
 */
withDefaults(defineProps<{ type: PostType; named?: boolean }>(), { named: false })
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center"
    :role="named ? 'img' : undefined"
    :aria-label="named ? $t(`posts.type.${type}`) : undefined"
    :aria-hidden="named ? undefined : 'true'"
    :title="named ? $t(`posts.type.${type}`) : undefined"
    :data-post-type="type"
  >
    <UIcon :name="POST_TYPE_ICON[type]" class="size-[1em]" />
  </span>
</template>
