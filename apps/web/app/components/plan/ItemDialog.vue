<script setup lang="ts">
import { PLAN_TYPE_ICONS, PLAN_TYPES, type PlanItem, type PlanType } from '~/utils/plan'

/**
 * The short form of the plan (spec §11.12, the landing's board): type, title, day, time and the
 * note for who prepares. Adding, Enter saves and the form stays open for the next one, the type
 * and the day kept, so a month is planned in a row; changing, it closes. Who only reads the plan
 * (or only prepares it) sees the same content without fields, note included (D-123.15).
 */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  mode: 'new' | 'edit' | 'view'
  item: PlanItem | null
  /** the day a new content starts on */
  day: string
  /** the time a new content of that day starts with (`HH:MM`), or none */
  suggest: (date: string) => string | null
  today: string
  workspaceId: string
  /** for the view: whether «Prepara questo contenuto» is offered */
  canPrepare: boolean
}>()
const emit = defineEmits<{
  saved: [item: PlanItem, created: boolean]
  /** someone else changed or removed it: the page reads the plan again */
  stale: []
  prepare: [item: PlanItem]
  openPost: [item: PlanItem]
}>()
const org = useOrganization()
const { call, failure } = useApi()
const { t } = useI18n()

const type = ref<PlanType>('reel')
const title = ref('')
const day = ref('')
const time = ref('')
const note = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)
const titleError = ref<string | null>(null)
/** «Aggiunto «…»», said while the form stays open */
const added = ref('')
const titleField = ref<{ inputRef?: HTMLInputElement } | null>(null)

const types = computed(() =>
  PLAN_TYPES.map((value) => ({
    value,
    label: t(`posts.type.${value}`),
    icon: PLAN_TYPE_ICONS[value],
  })),
)
const heading = computed(() =>
  props.mode === 'new'
    ? t('plan.form.new')
    : props.mode === 'edit'
      ? t('plan.form.edit')
      : t('plan.form.view'),
)

watch(open, (now) => {
  if (!now) return
  const item = props.item
  type.value = item?.type ?? 'reel'
  title.value = item?.title ?? ''
  day.value = item?.localDate ?? props.day
  time.value = item ? (item.localTime ?? '') : suggestFor(day.value)
  note.value = item?.note ?? ''
  problem.value = null
  titleError.value = null
  added.value = ''
})

/** the time last proposed: a time the person did not touch follows the day they choose */
let proposed = ''
function suggestFor(date: string) {
  proposed = props.suggest(date) ?? ''
  return proposed
}
watch(day, (next, before) => {
  if (props.mode === 'new' && open.value && before !== '' && time.value === proposed)
    time.value = suggestFor(next)
})

const focusTitle = () => nextTick(() => titleField.value?.inputRef?.focus())

