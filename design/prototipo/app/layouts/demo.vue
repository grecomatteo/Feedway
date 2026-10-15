<template>
  <div class="flex h-dvh flex-col">
    <a href="#contenuto" class="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-white px-3 py-2 text-black">Vai al contenuto</a>
    <DemoBar />
    <div class="flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 lg:hidden">
      <img src="/brand/feedway-symbol-arancio.svg" alt="Feedway" width="32" height="32">
      <div class="min-w-0 flex-1"><ContextSwitcher compact /></div>
    </div>
    <div class="flex min-h-0 flex-1">
      <AppSidebar class="max-lg:hidden" />
      <main id="contenuto" class="min-w-0 flex-1 overflow-auto">
        <slot />
      </main>
    </div>
    <MobileTabs class="lg:hidden" />
  </div>
</template>
