<script setup lang="ts">
import type { Me } from '@app/contracts'
import type { RouteLocationRaw } from 'vue-router'

/**
 * The content of the person's menu (D-81, screen 06), the same in the sidebar's popover and in the
 * phone's sheet: who is signed in, the agency's pages the phone's bar has no room for (Libreria,
 * Utenti), «Impostazioni», «Cambia agenzia», and «Esci» with the theme beside it (Matteo, 13/11:
 * «Automatico» stays in «Impostazioni»).
 */
const props = defineProps<{
  me: Me
  pages: { to: string; link: RouteLocationRaw; label: string; icon: string }[]
  dark: boolean
  otherAgencies: boolean
  leaving: boolean
  leaveFailed: boolean
  phone?: boolean
}>()
const emit = defineEmits<{ toggleTheme: []; navigate: []; signOut: [] }>()

const entry = computed(() => [
  'flex w-full items-center gap-2.5 rounded-md px-2 text-start outline-none transition-colors duration-150 hover:bg-(--app-nav-hover) focus-visible:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-(--app-focus)',
  props.phone ? 'min-h-12' : 'min-h-9',
])
const icon = 'size-4 shrink-0 text-(--app-text-muted)'
</script>

<template>
  <div class="text-(--app-text)">
    <!-- who is signed in: not an entry of the menu -->
    <div class="flex items-center gap-2 px-2 pt-2 pb-2.5">
      <Avatar :name="me.name" :src="me.avatarUrl" kind="person" :size="28" />
      <div class="min-w-0 leading-[1.125rem]">
        <p class="truncate font-semibold">{{ me.name }}</p>
        <p class="truncate text-detail text-(--app-text-muted)">{{ me.email }}</p>
      </div>
    </div>
    <div role="separator" class="-mx-1.5 my-1.5 h-px bg-(--app-border)" />

    <div role="menu" :aria-label="$t('userMenu.label')">
      <NuxtLink
        v-for="item in pages"
        :key="item.to"
        :to="item.link"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon :name="item.icon" :class="icon" aria-hidden="true" />
        {{ $t(item.label) }}
      </NuxtLink>
      <NuxtLink
        to="/account"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon name="i-lucide-settings" :class="icon" aria-hidden="true" />
        {{ $t('nav.settings') }}
      </NuxtLink>
      <NuxtLink
        v-if="otherAgencies"
        to="/agenzie"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon name="i-lucide-building" :class="icon" aria-hidden="true" />
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
        <UIcon name="i-lucide-mail" :class="icon" aria-hidden="true" />
        {{ $t('nav.systemEmail') }}
      </NuxtLink>
      <NuxtLink
        v-if="me.platformRole === 'admin'"
        to="/piattaforma/integrazioni"
        role="menuitem"
        tabindex="-1"
        :class="entry"
        @click="emit('navigate')"
      >
        <UIcon name="i-lucide-plug" :class="icon" aria-hidden="true" />
        {{ $t('nav.platformIntegrations') }}
      </NuxtLink>

      <div role="separator" class="-mx-1.5 my-1.5 h-px bg-(--app-border)" />

      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          :class="[entry, 'flex-1']"
          :aria-busy="leaving"
          :aria-disabled="leaving"
          @click="emit('signOut')"
        >
          <UIcon name="i-lucide-log-out" :class="icon" aria-hidden="true" />
          {{ $t('nav.signOut') }}
        </button>
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          :aria-label="$t(dark ? 'userMenu.toLight' : 'userMenu.toDark')"
          :title="$t(dark ? 'userMenu.toLight' : 'userMenu.toDark')"
          class="flex size-control shrink-0 items-center justify-center rounded-control text-(--app-text) outline-none transition-colors duration-150 hover:bg-(--app-nav-hover) focus-visible:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-(--app-focus)"
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
    <p v-if="leaveFailed" role="alert" class="px-2 py-2 text-detail text-(--app-danger)">
      {{ $t('nav.signOutFailed') }}
    </p>
  </div>
</template>
