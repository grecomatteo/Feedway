<script setup lang="ts">
import type { AccountGroupDto } from '@app/contracts'

/**
 * «Nuovo gruppo» and «Modifica gruppo»: a name and some accounts of the client, by profile. An
 * account saved in the group and no longer the client's is listed apart, to take it out.
 */
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  base: string
  group: AccountGroupDto | null
  profiles: WorkspaceProfile[]
}>()
const emit = defineEmits<{ saved: [group: AccountGroupDto] }>()
const { t } = useI18n()
const { call, failure } = useApi()

const name = ref('')
const picked = ref<string[]>([])
const sending = ref(false)
const problem = ref<{ message: string; field: string } | null>(null)
const known = computed(() => new Set(props.profiles.flatMap((p) => p.accounts.map((a) => a.id))))
watch(open, (v) => {
  if (!v) return
  name.value = props.group?.name ?? ''
  // an account that left the client cannot be saved again: it starts out
  picked.value = (props.group?.accountIds ?? []).filter((id) => known.value.has(id))
  problem.value = null
})
const gone = computed(() =>
  props.group ? props.group.accountIds.filter((id) => !known.value.has(id)).length : 0,
)
const ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const handleOf = (a: ProfileAccount) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
function toggle(id: string, on: boolean) {
  const now = new Set(picked.value)
  if (on) now.add(id)
  else now.delete(id)
  picked.value = [...now]
}

async function submit() {
  sending.value = true
  problem.value = null
  try {
    const body = { name: name.value, accountIds: picked.value }
    const saved = props.group
      ? await call<AccountGroupDto>(
          'PATCH',
          `${props.base}/account-groups/${encodeURIComponent(props.group.id)}`,
          body,
        )
      : await call<AccountGroupDto>('POST', `${props.base}/account-groups`, body)
    open.value = false
    emit('saved', saved)
  } catch (e) {
    const f = failure(e)
    problem.value = { message: f.message, field: f.field ?? '' }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="group ? t('contentSettings.groups.edit') : t('contentSettings.groups.new')"
  >
    <template #body>
      <form id="group-form" class="space-y-5" novalidate @submit.prevent="submit">
        <UFormField
          :label="$t('contentSettings.groups.name')"
          name="group-name"
          :error="problem?.field === 'name' ? problem.message : undefined"
        >
          <UInput v-model="name" class="w-full" size="xl" maxlength="80" autofocus />
        </UFormField>
        <fieldset class="min-w-0">
          <legend class="mb-2 text-sm font-semibold">
            {{ $t('contentSettings.groups.accounts') }}
          </legend>
          <p v-if="profiles.length === 0" class="text-sm text-(--app-text-muted)">
            {{ $t('contentSettings.groups.noAccounts') }}
          </p>
          <ul
            v-else
            class="max-h-72 divide-y divide-(--app-border) overflow-y-auto rounded-xl border border-(--app-border)"
          >
            <li v-for="p in profiles" :key="p.key" class="px-4 py-2">
              <p class="py-1 text-sm font-semibold">{{ profileName(p) }}</p>
              <ul>
                <li v-for="a in p.accounts" :key="a.id">
                  <!-- the whole row ticks the account, not only the box -->
                  <label class="flex min-h-11 cursor-pointer items-center gap-3">
                    <UCheckbox
                      :model-value="picked.includes(a.id)"
                      :aria-label="`${handleOf(a)} · ${$t(`socialAccounts.platform.${a.platform}`)}`"
                      @update:model-value="toggle(a.id, $event === true)"
                    />
                    <UIcon
                      :name="ICON[a.platform] ?? 'i-lucide-at-sign'"
                      class="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="min-w-0 truncate">{{ handleOf(a) }}</span>
                  </label>
                </li>
              </ul>
            </li>
          </ul>
          <p v-if="gone > 0" class="mt-2 text-sm text-(--app-warning)">
            {{ $t('contentSettings.groups.goneInDialog', { n: gone }, gone) }}
          </p>
        </fieldset>
        <p
          v-if="problem && problem.field !== 'name'"
          role="alert"
          class="text-sm text-(--app-danger)"
        >
          {{ problem.message }}
        </p>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton
          type="submit"
          form="group-form"
          class="min-h-11"
          :loading="sending"
          :disabled="picked.length === 0"
        >
          {{ group ? $t('contentSettings.save') : $t('contentSettings.groups.create') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
