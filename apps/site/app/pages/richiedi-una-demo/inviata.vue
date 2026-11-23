<script setup lang="ts">
useSeoMeta({ title: 'Richiesta inviata · Feedway', robots: 'noindex' })
</script>

<template>
  <main id="contenuto" class="demo wrap">
    <section class="demo-card sent" aria-labelledby="inviata-titolo">
      <span class="sent-mark" aria-hidden="true">✓</span>
      <h1 id="inviata-titolo">Richiesta inviata, ti scriviamo noi</h1>
      <p class="muted">
        Ti rispondiamo all’email che hai indicato. Se non ci senti entro due giorni lavorativi,
        guarda anche nella posta indesiderata.
      </p>
      <NuxtLink to="/" class="btn btn-outline">Torna alla pagina iniziale</NuxtLink>
    </section>
  </main>
</template>
