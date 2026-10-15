<script setup lang="ts">
const { state, reset } = useDemo()
const toast = useToast()
function doReset() {
  reset()
  toast.add({ title: 'Demo ripristinata', description: 'Dati fittizi riportati allo stato iniziale.', color: 'neutral' })
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--fw-carbone)] px-4 py-2 text-[13px] text-white" role="region" aria-label="Controlli della demo">
    <span class="inline-flex items-center gap-2 font-semibold"><UIcon name="i-lucide-flask-conical" class="size-4 text-[var(--fw-arancio)]" aria-hidden="true" /><span class="max-md:hidden">Prototipo con dati fittizi: nulla viene pubblicato, le modifiche restano in questo browser.</span><span class="md:hidden">Demo con dati fittizi</span></span>
    <span class="flex-1" />
    <label class="inline-flex items-center gap-2">Ruolo
      <select v-model="state.role" class="rounded-md bg-white/10 px-2 py-1 text-white">
        <option class="text-black">Manager</option><option class="text-black">Editor</option><option class="text-black">Viewer</option>
      </select>
    </label>
    <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10" @click="state.dark = !state.dark">
      <UIcon :name="state.dark ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-4" aria-hidden="true" /><span class="max-md:sr-only">{{ state.dark ? 'Tema chiaro' : 'Tema scuro' }}</span>
    </button>
    <button type="button" class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-white/10" @click="doReset"><UIcon name="i-lucide-rotate-ccw" class="size-4" aria-hidden="true" />Ripristina<span class="max-md:hidden"> demo</span></button>
    <NuxtLink to="/" class="underline underline-offset-2 max-md:hidden">Torna alla presentazione</NuxtLink>
  </div>
</template>
