<script setup lang="ts">
// Reached without JavaScript: the function redirects here when a request is invalid or cannot be
// sent. A static page cannot read the query string, so each reason has its own address.
definePageMeta({ alias: '/richiedi-una-demo/da-correggere' })

const route = useRoute()
const invalid = computed(() => route.path.includes('da-correggere'))
useSeoMeta({ title: 'Richiesta non inviata · Feedway', robots: 'noindex' })
</script>

<template>
  <main id="contenuto" class="demo wrap">
    <section class="demo-card" aria-labelledby="non-inviata-titolo">
      <h1 id="non-inviata-titolo">La richiesta non è partita</h1>
      <p role="alert" class="form-alert">
        <template v-if="invalid">
          Controlla nome, agenzia ed email: servono tutti e tre, e l’email deve essere valida.
        </template>
        <template v-else
          >Non siamo riusciti a inviare la richiesta. Riprova tra qualche minuto.</template
        >
      </p>
      <NuxtLink to="/richiedi-una-demo" class="btn btn-primary">Torna al modulo</NuxtLink>
    </section>
  </main>
</template>
