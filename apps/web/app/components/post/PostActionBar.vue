<script setup lang="ts">
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * The actions of the editor: in the row at the top on a computer (screens 08 and 09), in a bar
 * fixed at the bottom on a phone (design E1, E6g–E6k). The state of the save («Salvataggio…»,
 * «Bozza salvata alle 18:04», «Non salvata: riprova»), what is missing («Manca 1 scelta»), then
 * the buttons. At the top a draft has «Salva ed esci» and «Programma su N account» (an Editor
 * only «Salva ed esci»); at the bottom «Salva bozza» stays until the phone's bar is redrawn
 * (Task R7). A scheduled post has «Annulla programmazione», «Riporta in bozza» and «Salva
 * modifiche»; a cancelled one only «Elimina post».
 */
const props = withDefaults(
  defineProps<{ editor: PostEditor; accountsCount: number; placement?: 'top' | 'bottom' }>(),
  { placement: 'bottom' },
)
const emit = defineEmits<{
  schedule: []
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
const draft = computed(() => e.status.value === 'draft')
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
        <UButton
          :color="e.may.value.publish ? 'neutral' : 'primary'"
          :variant="e.may.value.publish ? 'outline' : 'solid'"
          @click="emit('exit')"
        >
          {{ $t('posts.actions.saveAndExit') }}
        </UButton>
        <UButton
          v-if="e.may.value.publish"
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

  <!-- at the bottom, on a phone -->
  <div
    v-else
    class="sticky bottom-0 z-30 border-t border-(--app-border) bg-(--app-surface) px-gutter py-3"
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
        class="min-h-10 text-sm underline-offset-2 hover:underline"
        :class="missing.warn ? 'text-(--app-warning)' : 'text-(--app-text-muted)'"
        data-missing
        @click="emit('goto', 'post-summary')"
      >
        {{ missing.text }}
      </button>
      <div class="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
        <template v-if="draft && e.editable.value">
          <UButton
            :color="e.may.value.publish ? 'neutral' : 'primary'"
            :variant="e.may.value.publish ? 'outline' : 'solid'"
            class="min-h-control max-sm:flex-1 max-sm:justify-center"
            :loading="e.save.value.status === 'saving'"
            @click="e.flush()"
          >
            {{ $t('posts.actions.saveDraft') }}
          </UButton>
          <UButton
            v-if="e.may.value.publish"
            class="min-h-control max-sm:flex-1 max-sm:justify-center"
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
            class="min-h-control"
            :loading="e.acting.value === 'cancel'"
            @click="emit('cancel')"
          >
            {{ $t('posts.actions.cancel') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-control"
            :loading="e.acting.value === 'unschedule'"
            @click="e.unschedule()"
          >
            {{ $t('posts.actions.unschedule') }}
          </UButton>
          <UButton
            class="min-h-control"
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
          class="min-h-control"
          :loading="e.acting.value === 'delete'"
          @click="emit('remove')"
        >
          {{ $t('posts.actions.delete') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
