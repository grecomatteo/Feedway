<script setup lang="ts">
/**
 * The list of the client selector (D-81, screen 04): a search, «Tutti i clienti» with the agency's
 * square, the clients with their square and a dot when something of theirs needs a hand, and
 * «Nuovo cliente» for who may create one. The same in the sidebar's popover and in the phone's
 * sheet. The search is a combobox: the arrows move through the list, Enter picks.
 *
 * Choosing a client, or one of its profiles, opens the client's page (D-5); its profiles are
 * listed only under the client chosen, when it has more than one (D-6).
 */
const props = defineProps<{ phone?: boolean }>()
/** `away`: the next page takes the focus (a dialog opens there), not the selector's button */
const emit = defineEmits<{ done: [away?: boolean] }>()

const route = useRoute()
const router = useRouter()
const org = useOrganization()
const { t } = useI18n()
const { visible, workspace, profile, profiles } = useActiveContext()
const id = useId()

const query = ref('')
const input = ref<HTMLInputElement | null>(null)
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * What needs a hand in a client, read from «Da sistemare» of «Oggi» (the same read, redesign R3):
 * its profiles' link, worst first, else a file not prepared. The dot is amber for all of them:
 * the red one is for a post that did not go out (stage 7).
 */
type Problem = 'reconnect' | 'error' | 'warning' | 'media'
const issues = useAgendaIssues()
function problemOf(w: WorkspaceView): Problem | null {
  const own = (issues.data.value?.items ?? []).filter((i) => i.workspaceId === w.id)
  const links = own.flatMap((i) => (i.kind === 'profile' ? [i.link] : []))
  const link = (['reconnect', 'error', 'warning'] as const).find((l) => links.includes(l))
  return link ?? (own.length > 0 ? 'media' : null)
}

interface Option {
  key: string
  label: string
  slug: string | null
  profileId: string | null
  avatar: { name: string; src: string | null; kind: 'client' | 'agency' }
  selected: boolean
  problem: Problem | null
  nested?: boolean
}

const list = computed(() => profiles.data.value?.items ?? [])
const all = computed<Option>(() => ({
  key: 'all',
  label: t('context.all'),
  slug: null,
  profileId: null,
  avatar: {
    name: org.organization.value?.name ?? '',
    src: org.organization.value?.logoUrl ?? null,
    kind: 'agency',
  },
  selected: workspace.value === null,
  problem: null,
}))
const clients = computed<Option[]>(() => {
  const q = fold(query.value.trim())
  return visible.value
    .filter((w) => q === '' || fold(w.name).includes(q))
    .flatMap((w) => {
      const current = workspace.value?.id === w.id
      const own: Option = {
        key: w.id,
        label: w.name,
        slug: w.slug,
        profileId: null,
        avatar: { name: w.name, src: w.photoUrl ?? null, kind: 'client' },
        // with one profile, the client and its profile are the same choice
        selected: current && (profile.value === null || list.value.length <= 1),
        problem: problemOf(w),
      }
      if (!current || list.value.length <= 1) return [own]
      return [
        own,
        ...list.value.map((p) => ({
          key: `${w.id}-${p.key}`,
          label: t('context.profile', { name: profileName(p) }),
          slug: w.slug,
          profileId: p.id,
          avatar: { name: profileName(p), src: profilePhoto(p), kind: 'client' as const },
          selected: profile.value?.key === p.key,
          problem: null,
          nested: true,
        })),
      ]
    })
})
const options = computed(() => [all.value, ...clients.value])

// the option the arrows are on: the chosen one when the list opens
const active = ref(0)
// the ring shows the option the arrows are on, once the arrows are used
const keyboarding = ref(false)
function hover(i: number) {
  active.value = i
  keyboarding.value = false
}
watch(
  options,
  (now) => {
    if (active.value >= now.length) active.value = Math.max(0, now.length - 1)
  },
  { immediate: true },
)
watch(
  query,
  () => (active.value = query.value.trim() === '' ? 0 : Math.min(1, options.value.length - 1)),
)
onMounted(() => {
  active.value = Math.max(
    0,
    options.value.findIndex((o) => o.selected),
  )
  // on a phone the keyboard would cover the sheet: the search waits for a tap
  if (!props.phone) void nextTick(() => input.value?.focus())
})
const optionId = (i: number) => `${id}-option-${String(i)}`

function pick(option: Option) {
  emit('done')
  if (option.slug !== null) {
    void navigateTo({
      path: org.to(`/spazi/${encodeURIComponent(option.slug)}`),
      query: option.profileId === null ? {} : { profilo: option.profileId },
    })
    return
  }
  // «Tutti i clienti»: from a client's page back to the clients, elsewhere the same page
  if (clientSlugOf(route) !== null) {
    void navigateTo(org.to('/spazi'))
    return
  }
  const next = { ...route.query }
  delete next['profilo']
  delete next['spazio']
  void router.replace({ query: next })
}

