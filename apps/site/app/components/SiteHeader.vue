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
      <nav aria-label="Principale" class="actions">
        <a v-if="SITE.signInUrl" :href="SITE.signInUrl" class="btn btn-outline">Accedi</a>
        <NuxtLink v-if="!onDemo" to="/richiedi-una-demo" class="btn btn-primary"
          >Richiedi una demo</NuxtLink
        >
      </nav>
    </div>
  </header>
</template>
