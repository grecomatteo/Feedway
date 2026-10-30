<script setup lang="ts">
interface Passkey {
  id: string
  name: string | null
  createdAt: string | null
}

const props = defineProps<{
  passkeys: Passkey[]
  /** The role requires 2FA and this is the only factor left. */
  lastFactor: boolean
  withReauth: WithReauth
}>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { call, failure } = useApi()
const passkey = usePasskey()

const sending = ref<string | null>(null)
const problem = ref<string | null>(null)
const done = ref<string | null>(null)
const renaming = ref<string | null>(null)
const newName = ref('')

const label = (p: Passkey) => p.name ?? t('security.passkeys.unnamed')

async function run(key: string, action: () => Promise<void>, success: string) {
  sending.value = key
  problem.value = null
  done.value = null
  try {
    await action()
    done.value = success
    emit('changed')
  } catch (e) {
    if (e instanceof ReauthCancelled) return
    problem.value =
      e instanceof DOMException ? t('security.passkeys.cancelled') : failure(e).message
  } finally {
    sending.value = null
  }
}

const add = () =>
  run(
    'add',
    () => passkey.register(t('security.passkeys.defaultName')),
    t('security.passkeys.added'),
  )

function startRename(p: Passkey) {
  renaming.value = p.id
  newName.value = p.name ?? ''
}
const saveRename = (p: Passkey) =>
  run(
    p.id,
    async () => {
      await call('POST', '/api/auth/passkey/update-passkey', {
        id: p.id,
        name: newName.value.trim(),
      })
      renaming.value = null
    },
    t('security.passkeys.renamed'),
  )
const remove = (p: Passkey) =>
  run(
    p.id,
    () =>
      props.withReauth(async () => {
        await call('POST', '/api/auth/passkey/delete-passkey', { id: p.id })
      }),
    t('security.passkeys.removed'),
  )
</script>

<template>
  <section
    aria-labelledby="security-passkeys"
    class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
  >
    <h2 id="security-passkeys" class="text-lg">{{ $t('security.passkeys.title') }}</h2>
    <p class="text-sm text-(--app-text-muted)">{{ $t('security.passkeys.explain') }}</p>

    <p v-if="props.passkeys.length === 0">{{ $t('security.passkeys.empty') }}</p>
    <ul v-else class="divide-y divide-(--app-border)" :aria-label="$t('security.passkeys.title')">
      <li
        v-for="p in props.passkeys"
        :key="p.id"
        class="flex flex-wrap items-center justify-between gap-3 py-3"
      >
        <form
          v-if="renaming === p.id"
          class="flex w-full flex-wrap items-end gap-3"
          novalidate
          @submit.prevent="saveRename(p)"
        >
          <UFormField
            :label="$t('security.passkeys.name')"
            :name="`passkey-name-${p.id}`"
            class="grow"
          >
            <UInput v-model="newName" maxlength="60" class="w-full" size="xl" />
          </UFormField>
          <UButton type="submit" class="min-h-11" :loading="sending === p.id">
            {{ $t('account.save') }}
          </UButton>
          <UButton class="min-h-11" color="neutral" variant="ghost" @click="renaming = null">
            {{ $t('security.cancel') }}
          </UButton>
        </form>
        <template v-else>
          <div>
            <p class="font-semibold">{{ label(p) }}</p>
            <p v-if="p.createdAt" class="text-sm text-(--app-text-muted)">
              {{ $t('security.passkeys.created', { date: formatDate(p.createdAt) }) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              class="min-h-11"
              color="neutral"
              variant="outline"
              :aria-label="$t('security.passkeys.renameOf', { name: label(p) })"
              @click="startRename(p)"
            >
              {{ $t('security.passkeys.rename') }}
            </UButton>
            <UButton
              class="min-h-11"
              color="error"
              variant="outline"
              :loading="sending === p.id"
              :disabled="props.lastFactor"
              :aria-label="$t('security.passkeys.removeOf', { name: label(p) })"
              :aria-describedby="props.lastFactor ? 'last-factor-passkey' : undefined"
              @click="remove(p)"
            >
              {{ $t('security.passkeys.remove') }}
            </UButton>
          </div>
        </template>
      </li>
    </ul>
    <p
      v-if="props.lastFactor && props.passkeys.length > 0"
      id="last-factor-passkey"
      class="text-sm text-(--app-text-muted)"
    >
      {{ $t('security.lastFactor') }}
    </p>

    <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
    <p v-if="done" role="status" class="text-(--app-success)">{{ done }}</p>

    <UButton
      v-if="passkey.supported()"
      class="min-h-11"
      icon="i-lucide-fingerprint"
      :loading="sending === 'add'"
      @click="add"
    >
      {{ $t('security.passkeys.add') }}
    </UButton>
    <p v-else class="text-sm text-(--app-text-muted)">{{ $t('security.passkeys.unsupported') }}</p>
  </section>
</template>
