<template>
  <div class="flex min-h-dvh flex-col bg-(--app-bg)">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-(--app-surface) focus:px-3 focus:py-2"
    >
      {{ $t('a11y.skipToContent') }}
    </a>
    <header class="flex justify-end px-4 py-2 sm:px-6">
      <ThemeSwitcher />
    </header>
    <main id="main" class="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-12 sm:pt-10">
      <div class="mb-6 flex justify-center">
        <AppLogo />
      </div>
      <div class="rounded-xl border border-(--app-border) bg-(--app-surface) p-6 shadow-sm sm:p-8">
        <slot />
      </div>
      <p class="mt-6 text-center text-sm text-(--app-text-muted)">
        {{ $t('auth.footer') }}
      </p>
    </main>
  </div>
</template>
