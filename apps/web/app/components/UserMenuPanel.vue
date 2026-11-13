<script setup lang="ts">
import type { Me } from '@app/contracts'
import type { RouteLocationRaw } from 'vue-router'

/**
 * The content of the user menu, the same in the sidebar's popover and in the phone's drawer.
 * «Impostazioni» opens the person's settings and, from there, the agency's (Matteo, 13/11). The
 * pages opened rarely (activity log, privacy) live here instead of the sidebar; the theme is one
 * button beside «Esci», «Automatico» stays in «Impostazioni» (Matteo, 13/11).
 */
defineProps<{
  me: Me
  links: { to: string; link: RouteLocationRaw; label: string; icon: string }[]
  dark: boolean
  otherAgencies: boolean
  leaving: boolean
  leaveFailed: boolean
}>()
const emit = defineEmits<{ toggleTheme: []; navigate: []; signOut: [] }>()

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
        <UIcon name="i-lucide-settings" class="size-4 text-(--app-text-muted)" aria-hidden="true" />
        {{ $t('nav.settings') }}
      </NuxtLink>

      <NuxtLink
        v-for="item in links"
        :key="item.to"
        :to="item.link"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon :name="item.icon" class="size-4 text-(--app-text-muted)" aria-hidden="true" />
        {{ $t(item.label) }}
      </NuxtLink>

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

      <div class="flex items-center gap-1">
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          :class="[entry, 'flex-1']"
          :aria-busy="leaving"
          :aria-disabled="leaving"
          @click="emit('signOut')"
        >
          <UIcon
            name="i-lucide-log-out"
            class="size-4 text-(--app-text-muted)"
            aria-hidden="true"
          />
          {{ $t('nav.signOut') }}
        </button>
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          :aria-label="$t(dark ? 'userMenu.toLight' : 'userMenu.toDark')"
          :title="$t(dark ? 'userMenu.toLight' : 'userMenu.toDark')"
          class="flex size-11 shrink-0 items-center justify-center rounded-lg text-(--app-text-muted) outline-none transition-colors duration-150 hover:bg-(--app-surface-sunken) hover:text-(--app-text) focus-visible:bg-(--app-surface-sunken) focus-visible:ring-2 focus-visible:ring-(--app-focus)"
          @click="emit('toggleTheme')"
        >
          <UIcon
            :name="dark ? 'i-lucide-sun' : 'i-lucide-moon'"
            class="size-4"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
    <p v-if="leaveFailed" role="alert" class="px-3 py-2 text-sm text-(--app-danger)">
      {{ $t('nav.signOutFailed') }}
    </p>
  </div>
</template>
