<script setup lang="ts">
const { can } = useDemo()
const route = useRoute()
const items = [
  { to: '/demo/calendario', icon: 'i-lucide-calendar-days', label: 'Calendario' },
  { to: '/demo/import', icon: 'i-lucide-table-properties', label: 'In blocco' },
  { to: '/demo/condivisione', icon: 'i-lucide-link', label: 'Link cliente' },
]
</script>

<template>
  <nav aria-label="Navigazione principale" class="flex border-t border-[var(--border)] bg-[var(--surface)] px-2 pb-4 pt-1.5">
    <template v-for="(item, i) in items" :key="item.to">
      <NuxtLink v-if="i === 2 && can.create" to="/demo/post/nuovo" class="flex flex-1 flex-col items-center py-0.5" aria-label="Nuovo post">
        <span class="grid size-11 place-items-center rounded-full border-[1.5px] border-[var(--fw-carbone)] bg-[var(--brand)] text-[var(--on-brand)]"><UIcon name="i-lucide-plus" class="size-[22px]" aria-hidden="true" /></span>
      </NuxtLink>
      <NuxtLink
        :to="item.to"
        class="flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px]"
        :class="route.path.startsWith(item.to) ? 'font-bold' : 'text-[var(--text-muted)]'"
        :aria-current="route.path.startsWith(item.to) ? 'page' : undefined"
      >
        <UIcon :name="item.icon" class="size-[22px]" aria-hidden="true" />{{ item.label }}
      </NuxtLink>
    </template>
  </nav>
</template>