function onKey(event: KeyboardEvent) {
  const count = options.value.length
  if (count === 0) return
  keyboarding.value = true
  if (event.key === 'ArrowDown') active.value = (active.value + 1) % count
  else if (event.key === 'ArrowUp') active.value = (active.value - 1 + count) % count
  else if (event.key === 'Enter') {
    // a search that found nobody picks nothing, not «Tutti i clienti»
    if (query.value.trim() !== '' && clients.value.length === 0) {
      event.preventDefault()
      return
    }
    const option = options.value[active.value]
    if (option) pick(option)
  } else return
  event.preventDefault()
  document.getElementById(optionId(active.value))?.scrollIntoView({ block: 'nearest' })
}

const newClient = computed(() =>
  org.may.value.createWorkspace ? { path: org.to('/spazi'), query: { nuovo: '1' } } : null,
)
const row = computed(() => (props.phone ? 'min-h-12' : 'min-h-9'))
</script>

<template>
  <div>
    <label
      class="mx-0.5 mt-0.5 mb-1.5 flex items-center gap-2 rounded-control border border-(--app-field-border) bg-(--app-surface) px-2.5 focus-within:border-(--app-text) focus-within:ring-1 focus-within:ring-(--app-text)"
      :class="phone ? 'h-11' : 'h-[34px]'"
    >
      <UIcon
        name="i-lucide-search"
        class="size-4 shrink-0 text-(--app-text-muted)"
        aria-hidden="true"
      />
      <input
        ref="input"
        v-model="query"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        :aria-controls="`${id}-list`"
        :aria-activedescendant="options.length ? optionId(active) : undefined"
        :aria-label="$t('context.search')"
        :placeholder="$t('context.search')"
        autocomplete="off"
        class="h-full min-w-0 flex-1 bg-transparent outline-none! placeholder:text-(--app-text-muted)"
        @keydown="onKey"
      />
    </label>
    <ul
      :id="`${id}-list`"
      role="listbox"
      :aria-label="$t('context.label')"
      class="max-h-[60vh] overflow-x-hidden overflow-y-auto"
    >
      <li
        v-for="(option, i) in options"
        :id="optionId(i)"
        :key="option.key"
        role="option"
        :aria-selected="option.selected"
        :data-active="(keyboarding && i === active) || undefined"
        class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 hover:bg-(--app-nav-hover) data-active:outline-2 data-active:-outline-offset-2 data-active:outline-(--app-focus) aria-selected:bg-(--app-nav-hover) aria-selected:font-semibold"
        :class="[
          row,
          option.nested && 'ps-6',
          i === 1 &&
            'relative mt-3 before:absolute before:inset-x-[-6px] before:-top-1.5 before:border-t before:border-(--app-border)',
        ]"
        @click="pick(option)"
        @mousemove="hover(i)"
      >
        <Avatar
          :name="option.avatar.name"
          :src="option.avatar.src"
          :kind="option.avatar.kind"
          :size="22"
        />
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
        <UIcon
          v-if="option.selected"
          name="i-lucide-check"
          class="size-4 shrink-0 text-(--app-text-muted)"
          aria-hidden="true"
        />
        <template v-else-if="option.problem">
          <span
            class="me-1 size-2 shrink-0 rounded-full bg-(--app-warning-dot) ring-3 ring-(--app-warning-soft)"
            :data-problem="option.problem"
            aria-hidden="true"
          />
          <span class="sr-only">, {{ $t(`context.problem.${option.problem}`) }}</span>
        </template>
      </li>
      <li
        v-if="clients.length === 0"
        role="presentation"
        class="relative mt-3 flex items-center px-2 text-(--app-text-muted) before:absolute before:inset-x-[-6px] before:-top-1.5 before:border-t before:border-(--app-border)"
        :class="row"
      >
        {{ query.trim() ? $t('context.noMatch') : $t('context.none') }}
      </li>
    </ul>
    <template v-if="newClient">
      <div role="separator" class="-mx-1.5 my-1.5 h-px bg-(--app-border)" />
      <NuxtLink
        :to="newClient"
        class="flex items-center gap-2.5 rounded-md px-2 outline-none hover:bg-(--app-nav-hover) focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-(--app-focus)"
        :class="row"
        @click="emit('done', true)"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-4 shrink-0 text-(--app-text-muted)"
          aria-hidden="true"
        />
        {{ $t('context.newClient') }}
      </NuxtLink>
    </template>
  </div>
</template>
