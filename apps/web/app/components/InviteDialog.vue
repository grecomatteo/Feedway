<script setup lang="ts">
/**
 * «Invita una persona» (screen 22): the email, one role and, for a role on clients, the clients it
 * works on. Admin works on every client, so it has none to choose. A window on a computer, a sheet
 * from the bottom on a phone. The invite of an Admin asks for a recent confirmation (`withReauth`).
 */
type ClientRole = 'manager' | 'publisher' | 'editor' | 'viewer'
type Role = 'admin' | ClientRole

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  clients: { id: string; name: string; photoUrl?: string | null }[]
  withReauth: WithReauth
}>()
const emit = defineEmits<{ sent: [email: string] }>()
const org = useOrganization()
const { call, failure } = useApi()
const { t } = useI18n()

const email = ref('')
const role = ref<Role>('editor')
const chosen = ref<string[]>([])
const sending = ref(false)
const problem = ref<string | null>(null)
const field = ref('')

watch(open, (v) => {
  if (!v) return
  email.value = ''
  role.value = 'editor'
  chosen.value = []
  problem.value = null
  field.value = ''
})

const ROLES: Role[] = ['admin', 'manager', 'publisher', 'editor', 'viewer']
const roles = computed(() =>
  ROLES.map((value) => ({
    value,
    label: t(`roles.${value}`),
    description: t(`users.invite.roleShort.${value}`),
  })),
)
const picked = computed(() =>
  chosen.value.map((id) => props.clients.find((c) => c.id === id)).filter((c) => c !== undefined),
)
const menu = computed(() =>
  props.clients.map((c) => ({
    type: 'checkbox' as const,
    label: c.name,
    checked: chosen.value.includes(c.id),
    onUpdateChecked: (on: boolean) => {
      chosen.value = on ? [...chosen.value, c.id] : chosen.value.filter((id) => id !== c.id)
    },
    onSelect: (e: Event) => e.preventDefault(),
  })),
)

async function submit() {
  sending.value = true
  problem.value = null
  field.value = ''
  const address = email.value.trim()
  try {
    const memberships =
      role.value === 'admin'
        ? []
        : chosen.value.map((workspaceId) => ({ workspaceId, role: role.value }))
    // inviting an Admin is sensitive: the server asks for a recent confirmation
    await props.withReauth(async () => {
      await call('POST', org.api('/invites'), {
        email: address,
        orgRole: role.value === 'admin' ? 'admin' : 'member',
        memberships,
      })
    })
    open.value = false
    emit('sent', address)
  } catch (e) {
    if (e instanceof ReauthCancelled) return
    const f = failure(e)
    problem.value = f.message
    field.value = f.field ?? ''
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('users.invite.title')"
    :description="$t('users.invite.explain')"
    :close="false"
    :ui="DIALOG_UI"
    data-invite
  >
    <template #body>
      <form id="invite" class="grid gap-4" novalidate @submit.prevent="submit">
        <UFormField
          :label="$t('signIn.email')"
          name="invite-email"
          :error="field === 'email' ? (problem ?? undefined) : undefined"
        >
          <UInput
            v-model="email"
            type="email"
            autocomplete="off"
            class="w-full"
            :ui="{ base: 'bg-(--app-surface)' }"
          />
        </UFormField>
        <fieldset class="grid min-w-0 gap-1.5">
          <legend class="mb-1.5 font-medium">{{ $t('users.invite.role') }}</legend>
          <div class="rounded-card border border-(--app-border)" role="radiogroup">
            <label
              v-for="r in roles"
              :key="r.value"
              class="flex min-h-11 cursor-pointer items-center gap-3 border-t border-(--app-border) px-3 py-1.5 first:border-t-0"
            >
              <input
                v-model="role"
                type="radio"
                name="invite-role"
                :value="r.value"
                class="peer sr-only"
              />
              <span
                aria-hidden="true"
                class="size-[18px] shrink-0 rounded-full border-[1.5px] border-(--app-field-border) bg-(--app-surface) peer-checked:border-[5.5px] peer-checked:border-(--app-text) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--app-focus)"
              />
              <span class="shrink-0">{{ r.label }}</span>
              <span class="flex-1" />
              <span class="min-w-0 text-left text-detail text-(--app-text-muted)">{{
                r.description
              }}</span>
            </label>
          </div>
        </fieldset>
        <div v-if="role !== 'admin'" class="grid min-w-0 gap-1.5">
          <p id="invite-clients" class="font-medium">{{ $t('users.invite.clients') }}</p>
          <p v-if="clients.length === 0" class="text-detail text-(--app-text-muted)">
            {{ $t('users.invite.noClients') }}
          </p>
          <div
            v-else
            class="flex flex-wrap items-center gap-2"
            role="group"
            aria-labelledby="invite-clients"
          >
            <span
              v-for="c in picked"
              :key="c.id"
              class="inline-flex h-6 items-center gap-1.5 rounded-[6px] border border-(--app-border-strong) bg-(--app-surface) pr-2 pl-1 text-detail"
              data-invite-client
            >
              <Avatar :name="c.name" :src="c.photoUrl" :size="18" />
              {{ c.name }}
            </span>
            <UDropdownMenu :items="menu" :content="{ align: 'start' }">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-plus"
                :aria-label="$t('users.invite.addClient')"
              >
                {{ $t('users.invite.add') }}
              </UButton>
            </UDropdownMenu>
          </div>
        </div>
        <p v-if="problem && field !== 'email'" role="alert" class="text-(--app-danger)">
          {{ problem }}
        </p>
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
        form="invite"
        icon="i-lucide-mail"
        class="max-md:flex-1 max-md:justify-center"
        :loading="sending"
      >
        {{ $t('users.invite.send') }}
      </UButton>
    </template>
  </UModal>
</template>
