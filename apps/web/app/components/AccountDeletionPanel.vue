<script setup lang="ts">
/**
 * "Elimina il mio account" (spec §15.7): the person types their email, then confirms with the
 * password or a passkey. An Owner passes the agency to an Admin first (the server says so too).
 */
import type { Me } from '@app/contracts'

const props = defineProps<{ me: Me | null }>()

const { call, failure } = useApi()
const session = useSession()

const confirming = ref(false)
const typed = ref('')
const sending = ref(false)
const problem = ref<string | null>(null)

const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()
const { data: factors } = useFetch<{ passkeys: unknown[] }>('/api/v1/me/second-factor', {
  key: 'second-factor',
  server: false,
  lazy: true,
})

const { t } = useI18n()

/** Why the account cannot go from here: an agency without its Owner, or the platform's admin. */
const blocked = computed(() => {
  const owned = props.me?.organizations.find((o) => o.role === 'owner')
  if (owned) return t('accountDeletion.owner', { agency: owned.name })
  if (props.me?.platformRole === 'admin') return t('accountDeletion.platformAdmin')
  return null
})
const matches = computed(
  () =>
    props.me !== null && typed.value.trim().toLowerCase() === props.me.email.trim().toLowerCase(),
)

watch(confirming, (value) => {
  if (value) {
    typed.value = ''
    problem.value = null
  }
})

async function remove() {
  sending.value = true
  problem.value = null
  try {
    await withReauth(async () => {
      await call('DELETE', '/api/v1/me')
    })
    confirming.value = false
    session.forget()
    await navigateTo('/account-eliminato')
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) problem.value = failure(e).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section
    aria-labelledby="account-deletion-heading"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 id="account-deletion-heading" class="text-lg">{{ $t('accountDeletion.heading') }}</h2>
    <p class="text-sm">{{ $t('accountDeletion.now') }}</p>
    <p class="text-sm">{{ $t('accountDeletion.stays') }}</p>
    <p class="text-sm font-semibold">{{ $t('accountDeletion.final') }}</p>

    <p v-if="blocked" class="flex items-start gap-2 text-sm">
      <UIcon name="i-lucide-info" class="mt-0.5 shrink-0" aria-hidden="true" />
      {{ blocked }}
    </p>
    <UButton
      v-else
      class="min-h-11"
      color="error"
      variant="outline"
      icon="i-lucide-user-x"
      :disabled="me === null"
      @click="confirming = true"
    >
      {{ $t('accountDeletion.start') }}
    </UButton>

    <UModal
      v-model:open="confirming"
      :title="$t('accountDeletion.confirmTitle')"
      :description="$t('accountDeletion.confirmExplain')"
    >
      <template #body>
        <form class="space-y-4" novalidate @submit.prevent="remove">
          <UFormField
            :label="$t('accountDeletion.typeEmail', { email: me?.email ?? '' })"
            name="confirm-email"
            :error="problem ?? undefined"
          >
            <UInput
              v-model="typed"
              type="email"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap gap-3">
            <UButton
              type="submit"
              class="min-h-11"
              color="error"
              :loading="sending"
              :disabled="!matches"
            >
              {{ $t('accountDeletion.confirm') }}
            </UButton>
            <UButton class="min-h-11" color="neutral" variant="ghost" @click="confirming = false">
              {{ $t('security.cancel') }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <ReauthDialog
      v-model:open="reauthOpen"
      :passkeys="factors?.passkeys.length ?? 0"
      @done="reauthDone"
    />
  </section>
</template>
