<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { PLAN_TYPE_ICONS, type PlanItem, type PlanState } from '~/utils/plan'

/**
 * A content of the plan in its day (spec §11.12, the landing's board «Piano editoriale»): the
 * type's icon, the title, then type, time and what is not plain «to prepare». Dashed while it
 * waits for its post, yellow and red as its day comes and goes, full once prepared. The card
 * opens its menu; whoever writes the plan can also drag it to another day.
 */
const props = defineProps<{
  item: PlanItem
  /** the state at the page's minute, not the one read */
  state: PlanState
  actions: DropdownMenuItem[][]
  draggable?: boolean
  /** lifted by a drag: drawn faded where it was */
  lifted?: boolean
}>()
const emit = defineEmits<{ lift: [event: DragEvent]; drop: [] }>()
const { t } = useI18n()

// the icon says the type: with a state to tell, the line keeps the room for it (D-123.23)
const typeName = computed(() => t(`posts.type.${props.item.type}`))
const meta = computed(() =>
  [
    props.state === 'to_prepare' ? typeName.value : null,
    props.item.localTime ? formatTime(props.item.localTime) : null,
    props.state === 'to_prepare' ? null : t(`plan.state.${props.state}`),
  ]
    .filter((part) => part !== null)
    .join(' · '),
)

const FRAME: Record<PlanState, string> = {
  to_prepare: 'border-dashed border-(--app-border-strong) bg-(--app-surface)',
  due_soon: 'border-dashed border-(--app-warning) bg-(--app-surface)',
  late: 'border-dashed border-(--app-danger) bg-(--app-danger-soft)',
  prepared: 'border-solid border-(--app-border) bg-(--app-surface-sunken)',
}
const META: Record<PlanState, string> = {
  to_prepare: 'text-(--app-text-muted)',
  due_soon: 'font-medium text-(--app-warning)',
  late: 'font-medium text-(--app-danger)',
  prepared: 'text-(--app-success)',
}
</script>

<template>
  <UDropdownMenu :items="actions" :content="{ align: 'start' }">
    <button
      type="button"
      :draggable="draggable || undefined"
      class="flex w-full min-w-0 items-start gap-1.5 rounded-[6px] border px-1.5 py-[5px] text-start text-[12px]/[15px] transition-colors hover:border-(--app-text-muted) max-md:px-2.5 max-md:py-2 max-md:text-detail"
      :class="[FRAME[state], lifted ? 'opacity-40' : '', draggable ? 'cursor-grab' : '']"
      :data-plan-item="item.id"
      :data-state="state"
      @dragstart="emit('lift', $event)"
      @dragend="emit('drop')"
    >
      <UIcon
        :name="PLAN_TYPE_ICONS[item.type]"
        class="mt-px size-3.5 shrink-0 text-(--app-text-muted) max-md:size-4"
        aria-hidden="true"
      />
      <span class="grid min-w-0">
        <span class="truncate font-medium"
          ><span v-if="state !== 'to_prepare'" class="sr-only">{{ typeName }}: </span
          >{{ item.title }}</span
        >
        <span class="truncate text-[11px]/[14px] max-md:text-caption" :class="META[state]">
          {{ meta
          }}<span v-if="state === 'to_prepare'" class="sr-only">
            · {{ $t('plan.state.to_prepare') }}</span
          >
        </span>
      </span>
    </button>
  </UDropdownMenu>
</template>
