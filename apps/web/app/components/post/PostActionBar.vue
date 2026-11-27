<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * The actions of the editor: in the row at the top on a computer (screens 08 and 09), in a bar
 * at the bottom on a phone (screens 08, 09 and 11). The state of the save («Salvataggio…»,
 * «Bozza salvata alle 18:04», «Non salvata: riprova»), what is missing («Manca 1 scelta»), then
 * the buttons. At the top a draft has «Salva ed esci» and «Programma su N account» (an Editor
 * only «Salva ed esci»); at the bottom only «Programma» (the draft saves by itself), or «Salva ed
 * esci» for an Editor. A scheduled post has «Annulla programmazione», «Riporta in bozza» and
 * «Salva modifiche»; a cancelled one only «Elimina post». A saved draft has its «⋯» with
 * «Elimina», which sends it to «Eliminati» with no question (plan 09 Scelta 12).
 */
const props = withDefaults(
  defineProps<{ editor: PostEditor; accountsCount: number; placement?: 'top' | 'bottom' }>(),
  { placement: 'bottom' },
)
const emit = defineEmits<{
  schedule: []
  publishNow: []
  cancel: []
  remove: []
  exit: []
  goto: [section: string]
}>()
const { t } = useI18n()
const e = props.editor

const savedAt = computed(() => {
  const at = e.save.value.savedAt
  return at ? formatTime(at) : null
})
const saveLine = computed(() => {
  const s = e.save.value
  if (s.status === 'saving')
    return { text: t('posts.save.saving'), tone: 'muted', icon: 'i-lucide-loader' }
  if (s.status === 'failed')
    return { text: t('posts.save.failed'), tone: 'danger', icon: 'i-lucide-cloud-off' }
  if (s.status === 'conflict')
    return { text: t('posts.save.conflict'), tone: 'danger', icon: 'i-lucide-cloud-alert' }
  if (e.status.value !== 'draft') return null
  if (s.status === 'saved' && savedAt.value && !s.dirty)
    return {
      text: t('posts.save.saved', { time: savedAt.value }),
      tone: 'success',
      icon: 'i-lucide-cloud-check',
    }
  if (s.postId === null)
    return { text: t('posts.save.notYet'), tone: 'muted', icon: 'i-lucide-cloud' }
  return null
})
const TONE: Record<string, string> = {
  muted: 'text-(--app-text-muted)',
  danger: 'text-(--app-danger)',
  success: 'text-(--app-success)',
}

const report = computed(() => e.report.value)
const blocks = computed(() => report.value?.outcomes.filter((o) => o.level === 'block').length ?? 0)
const open = computed(() => report.value?.unresolved.length ?? 0)
const busyFiles = computed(() => e.entries.value.filter((x) => !x.file).length)
/** What keeps «Programma» off, in one line that leads to the checks; a choice or a block in amber. */
const missing = computed(() => {
  if (busyFiles.value > 0)
    return {
      text: t('posts.actions.waitFiles', { n: busyFiles.value }, busyFiles.value),
      warn: false,
    }
  if (e.checking.value && !report.value) return { text: t('posts.actions.checking'), warn: false }
  if (open.value > 0)
    return { text: t('posts.actions.choose', { n: open.value }, open.value), warn: true }
  if (blocks.value > 0)
    return { text: t('posts.actions.fix', { n: blocks.value }, blocks.value), warn: true }
  return null
})
const canSchedule = computed(
  () =>
    e.editable.value &&
    report.value?.canSchedule === true &&
    busyFiles.value === 0 &&
    e.save.value.status !== 'conflict',
)
/**
 * «Programma» off because of a choice or a block still reads as off, but a click on it leads to
 * what is missing, as «Manca 1 scelta» does: an off button that answers nothing reads as broken.
 */
