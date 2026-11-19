<script setup lang="ts">
import { editorKeyOf } from '~/utils/post-editor'

/**
 * Nuovo post, and the same page to change one (plan 06 Task 5, spec §11.2; brief F02; design
 * E1–E7): `…/spazi/<cliente>/post/nuovo` makes a draft at its first content, then the address
 * becomes the post's without a new page (the key below keeps the editor mounted). No side bar:
 * the editor draws its own row at the top (screens 08 and 09).
 */
definePageMeta({
  layout: 'agency',
  editor: true,
  key: (route) =>
    `post-${String(route.params['slug'])}-${editorKeyOf(String(route.params['postId']))}`,
})

const route = useRoute()
const org = useOrganization()
const { t } = useI18n()
const { client, profiles } = useClientPage()
const firstId = route.params['postId'] === 'nuovo' ? null : String(route.params['postId'])

useHead({
  title: () =>
    `${firstId ? t('posts.editor.editTitle') : t('posts.editor.newTitle')} · ${client.value?.name ?? ''}`,
})
const back = computed(() =>
  org.to(`/spazi/${encodeURIComponent(String(route.params['slug']))}/post`),
)
const profileList = computed(() => profiles.data.value?.items ?? [])
</script>

<template>
  <ClientOnly>
    <PostEditorForm
      v-if="client"
      :key="client.id"
      :client="client"
      :post-id="firstId"
      :profile-key="typeof route.query['profilo'] === 'string' ? route.query['profilo'] : null"
      :profiles="profileList"
      :profiles-loading="profiles.status.value === 'pending' || profiles.status.value === 'idle'"
      :back="back"
    />
    <div v-else class="px-gutter pt-page-top"><ListSkeleton /></div>
    <template #fallback>
      <div class="px-gutter pt-page-top"><ListSkeleton /></div>
    </template>
  </ClientOnly>
</template>
