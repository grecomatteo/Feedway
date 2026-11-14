<script setup lang="ts">
/**
 * «Sistemali» (spec §14.7): the profiles found that are in no client, each with «Crea il cliente»
 * (the main action) and «Aggiungi a un cliente esistente». Only for Owner and Admin.
 */
import type { ProfileWithoutClient, WorkspaceView } from '~/composables/useOrganization'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ profiles: ProfileWithoutClient[]; clients: WorkspaceView[] }>()
const emit = defineEmits<{
  create: [key: string]
  added: [message: string]
  changed: []
}>()
const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()

const placing = ref<ProfileWithoutClient | null>(null)
const busy = ref(false)
const problem = ref<string | null>(null)
watch(placing, () => (problem.value = null))
const handleOf = (a: ProfileWithoutClient['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const activeClients = computed(() => props.clients.filter((w) => w.archivedAt === null))

async function placeIn(w: WorkspaceView) {
  const p = placing.value
  if (!p || busy.value) return
  busy.value = true
  problem.value = null
  let moved = 0
  try {
    for (const a of p.accounts) {
      await call(
        'PUT',
        org.api(`/workspaces/${encodeURIComponent(w.id)}/accounts/${encodeURIComponent(a.id)}`),
      )
      moved += 1
    }
    placing.value = null
    emit('added', t('clients.fix.added', { name: p.name, client: w.name }))
  } catch (e) {
    problem.value = failure(e).message
    // part of the profile may be in the client already: the lists must say so
    if (moved > 0) emit('changed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="$t('clients.fix.title')"
    :description="$t('clients.fix.intro')"
  >
    <template #body>
      <p v-if="profiles.length === 0" class="text-(--app-text-muted)">
        {{ $t('clients.fix.empty') }}
      </p>
      <ul
        v-else
        :aria-label="$t('clients.fix.title')"
        class="divide-y divide-(--app-border) rounded-xl border border-(--app-border) bg-(--app-card)"
      >
        <li v-for="p in profiles" :key="p.key" class="space-y-3 px-4 py-3">
          <div class="flex items-center gap-3">
            <RowAvatar :name="p.name" :src="p.accounts.find((a) => a.avatarUrl)?.avatarUrl" />
            <span class="min-w-0">
              <span class="block truncate font-semibold">{{ p.name }}</span>
              <span class="flex flex-wrap gap-x-3 text-[0.8125rem] text-(--app-text-muted)">
                <span v-for="a in p.accounts" :key="a.id" class="inline-flex items-center gap-1">
                  <UIcon
                    :name="PLATFORM_ICON[a.platform] ?? 'i-lucide-at-sign'"
                    class="size-3.5"
                    aria-hidden="true"
                  />
                  <span class="sr-only">{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span>
                  {{ handleOf(a) }}
                </span>
              </span>
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              class="min-h-11"
              :aria-label="$t('clients.fix.createOf', { name: p.name })"
              @click="emit('create', p.key)"
            >
              {{ $t('clients.fix.create') }}
            </UButton>
            <UButton
              class="min-h-11"
              color="neutral"
              variant="outline"
              :disabled="activeClients.length === 0"
              :aria-label="$t('clients.fix.existingOf', { name: p.name })"
              @click="placing = p"
            >
              {{ $t('clients.fix.existing') }}
            </UButton>
          </div>
        </li>
      </ul>
    </template>
  </USlideover>

  <UModal
    :open="placing !== null"
    :title="$t('clients.match.existingTitle', { name: placing?.name ?? '' })"
    @update:open="!$event && (placing = null)"
  >
    <template #body>
      <ul class="divide-y divide-(--app-border) rounded-xl border border-(--app-border)">
        <li v-for="w in activeClients" :key="w.id">
          <button
            type="button"
            class="flex min-h-14 w-full items-center gap-3 px-4 text-left font-semibold disabled:opacity-60"
            :disabled="busy"
            @click="placeIn(w)"
          >
            <RowAvatar :name="w.name" :src="w.photoUrl ?? null" />
            {{ w.name }}
          </button>
        </li>
      </ul>
      <p v-if="problem" role="alert" class="mt-3 text-(--app-danger)">{{ problem }}</p>
    </template>
  </UModal>
</template>
