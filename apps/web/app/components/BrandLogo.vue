<script setup lang="ts">
import { PRODUCT_NAME } from '@app/config/product'
</script>

<!-- The horizontal logo of the brand kit: carbone on light, arancio on dark (brand guide). -->
<template>
  <span class="brand-logo inline-flex">
    <img
      class="brand-logo-light h-[51px] w-[176px]"
      src="/brand/feedway-horizontal-carbone.svg"
      :alt="PRODUCT_NAME"
      width="176"
      height="51"
    />
    <img
      class="brand-logo-dark h-[51px] w-[176px]"
      src="/brand/feedway-horizontal-arancio.svg"
      :alt="PRODUCT_NAME"
      width="176"
      height="51"
    />
  </span>
</template>

<style>
.brand-logo-dark {
  display: none;
}
.dark .brand-logo-light {
  display: none;
}
.dark .brand-logo-dark {
  display: block;
}
</style>
