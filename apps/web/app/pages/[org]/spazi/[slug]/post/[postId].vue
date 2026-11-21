<script setup lang="ts">
import type { PostResponse } from '@app/contracts'
import { editorKeyOf } from '~/utils/post-editor'

/**
 * Nuovo post, and the same page to change one (plan 06 Task 5, spec §11.2; brief F02; design
 * E1–E7): `…/spazi/<cliente>/post/nuovo` makes a draft at its first content, then the address
 * becomes the post's without a new page (the key below keeps the editor mounted). No side bar:
 * the editor draws its own row at the top (screens 08 and 09). A post out or on its way opens on
 * the page of its outcome instead (plan 07 Scelta 6, screen 13), with the side bar: the editor
 * tells when the post it read is one, and «Pubblica subito» leads there too.
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

const outcome = ref<PostResponse | null>(null)
const outcomePage = usePostOutcomePage()
function showOutcome(post: PostResponse) {
  outcome.value = post
  outcomePage.value = true
  // «Pubblica subito» from a new post: the address becomes the post's
  if (route.params['postId'] !== post.id)
    void navigateTo(
      {
        path: org.to(
          `/spazi/${encodeURIComponent(String(route.params['slug']))}/post/${encodeURIComponent(post.id)}`,
        ),
      },
      { replace: true },
    )
}
onBeforeUnmount(() => (outcomePage.value = false))
/** «Modifica» of a post in preparation (R13): the editor, on the post of the outcome */
const editingId = ref<string | null>(null)
function edit(post: PostResponse) {
  editingId.value = post.id
  outcome.value = null
  outcomePage.value = false
}
function outcomeAgain(post: PostResponse) {
  editingId.value = null
  showOutcome(post)
}

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
    <PostOutcome
      v-if="client && outcome"
      :key="`outcome-${outcome.id}`"
      :client="client"
      :post="outcome"
      :profiles="profileList"
      :back="back"
      @edit="edit"
    />
    <PostEditorForm
      v-else-if="client"
      :key="`${client.id}-${editingId ?? ''}`"
      :client="client"
      :post-id="editingId ?? firstId"
      :profile-key="typeof route.query['profilo'] === 'string' ? route.query['profilo'] : null"
      :file-id="typeof route.query['file'] === 'string' ? route.query['file'] : null"
      :profiles="profileList"
      :profiles-loading="profiles.status.value === 'pending' || profiles.status.value === 'idle'"
      :back="back"
      :editing="editingId !== null"
      @outcome="outcomeAgain"
    />
    <div v-else class="px-gutter pt-page-top"><ListSkeleton /></div>
    <template #fallback>
      <div class="px-gutter pt-page-top"><ListSkeleton /></div>
    </template>
  </ClientOnly>
</template>
