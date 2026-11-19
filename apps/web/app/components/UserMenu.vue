<script setup lang="ts">
/**
 * The signed-in person at the bottom of the sidebar (`row`, name and role) or as «Tu» in the
 * phone's bar at the bottom (`tab`, spec §11.11). One click opens their menu (D-81, screen 06):
 * Libreria and Utenti, «Impostazioni», the other agencies, «Esci» and the theme. On a phone it
 * opens from the bottom, full width.
 */
const props = withDefaults(
  defineProps<{
    variant?: 'row' | 'tab'
    /** `tab`: the page is one of the menu's (Libreria, Utenti, Impostazioni) */
    current?: boolean
  }>(),
  { variant: 'row', current: false },
)

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

const subtitle = computed(() => (org.role.value ? t(`roles.${org.role.value}`) : ''))
// from a suspended agency too: the list of the agencies is the way out
const otherAgencies = computed(() => (me.value?.organizations.length ?? 0) > 1)
// the agency's pages the phone's bar has no room for, only with an agency of the person's
const nav = useAgencyNav()
const pages = computed(() => (org.active.value ? nav.value.filter((item) => item.phoneMenu) : []))
const dark = computed(() => colorMode.value === 'dark')

/** Light ↔ dark at once, without closing the menu; the profile keeps it. */
function toggleTheme() {
  const value = dark.value ? 'light' : 'dark'
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
/** Up and down (and left and right on the last row) go through every entry. */
function onKey(event: KeyboardEvent) {
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const move: Record<string, () => void> = {
    ArrowDown: () => focusAt(at + 1),
    ArrowUp: () => focusAt(at - 1),
    Home: () => focusAt(0),
    End: () => focusAt(list.length - 1),
    ArrowRight: () => focusAt(at + 1),
    ArrowLeft: () => focusAt(at - 1),
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
      :content="{ side: 'top', align: 'start', sideOffset: 0, onOpenAutoFocus: focusFirst }"
      :ui="{
        content:
          'w-[264px] rounded-xl border border-(--app-border) bg-(--app-surface) p-1.5 shadow-(--app-shadow-2) ring-0',
      }"
    >
      <button
        type="button"
        :disabled="!ready"
        aria-haspopup="menu"
        class="flex w-full items-center gap-2.5 rounded-control p-2 text-start transition-colors duration-150 hover:bg-(--app-nav-hover)"
      >
        <Avatar :name="me.displayName" :src="me.avatarUrl" kind="person" :size="28" />
        <span class="min-w-0 flex-1 leading-[1.125rem]">
          <span class="block truncate font-semibold">{{ me.displayName }}</span>
          <span v-if="subtitle" class="block truncate text-caption text-(--app-text-muted)">
            {{ subtitle }}
          </span>
        </span>
      </button>
      <template #content>
        <div ref="panel" @keydown="onKey">
          <UserMenuPanel
            :me="me"
            :pages="pages"
            :dark="dark"
            :other-agencies="otherAgencies"
            :leaving="leaving"
            :leave-failed="leaveFailed"
            @toggle-theme="toggleTheme"
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
      :handle="false"
      :ui="{
        overlay: 'bg-[rgb(36_35_33/0.4)]',
        content:
          'max-h-[80vh] rounded-t-2xl border border-b-0 border-(--app-border) bg-(--app-surface) ring-0',
        container: 'gap-0 p-2.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
        header: 'sr-only',
      }"
    >
      <button
        type="button"
        :disabled="!ready"
        aria-haspopup="menu"
        :aria-label="$t('userMenu.tab', { name: me.displayName })"
        class="flex h-[59px] w-full flex-col items-center justify-center gap-[3px] text-[11px] leading-[14px] font-medium text-(--app-text-muted) outline-none focus-visible:ring-2 focus-visible:ring-(--app-focus) focus-visible:ring-inset aria-expanded:font-semibold aria-expanded:text-(--app-text) data-[current]:font-semibold data-[current]:text-(--app-text)"
        :data-current="current || undefined"
      >
        <Avatar :name="me.displayName" :src="me.avatarUrl" kind="person" :size="22" />
        {{ $t('userMenu.you') }}
      </button>
      <template #body>
        <div ref="panel" @keydown="onKey">
          <UserMenuPanel
            phone
            :me="me"
            :pages="pages"
            :dark="dark"
            :other-agencies="otherAgencies"
            :leaving="leaving"
            :leave-failed="leaveFailed"
            @toggle-theme="toggleTheme"
            @navigate="close"
            @sign-out="signOut"
          />
        </div>
      </template>
    </UDrawer>
  </template>
</template>
