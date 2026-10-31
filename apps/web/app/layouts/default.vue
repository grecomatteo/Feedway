<template>
  <div class="min-h-dvh">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>
    <header
      class="flex flex-wrap items-center justify-between gap-2 border-b border-(--app-border) bg-(--app-surface) px-4 py-2 sm:px-6"
    >
      <NuxtLink to="/" class="flex min-h-11 items-center"><AppLogo /></NuxtLink>
      <div class="flex flex-wrap items-center justify-end gap-1">
        <AppNav />
        <ThemeSwitcher />
      </div>
    </header>
    <main id="main" class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <slot />
    </main>
  </div>
</template>
