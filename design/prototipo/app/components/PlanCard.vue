<script setup lang="ts">
import { DateTime } from 'luxon'
import { ZONE, type PlanItem } from '~/fixtures/scenario'
import { TYPE_ICON, TYPE_LABEL, now, workspace } from '~/utils/format'

// A planned content that does not exist yet: dashed and translucent, so it never looks like a real post.
const props = defineProps<{ item: PlanItem, compact?: boolean, showClient?: boolean }>()
defineEmits<{ open: [item: PlanItem] }>()
const ws = computed(() => workspace(props.item.workspaceId))
const due = computed(() => DateTime.fromISO(`${props.item.date}T${props.item.time ?? '23:59'}`, { zone: ZONE }))
const soon = computed(() => due.value.diff(now(), 'hours').hours <= 36)
const label = computed(() => `Da preparare: ${TYPE_LABEL[props.item.type]} «${props.item.title}»${props.item.time ? ` alle ${props.item.time}` : ''}, ${ws.value.short}${soon.value ? '. In scadenza' : ''}`)
</script>

<template>
  <button
    type="button" :aria-label="label"
    class="w-full rounded-xl border-[1.5px] border-dashed text-left opacity-90 transition hover:opacity-100"
    :class="[soon ? 'border-[var(--warning)] bg-[var(--warning-soft)]/60' : 'border-[var(--border-strong)] bg-[var(--surface)]/50', compact ? 'p-1' : 'p-2.5']"
    @click="$emit('open', item)"
  >
    <span class="flex items-center gap-1.5" :class="compact ? 'text-[11px]' : 'text-[13px]'">
      <UIcon :name="TYPE_ICON[item.type]" class="size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      <span v-if="item.time" class="tabular font-bold">{{ item.time }}</span>
      <span v-if="!compact" class="text-[var(--text-muted)]">{{ TYPE_LABEL[item.type] }}</span>
      <span v-if="showClient !== false" class="ml-auto size-2 shrink-0 rounded-full" :style="{ background: ws.color }" />
    </span>
    <span class="mt-1 block font-semibold leading-snug" :class="compact ? 'truncate text-[11px]' : 'line-clamp-2 text-[13px]'">{{ item.title }}</span>
    <span v-if="!compact" class="mt-1.5 flex items-center gap-1 text-xs font-semibold" :class="soon ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'">
      <UIcon :name="soon ? 'i-lucide-alarm-clock' : 'i-lucide-circle-dashed'" class="size-3.5" aria-hidden="true" />{{ soon ? 'Da preparare, in scadenza' : 'Da preparare' }}
    </span>
  </button>
</template>
