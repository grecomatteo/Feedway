<script setup lang="ts">
import type { MetaIntegration, MetaReminder } from '@app/contracts'
import MetaConnections from '~/components/MetaConnections.vue'

/**
 * Impostazioni → Integrazioni → Meta (spec §8.3, plan 04 Task 6c): the agency's Meta app (only the
 * Owner changes it, the Admin reads it), then what Owner and Admin manage (§10.2): the reminders,
 * the connections, the profiles and «Aggiungi account». `?account=` comes from «Ricollega».
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const route = useRoute()
const context = useContextQuery()
const { t } = useI18n()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('metaIntegration.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const editable = computed(() => org.may.value.editSettings)
const focusAccount = computed(() => {
  const a = route.query['account']
  return typeof a === 'string' ? a : null
})

const { data, status, error, refresh } = useFetch<{ integration: MetaIntegration | null }>(
  () => org.api('/integrations/meta'),
  { key: () => `meta-integration-${org.slug.value}`, server: false, lazy: true },
)
const integration = computed(() => data.value?.integration ?? null)

// the reminders are a notice on top, for who manages the connections (§8.4)
const { data: reminders, status: remindersStatus } = useFetch<{ items: MetaReminder[] }>(
  () => org.api('/accounts/reminders'),
  {
    key: () => `meta-reminders-${org.slug.value}`,
    server: false,
    lazy: true,
    immediate: org.may.value.manageAccounts,
  },
)

/** What sits above the connections is in: a connection brought into view stays there. */
const settled = (s: string) => s !== 'pending' && s !== 'idle'
const aboveReady = computed(
  () => settled(status.value) && (!org.may.value.manageAccounts || settled(remindersStatus.value)),
)

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
const guideSteps = ['create', 'copy', 'checkup'] as const

/** The state beside «Meta»: works, refused, still to try, or not set up. */
const state = computed(() => {
  const i = integration.value
  if (!i) return { tone: 'neutral' as const, label: t('metaIntegration.notConfigured') }
  if (i.rejectedAt) return { tone: 'danger' as const, label: t('metaIntegration.rejected') }
  if (i.verifiedAt) return { tone: 'success' as const, label: t('metaIntegration.verified') }
  return { tone: 'neutral' as const, label: t('metaIntegration.notVerified') }
})
/** The app's form opens in a window once the app exists (screen 25: «Sostituisci»). */
const editing = ref(false)
/** Saved: the form gives way to the rows (or the window closes), so the page says it. */
const saved = ref(false)
function integrationSaved(value: MetaIntegration) {
  data.value = { integration: value }
}
function appSaved() {
  saved.value = true
  editing.value = false
}
watch(editing, (open) => {
  if (open) saved.value = false
})
</script>