const leadsToMissing = computed(() => !canSchedule.value && !!missing.value?.warn)
/** «Pubblica subito» (Scelta 2): the same button, which asks first */
const now = computed(() => e.mode.value === 'now')
function scheduleOrShow() {
  if (leadsToMissing.value) emit('goto', 'post-summary')
  else if (now.value) emit('publishNow')
  else emit('schedule')
}
const draft = computed(() => e.status.value === 'draft')
/** «⋯ → Elimina» of a saved draft this person may change */
const draftMenu = computed(() =>
  draft.value && e.editable.value && e.save.value.postId !== null
    ? [
        [
          {
            label: t('trash.action'),
            icon: 'i-lucide-trash-2',
            color: 'error' as const,
            disabled: e.acting.value === 'delete',
            onSelect: () => emit('remove'),
          },
        ],
      ]
    : [],
)
/** «Bozza salvata» over «alle 11:53», at the bottom on a phone */
const saved = computed(
  () => e.save.value.status === 'saved' && savedAt.value !== null && !e.save.value.dirty,
)
/** At the bottom, what is missing takes the place of the state, unless the save failed. */
const showMissing = computed(
  () =>
    !!missing.value &&
    e.editable.value &&
    e.may.value.publish &&
    draft.value &&
    e.save.value.status !== 'failed' &&
    e.save.value.status !== 'conflict',
)
/** How much the open keyboard covers at the bottom: the bar stays above it (plan R7). */
const keyboard = ref(0)
function measure() {
  const v = window.visualViewport
  keyboard.value = v ? Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)) : 0
}
onMounted(() => {
  if (props.placement !== 'bottom') return
  measure()
  window.visualViewport?.addEventListener('resize', measure)
  window.visualViewport?.addEventListener('scroll', measure)
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', measure)
  window.visualViewport?.removeEventListener('scroll', measure)
})
const scheduled = computed(() => e.status.value === 'scheduled')
</script>

