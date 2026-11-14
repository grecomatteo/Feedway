<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * «⋯» at the end of a row: every action that does not solve a problem lives here. The trigger
 * names the row («Azioni per Forno Luce»); the menu opens and moves with the keyboard.
 */
defineProps<{ name: string; items: DropdownMenuItem[] | DropdownMenuItem[][] }>()
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-ellipsis"
      class="size-11 justify-center"
      :aria-label="$t('lists.actionsFor', { name })"
    />
  </UDropdownMenu>
</template>
