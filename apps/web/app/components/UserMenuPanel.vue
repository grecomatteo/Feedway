<script setup lang="ts">
import type { Me } from '@app/contracts'

/** The content of the user menu, the same in the sidebar's popover and in the phone's drawer. */
type ThemeChoice = 'light' | 'dark' | 'system'
defineProps<{
  me: Me
  themes: { value: ThemeChoice; icon: string; label: string }[]
  theme: ThemeChoice
  otherAgencies: boolean
  leaving: boolean
  leaveFailed: boolean
}>()
const emit = defineEmits<{ theme: [ThemeChoice]; navigate: []; signOut: [] }>()

const entry =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-start outline-none transition-colors duration-150 hover:bg-(--app-surface-sunken) focus-visible:bg-(--app-surface-sunken) focus-visible:ring-2 focus-visible:ring-(--app-focus)'
</script>

<template>
  <div class="text-(--app-text)">
    <!-- who is signed in: not an entry of the menu -->
    <div class="flex items-center gap-3 px-3 pt-2 pb-3">
      <UserAvatar :name="me.displayName" :src="me.avatarUrl" size="md" />
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold">{{ me.displayName }}</p>
        <p class="truncate text-xs text-(--app-text-muted)">{{ me.email }}</p>
      </div>
    </div>
    <div role="separator" class="mx-1 mb-1 h-px bg-(--app-border)" />

    <div role="menu" :aria-label="$t('userMenu.label')" class="space-y-0.5">
      <NuxtLink
        to="/account"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon
          name="i-lucide-circle-user"
          class="size-4 text-(--app-text-muted)"
          aria-hidden="true"
        />
        {{ $t('nav.account') }}
      </NuxtLink>

      <div role="group" :aria-label="$t('theme.label')" class="px-3 py-2">
        <p class="mb-1.5 text-xs text-(--app-text-muted)" aria-hidden="true">
          {{ $t('theme.label') }}
        </p>
        <div class="grid grid-cols-3 gap-1 rounded-lg bg-(--app-surface-sunken) p-1">
          <button
            v-for="choice in themes"
            :key="choice.value"
            type="button"
            role="menuitemradio"
            tabindex="-1"
            :aria-checked="theme === choice.value"
            class="flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs outline-none transition-colors duration-150 hover:text-(--app-text) focus-visible:ring-2 focus-visible:ring-(--app-focus) aria-checked:bg-(--app-surface) aria-checked:font-semibold aria-checked:text-(--app-text) aria-checked:shadow-sm text-(--app-text-muted)"
            @click="emit('theme', choice.value)"
          >
            <UIcon :name="choice.icon" class="size-4" aria-hidden="true" />
            {{ $t(choice.label) }}
          </button>
        </div>
      </div>

      <NuxtLink
        v-if="otherAgencies"
        to="/agenzie"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon
          name="i-lucide-arrow-left-right"
          class="size-4 text-(--app-text-muted)"
          aria-hidden="true"
        />
        {{ $t('userMenu.otherAgency') }}
      </NuxtLink>
      <NuxtLink
        v-if="me.platformRole === 'admin'"
        to="/piattaforma/email"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon name="i-lucide-mail" class="size-4 text-(--app-text-muted)" aria-hidden="true" />
        {{ $t('nav.systemEmail') }}
      </NuxtLink>

      <div role="separator" class="mx-1 my-1 h-px bg-(--app-border)" />

      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        :aria-busy="leaving"
        @click="emit('signOut')"
      >
        <UIcon name="i-lucide-log-out" class="size-4 text-(--app-text-muted)" aria-hidden="true" />
        {{ $t('nav.signOut') }}
      </button>
    </div>
    <p v-if="leaveFailed" role="alert" class="px-3 py-2 text-sm text-(--app-danger)">
      {{ $t('nav.signOutFailed') }}
    </p>
  </div>
</template>