<template>
  <SettingsShell wide :data-ready="aboveReady || undefined">
    <div class="-mb-4">
      <NuxtLink
        :to="{ path: org.to('/impostazioni/integrazioni'), query: context }"
        class="mb-2 inline-flex items-center gap-1.5 text-detail text-(--app-text-muted) hover:text-(--app-text)"
      >
        <UIcon name="i-lucide-arrow-left" class="size-3.5" aria-hidden="true" />
        {{ $t('integrations.back') }}
      </NuxtLink>
      <div class="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-3">
        <h2 class="font-display text-lg font-semibold tracking-[-0.01em]">
          {{ $t('metaIntegration.title') }}
        </h2>
        <StatusDot
          v-if="data"
          :tone="state.tone"
          :label="state.label"
          class="ms-2 text-(--app-text)"
          data-testid="meta-integration-state"
        />
        <span class="flex-1" />
        <UButton
          v-if="org.may.value.manageAccounts"
          :to="{ path: org.to('/impostazioni/integrazioni/meta/aggiungi'), query: context }"
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
        >
          {{ $t('socialAccounts.add') }}
        </UButton>
      </div>
    </div>

    <MetaReminders :items="reminders?.items ?? []" />

    <component
      :is="org.may.value.manageAccounts ? MetaConnections : 'div'"
      v-bind="
        org.may.value.manageAccounts
          ? { withReauth, focusAccount: aboveReady ? focusAccount : null }
          : { class: 'contents' }
      "
    >
      <SettingsGroup :title="$t('metaIntegration.app')">
        <template #aside>
          <p v-if="saved" role="status" class="text-detail text-(--app-success)">
            {{ $t('metaIntegration.saved') }}
          </p>
        </template>
        <div
          v-if="!data && !error && (status === 'pending' || status === 'idle')"
          role="status"
          class="px-4 py-3"
        >
          {{ $t('account.loading') }}
        </div>
        <div v-else-if="error" role="alert" class="space-y-3 px-4 py-3">
          <p class="flex items-center gap-2 text-(--app-danger)">
            <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
            {{ $t('account.loadError') }}
          </p>
          <UButton color="neutral" variant="outline" @click="() => refresh()">
            {{ $t('account.retry') }}
          </UButton>
        </div>
        <template v-else-if="integration">
          <SettingsRow :label="$t('metaIntegration.appIdRow')">
            <span class="tabular-nums">{{ integration.appId }}</span>
          </SettingsRow>
          <SettingsRow :label="$t('metaIntegration.secret')">
            <span class="text-(--app-text-muted)">{{
              $t('metaIntegration.secretSaved', { when: formatDate(integration.updatedAt) })
            }}</span>
            <UButton
              v-if="editable"
              color="neutral"
              variant="outline"
              size="sm"
              :aria-label="$t('metaIntegration.edit')"
              @click="editing = true"
            >
              {{ $t('metaIntegration.replace') }}
            </UButton>
          </SettingsRow>
          <SettingsRow v-if="integration.businessId" :label="$t('metaIntegration.businessId')">
            <span class="tabular-nums">{{ integration.businessId }}</span>
          </SettingsRow>
          <SettingsRow
            v-if="integration.dataUseCheckupDueOn"
            :label="$t('metaIntegration.dataUseCheckup')"
          >
            {{ formatDate(integration.dataUseCheckupDueOn) }}
          </SettingsRow>
          <p
            v-if="integration.rejectedAt"
            role="alert"
            class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
          >
            {{
              $t('metaIntegration.rejectedAt', {
                when: formatDate(integration.rejectedAt, { time: true }),
              })
            }}
          </p>
        </template>
        <div v-else class="space-y-4 p-4">
          <p class="text-detail text-(--app-text-muted)">{{ $t('metaIntegration.explain') }}</p>
          <EmptyState
            v-if="!editable"
            icon="i-lucide-plug"
            :title="$t('metaIntegration.emptyTitle')"
            :text="$t('metaIntegration.emptyAdmin')"
          />
          <MetaAppForm
            v-else
            :integration="null"
            :editable="editable"
            :with-reauth="withReauth"
            @update:integration="integrationSaved"
            @saved="appSaved"
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        v-if="data && !integration && editable"
        :title="$t('metaIntegration.guide.title')"
      >
        <div class="space-y-3 p-4">
          <ol class="list-decimal space-y-2 pl-5">
            <li v-for="step in guideSteps" :key="step">
              {{ $t(`metaIntegration.guide.${step}`) }}
            </li>
          </ol>
          <p class="rounded-md bg-(--app-surface-sunken) p-3">
            {{ $t('metaIntegration.guide.pagePermissions') }}
          </p>
        </div>
      </SettingsGroup>
    </component>

    <UModal
      v-model:open="editing"
      :title="$t('metaIntegration.edit')"
      :description="$t('metaIntegration.explain')"
      :close="false"
      :ui="DIALOG_UI"
    >
      <template #body>
        <div class="grid gap-4">
          <p class="text-detail text-(--app-text-muted)">
            {{ $t('metaIntegration.explain') }}
            <template v-if="integration">
              {{ $t('metaIntegration.updatedAt', { when: formatRelative(integration.updatedAt) }) }}
              <template v-if="integration.verifiedAt">{{
                $t('metaIntegration.verifiedAt', {
                  when: formatDate(integration.verifiedAt, { time: true }),
                })
              }}</template>
            </template>
          </p>
          <MetaAppForm
            :integration="integration"
            :editable="editable"
            :with-reauth="withReauth"
            @update:integration="integrationSaved"
            @saved="appSaved"
          />
        </div>
      </template>
      <template #footer>
        <UButton
          class="max-md:flex-1 max-md:justify-center"
          color="neutral"
          variant="outline"
          @click="editing = false"
        >
          {{ $t('accountDeletion.close') }}
        </UButton>
      </template>
    </UModal>

    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </SettingsShell>
</template>
