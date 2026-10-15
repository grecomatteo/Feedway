<template>
  <div class="flex h-dvh flex-col">
    <a href="#contenuto" class="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-white px-3 py-2 text-black">Vai al contenuto</a>
    <DemoBar />
    <div class="flex min-h-0 flex-1">
      <AppSidebar class="max-lg:hidden" />
      <main id="contenuto" class="min-w-0 flex-1 overflow-auto">
        <slot />
      </main>
    </div>
    <MobileTabs class="lg:hidden" />
  </div>
</template>
