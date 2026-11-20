<script setup lang="ts">
/**
 * The pages before the panel (screen 01): the logo and a 380 column in the middle of the window,
 * no box around it. A long text (the privacy notice) asks for a wider column with `authWide`.
 */
const route = useRoute()
const wide = computed(() => route.meta['authWide'] === true)
</script>

<template>
  <div class="relative flex min-h-dvh flex-col bg-(--app-bg)">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>
    <!-- the theme before signing in: out of the way, in the corner -->
    <header class="absolute top-2 right-4 z-10 sm:right-6">
      <ThemeSwitcher />
    </header>
    <main
      id="main"
      class="relative mx-auto flex w-full flex-1 flex-col justify-center px-4 py-16"
      :class="wide ? 'max-w-2xl' : 'max-w-[412px]'"
      data-auth
    >
      <div class="mb-9 flex justify-center">
        <BrandLogo size="sign-in" />
      </div>
      <slot />
    </main>
  </div>
</template>
