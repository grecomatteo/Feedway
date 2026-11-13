<script setup lang="ts">
import { PRODUCT_NAME } from '@app/config/product'

// large: the sign-in pages; small: the sidebar, at the 160 px the brand guide recommends.
const props = withDefaults(defineProps<{ size?: 'large' | 'small' }>(), { size: 'large' })
const box = computed(() =>
  props.size === 'small'
    ? { width: 160, height: 46, cls: 'h-[46px] w-[160px]' }
    : { width: 176, height: 51, cls: 'h-[51px] w-[176px]' },
)
</script>

<!-- The horizontal logo of the brand kit: carbone on light, arancio on dark (brand guide). -->
<template>
  <span class="brand-logo inline-flex">
    <img
      :class="['brand-logo-light', box.cls]"
      src="/brand/feedway-horizontal-carbone.svg"
      :alt="PRODUCT_NAME"
      :width="box.width"
      :height="box.height"
    />
    <img
      :class="['brand-logo-dark', box.cls]"
      src="/brand/feedway-horizontal-arancio.svg"
      :alt="PRODUCT_NAME"
      :width="box.width"
      :height="box.height"
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
