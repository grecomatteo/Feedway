<script setup lang="ts">
const props = defineProps<{ title: string; updatedOn: string }>()
const updated = computed(() =>
  new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${props.updatedOn}T12:00:00Z`),
  ),
)
</script>

<template>
  <main id="contenuto" class="legal">
    <header class="legal-head">
      <h1>{{ title }}</h1>
      <p class="muted">Aggiornata il {{ updated }}</p>
    </header>
    <div class="prose">
      <slot />
    </div>
  </main>
</template>