<template>
  <!-- at the top: the state beside the title, then what is missing and the buttons on the right -->
  <template v-if="placement === 'top'">
    <p
      v-if="saveLine"
      class="ms-2 flex min-w-0 items-center gap-1.5 text-detail"
      :class="saveLine.tone === 'danger' ? TONE.danger : TONE.muted"
      role="status"
      data-save-state
    >
      <UIcon
        :name="saveLine.icon"
        class="size-4 shrink-0"
        :class="TONE[saveLine.tone]"
        aria-hidden="true"
      />
      <span class="truncate max-lg:sr-only">{{ saveLine.text }}</span>
      <UButton
        v-if="e.save.value.status === 'failed'"
        color="neutral"
        variant="outline"
        size="sm"
        @click="e.flush()"
      >
        {{ $t('posts.save.retry') }}
      </UButton>
      <UButton
        v-if="e.save.value.status === 'conflict'"
        color="neutral"
        variant="outline"
        size="sm"
        @click="e.reload()"
      >
        {{ $t('posts.save.reload') }}
      </UButton>
    </p>
    <span class="flex-1" />
    <slot />
    <div class="flex shrink-0 items-center gap-3" data-action-bar>
      <button
        v-if="missing && e.editable.value && e.may.value.publish"
        type="button"
        class="inline-flex min-h-control items-center gap-1.5 text-detail font-medium hover:underline"
        :class="missing.warn ? 'text-(--app-warning)' : 'text-(--app-text-muted)'"
        data-missing
        @click="emit('goto', 'post-summary')"
      >
        <UIcon
          :name="missing.warn ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
          class="size-4 shrink-0"
          :class="missing.warn ? '' : 'lg:hidden'"
          aria-hidden="true"
        />
        <!-- between 768 and 1024 only the icon: the row keeps its buttons whole -->
        <span class="max-lg:sr-only">{{ missing.text }}</span>
      </button>
      <template v-if="draft && e.editable.value">
        <RowActions
          v-if="draftMenu.length > 0"
          :name="''"
          :label="$t('posts.actions.more')"
          :items="draftMenu"
          data-editor-more
        />
        <UButton
          :color="e.may.value.publish ? 'neutral' : 'primary'"
          :variant="e.may.value.publish ? 'outline' : 'solid'"
          @click="emit('exit')"
        >
          {{ $t('posts.actions.saveAndExit') }}
        </UButton>
        <UButton
          v-if="e.may.value.publish"
          :icon="now ? 'i-lucide-send' : 'i-lucide-calendar-check'"
          :disabled="!canSchedule && !leadsToMissing"
          :aria-disabled="leadsToMissing || undefined"
          :class="{ 'aria-disabled:cursor-pointer': leadsToMissing }"
          :loading="e.acting.value === 'schedule' || e.acting.value === 'publishNow'"
          data-schedule
          @click="scheduleOrShow"
        >
          {{
            $t(
              now ? 'posts.actions.publishNow' : 'posts.actions.schedule',
              { n: accountsCount },
              accountsCount,
            )
          }}
        </UButton>
      </template>
      <template v-else-if="scheduled && e.editable.value">
        <UButton
          color="error"
          variant="ghost"
          :loading="e.acting.value === 'cancel'"
          @click="emit('cancel')"
        >
          {{ $t('posts.actions.cancel') }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="e.acting.value === 'unschedule'"
          @click="e.unschedule()"
        >
          {{ $t('posts.actions.unschedule') }}
        </UButton>
        <UButton
          :disabled="!e.save.value.dirty"
          :loading="e.acting.value === 'saveScheduled'"
          @click="e.saveScheduled()"
        >
          {{ $t('posts.actions.saveChanges') }}
        </UButton>
      </template>
      <UButton
        v-else-if="e.mayDelete.value"
        color="error"
        variant="outline"
        :loading="e.acting.value === 'delete'"
        @click="emit('remove')"
      >
        {{ $t('posts.actions.delete') }}
      </UButton>
    </div>
  </template>

  <!-- at the bottom, on a phone (screens 08, 09 and 11): the state on the left, one button on the
       right; above the keyboard when it is open -->
  <div
    v-else
    class="sticky z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-(--app-border) bg-(--app-surface) pt-2.5 pe-3 pb-3.5 ps-4"
    :style="{ bottom: `${keyboard}px` }"
    data-action-bar
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <button
        v-if="showMissing && missing"
        type="button"
        class="inline-flex min-h-11 min-w-0 items-center gap-1.5 text-detail font-medium"
        :class="missing.warn ? 'text-(--app-warning)' : 'text-(--app-text-muted)'"
        data-missing
        @click="emit('goto', 'post-summary')"
      >
        <UIcon
          :name="missing.warn ? 'i-lucide-triangle-alert' : 'i-lucide-info'"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">{{ missing.text }}</span>
      </button>
      <!-- what is missing takes its place on the screen; a screen reader still hears it -->
      <p
        v-if="saveLine"
        class="flex min-w-0 items-center gap-1.5 text-detail"
        :class="[saveLine.tone === 'danger' ? TONE.danger : TONE.muted, { 'sr-only': showMissing }]"
        role="status"
        data-save-state
      >
        <UIcon
          :name="saveLine.icon"
          class="size-4 shrink-0"
          :class="TONE[saveLine.tone]"
          aria-hidden="true"
        />
        <span v-if="saved" class="min-w-0 leading-4">
          {{ $t('posts.save.savedShort') }}
          <small class="block text-caption">{{
            $t('posts.save.savedAt', { time: savedAt })
          }}</small>
        </span>
        <span v-else class="min-w-0">{{ saveLine.text }}</span>
      </p>
      <UButton
        v-if="e.save.value.status === 'failed'"
        color="neutral"
        variant="outline"
        size="sm"
        class="shrink-0 max-md:min-h-control"
        @click="e.flush()"
      >
        {{ $t('posts.save.retry') }}
      </UButton>
      <UButton
        v-if="e.save.value.status === 'conflict'"
        color="neutral"
        variant="outline"
        size="sm"
        class="shrink-0 max-md:min-h-control"
        @click="e.reload()"
      >
        {{ $t('posts.save.reload') }}
      </UButton>
    </div>
    <div class="ms-auto flex min-w-0 flex-wrap justify-end gap-2">
      <template v-if="draft && e.editable.value">
        <RowActions
          v-if="draftMenu.length > 0"
          :name="''"
          :label="$t('posts.actions.more')"
          :items="draftMenu"
          data-editor-more
        />
        <UButton
          v-if="e.may.value.publish"
          :icon="now ? 'i-lucide-send' : 'i-lucide-calendar-check'"
          :disabled="!canSchedule && !leadsToMissing"
          :aria-disabled="leadsToMissing || undefined"
          :class="{ 'aria-disabled:cursor-pointer': leadsToMissing }"
          :loading="e.acting.value === 'schedule' || e.acting.value === 'publishNow'"
          data-schedule
          @click="scheduleOrShow"
        >
          {{
            showMissing
              ? $t(now ? 'posts.actions.publishShort' : 'posts.actions.scheduleShort')
              : $t(
                  now ? 'posts.actions.publishNow' : 'posts.actions.schedule',
                  { n: accountsCount },
                  accountsCount,
                )
          }}
        </UButton>
        <UButton v-else @click="emit('exit')">
          {{ $t('posts.actions.saveAndExit') }}
        </UButton>
      </template>
      <template v-else-if="scheduled && e.editable.value">
        <UButton
          color="error"
          variant="ghost"
          :loading="e.acting.value === 'cancel'"
          @click="emit('cancel')"
        >
          {{ $t('posts.actions.cancel') }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          :loading="e.acting.value === 'unschedule'"
          @click="e.unschedule()"
        >
          {{ $t('posts.actions.unschedule') }}
        </UButton>
        <UButton
          :disabled="!e.save.value.dirty"
          :loading="e.acting.value === 'saveScheduled'"
          @click="e.saveScheduled()"
        >
          {{ $t('posts.actions.saveChanges') }}
        </UButton>
      </template>
      <UButton
        v-else-if="e.mayDelete.value"
        color="error"
        variant="outline"
        :loading="e.acting.value === 'delete'"
        @click="emit('remove')"
      >
        {{ $t('posts.actions.delete') }}
      </UButton>
    </div>
  </div>
</template>
