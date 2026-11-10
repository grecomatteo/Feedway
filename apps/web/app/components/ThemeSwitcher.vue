<script setup lang="ts">
import type { Me } from '@app/contracts'

const colorMode = useColorMode()
const session = useSession()
const { call } = useApi()

/** Each click counts: only the answer to the latest save is kept. */
let saves = 0

/**
 * One click to the opposite theme. Until the first click the theme follows the system
 * (preference `system`); after it, the choice is explicit and goes to the profile too.
 */
async function toggle(event: MouseEvent) {
  const next = colorMode.value === 'dark' ? 'light' : 'dark'
  void save(next)
  const apply = async () => {
    colorMode.preference = next
    await nextTick()
  }
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (still || typeof document.startViewTransition !== 'function') return apply()
  // the new theme grows from the button (its centre when pressed from the keyboard)
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const x = event.clientX || box.left + box.width / 2
  const y = event.clientY || box.top + box.height / 2
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const transition = document.startViewTransition(apply)
  try {
    await transition.ready
  } catch {
    // a quicker second click skipped this animation: the theme is applied anyway
    return
  }
  document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    {
      duration: 450,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
      pseudoElement: '::view-transition-new(root)',
    },
  )
}

/** Signed in: the profile keeps the choice, or the next visit would bring the old one back. */
async function save(theme: 'light' | 'dark') {
  if (session.view.value.state !== 'active') return
  const mine = ++saves
  try {
    const me = await call<Me>('PATCH', '/api/v1/me', { theme })
    if (mine !== saves || session.view.value.state !== 'active') return
    session.view.value = { state: 'active', me }
    // the account page keeps its own copy of the profile: its preferences follow too
    const page = useNuxtData<Me>('me')
    if (page.data.value) page.data.value = me
  } catch {
    // the cookie still holds the theme on this device
  }
}
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    size="xl"
    class="theme-toggle min-h-11 min-w-11 justify-center"
    :aria-label="$t('theme.toggle')"
    :title="$t('theme.toggle')"
    @click="toggle"
  >
    <UIcon name="i-lucide-moon" class="theme-toggle-moon size-6" aria-hidden="true" />
    <UIcon name="i-lucide-sun" class="theme-toggle-sun size-6" aria-hidden="true" />
  </UButton>
</template>

<style>
/* the icon shows where the click goes; plain CSS, so the server render already matches */
.theme-toggle-sun,
.dark .theme-toggle-moon {
  display: none;
}
.dark .theme-toggle-sun {
  display: inline-block;
}
</style>
