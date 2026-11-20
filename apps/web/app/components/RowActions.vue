<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * «⋯» at the end of a row: every action that does not solve a problem lives here. The trigger
 * names the row («Azioni per Forno Luce»); the menu opens and moves with the keyboard.
 */
defineProps<{
  name: string
  items: DropdownMenuItem[] | DropdownMenuItem[][]
  /** 32 px instead of 44, for a row of 36 px on a computer (the folders of the library) */
  compact?: boolean
  /** the trigger's name when «Azioni per <name>» would repeat another trigger on the page */
  label?: string
}>()
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis"
      class="justify-center"
      :class="compact ? 'size-8' : 'size-11'"
      :aria-label="label ?? $t('lists.actionsFor', { name })"
    />
  </UDropdownMenu>
</template>
