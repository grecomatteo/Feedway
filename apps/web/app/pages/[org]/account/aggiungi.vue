<script setup lang="ts">
import type { ImportableAccount, MetaIntegration } from '@app/contracts'
import type { TokenSaved } from '~/components/SystemUserTokenDialog.vue'

definePageMeta({ layout: 'agency' })

/**
 * «Aggiungi account» (spec §8.2, RF-03): it starts from "is the account already in your Business
 * Manager?". Every way ends with the system user seeing it, then the accounts to import. The
 * unified login waits for the public version (plan 03, Task 7).
 */
type Answer = 'own' | 'client' | 'personal'
type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('addAccount.title') })
if (!org.may.value.manageAccounts)
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const {
  data: app,
  status: appStatus,
  error: appError,
  refresh: refreshApp,
} = useFetch<{ integration: MetaIntegration | null }>(() => org.api('/integrations/meta'), {
  key: () => `meta-integration-${org.slug.value}`,
  server: false,
  lazy: true,
})
const integration = computed(() => app.value?.integration ?? null)
const businessId = computed(() => integration.value?.businessId ?? null)

// the system users connected, a new one without accounts too
const {
  data: connections,
  status: connectionsStatus,
  error: connectionsError,
  refresh: refreshConnections,
} = useFetch<{
  items: { id: string; kind: string; status: ConnectionStatus; createdAt: string }[]
}>(() => org.api('/connections'), {
  key: () => `connections-${org.slug.value}`,
  server: false,
  lazy: true,
})
const systemUsers = computed(() =>
  (connections.value?.items ?? []).filter(
    (c) => c.kind === 'meta_system_user' && (c.status === 'active' || c.status === 'pending'),
  ),
)
const chosenConnection = ref<string | null>(null)
const connectionId = computed(
  () =>
    systemUsers.value.find((c) => c.id === chosenConnection.value)?.id ??
    systemUsers.value[0]?.id ??
    null,
)
const connectionItems = computed(() =>
  systemUsers.value.map((c) => ({
    label: t('addAccount.systemUserSince', { when: formatDate(c.createdAt) }),
    value: c.id,
  })),
)

const answer = ref<Answer | undefined>(undefined)
const answers = computed(() =>
  (['own', 'client', 'personal'] as const).map((value) => ({
    value,
    label: t(`addAccount.answer.${value}`),
    description: t(`addAccount.answerHelp.${value}`),
  })),
)

const agencyName = computed(() => org.organization.value?.name ?? '')
const clientMessage = computed(() =>
  t('addAccount.client.message', {
    agency: agencyName.value,
    businessId: businessId.value ?? t('addAccount.client.businessIdMissing'),
  }),
)
const systemUsersUrl = computed(() => metaBusinessUrl('system-users', businessId.value))

const found = ref<ImportableAccount[] | null>(null)
const search = reactive({ sending: false, problem: '' })
const imported = ref<number | null>(null)

async function findAccounts() {
  const id = connectionId.value
  if (id === null) return
  Object.assign(search, { sending: true, problem: '' })
  try {
    const r = await call<{ accounts: ImportableAccount[] }>(
      'GET',
      org.api(`/connections/${id}/importable`),
    )
    found.value = r.accounts
  } catch (e) {
    search.problem = failure(e).message
  } finally {
    search.sending = false
  }
}

// another system user sees other accounts: what was found belongs to the previous one
function chooseConnection(id: string) {
  chosenConnection.value = id
  found.value = null
  imported.value = null
  search.problem = ''
}

const tokenOpen = ref(false)
async function tokenDone(_outcome: 'connected' | 'replaced', saved: TokenSaved) {
  await refreshConnections()
  chosenConnection.value = saved.connection.id
  imported.value = null
  found.value = saved.accounts
}

function searchAgain() {
  imported.value = null
  return findAccounts()
}

