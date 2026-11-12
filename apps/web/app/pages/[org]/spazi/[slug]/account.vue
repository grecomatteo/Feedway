<script setup lang="ts">
definePageMeta({ layout: 'agency' })

/**
 * Spazio → Account (spec §3, §14.4, plan 03 Task 12): the client's accounts as profiles, for
 * whoever sees the client. Owner and Admin add the agency's active accounts and take them out;
 * a post can use only the accounts of its client.
 */
interface AgencyAccount {
  id: string
  platform: 'instagram' | 'facebook'
  name: string
  username: string | null
  pageId: string | null
  active: boolean
  workspaceIds: string[]
}

const org = useOrganization()
const route = useRoute()
const { t } = useI18n()
const { call, failure } = useApi()
const { data: spaces, status: spacesStatus } = useWorkspaces()

const workspace = computed(
  () => spaces.value?.items.find((w) => w.slug === route.params['slug']) ?? null,
)
const missing = computed(() => spacesStatus.value === 'success' && workspace.value === null)
useHead({ title: () => workspace.value?.name ?? t('workspaceAccounts.title') })

const workspaceId = computed(() => workspace.value?.id ?? null)
const { data, error, refresh } = useWorkspaceProfiles(workspaceId)
watch(
  workspaceId,
  (id) => {
    if (id) void refresh()
  },
  { immediate: true },
)

// the agency's accounts, to add one: Owner and Admin only (they manage the accounts)
// an archived client stays as it is (§3): nothing to add or take out
const canAssign = computed(
  () => org.may.value.manageAccounts && (workspace.value?.archivedAt ?? null) === null,
)
const { data: agency, refresh: refreshAgency } = useFetch<{ items: AgencyAccount[] }>(
  () => org.api('/accounts?limit=100'),
  { server: false, lazy: true, immediate: canAssign.value },
)
const free = computed(() =>
  (agency.value?.items ?? []).filter(
    (a) => a.active && workspaceId.value !== null && !a.workspaceIds.includes(workspaceId.value),
  ),
)

const chosen = ref<string[]>([])
const state = reactive({ sending: false, problem: '', done: '' })
function toggle(id: string, on: boolean | 'indeterminate') {
  chosen.value =
    on === true ? [...new Set([...chosen.value, id])] : chosen.value.filter((x) => x !== id)
}
const base = (accountId: string) =>
  org.api(
    `/workspaces/${encodeURIComponent(workspaceId.value ?? '')}/accounts/${encodeURIComponent(accountId)}`,
  )

async function run(action: () => Promise<void>, message?: string) {
  Object.assign(state, { sending: true, problem: '', done: '' })
  try {
    await action()
    if (message) state.done = message
  } catch (e) {
    state.problem = failure(e).message
  } finally {
    state.sending = false
    await Promise.all([refresh(), refreshAgency()])
  }
}
const assign = () =>
  run(async () => {
    let added = 0
    try {
      for (const id of [...chosen.value]) {
        await call('PUT', base(id))
        // what went in leaves the choice at once: after a failure only the rest stays chosen
        chosen.value = chosen.value.filter((x) => x !== id)
        added += 1
      }
    } finally {
      if (added > 0) state.done = t('workspaceAccounts.added', { n: added }, added)
    }
  })
const remove = (a: { id: string; name: string; platform: string }) =>
  run(
    () => call('DELETE', base(a.id)).then(() => undefined),
    t('workspaceAccounts.removed', { name: a.name }),
  )

