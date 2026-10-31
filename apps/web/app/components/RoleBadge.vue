<script setup lang="ts">
defineProps<{
  role: 'owner' | 'admin' | 'member' | 'manager' | 'publisher' | 'editor' | 'viewer'
}>()
</script>

<template>
  <UBadge color="neutral" variant="subtle">{{ $t(`roles.${role}`) }}</UBadge>
</template>
