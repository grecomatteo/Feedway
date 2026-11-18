<script setup lang="ts">
import { selectable, type PostEditor } from '~/composables/usePostEditor'

/**
 * «Dove pubblicare» (§11.2 point 5; design E1): the client's profiles with their accounts under
 * them, a search, «Seleziona tutti» of the accounts that can be chosen. An account to reconnect
 * is off, with the reason under its name.
 */
const props = defineProps<{ editor: PostEditor; profiles: WorkspaceProfile[]; loading: boolean }>()
const { t } = useI18n()
const e = props.editor
const q = ref('')

const ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const matches = (p: WorkspaceProfile) => {
  const s = q.value.trim().toLowerCase()
  if (!s) return true
  return [profileName(p), ...p.accounts.flatMap((a) => [a.name, a.username ?? ''])].some((x) =>
    x.toLowerCase().includes(s.replace(/^@/, '')),
  )
}
const shown = computed(() => props.profiles.filter(matches))
const all = computed(() => props.profiles.flatMap((p) => p.accounts.filter(selectable)))
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
const stateOf = (p: WorkspaceProfile): boolean | 'indeterminate' => {
  const ids = p.accounts.filter(selectable).map((a) => a.id)
  const on = ids.filter((id) => e.destinations.value.includes(id)).length
  if (on === 0) return false
  return on === ids.length ? true : 'indeterminate'
}
const allPicked = computed(
  () => all.value.length > 0 && all.value.every((a) => e.destinations.value.includes(a.id)),
)
const whyOff = (a: ProfileAccount) =>
  !a.active ? t('posts.destinations.inactive') : t('posts.destinations.reconnect')
</script>

<template>
  <section aria-labelledby="post-destinations" class="flex flex-col gap-3">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="post-destinations" class="text-lg">{{ $t('posts.destinations.title') }}</h2>
      <p class="text-sm text-(--app-text-muted)" aria-live="polite">
        {{ $t('posts.destinations.count', { n: count }, count) }}
      </p>
    </div>
    <ListSkeleton v-if="loading && profiles.length === 0" />
    <p v-else-if="profiles.length === 0" class="text-(--app-text-muted)">
      {{ $t('posts.destinations.none') }}
    </p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <SearchField v-model="q" :label="$t('posts.destinations.search')" class="flex-1" />
        <UButton
          v-if="e.editable.value"
          color="neutral"
          variant="ghost"
          class="min-h-11"
          :icon="allPicked ? 'i-lucide-x' : 'i-lucide-check-check'"
          trailing
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
      <ul
        class="divide-y divide-(--app-border) overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)"
      >
        <li v-for="p in shown" :key="p.key" class="flex flex-col gap-1 px-4 py-3">
          <div class="flex min-h-11 items-center gap-3">
            <UCheckbox
              :model-value="stateOf(p)"
              :disabled="!e.editable.value || p.accounts.filter(selectable).length === 0"
              :aria-label="$t('posts.destinations.profile', { name: profileName(p) })"
              @update:model-value="
                set(
                  p.accounts.filter(selectable).map((a) => a.id),
                  stateOf(p) !== true,
                )
              "
            />
            <RowAvatar :name="profileName(p)" :src="profilePhoto(p)" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ profileName(p) }}</span>
            <span class="text-sm text-(--app-text-muted) tabular-nums">{{
              $t('posts.destinations.ofProfile', {
                on: p.accounts.filter((a) => picked(a)).length,
                n: p.accounts.length,
              })
            }}</span>
          </div>
          <ul class="flex flex-col pl-9">
            <li v-for="a in p.accounts" :key="a.id" class="flex min-h-11 items-center gap-3">
              <UCheckbox
                :model-value="picked(a)"
                :disabled="!e.editable.value || !selectable(a)"
                :aria-label="`${handleOf(a)} · ${$t(`socialAccounts.platform.${a.platform}`)}`"
                :aria-describedby="selectable(a) ? undefined : `why-${a.id}`"
                :data-account="a.id"
                @update:model-value="set([a.id], $event === true)"
              />
              <UIcon
                :name="ICON[a.platform] ?? 'i-lucide-at-sign'"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate" :class="selectable(a) ? '' : 'text-(--app-text-muted)'">
                  {{ handleOf(a) }}
                  <span class="text-xs text-(--app-text-muted)">{{
                    $t(`posts.destinations.kind.${a.platform}`)
                  }}</span>
                </p>
                <p v-if="!selectable(a)" :id="`why-${a.id}`" class="text-xs text-(--app-warning)">
                  {{ whyOff(a) }}
                </p>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>
