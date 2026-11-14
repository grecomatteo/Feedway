<script setup lang="ts">
/**
 * Chooses one of the profiles in no client (spec §14.7), for «Sostituisci profilo» and «Aggiungi
 * profilo» on the client's page. The page makes the change; this only asks which profile.
 */
import type { ProfileWithoutClient } from '~/composables/useOrganization'

const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(
  defineProps<{
    title: string
    description: string
    confirm: string
    profiles: ProfileWithoutClient[]
    busy?: boolean
    problem?: string | null
  }>(),
  { busy: false, problem: null },
)
const emit = defineEmits<{ pick: [key: string] }>()
const org = useOrganization()

const choice = ref<string | null>(null)
watch(open, (v) => {
  // nothing is chosen for the person: the change waits for a click
  if (v) choice.value = null
})

const handleOf = (a: ProfileWithoutClient['accounts'][number]) =>
  a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
const PLATFORM_ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const submit = () => {
  if (choice.value !== null && !props.busy) emit('pick', choice.value)
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description">
    <template #body>
      <p v-if="profiles.length === 0" class="text-(--app-text-muted)">
        {{ $t('client.pickNone') }}
        <NuxtLink
          v-if="org.may.value.manageAccounts"
          :to="org.to('/impostazioni/integrazioni')"
          class="underline"
          >{{ $t('client.pickNoneLink') }}</NuxtLink
        >
      </p>
      <form v-else id="pick-profile" novalidate @submit.prevent="submit">
        <fieldset class="min-w-0">
          <legend class="mb-2 text-sm font-semibold">{{ $t('client.pickLegend') }}</legend>
          <ul
            class="max-h-72 divide-y divide-(--app-border) overflow-y-auto rounded-xl border border-(--app-border)"
          >
            <li v-for="p in profiles" :key="p.key">
              <label
                class="flex min-h-14 cursor-pointer items-center gap-3 px-4"
                :class="
                  choice === p.key
                    ? 'bg-(--app-surface-sunken) shadow-[inset_3px_0_0_var(--app-brand)]'
                    : ''
                "
              >
                <input
                  type="radio"
                  name="pick-profile"
                  class="size-5 accent-(--app-text)"
                  :value="p.key"
                  :checked="choice === p.key"
                  @change="choice = p.key"
                />
                <RowAvatar :name="p.name" :src="p.accounts.find((a) => a.avatarUrl)?.avatarUrl" />
                <span class="min-w-0">
                  <span class="block truncate font-semibold">{{ p.name }}</span>
                  <span class="flex flex-wrap gap-x-3 text-[0.8125rem] text-(--app-text-muted)">
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
          </ul>
        </fieldset>
        <p v-if="problem" role="alert" class="mt-3 text-sm text-(--app-danger)">{{ problem }}</p>
      </form>
    </template>
    <template #footer>
      <div class="flex flex-wrap gap-3">
        <UButton
          v-if="profiles.length > 0"
          type="submit"
          form="pick-profile"
          class="min-h-11"
          :loading="busy"
          :disabled="choice === null"
        >
          {{ confirm }}
        </UButton>
        <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
