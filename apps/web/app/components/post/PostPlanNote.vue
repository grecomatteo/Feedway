<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'
import { PLAN_TYPE_ICONS, planDifferences, type PlanItem } from '~/utils/plan'

/**
 * «Dal piano» (spec §11.12, plan 09 Task 7): a post prepared from the editorial plan shows, as
 * its first row, what the plan asked for: the title, type, day and time, and the note for who
 * prepares, in evidence. When the post goes out on another day, or is another type, the row
 * says what the plan had, without blocking (rule 3). A post that does not come from the plan
 * has no row; with the module off the read answers 404 and the row stays away too.
 */
const props = defineProps<{ editor: PostEditor; client: WorkspaceView }>()
const org = useOrganization()
const { call } = useApi()
const { t } = useI18n()

const item = ref<PlanItem | null>(null)
let asked: string | null = null
watch(
  () => props.editor.save.value.postId,
  async (postId) => {
    if (!postId || postId === asked || org.organization.value?.modules.plan !== true) return
    asked = postId
    try {
      const read = await call<{ item: PlanItem | null }>(
        'GET',
        org.api(
          `/workspaces/${encodeURIComponent(props.client.id)}/posts/${encodeURIComponent(postId)}/plan`,
        ),
      )
      if (asked === postId) item.value = read.item
    } catch {
      // only a reminder: the post is written the same without it
    }
  },
  { immediate: true },
)

// the type of the plan, once the post is read (reading it sets the type again)
watch(
  () => [item.value, props.editor.loadState.value] as const,
  ([planned, load]) => {
    if (planned && load === 'ready') props.editor.takePlanType(planned.type)
  },
  { immediate: true },
)

const typeName = (type: string) => t(`posts.type.${type}`)
const planned = computed(() => {
  const i = item.value
  if (!i) return ''
  const day = formatDay(i.localDate)
  return i.localTime
    ? t('posts.plan.plannedAt', { type: typeName(i.type), day, time: formatTime(i.localTime) })
    : t('posts.plan.plannedOn', { type: typeName(i.type), day })
})
const differs = computed(() =>
  item.value
    ? planDifferences(item.value, {
        localDate: props.editor.when.value?.localDate ?? null,
        type: props.editor.type.value,
      })
    : { day: null, type: null },
)
const planLink = computed(() =>
  item.value
    ? {
        path: org.to('/piano'),
        query: { spazio: props.client.slug, giorno: item.value.localDate },
      }
    : null,
)
</script>

<template>
  <PostEditorRow v-if="item" heading="post-plan" :label="$t('posts.plan.title')" data-post-plan>
    <div class="flex flex-col gap-3 md:pt-2">
      <div class="flex items-start gap-2.5">
        <UIcon
          :name="PLAN_TYPE_ICONS[item.type]"
          class="mt-0.5 size-4 shrink-0 text-(--app-text-muted)"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="font-medium break-words">{{ item.title }}</p>
          <p class="text-detail text-(--app-text-muted)">{{ planned }}</p>
        </div>
        <UButton
          v-if="planLink"
          :to="planLink"
          color="neutral"
          variant="link"
          size="sm"
          class="shrink-0"
        >
          {{ $t('posts.plan.open') }}
        </UButton>
      </div>
      <div
        v-if="item.note"
        class="rounded-card bg-(--app-warning-soft) px-4 py-3"
        data-post-plan-note
      >
        <p class="text-detail font-medium">{{ $t('posts.plan.note') }}</p>
        <p class="whitespace-pre-line break-words">{{ item.note }}</p>
      </div>
      <p
        v-if="differs.day"
        class="flex items-start gap-2 text-detail text-(--app-text-muted)"
        data-post-plan-day
      >
        <UIcon name="i-lucide-calendar-clock" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ $t('posts.plan.otherDay', { day: formatDay(differs.day) }) }}
      </p>
      <p
        v-if="differs.type"
        class="flex items-start gap-2 text-detail text-(--app-warning)"
        data-post-plan-type
      >
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{
          $t('posts.plan.otherType', {
            planned: typeName(differs.type).toLowerCase(),
            chosen: typeName(editor.type.value ?? '').toLowerCase(),
          })
        }}
      </p>
    </div>
  </PostEditorRow>
</template>
