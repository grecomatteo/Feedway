<script setup lang="ts">
/** The QR code of an `otpauth://totp/` link, for the authenticator app to scan (uqr, docs/stack.md). */
import { qrPath } from '~/utils/qr-path'

const props = defineProps<{ link: string }>()
const qr = computed(() => (props.link ? qrPath(props.link) : null))
</script>

<template>
  <!-- dark on white in both themes: authenticator apps read it reliably -->
  <svg
    v-if="qr"
    role="img"
    :aria-label="$t('security.totp.qrLabel')"
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    class="size-48 rounded-md bg-white"
    shape-rendering="crispEdges"
  >
    <path :d="qr.d" fill="#000" />
  </svg>
</template>
