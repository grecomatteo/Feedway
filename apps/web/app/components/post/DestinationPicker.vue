<script setup lang="ts">
import type { AccountGroupDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { reconnecting, selectable, type PostEditor } from '~/composables/usePostEditor'

/**
 * «Dove» (§11.2 point 5; screens 08 and 09): the client's accounts in one list, each with its box,
 * its icon, its name and on the right what it is («Pagina Facebook») or why it cannot be chosen
 * («Da ricollegare», with the box off). From six accounts up a search, «Gruppi» and «Seleziona
 * tutti» stand above the list: with fewer they only take room. «Gruppi» puts the accounts of a
 * saved group that can be chosen in place of the ones ticked (D-80.2) and says which ones it
 * skips (§11.7, design E8c).
 */
const props = defineProps<{
  editor: PostEditor
  client: WorkspaceView
  profiles: WorkspaceProfile[]
  loading: boolean
  /** the client's account groups; null while they load */
  groups: AccountGroupDto[] | null
}>()
const { t } = useI18n()
const e = props.editor
const q = ref('')

const ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
/**
 * Every account of the client, Instagram first (D-51), each with its profile's name for the
 * search and whether it can be ticked.
 */
const accounts = computed(() => {
  const list = props.profiles.flatMap((p) =>
    p.accounts.map((a) => ({
      a,
      profile: profileName(p),
      reconnect: reconnecting(props.client, p.key),
    })),
  )
  return [
    ...list.filter((x) => x.a.platform === 'instagram'),
    ...list.filter((x) => x.a.platform !== 'instagram'),
  ]
})
const off = computed(() => new Set(accounts.value.filter((x) => x.reconnect).map((x) => x.a.id)))
/** an account to reconnect is shown off here too, as in «Clienti» (screens 08, 14 and 16) */
const pickable = (a: ProfileAccount) => selectable(a) && !off.value.has(a.id)
/** «Gruppi», the search and «Seleziona tutti» from this many accounts up (plan R7) */
const MANY = 6
const many = computed(() => accounts.value.length >= MANY)
const shown = computed(() => {
  const s = q.value.trim().toLowerCase().replace(/^@/, '')
  if (!many.value || !s) return accounts.value
  return accounts.value.filter(({ a, profile }) =>
    [profile, a.name, a.username ?? ''].some((x) => x.toLowerCase().includes(s)),
  )
})
const all = computed(() => accounts.value.map((x) => x.a).filter(pickable))
const picked = (a: ProfileAccount) => e.destinations.value.includes(a.id)
const count = computed(() => e.destinations.value.length)

function set(ids: string[], on: boolean) {
  const now = new Set(e.destinations.value)
  for (const id of ids) {
    if (on) now.add(id)
    else now.delete(id)
  }
  e.destinations.value = [...now]
  e.touched()
}
const allPicked = computed(
  () => all.value.length > 0 && all.value.every((a) => e.destinations.value.includes(a.id)),
)
// ---- «Gruppi»
const byId = computed(
  () => new Map(props.profiles.flatMap((p) => p.accounts.map((a) => [a.id, a] as const))),
)
/** The accounts of the group that can be ticked now, and the ones it skips. */
function split(g: AccountGroupDto) {
  const ok: ProfileAccount[] = []
  const skipped: string[] = []
  for (const id of g.accountIds) {
    const a = byId.value.get(id)
    if (a && pickable(a)) ok.push(a)
    else skipped.push(a ? handleOf(a) : t('posts.destinations.groups.gone'))
  }
  return { ok, skipped }
}
const groupNote = ref<string | null>(null)
function applyGroup(g: AccountGroupDto) {
  const { ok, skipped } = split(g)
  // a group is the choice, not an addition to it (D-80.2): the accounts ticked before go away
  e.destinations.value = ok.map((a) => a.id)
  e.touched()
  const done = t('posts.destinations.groups.done', { n: ok.length, name: g.name }, ok.length)
  groupNote.value =
    skipped.length === 0
      ? done
      : `${done} ${t(
          'posts.destinations.groups.skippedNote',
          { skipped: skipped.join(', ') },
          // 1 → the first form, more → the second
          skipped.length === 1 ? 1 : 2,
        )}`
}
const groupItems = computed<DropdownMenuItem[][]>(() => {
  const list = props.groups ?? []
  if (list.length === 0) return [[{ label: t('posts.destinations.groups.none'), disabled: true }]]
  return [
    list.map((g) => {
      const { ok, skipped } = split(g)
      return {
        label: g.name,
        icon: 'i-lucide-users',
        description:
          skipped.length === 0
            ? t('posts.destinations.groups.ticks', { n: ok.length }, ok.length)
            : t('posts.destinations.groups.ticksSkipping', {
                n: ok.length,
                skipped: skipped.join(', '),
              }),
        disabled: ok.length === 0,
        onSelect: () => applyGroup(g),
      }
    }),
  ]
})

const whyOff = (a: ProfileAccount) =>
  !a.active ? t('posts.destinations.inactive') : t('posts.destinations.reconnect')
const pickedOff = (a: ProfileAccount) => !pickable(a) && picked(a)
const offWord = (a: ProfileAccount) =>
  !a.active ? t('posts.destinations.offInactive') : t('posts.destinations.offReconnect')
</script>

<template>
  <PostEditorRow
    heading="post-destinations"
    :label="$t('posts.destinations.title')"
    :detail="
      accounts.length > 0 ? $t('posts.destinations.count', { on: count, n: accounts.length }) : null
    "
  >
    <div class="flex flex-col gap-3">
      <ListSkeleton v-if="loading && profiles.length === 0" />
      <p v-else-if="profiles.length === 0" class="text-(--app-text-muted)">
        {{ $t('posts.destinations.none') }}
      </p>
      <template v-else>
        <div v-if="many" class="flex flex-wrap items-center gap-2" data-destinations-tools>
          <SearchField v-model="q" :label="$t('posts.destinations.search')" class="flex-1" />
          <UDropdownMenu
            v-if="e.editable.value"
            :items="groupItems"
            :content="{ align: 'end' }"
            :ui="{ content: 'w-80 max-w-[calc(100vw-2rem)]', itemDescription: 'whitespace-normal' }"
          >
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-users"
              :loading="groups === null"
            >
              {{ $t('posts.destinations.groups.button') }}
            </UButton>
          </UDropdownMenu>
          <UButton
            v-if="e.editable.value"
            color="neutral"
            variant="ghost"
            :icon="allPicked ? 'i-lucide-x' : 'i-lucide-check-check'"
            :disabled="all.length === 0"
            @click="
              set(
                all.map((a) => a.id),
                !allPicked,
              )
            "
          >
            {{ allPicked ? $t('posts.destinations.none_') : $t('posts.destinations.all') }}
          </UButton>
        </div>
        <p v-if="groupNote" role="status" class="text-detail text-(--app-text-muted)">
          {{ groupNote }}
        </p>
        <ul
          class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
          data-destinations
        >
          <li
            v-for="{ a } in shown"
            :key="a.id"
            class="border-t border-(--app-border) first:border-t-0"
          >
            <label
              class="flex min-h-12 items-center gap-3 px-3.5 max-md:min-h-14"
              :class="
                pickable(a) && e.editable.value ? 'cursor-pointer' : 'text-(--app-text-muted)'
              "
            >
              <UCheckbox
                :model-value="picked(a)"
                :disabled="!e.editable.value || (!pickable(a) && !pickedOff(a))"
                :aria-label="`${handleOf(a)} · ${$t(`posts.destinations.kind.${a.platform}`)}`"
                :aria-describedby="pickable(a) ? undefined : `why-${a.id}`"
                :data-account="a.id"
                :class="pickable(a) ? '' : 'opacity-45'"
                @update:model-value="set([a.id], $event === true)"
              />
              <UIcon
                :name="ICON[a.platform] ?? 'i-lucide-at-sign'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate" :class="pickable(a) ? 'font-medium' : ''">{{
                handleOf(a)
              }}</span>
              <span
                v-if="pickable(a)"
                class="shrink-0 text-detail text-(--app-text-muted)"
                aria-hidden="true"
                >{{ $t(`posts.destinations.kind.${a.platform}`) }}</span
              >
              <StatusDot v-else :label="offWord(a)" tone="warning" class="shrink-0" />
              <span v-if="!pickable(a)" :id="`why-${a.id}`" class="sr-only">{{ whyOff(a) }}</span>
            </label>
          </li>
          <li v-if="shown.length === 0" class="px-3.5 py-3 text-(--app-text-muted)">
            {{ $t('posts.destinations.noMatch') }}
          </li>
        </ul>
      </template>
    </div>
  </PostEditorRow>
</template>