async function submit() {
  if (sending.value) return
  if (title.value.trim() === '') {
    titleError.value = t('plan.form.titleMissing')
    await focusTitle()
    return
  }
  sending.value = true
  problem.value = null
  titleError.value = null
  const fields = {
    localDate: day.value,
    localTime: time.value === '' ? null : time.value,
    type: type.value,
    title: title.value,
    note: note.value,
  }
  try {
    if (props.mode === 'new') {
      const created = await call<PlanItem>('POST', org.api('/plan'), {
        workspaceId: props.workspaceId,
        ...fields,
      })
      emit('saved', created, true)
      added.value = t('plan.form.added', { title: created.title })
      title.value = ''
      note.value = ''
      // the page has the new one by now: the next free slot of the day
      time.value = suggestFor(day.value)
      await focusTitle()
    } else if (props.item) {
      const updated = await call<PlanItem>(
        'PATCH',
        org.api(`/plan/${encodeURIComponent(props.item.id)}`),
        { version: props.item.version, ...fields },
      )
      emit('saved', updated, false)
      open.value = false
    }
  } catch (e) {
    const f = failure(e)
    if (f.status === 409 || f.status === 404) {
      problem.value = f.status === 409 ? t('plan.form.changed') : t('plan.notFound')
      emit('stale')
    } else if (f.field === 'title') titleError.value = f.message
    else problem.value = f.message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="heading"
    :close="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.24)]',
      content:
        'w-[440px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em]',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
      footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
    }"
    data-plan-form
  >
    <template #body>
      <dl v-if="mode === 'view' && item" class="grid gap-3" data-plan-view>
        <div class="grid gap-0.5">
          <dt class="text-detail text-(--app-text-muted)">{{ $t('plan.form.title') }}</dt>
          <dd class="font-medium break-words">{{ item.title }}</dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-detail text-(--app-text-muted)">{{ $t('plan.form.day') }}</dt>
          <dd class="first-letter:uppercase">
            {{ formatDay(item.localDate) }} ·
            {{ item.localTime ? formatTime(item.localTime) : $t('plan.form.noTime') }} ·
            {{ $t(`posts.type.${item.type}`) }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-detail text-(--app-text-muted)">{{ $t('plan.form.note') }}</dt>
          <dd
            class="break-words whitespace-pre-line"
            :class="item.note ? '' : 'text-(--app-text-muted)'"
          >
            {{ item.note || $t('plan.form.noNote') }}
          </dd>
        </div>
      </dl>

      <form v-else id="plan-item" class="grid gap-4" novalidate @submit.prevent="submit">
        <SegmentedFilter v-model="type" wide :label="$t('plan.form.type')" :options="types" />
        <UFormField
          :label="$t('plan.form.title')"
          name="plan-title"
          :error="titleError ?? undefined"
          :help="titleError ? undefined : $t('plan.form.titleHint')"
        >
          <UInput
            ref="titleField"
            v-model="title"
            class="w-full"
            maxlength="200"
            autocomplete="off"
            :ui="{ base: 'bg-(--app-surface)' }"
            autofocus
            @update:model-value="titleError = null"
          />
        </UFormField>
        <div class="flex flex-wrap gap-3">
          <div class="grid gap-1.5">
            <span class="font-medium" aria-hidden="true">{{ $t('plan.form.day') }}</span>
            <DayField v-model="day" :label="$t('plan.form.day')" :today="today" />
          </div>
          <div class="grid gap-1.5">
            <span class="font-medium" aria-hidden="true">{{ $t('plan.form.time') }}</span>
            <TimeField
              v-model="time"
              :label="$t('plan.form.time')"
              :empty-label="$t('plan.form.noTime')"
            />
          </div>
        </div>
        <UFormField :label="$t('plan.form.note')" name="plan-note">
          <UTextarea
            v-model="note"
            class="w-full"
            :rows="2"
            autoresize
            :maxrows="6"
            maxlength="2000"
            :ui="{ base: 'bg-(--app-surface)' }"
            @keydown.enter.exact.prevent="submit"
          />
        </UFormField>
        <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
        <p
          class="text-detail text-(--app-success)"
          :class="added ? '' : 'sr-only'"
          aria-live="polite"
          data-plan-added
        >
          {{ added }}
        </p>
      </form>
    </template>

    <template #footer>
      <template v-if="mode === 'view' && item">
        <UButton
          color="neutral"
          variant="outline"
          class="max-md:flex-1 max-md:justify-center"
          @click="open = false"
        >
          {{ $t('plan.form.close') }}
        </UButton>
        <UButton
          v-if="item.state === 'prepared'"
          color="neutral"
          variant="outline"
          class="max-md:flex-1 max-md:justify-center"
          @click="emit('openPost', item)"
        >
          {{ $t('plan.actions.openPost') }}
        </UButton>
        <UButton
          v-else-if="canPrepare"
          class="max-md:flex-1 max-md:justify-center"
          @click="emit('prepare', item)"
        >
          {{ $t('plan.actions.prepare') }}
        </UButton>
      </template>
      <template v-else>
        <UButton
          color="neutral"
          variant="outline"
          class="max-md:flex-1 max-md:justify-center"
          @click="open = false"
        >
          {{ mode === 'new' && added ? $t('plan.form.close') : $t('plan.form.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="plan-item"
          :loading="sending"
          class="max-md:flex-1 max-md:justify-center"
          data-plan-submit
        >
          {{ mode === 'new' ? $t('plan.form.add') : $t('plan.form.save') }}
        </UButton>
      </template>
    </template>
  </UModal>
</template>
