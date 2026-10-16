<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()

const options = ['light', 'dark', 'system'] as const
const icons = { light: 'i-lucide-sun', dark: 'i-lucide-moon', system: 'i-lucide-monitor' } as const

const items = computed(() =>
  options.map((value) => ({
    label: t(`theme.${value}`),
    icon: icons[value],
    type: 'checkbox' as const,
    checked: colorMode.preference === value,
    onUpdateChecked() {
      colorMode.preference = value
    },
  })),
)
</script>

<template>
  <UDropdownMenu :items="items">
    <UButton
      color="neutral"
      variant="ghost"
      size="xl"
      class="min-h-11 min-w-11 justify-center"
      icon="i-lucide-sun-moon"
      :aria-label="$t('theme.label')"
    />
  </UDropdownMenu>
</template>
