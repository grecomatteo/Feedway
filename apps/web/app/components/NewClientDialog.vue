<script setup lang="ts">
/**
 * «Nuovo cliente» (spec §14.7): the client is born from a profile found and in no client yet, its
 * accounts arriving together and its name proposed from the profile; or «Senza profilo, per ora».
 */
import type { ProfileWithoutClient } from '~/composables/useOrganization'

const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(
  defineProps<{ profiles: ProfileWithoutClient[]; preselect?: string | null }>(),
  { preselect: null },
)
const emit = defineEmits<{ created: [name: string] }>()
const org = useOrganization()
const { call, failure } = useApi()

const NONE = 'none'
const choice = ref<string>(NONE)
const name = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)

const chosen = computed(() => props.profiles.find((p) => p.key === choice.value) ?? null)
watch(open, (v) => {
  if (!v) return
  // a profile is chosen on purpose: none is attached without a click
  choice.value = props.preselect ?? NONE
  name.value = chosen.value?.name ?? ''
  problem.value = null
})
function choose(key: string) {
  choice.value = key
  name.value = chosen.value?.name ?? ''
}

const handleOf = (a: ProfileWithoutClient['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}

async function submit() {
  sending.value = true
  problem.value = null
  try {
    await call('POST', org.api('/workspaces'), {
      name: name.value,
      ...(chosen.value ? { accountIds: chosen.value.accounts.map((a) => a.id) } : {}),
    })
    open.value = false
    emit('created', name.value.trim())
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="$t('workspaces.new')">
    <template #body>
      <form id="new-client" class="space-y-5" novalidate @submit.prevent="submit">
        <fieldset v-if="profiles.length > 0" class="min-w-0">
          <legend class="mb-2 text-sm font-semibold">{{ $t('clients.new.profile') }}</legend>
          <ul
            class="max-h-72 divide-y divide-(--app-border) overflow-y-auto rounded-xl border border-(--app-border)"
          >
            <li v-for="p in profiles" :key="p.key">
              <label
                class="flex min-h-14 cursor-pointer items-center gap-3 px-4"
                :class="choice === p.key ? 'bg-(--app-brand-soft)' : ''"
              >
                <input
                  type="radio"
                  name="client-profile"
                  class="size-5 accent-(--app-text)"
                  :value="p.key"
                  :checked="choice === p.key"
                  @change="choose(p.key)"
                />
                <RowAvatar :name="p.name" :src="p.accounts.find((a) => a.avatarUrl)?.avatarUrl" />
                <span class="min-w-0">
                  <span class="block truncate font-semibold">{{ p.name }}</span>
                  <span class="flex gap-3 text-[0.8125rem] text-(--app-text-muted)">
                    <span
                      v-for="a in p.accounts"
                      :key="a.id"
                      class="inline-flex items-center gap-1"
                    >
                      <UIcon
                        :name="PLATFORM_ICON[a.platform] ?? 'i-lucide-at-sign'"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      <span class="sr-only"
                        >{{ $t(`socialAccounts.platform.${a.platform}`) }}:</span
                      >
                      {{ handleOf(a) }}
                    </span>
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label
                class="flex min-h-14 cursor-pointer items-center gap-3 px-4"
                :class="choice === NONE ? 'bg-(--app-brand-soft)' : ''"
              >
                <input
                  type="radio"
                  name="client-profile"
                  class="size-5 accent-(--app-text)"
                  :value="NONE"
                  :checked="choice === NONE"
                  @change="choose(NONE)"
                />
                <span>
                  <span class="block font-semibold">{{ $t('clients.new.none') }}</span>
                  <span class="block text-[0.8125rem] text-(--app-text-muted)">{{
                    $t('clients.new.noneHelp')
                  }}</span>
                </span>
              </label>
            </li>
          </ul>
        </fieldset>
        <UFormField
          :label="$t('clients.new.name')"
          name="workspace-name"
          :error="problem ?? undefined"
        >
          <UInput v-model="name" class="w-full" size="xl" :autofocus="profiles.length === 0" />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton type="submit" form="new-client" class="min-h-11" :loading="sending">
          {{ $t('workspaces.create') }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
