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

// «Prepara questo contenuto» as a link (spec §11.12, plan 09 Task 7): `…/post/nuovo?piano=<id>`
// prepares the content of the plan and opens its draft in place of the new post; a content
// already prepared opens its post. The editor waits, so no empty draft is made meanwhile. The
// draft opens under the content's own client, whatever client the address names.
const planId =
  firstId === null && typeof route.query['piano'] === 'string' ? route.query['piano'] : null
const preparing = ref(planId !== null)
const prepareProblem = ref<string | null>(null)
async function prepareFromPlan() {
  if (!planId) return
  const { call, failure } = useApi()
  preparing.value = true
  prepareProblem.value = null
  try {
    const { postId, workspaceId } = await call<{ postId: string; workspaceId: string }>(
      'POST',
      org.api(`/plan/${encodeURIComponent(planId)}/prepare`),
    )
    let slug = String(route.params['slug'])
    if (client.value?.id !== workspaceId) {
      const { items } = await call<{ items: { id: string; slug: string }[] }>(
        'GET',
        org.api('/workspaces'),
      )
      slug = items.find((w) => w.id === workspaceId)?.slug ?? slug
    }
    await navigateTo(
      org.to(`/spazi/${encodeURIComponent(slug)}/post/${encodeURIComponent(postId)}`),
      { replace: true },
    )
  } catch (e) {
    prepareProblem.value = failure(e).message
    preparing.value = false
  }
}
onMounted(prepareFromPlan)
const planPage = computed(() => ({
  path: org.to('/piano'),
  query: { spazio: String(route.params['slug']) },
}))

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
// back to the calendar the post was opened from, with its view, day and filters; otherwise to
// the client's calendar in the profile of the address (plan 09 Task 3: «Post» became «Calendario»)
const cameFrom = import.meta.client
  ? (window.history.state as { back?: unknown } | null)?.back
  : null
const back = computed(() => {
  const calendar = org.to(`/spazi/${encodeURIComponent(String(route.params['slug']))}/calendario`)
  if (
    typeof cameFrom === 'string' &&
    [calendar, org.to('/calendario')].some((p) => cameFrom === p || cameFrom.startsWith(`${p}?`))
  )
    return cameFrom
  const profilo = route.query['profilo']
  return typeof profilo === 'string' && profilo !== ''
    ? `${calendar}?profilo=${encodeURIComponent(profilo)}`
    : calendar
})
const profileList = computed(() => profiles.data.value?.items ?? [])
</script>

<template>
  <ClientOnly>
    <div v-if="preparing" class="px-gutter pt-page-top" role="status">
      <p class="sr-only">{{ $t('posts.plan.preparing') }}</p>
      <ListSkeleton />
    </div>
    <div
      v-else-if="prepareProblem"
      class="mx-auto flex max-w-[42.5rem] flex-col gap-3 px-gutter pt-page-top"
    >
      <p role="alert" class="rounded-card border-2 border-(--app-danger) px-4 py-3">
        {{ $t('posts.plan.prepareFailed', { message: prepareProblem }) }}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <UButton color="neutral" variant="outline" data-prepare-retry @click="prepareFromPlan">
          {{ $t('posts.plan.retry') }}
        </UButton>
        <NuxtLink :to="planPage" class="underline">{{ $t('posts.plan.backToPlan') }}</NuxtLink>
      </div>
    </div>
    <PostOutcome
      v-else-if="client && outcome"
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
