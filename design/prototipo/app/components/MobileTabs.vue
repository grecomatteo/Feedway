<script setup lang="ts">
const { can } = useDemo()
const route = useRoute()
const moreOpen = ref(false)
watch(() => route.path, () => { moreOpen.value = false })
const left = [
  { to: '/demo/calendario', icon: 'i-lucide-calendar-days', label: 'Calendario' },
  { to: '/demo/import', icon: 'i-lucide-table-properties', label: 'In blocco' },
]
const right = [
  { to: '/demo/condivisione', icon: 'i-lucide-link', label: 'Link cliente' },
]
const isActive = (to: string) => route.path.startsWith(to)
</script>

<template>
  <nav aria-label="Navigazione principale" class="grid grid-cols-5 items-end border-t border-[var(--border)] bg-[var(--surface)] px-1 pb-4 pt-1.5">
    <NuxtLink
      v-for="item in left" :key="item.to" :to="item.to"
      class="flex flex-col items-center gap-0.5 py-1 text-[11px]"
      :class="isActive(item.to) ? 'font-bold' : 'text-[var(--text-muted)]'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <UIcon :name="item.icon" class="size-[22px]" aria-hidden="true" />{{ item.label }}
    </NuxtLink>
    <div class="flex justify-center">
      <NuxtLink v-if="can.create" to="/demo/post/nuovo" class="-mt-5 grid size-14 place-items-center rounded-full border-[1.5px] border-[var(--fw-carbone)] bg-[var(--brand)] text-[var(--on-brand)] shadow-[0_6px_16px_#24232133]" aria-label="Nuovo post">
        <UIcon name="i-lucide-plus" class="size-7" aria-hidden="true" />
      </NuxtLink>
    </div>
    <NuxtLink
      v-for="item in right" :key="item.to" :to="item.to"
      class="flex flex-col items-center gap-0.5 py-1 text-[11px]"
      :class="isActive(item.to) ? 'font-bold' : 'text-[var(--text-muted)]'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <UIcon :name="item.icon" class="size-[22px]" aria-hidden="true" />{{ item.label }}
    </NuxtLink>
    <USlideover v-model:open="moreOpen" side="left" title="Menu" description="Tutte le sezioni di Feedway">
      <button type="button" class="flex flex-col items-center gap-0.5 py-1 text-[11px] text-[var(--text-muted)]" :aria-expanded="moreOpen">
        <UIcon name="i-lucide-menu" class="size-[22px]" aria-hidden="true" />Altro
      </button>
      <template #content>
        <AppSidebar class="!w-full" />
      </template>
    </USlideover>
  </nav>
</template>
