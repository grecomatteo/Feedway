<script setup lang="ts">
/**
 * «Nuovo cliente» (screen 15, spec §14.7): the name, then the profiles found on Meta that are in
 * no client yet, each ticked on purpose (none is attached without a click). Ticking one proposes
 * its name while the field still holds a proposal. A window on a computer, a sheet from the bottom
 * on a phone.
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

const ticked = ref<string[]>([])
const name = ref('')
/** the name the dialog proposed, replaced by the next proposal until the person types their own */
let proposed = ''
const sending = ref(false)
const problem = ref<string | null>(null)

function propose(value: string) {
  if (name.value.trim() === '' || name.value === proposed) {
    name.value = value
    proposed = value
  }
}
watch(open, (v) => {
  if (!v) return
  ticked.value = props.preselect ? [props.preselect] : []
  name.value = ''
  proposed = ''
  const first = props.profiles.find((p) => p.key === props.preselect)
  if (first) propose(first.name)
  problem.value = null
})
function toggle(key: string, on: boolean) {
  ticked.value = on ? [...ticked.value, key] : ticked.value.filter((k) => k !== key)
  // the first one ticked names the client
  const first = props.profiles.find((p) => p.key === ticked.value[0])
  propose(first?.name ?? '')
}

const handleOf = (a: ProfileWithoutClient['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
/** «@barcentrale.bo», or «@x · Pagina» for an Instagram and its Page */
const labelOf = (p: ProfileWithoutClient) => p.accounts.map(handleOf).join(' · ')
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const { t } = useI18n()
const kindOf = (p: ProfileWithoutClient) => {
  const platforms = new Set(p.accounts.map((a) => a.platform))
  if (platforms.has('instagram') && platforms.has('facebook')) return t('clients.new.kind.both')
  return platforms.has('facebook')
    ? t('clients.new.kind.facebook')
    : t('clients.new.kind.instagram')
}

async function submit() {
  sending.value = true
  problem.value = null
  const accountIds = props.profiles
    .filter((p) => ticked.value.includes(p.key))
    .flatMap((p) => p.accounts.map((a) => a.id))
  try {
    await call('POST', org.api('/workspaces'), {
      name: name.value,
      ...(accountIds.length > 0 ? { accountIds } : {}),
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
  <UModal
    v-model:open="open"
    :title="$t('workspaces.new')"
    :close="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.4)]',
      content:
        'w-[480px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em]',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
      footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
    }"
    data-new-client
  >
    <template #body>
      <form id="new-client" class="grid gap-4" novalidate @submit.prevent="submit">
        <UFormField
          :label="$t('clients.new.name')"
          name="workspace-name"
          :error="problem ?? undefined"
        >
          <UInput
            v-model="name"
            class="w-full"
            :ui="{ base: 'bg-(--app-surface)' }"
            :autofocus="profiles.length === 0"
          />
        </UFormField>
        <fieldset v-if="profiles.length > 0" class="grid min-w-0 gap-1.5">
          <legend class="mb-1.5 font-medium">{{ $t('clients.new.profiles') }}</legend>
          <ul
            class="max-h-72 overflow-y-auto rounded-card border border-(--app-border)"
            data-new-client-profiles
          >
            <li
              v-for="p in profiles"
              :key="p.key"
              class="border-t border-(--app-border) first:border-t-0"
            >
              <label class="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <UCheckbox
                  :model-value="ticked.includes(p.key)"
                  :aria-label="labelOf(p)"
                  @update:model-value="(v) => toggle(p.key, v === true)"
                />
                <span class="flex min-w-0 flex-1 items-center gap-3">
                  <span class="flex shrink-0 gap-1">
                    <UIcon
                      v-for="a in p.accounts"
                      :key="a.id"
                      :name="PLATFORM_ICON[a.platform] ?? 'i-lucide-at-sign'"
                      class="size-[18px]"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="min-w-0 truncate">{{ labelOf(p) }}</span>
                </span>
                <span class="shrink-0 text-detail text-(--app-text-muted)">{{ kindOf(p) }}</span>
              </label>
            </li>
          </ul>
          <p class="text-detail text-(--app-text-muted)">{{ $t('clients.new.profilesHelp') }}</p>
        </fieldset>
      </form>
    </template>
    <template #footer>
      <UButton
        class="max-md:flex-1 max-md:justify-center"
        color="neutral"
        variant="outline"
        @click="open = false"
      >
        {{ $t('security.cancel') }}
      </UButton>
      <UButton
        type="submit"
        form="new-client"
        class="max-md:flex-1 max-md:justify-center"
        :loading="sending"
      >
        {{ $t('workspaces.create') }}
      </UButton>
    </template>
  </UModal>
</template>
