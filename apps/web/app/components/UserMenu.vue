<script setup lang="ts">
/**
 * The signed-in person at the bottom of the sidebar (`row`) or as a photo in the phone's top bar
 * (`avatar`). One click opens their menu: «Il mio account», the theme, the other agencies, «Esci».
 * On a phone it opens from the bottom, full width.
 */
const props = withDefaults(defineProps<{ variant?: 'row' | 'avatar' }>(), { variant: 'row' })

type ThemeChoice = 'light' | 'dark' | 'system'

const org = useOrganization()
const session = useSession()
const colorMode = useColorMode()
const { t } = useI18n()
// the menu opens only once the page runs in the browser: a click before that would be lost
const ready = useHydrated()

const me = computed(() => org.me.value)
const open = ref(false)
const panel = ref<HTMLElement | null>(null)
const leaving = ref(false)
const leaveFailed = ref(false)

const subtitle = computed(() =>
  [org.role.value ? t(`roles.${org.role.value}`) : null, org.organization.value?.name]
    .filter(Boolean)
    .join(' · '),
)
const otherAgencies = computed(
  () => (me.value?.organizations.filter((o) => o.status === 'active').length ?? 0) > 1,
)
const themes: { value: ThemeChoice; icon: string; label: string }[] = [
  { value: 'light', icon: 'i-lucide-sun', label: 'theme.light' },
  { value: 'dark', icon: 'i-lucide-moon', label: 'theme.dark' },
  { value: 'system', icon: 'i-lucide-monitor', label: 'theme.system' },
]

/** The theme changes at once, without closing the menu; the profile keeps it. */
function chooseTheme(value: ThemeChoice) {
  colorMode.preference = value
  void session.saveTheme(value)
}

async function signOut() {
  if (leaving.value) return
  leaveFailed.value = false
  leaving.value = true
  try {
    await session.signOut()
  } catch {
    leaveFailed.value = true
  } finally {
    leaving.value = false
  }
}

const items = () =>
  Array.from(panel.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
function focusAt(index: number) {
  const list = items()
  if (list.length === 0) return
  list[(index + list.length) % list.length]?.focus()
}
/** Up and down go through every entry; left and right stay among the theme choices. */
function onKey(event: KeyboardEvent) {
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const inThemes = document.activeElement?.getAttribute('role') === 'menuitemradio'
  const move: Record<string, () => void> = {
    ArrowDown: () => focusAt(at + 1),
    ArrowUp: () => focusAt(at - 1),
    Home: () => focusAt(0),
    End: () => focusAt(list.length - 1),
  }
  if (inThemes) {
    const first = list.findIndex((el) => el.getAttribute('role') === 'menuitemradio')
    move['ArrowRight'] = () => focusAt(first + ((at - first + 1) % themes.length))
    move['ArrowLeft'] = () => focusAt(first + ((at - first + themes.length - 1) % themes.length))
  }
  const action = move[event.key]
  if (!action) return
  event.preventDefault()
  action()
}
function focusFirst(event?: Event) {
  event?.preventDefault()
  void nextTick(() => focusAt(0))
}
watch(open, (value) => {
  if (value) focusFirst()
  // a failure is about the last attempt: a menu opened again starts clean
  else leaveFailed.value = false
})
const close = () => (open.value = false)
</script>

<template>
  <template v-if="me">
    <UPopover
      v-if="props.variant === 'row'"
      v-model:open="open"
      :content="{ side: 'top', align: 'start', sideOffset: 8, onOpenAutoFocus: focusFirst }"
      :ui="{ content: 'w-(--reka-popover-trigger-width) min-w-60 rounded-xl p-1.5' }"
    >
      <button
        type="button"
        :disabled="!ready"
        aria-haspopup="menu"
        class="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start transition-colors duration-150 hover:bg-(--app-nav-hover) aria-expanded:bg-(--app-nav-hover)"
      >
        <UserAvatar :name="me.displayName" :src="me.avatarUrl" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">{{ me.displayName }}</span>
          <span v-if="subtitle" class="block truncate text-xs text-(--app-text-muted)">
            {{ subtitle }}
          </span>
        </span>
      </button>
      <template #content>
        <div ref="panel" @keydown="onKey">
          <UserMenuPanel
            :me="me"
            :themes="themes"
            :theme="colorMode.preference as ThemeChoice"
            :other-agencies="otherAgencies"
            :leaving="leaving"
            :leave-failed="leaveFailed"
            @theme="chooseTheme"
            @navigate="close"
            @sign-out="signOut"
          />
        </div>
      </template>
    </UPopover>

    <UDrawer
      v-else
      v-model:open="open"
      :title="$t('userMenu.label')"
      :ui="{ header: 'sr-only', body: 'p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]' }"
    >
      <button
        type="button"
        :disabled="!ready"
        aria-haspopup="menu"
        :aria-label="$t('userMenu.open', { name: me.displayName })"
        class="flex size-11 items-center justify-center rounded-full"
      >
        <UserAvatar :name="me.displayName" :src="me.avatarUrl" />
      </button>
      <template #body>
        <div ref="panel" @keydown="onKey">
          <UserMenuPanel
            :me="me"
            :themes="themes"
            :theme="colorMode.preference as ThemeChoice"
            :other-agencies="otherAgencies"
            :leaving="leaving"
            :leave-failed="leaveFailed"
            @theme="chooseTheme"
            @navigate="close"
            @sign-out="signOut"
          />
        </div>
      </template>
    </UDrawer>
  </template>
</template>
