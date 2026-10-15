<script setup lang="ts">
useHead({ title: 'Accedi · Feedway' })
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-[var(--fw-carta)] px-5">
    <main class="w-full max-w-sm text-center">
      <FwLogo :width="170" class="mx-auto" />
      <h1 class="fw-title mt-8 text-2xl">Accedi a Feedway</h1>
      <p class="mt-3 text-sm text-[var(--text-muted)]">Nel prototipo l'accesso non è attivo: arriverà con la tappa «Identità» dell'app vera (passkey e email). Puoi provare il prodotto nella demo con dati fittizi.</p>
      <div class="mt-6 flex flex-col gap-2">
        <NuxtLink to="/demo/calendario" class="fw-btn fw-btn--primary"><UIcon name="i-lucide-monitor-play" class="size-[18px]" aria-hidden="true" />Esplora la demo</NuxtLink>
        <NuxtLink to="/" class="fw-btn fw-btn--ghost">Torna alla presentazione</NuxtLink>
      </div>
    </main>
  </div>
</template>
