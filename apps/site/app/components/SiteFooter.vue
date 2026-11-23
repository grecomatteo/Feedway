<script setup lang="ts">
import { LEGAL, PLACEHOLDER } from '~/legal'
</script>

<template>
  <footer class="site-footer">
    <div class="wrap foot-row">
      <img src="/brand/feedway-horizontal-bianco.svg" alt="Feedway" width="124" height="36" />
      <nav aria-label="Sezioni della pagina iniziale">
        <NuxtLink to="/#prodotto">Prodotto</NuxtLink>
        <NuxtLink to="/#pubblicazione">Pubblicazione</NuxtLink>
        <NuxtLink to="/#cliente">Clienti</NuxtLink>
        <NuxtLink to="/#domande">Domande</NuxtLink>
      </nav>
      <nav aria-label="Note legali">
        <NuxtLink to="/privacy">Informativa privacy</NuxtLink>
        <NuxtLink to="/cancellazione-dati">Cancellazione dei dati</NuxtLink>
        <NuxtLink to="/termini">Termini di servizio</NuxtLink>
      </nav>
    </div>
    <p class="wrap foot-note">
      © {{ new Date().getFullYear() }}
      {{ LEGAL.controllerName === PLACEHOLDER ? 'Feedway' : LEGAL.controllerName
      }}<template v-if="LEGAL.controllerDetails"> · {{ LEGAL.controllerDetails }}</template>
      · Questo sito non usa cookie.
    </p>
    <div class="wordmark" aria-hidden="true">
      <img src="/brand/feedway-wordmark-arancio.svg" alt="" width="444" height="128" />
    </div>
  </footer>
</template>
