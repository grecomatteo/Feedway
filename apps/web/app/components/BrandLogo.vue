<script setup lang="ts">
import { PRODUCT_NAME } from '@app/config/product'

// large: the sign-in pages; small: the sidebar, at the 160 px the brand guide recommends;
// bar: 30 high, the side bar of the new direction (D-81, base.css `.side-top img`).
// sign-in: the letters 44 high above the column of screen 01 (the file has a margin).
const props = withDefaults(defineProps<{ size?: 'large' | 'small' | 'bar' | 'sign-in' }>(), {
  size: 'large',
})
const BOXES = {
  'sign-in': { width: 220, height: 64, cls: 'h-16 w-[220px]' },
  bar: { width: 104, height: 30, cls: 'h-[30px] w-[104px]' },
  small: { width: 160, height: 46, cls: 'h-[46px] w-[160px]' },
  large: { width: 176, height: 51, cls: 'h-[51px] w-[176px]' },
} as const
const box = computed(() => BOXES[props.size])
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
