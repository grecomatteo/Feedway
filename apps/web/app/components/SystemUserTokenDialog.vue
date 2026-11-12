<script setup lang="ts">
/**
 * The system user's token (spec §8.1 step 4, §8.3): to connect it, "Sostituisci token" and
 * "Ricollega". The new token is checked by Meta before it is saved, the old one keeps working
 * until then. Needs a recent confirmation (withReauth of the page). The token is never shown
 * again. `done` also carries the connection and the accounts it sees, for the import.
 */
import type { ImportableAccount } from '@app/contracts'

interface PermissionCheck {
  name: string
  granted: boolean
}
type Outcome = 'connected' | 'replaced' | 'permissions_missing'
export interface TokenSaved {
  connection: { id: string }
  accounts: ImportableAccount[]
}

const props = defineProps<{ withReauth: WithReauth; path: string; title: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  done: [outcome: Exclude<Outcome, 'permissions_missing'>, saved: TokenSaved]
}>()
const { call, failure } = useApi()

const token = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)
const missing = ref<PermissionCheck[] | null>(null)
watch(open, (v) => {
  if (v) {
    token.value = ''
    problem.value = null
    missing.value = null
  }
})

async function confirm() {
  sending.value = true
  problem.value = null
  missing.value = null
  try {
    await props.withReauth(async () => {
      const r = await call<{
        outcome: Outcome
        permissions: PermissionCheck[]
        connection: { id: string } | null
        accounts: ImportableAccount[]
      }>('POST', props.path, { token: token.value.trim() })
      token.value = ''
      if (r.outcome === 'permissions_missing' || r.connection === null) {
        missing.value = r.permissions
        return
      }
      open.value = false
      emit('done', r.outcome, { connection: r.connection, accounts: r.accounts })
    })
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="$t('metaToken.explain')">
    <template #body>
      <form class="space-y-4" novalidate @submit.prevent="confirm">
        <UFormField
          :label="$t('metaToken.token')"
          :help="$t('metaToken.tokenHelp')"
          name="system-user-token"
          required
          :error="problem ?? undefined"
        >
          <UInput
            v-model="token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <div v-if="missing" role="alert" class="space-y-2">
          <p class="text-(--app-danger)">{{ $t('metaToken.permissionsMissing') }}</p>
          <ul class="space-y-1" :aria-label="$t('metaToken.permissions')">
            <li v-for="p in missing" :key="p.name" class="flex items-center gap-2 text-sm">
              <UIcon
                :name="p.granted ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :class="p.granted ? 'text-(--app-success)' : 'text-(--app-danger)'"
                aria-hidden="true"
              />
              <code>{{ p.name }}</code>
              <span class="sr-only">{{
                p.granted ? $t('metaToken.granted') : $t('metaToken.notGranted')
              }}</span>
            </li>
          </ul>
        </div>
        <div class="flex flex-wrap gap-3">
          <UButton
            type="submit"
            class="min-h-11"
            :loading="sending"
            :disabled="token.trim() === ''"
          >
            {{ $t('metaToken.confirm') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="open = false">
            {{ $t('security.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