async function importedDone(count: number) {
  imported.value = count
  // what was just imported shows as such, and the list of the accounts page is fresh
  await Promise.all([
    findAccounts(),
    refreshConnections(),
    refreshNuxtData(`accounts-${org.slug.value}`),
  ])
}

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <div class="space-y-6">
    <NuxtLink
      :to="org.to('/account')"
      class="inline-flex min-h-11 items-center gap-1 text-sm underline"
    >
      <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
      {{ $t('addAccount.back') }}
    </NuxtLink>
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('addAccount.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('addAccount.explain') }}</p>
    </header>

    <p v-if="!app && !appError && (appStatus === 'pending' || appStatus === 'idle')" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="appError" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('account.loadError') }}
      </p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refreshApp()">
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <EmptyState
      v-else-if="integration === null"
      icon="i-lucide-plug"
      :title="$t('addAccount.noApp')"
      :text="org.may.value.editSettings ? $t('addAccount.noAppOwner') : $t('addAccount.noAppAdmin')"
    >
      <NuxtLink
        v-if="org.may.value.editSettings"
        :to="org.to('/impostazioni/integrazioni')"
        class="underline"
      >
        {{ $t('addAccount.noAppLink') }}
      </NuxtLink>
    </EmptyState>

    <template v-else>
      <section
        aria-labelledby="add-question"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="add-question" class="text-lg">{{ $t('addAccount.question') }}</h2>
        <URadioGroup
          v-model="answer"
          :items="answers"
          :aria-label="$t('addAccount.question')"
          :ui="{ item: 'min-h-11' }"
        />
      </section>

      <section
        v-if="answer === 'personal'"
        aria-labelledby="add-personal"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="add-personal" class="text-lg">{{ $t('addAccount.personal.title') }}</h2>
        <ol class="list-decimal space-y-2 pl-5">
          <li>{{ $t('addAccount.personal.step1') }}</li>
          <li>{{ $t('addAccount.personal.step2') }}</li>
          <li>{{ $t('addAccount.personal.step3') }}</li>
        </ol>
      </section>

      <section
        v-if="answer === 'client'"
        aria-labelledby="add-client"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="add-client" class="text-lg">{{ $t('addAccount.client.title') }}</h2>
        <p>{{ $t('addAccount.client.explain') }}</p>
        <p
          v-if="businessId === null"
          class="rounded-md border border-(--app-border-strong) bg-(--app-surface-sunken) p-3"
        >
          {{
            org.may.value.editSettings
              ? $t('addAccount.client.noBusinessIdOwner')
              : $t('addAccount.client.noBusinessIdAdmin')
          }}
          <NuxtLink
            v-if="org.may.value.editSettings"
            :to="org.to('/impostazioni/integrazioni')"
            class="underline"
          >
            {{ $t('addAccount.noAppLink') }}
          </NuxtLink>
        </p>
        <CopyLinkField
          :url="clientMessage"
          :label="$t('addAccount.client.messageLabel')"
          :copied="$t('addAccount.client.copied')"
          multiline
        />
      </section>

      <section
        v-if="answer === 'own' || answer === 'client'"
        aria-labelledby="add-assign"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="add-assign" class="text-lg">
          {{
            answer === 'client'
              ? $t('addAccount.assign.titleClient')
              : $t('addAccount.assign.title')
          }}
        </h2>
        <ol class="list-decimal space-y-2 pl-5">
          <li v-if="answer === 'client'">{{ $t('addAccount.assign.accepted') }}</li>
          <li>
            {{ $t('addAccount.assign.open') }}
            <a :href="systemUsersUrl" target="_blank" rel="noopener noreferrer" class="underline">
              {{ $t('addAccount.assign.systemUsers') }}
              <span class="sr-only">{{ $t('addAccount.newTab') }}</span>
            </a>
          </li>
          <li>{{ $t('addAccount.assign.assets') }}</li>
          <li>{{ $t('addAccount.assign.full') }}</li>
          <li>{{ $t('addAccount.assign.find') }}</li>
        </ol>

        <div class="space-y-3 border-t border-(--app-border) pt-4">
          <div v-if="connectionsError" role="alert" class="space-y-3">
            <p class="text-(--app-danger)">{{ $t('addAccount.connectionsError') }}</p>
            <UButton
              class="min-h-11"
              color="neutral"
              variant="outline"
              @click="() => refreshConnections()"
            >
              {{ $t('account.retry') }}
            </UButton>
          </div>
          <p
            v-else-if="
              !connections && (connectionsStatus === 'pending' || connectionsStatus === 'idle')
            "
            role="status"
          >
            {{ $t('account.loading') }}
          </p>
          <template v-else-if="connectionId === null">
            <p>{{ $t('addAccount.noSystemUser') }}</p>
            <UButton class="min-h-11" icon="i-lucide-key-round" @click="tokenOpen = true">
              {{ $t('addAccount.connectSystemUser') }}
            </UButton>
          </template>
          <template v-else>
            <UFormField
              v-if="connectionItems.length > 1"
              :label="$t('addAccount.whichSystemUser')"
              name="connection"
            >
              <USelect
                :model-value="connectionId"
                :items="connectionItems"
                class="w-full sm:w-72"
                size="xl"
                @update:model-value="chooseConnection($event as string)"
              />
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UButton
                class="min-h-11"
                icon="i-lucide-search"
                :loading="search.sending"
                @click="searchAgain"
              >
                {{ $t('addAccount.search') }}
              </UButton>
              <UButton
                class="min-h-11"
                color="neutral"
                variant="outline"
                icon="i-lucide-key-round"
                @click="tokenOpen = true"
              >
                {{ $t('addAccount.otherSystemUser') }}
              </UButton>
            </div>
          </template>
          <p v-if="search.problem" role="alert" class="text-(--app-danger)">{{ search.problem }}</p>
        </div>

        <p v-if="imported !== null" role="status" class="text-(--app-success)">
          {{ $t('addAccount.imported', { n: imported }, imported) }}
        </p>
        <ImportAccountsChooser
          v-if="found !== null && connectionId !== null"
          :accounts="found"
          :path="org.api(`/connections/${connectionId}/import`)"
          @imported="importedDone"
        />
      </section>

      <SystemUserTokenDialog
        v-model:open="tokenOpen"
        :title="$t('addAccount.connectSystemUser')"
        :with-reauth="withReauth"
        :path="org.api('/connections/system-user')"
        @done="tokenDone"
      />
      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