const accountLabel = (a: { platform: string; name: string }) =>
  `${t(`socialAccounts.platform.${a.platform}`)}: ${a.name}`
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <NuxtLink :to="org.to('/spazi')" class="text-sm text-(--app-text-muted) underline">
        {{ $t('workspaces.title') }}
      </NuxtLink>
      <h1 class="text-3xl">{{ workspace?.name ?? $t('workspaceAccounts.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('workspaceAccounts.explain') }}</p>
    </header>

    <p v-if="missing" role="alert">{{ $t('workspaceMembers.missing') }}</p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="text-(--app-danger)">{{ $t('workspaceAccounts.loadError') }}</p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <p v-else-if="!data" role="status">{{ $t('account.loading') }}</p>

    <template v-else>
      <p v-if="state.done" role="status" class="text-(--app-success)">{{ state.done }}</p>
      <p v-if="state.problem" role="alert" class="text-(--app-danger)">{{ state.problem }}</p>

      <section aria-labelledby="client-accounts" class="space-y-3">
        <h2 id="client-accounts" class="text-lg">{{ $t('workspaceAccounts.assigned') }}</h2>
        <EmptyState
          v-if="data.items.length === 0"
          icon="i-lucide-at-sign"
          :title="$t('workspaceAccounts.empty')"
          :text="
            workspace?.archivedAt
              ? $t('workspaceAccounts.emptyArchived')
              : canAssign
                ? $t('workspaceAccounts.emptyAdmin')
                : $t('workspaceAccounts.emptyMember')
          "
        />
        <ul v-else class="space-y-4" :aria-label="$t('workspaceAccounts.list')">
          <li
            v-for="p in data.items"
            :key="p.key"
            class="rounded-xl border border-(--app-border) bg-(--app-surface)"
          >
            <h3 class="border-b border-(--app-border) px-4 py-3 text-base font-semibold sm:px-6">
              {{ profileName(p) }}
            </h3>
            <ul class="divide-y divide-(--app-border)">
              <li
                v-for="a in p.accounts"
                :key="a.id"
                class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
              >
                <span class="flex min-w-0 items-center gap-3">
                  <UIcon
                    :name="a.platform === 'instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'"
                    class="size-5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="font-semibold break-words">
                    <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}: </span
                    >{{ a.name }}
                  </span>
                  <span v-if="a.username" class="text-(--app-text-muted)">@{{ a.username }}</span>
                </span>
                <UButton
                  v-if="canAssign"
                  class="min-h-11"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :disabled="state.sending"
                  :aria-label="$t('workspaceAccounts.removeOf', { name: accountLabel(a) })"
                  @click="remove(a)"
                >
                  {{ $t('workspaceAccounts.remove') }}
                </UButton>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <form
        v-if="canAssign"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
        novalidate
        @submit.prevent="assign"
      >
        <fieldset class="min-w-0 space-y-2">
          <legend class="text-lg">{{ $t('workspaceAccounts.free') }}</legend>
          <p v-if="free.length === 0" class="text-(--app-text-muted)">
            {{ $t('workspaceAccounts.noneFree') }}
            <NuxtLink :to="org.to('/account/aggiungi')" class="underline">
              {{ $t('socialAccounts.add') }}
            </NuxtLink>
          </p>
          <ul v-else class="divide-y divide-(--app-border)">
            <li v-for="a in free" :key="a.id" class="py-1">
              <UCheckbox
                :model-value="chosen.includes(a.id)"
                :ui="{ root: 'min-h-11 items-center' }"
                @update:model-value="toggle(a.id, $event)"
              >
                <template #label>
                  <span class="flex items-center gap-2">
                    <UIcon
                      :name="
                        a.platform === 'instagram' ? 'i-lucide-instagram' : 'i-lucide-facebook'
                      "
                      class="size-5 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="font-semibold break-words">
                      <span class="sr-only"
                        >{{ $t(`socialAccounts.platform.${a.platform}`) }}: </span
                      >{{ a.name }}
                    </span>
                    <span v-if="a.username" class="text-(--app-text-muted)">@{{ a.username }}</span>
                  </span>
                </template>
              </UCheckbox>
            </li>
          </ul>
        </fieldset>
        <UButton
          v-if="free.length > 0"
          type="submit"
          class="min-h-11"
          :loading="state.sending"
          :disabled="chosen.length === 0"
        >
          {{
            chosen.length === 0
              ? $t('workspaceAccounts.choose')
              : $t('workspaceAccounts.add', { n: chosen.length }, chosen.length)
          }}
        </UButton>
      </form>
    </template>
  </div>
</template>
