<script setup lang="ts">
import { LEGAL, PLACEHOLDER } from '~/legal'
</script>

<template>
  <footer class="site-footer">
    <div class="wrap foot">
      <img src="/brand/feedway-horizontal-carbone.svg" alt="Feedway" width="110" height="32" />
      <nav aria-label="Note legali" class="foot-links">
        <NuxtLink to="/privacy">Informativa privacy</NuxtLink>
        <NuxtLink to="/cancellazione-dati">Cancellazione dei dati</NuxtLink>
      </nav>
      <p class="muted">
        © {{ new Date().getFullYear() }}
        {{ LEGAL.controllerName === PLACEHOLDER ? 'Feedway' : LEGAL.controllerName }}
      </p>
    </div>
  </footer>
</template>
