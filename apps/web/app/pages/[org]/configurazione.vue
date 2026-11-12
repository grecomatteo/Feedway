<script setup lang="ts">
import type { ImportableAccount, MetaIntegration } from '@app/contracts'
import { META_REQUIRED_PERMISSIONS } from '@app/domain/platforms/meta'
import type { TokenSaved } from '~/components/SystemUserTokenDialog.vue'

definePageMeta({ layout: 'agency' })

/**
 * «Prima configurazione» (spec §8.1, plan 03 Task 12): the five steps of the system user,
 * Owner only. It can stop anywhere: where it is comes from the data (the app saved, a system
 * user connected, accounts imported), so nothing is stored. Steps 2 and 3 happen on Meta and
 * cannot be checked here: the Owner says they are done.
 */
type Step = 1 | 2 | 3 | 4 | 5

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('firstSetup.title') })
if (!org.may.value.editSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const setup = useFirstSetup()
const STEPS = [1, 2, 3, 4, 5] as const

/** The step the Owner looks at; null follows the data. */
const viewing = ref<Step | null>(null)
/** How far the Owner went in the steps the data cannot see (2 to 4). */
const walked = ref<Step>(2)
const reached = computed<Step | 6 | null>(() => {
  const s = setup.step.value
  if (s === null) return null
  return s === 2 ? walked.value : s
})
const shown = computed<Step | null>(() => {
  const r = reached.value
  if (r === null || r === 6) return viewing.value
  return viewing.value !== null && viewing.value <= r ? viewing.value : r
})
const stateOf = (s: Step) => {
  const r = reached.value
  if (r === null) return 'todo'
  return s < r ? 'done' : s === r ? 'current' : 'todo'
}

function goTo(s: Step) {
  viewing.value = s
}
function next(from: 2 | 3) {
  walked.value = from === 2 ? 3 : 4
  viewing.value = null
}

function appSaved(integration: MetaIntegration) {
  setup.app.data.value = { integration }
  viewing.value = null
}

const businessId = computed(() => setup.integration.value?.businessId ?? null)
const systemUsersUrl = computed(() => metaBusinessUrl('system-users', businessId.value))

const tokenOpen = ref(false)
const found = ref<ImportableAccount[] | null>(null)
const search = reactive({ sending: false, problem: '' })
async function tokenDone(_outcome: 'connected' | 'replaced', saved: TokenSaved) {
  found.value = saved.accounts
  viewing.value = null
  await setup.refresh()
}
async function findAccounts() {
  const id = setup.systemUser.value?.id
  if (!id) return
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
async function imported() {
  viewing.value = null
  await Promise.all([setup.refresh(), refreshNuxtData(`accounts-${org.slug.value}`)])
}

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('firstSetup.title') }}</h1>
      <p class="text-(--app-text-muted)">{{ $t('firstSetup.explain') }}</p>
    </header>

    <div v-if="setup.error.value" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('account.loadError') }}
      </p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => setup.refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>
    <p v-else-if="reached === null" role="status">{{ $t('account.loading') }}</p>

    <template v-else>
      <nav :aria-label="$t('firstSetup.progress')">
        <ol :aria-label="$t('firstSetup.steps')" class="grid gap-2 sm:grid-cols-5">
          <li
            v-for="s in STEPS"
            :key="s"
            :aria-current="shown === s ? 'step' : undefined"
            class="border-t-4 pt-2"
            :class="
              stateOf(s) === 'done'
                ? 'border-(--app-text)'
                : shown === s || stateOf(s) === 'current'
                  ? 'border-(--app-brand)'
                  : 'border-(--app-border)'
            "
          >
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2 text-left text-sm disabled:text-(--app-text-muted)"
              :class="shown === s ? 'font-semibold' : undefined"
              :disabled="stateOf(s) === 'todo'"
              @click="goTo(s)"
            >
              <UIcon
                :name="stateOf(s) === 'done' ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                class="size-4 shrink-0"
                :class="stateOf(s) === 'done' ? 'text-(--app-success)' : undefined"
                aria-hidden="true"
              />
              <span>
                {{ s }}. {{ $t(`firstSetup.step${s}.title`) }}
                <span class="sr-only">{{ $t(`firstSetup.state.${stateOf(s)}`) }}</span>
              </span>
            </button>
          </li>
        </ol>
      </nav>

      <section
        v-if="reached === 6 && shown === null"
        aria-labelledby="setup-done"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="setup-done" class="text-lg">{{ $t('firstSetup.done.title') }}</h2>
        <p>{{ $t('firstSetup.done.text') }}</p>
        <div class="flex flex-wrap gap-3">
          <UButton :to="org.to('/spazi')" class="min-h-11" icon="i-lucide-briefcase">
            {{ $t('firstSetup.done.workspaces') }}
          </UButton>
          <UButton
            :to="org.to('/account')"
            class="min-h-11"
            color="neutral"
            variant="outline"
            icon="i-lucide-at-sign"
          >
            {{ $t('firstSetup.done.accounts') }}
          </UButton>
        </div>
      </section>

      <section
        v-else-if="shown !== null"
        aria-labelledby="setup-step"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="setup-step" class="text-lg">
          {{ $t(`firstSetup.step${shown}.title`) }}
        </h2>

        <template v-if="shown === 1">
          <ol class="list-decimal space-y-2 pl-5">
            <li>{{ $t('metaIntegration.guide.create') }}</li>
            <li>{{ $t('metaIntegration.guide.copy') }}</li>
          </ol>
          <MetaAppForm
            :integration="setup.integration.value"
            editable
            :with-reauth="withReauth"
            @update:integration="appSaved"
          />
        </template>

        <template v-else-if="shown === 2">
          <ol class="list-decimal space-y-2 pl-5">
            <li>
              {{ $t('addAccount.assign.open') }}
              <a :href="systemUsersUrl" target="_blank" rel="noopener noreferrer" class="underline">
                {{ $t('addAccount.assign.systemUsers') }}
                <span class="sr-only">{{ $t('addAccount.newTab') }}</span>
              </a>
            </li>
            <li>{{ $t('firstSetup.step2.add') }}</li>
            <li>{{ $t('firstSetup.step2.app') }}</li>
          </ol>
          <UButton class="min-h-11" icon="i-lucide-arrow-right" @click="next(2)">
            {{ $t('firstSetup.next') }}
          </UButton>
        </template>

        <template v-else-if="shown === 3">
          <ol class="list-decimal space-y-2 pl-5">
            <li>{{ $t('addAccount.assign.assets') }}</li>
            <li>{{ $t('addAccount.assign.full') }}</li>
            <li>{{ $t('firstSetup.step3.clients') }}</li>
          </ol>
          <UButton class="min-h-11" icon="i-lucide-arrow-right" @click="next(3)">
            {{ $t('firstSetup.next') }}
          </UButton>
        </template>

        <template v-else-if="shown === 4">
          <p>{{ $t('firstSetup.step4.explain') }}</p>
          <ul class="space-y-1" :aria-label="$t('metaToken.permissions')">
            <li v-for="p in META_REQUIRED_PERMISSIONS" :key="p" class="text-sm">
              <code>{{ p }}</code>
            </li>
          </ul>
          <p class="text-sm text-(--app-text-muted)">{{ $t('firstSetup.step4.never') }}</p>
          <UButton class="min-h-11" icon="i-lucide-key-round" @click="tokenOpen = true">
            {{ $t('firstSetup.step4.paste') }}
          </UButton>
        </template>

        <template v-else-if="shown === 5">
          <p>{{ $t('firstSetup.step5.explain') }}</p>
          <UButton
            class="min-h-11"
            icon="i-lucide-search"
            :color="found === null ? 'primary' : 'neutral'"
            :variant="found === null ? 'solid' : 'outline'"
            :loading="search.sending"
            @click="findAccounts"
          >
            {{ $t('addAccount.search') }}
          </UButton>
          <p v-if="search.problem" role="alert" class="text-(--app-danger)">{{ search.problem }}</p>
          <ImportAccountsChooser
            v-if="found !== null && setup.systemUser.value"
            :accounts="found"
            :path="org.api(`/connections/${setup.systemUser.value.id}/import`)"
            @imported="imported"
          />
        </template>
      </section>

      <SystemUserTokenDialog
        v-model:open="tokenOpen"
        :title="$t('firstSetup.step4.paste')"
        :with-reauth="withReauth"
        :path="org.api('/connections/system-user')"
        @done="tokenDone"
      />
      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
