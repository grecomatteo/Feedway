<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * The bar of the actions, fixed at the bottom (design E1, E6g–E6k): the state of the save on
 * the left («Salvataggio…», «Bozza salvata alle 18:04», «Non salvata: riprova»), what is missing,
 * then the buttons. An Editor only has «Salva bozza»; a scheduled post has «Annulla
 * programmazione», «Riporta in bozza» and «Salva modifiche»; a cancelled one only «Elimina post».
 */
const props = defineProps<{ editor: PostEditor; accountsCount: number }>()
const emit = defineEmits<{ schedule: []; cancel: []; remove: []; goto: [section: string] }>()
const { t, locale } = useI18n()
const e = props.editor

const savedAt = computed(() => {
  const at = e.save.value.savedAt
  return at
    ? new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(at)
    : null
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
/** What keeps «Programma» off, in one line that leads to the summary. */
const missing = computed(() => {
  if (busyFiles.value > 0)
    return t('posts.actions.waitFiles', { n: busyFiles.value }, busyFiles.value)
  if (e.checking.value && !report.value) return t('posts.actions.checking')
  if (open.value > 0) return t('posts.actions.choose', { n: open.value }, open.value)
  if (blocks.value > 0) return t('posts.actions.fix', { n: blocks.value }, blocks.value)
  return null
})
const canSchedule = computed(
  () =>
    e.editable.value &&
    report.value?.canSchedule === true &&
    busyFiles.value === 0 &&
    e.save.value.status !== 'conflict',
)
const draft = computed(() => e.status.value === 'draft')
const scheduled = computed(() => e.status.value === 'scheduled')
</script>

<template>
  <div
    class="sticky bottom-0 z-30 -mx-gutter border-t border-(--app-border) bg-(--app-surface) px-gutter py-3"
    data-action-bar
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p
        v-if="saveLine"
        class="flex min-w-0 items-center gap-2 text-sm"
        :class="TONE[saveLine.tone]"
        role="status"
        data-save-state
      >
        <UIcon :name="saveLine.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span>{{ saveLine.text }}</span>
        <UButton
          v-if="e.save.value.status === 'failed'"
          color="neutral"
          variant="outline"
          size="sm"
          class="min-h-10"
          @click="e.flush()"
        >
          {{ $t('posts.save.retry') }}
        </UButton>
        <UButton
          v-if="e.save.value.status === 'conflict'"
          color="neutral"
          variant="outline"
          size="sm"
          class="min-h-10"
          @click="e.reload()"
        >
          {{ $t('posts.save.reload') }}
        </UButton>
      </p>
      <span class="flex-1 max-sm:hidden" />
      <button
        v-if="missing && e.editable.value && e.may.value.publish"
        type="button"
        class="min-h-10 text-sm text-(--app-text-muted) underline-offset-2 hover:underline"
        @click="emit('goto', 'post-summary')"
      >
        {{ missing }}
      </button>
      <div class="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
        <template v-if="draft && e.editable.value">
          <UButton
            :color="e.may.value.publish ? 'neutral' : 'primary'"
            :variant="e.may.value.publish ? 'outline' : 'solid'"
            class="min-h-11 max-sm:flex-1 max-sm:justify-center"
            :loading="e.save.value.status === 'saving'"
            @click="e.flush()"
          >
            {{ $t('posts.actions.saveDraft') }}
          </UButton>
          <UButton
            v-if="e.may.value.publish"
            class="min-h-11 max-sm:flex-1 max-sm:justify-center"
            icon="i-lucide-calendar-check"
            :disabled="!canSchedule"
            :loading="e.acting.value === 'schedule'"
            data-schedule
            @click="emit('schedule')"
          >
            {{ $t('posts.actions.schedule', { n: accountsCount }, accountsCount) }}
          </UButton>
        </template>
        <template v-else-if="scheduled && e.editable.value">
          <UButton
            color="error"
            variant="ghost"
            class="min-h-11"
            :loading="e.acting.value === 'cancel'"
            @click="emit('cancel')"
          >
            {{ $t('posts.actions.cancel') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-11"
            :loading="e.acting.value === 'unschedule'"
            @click="e.unschedule()"
          >
            {{ $t('posts.actions.unschedule') }}
          </UButton>
          <UButton
            class="min-h-11"
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
          class="min-h-11"
          :loading="e.acting.value === 'delete'"
          @click="emit('remove')"
        >
          {{ $t('posts.actions.delete') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
