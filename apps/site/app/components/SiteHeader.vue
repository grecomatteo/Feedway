<script setup lang="ts">
import { SITE } from '~/legal'

// one orange button per page: on the form page the form's own button is the one
const route = useRoute()
const onDemo = computed(() => route.path.startsWith('/richiedi-una-demo'))
</script>

<template>
  <header class="site-header">
    <div class="wrap bar">
      <NuxtLink to="/" class="logo" aria-label="Feedway, pagina iniziale">
        <img src="/brand/feedway-horizontal-carbone.svg" alt="" width="124" height="36" />
      </NuxtLink>
      <nav v-if="route.path === '/'" aria-label="Sezioni" class="anchors">
        <a href="#prodotto">Prodotto</a>
        <a href="#pubblicazione">Pubblicazione</a>
        <a href="#domande">Domande</a>
      </nav>
      <div class="actions">
        <a v-if="SITE.signInUrl" :href="SITE.signInUrl" class="btn btn-outline">Accedi</a>
        <NuxtLink v-if="!onDemo" to="/richiedi-una-demo" class="btn btn-primary"
          >Richiedi una demo</NuxtLink
        >
      </div>
    </div>
  </header>
</template>
