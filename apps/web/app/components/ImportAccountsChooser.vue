<script setup lang="ts">
/**
 * The accounts a connection sees, to choose which to import (spec §8.1 step 5, §8.2): the ones
 * already here, of another connection or without the role stay visible with the reason, so
 * nobody looks for them elsewhere. Imported accounts stay out of every client until an Admin
 * assigns them.
 */
import type { ImportableAccount } from '@app/contracts'

const props = defineProps<{ accounts: ImportableAccount[]; path: string }>()
const emit = defineEmits<{ imported: [count: number] }>()
const { call, failure } = useApi()

const chosen = ref<string[]>([])
const sending = ref(false)
const problem = ref<string | null>(null)
watch(
  () => props.accounts,
  () => {
    chosen.value = []
    problem.value = null
  },
)

const importable = computed(() => props.accounts.filter((a) => a.state === 'to_import'))

function toggle(externalId: string, on: boolean | 'indeterminate') {
  chosen.value =
    on === true
      ? [...new Set([...chosen.value, externalId])]
      : chosen.value.filter((id) => id !== externalId)
}

async function submit() {
  if (chosen.value.length === 0) return
  sending.value = true
  problem.value = null
  try {
    const r = await call<{ accounts: unknown[] }>('POST', props.path, {
      externalIds: chosen.value,
    })
    emit('imported', r.accounts.length)
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <form class="space-y-4" novalidate @submit.prevent="submit">
    <fieldset class="min-w-0 space-y-2">
      <legend class="text-lg">{{ $t('addAccount.found') }}</legend>
      <p v-if="accounts.length === 0" class="text-(--app-text-muted)">
        {{ $t('addAccount.noneFound') }}
      </p>
      <ul v-else class="divide-y divide-(--app-border) rounded-xl border border-(--app-border)">
        <li
          v-for="a in accounts"
          :key="`${a.platform}:${a.externalId}`"
          class="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <UCheckbox
            v-if="a.state === 'to_import'"
            :model-value="chosen.includes(a.externalId)"
            :ui="{ root: 'min-h-11 items-center' }"
            @update:model-value="toggle(a.externalId, $event)"
          >
            <template #label>
              <span class="flex items-center gap-2">
                <RowAvatar :name="a.name" :src="a.avatarUrl" />
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
            </template>
          </UCheckbox>
          <p v-else class="flex min-h-11 items-center gap-2">
            <RowAvatar :name="a.name" :src="a.avatarUrl" />
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
          </p>
          <p
            v-if="a.state !== 'to_import'"
            class="text-sm"
            :class="
              a.state === 'not_importable' ? 'text-(--app-danger)' : 'text-(--app-text-muted)'
            "
          >
            {{ $t(`addAccount.state.${a.state}`) }}
          </p>
        </li>
      </ul>
    </fieldset>
    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <UButton
      v-if="importable.length > 0"
      type="submit"
      class="min-h-11"
      :loading="sending"
      :disabled="chosen.length === 0"
    >
      {{
        chosen.length === 0
          ? $t('addAccount.chooseSome')
          : $t('addAccount.import', { n: chosen.length }, chosen.length)
      }}
    </UButton>
  </form>
</template>
