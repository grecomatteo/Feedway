<script setup lang="ts">
import type { MetaIntegration } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

definePageMeta({ layout: 'agency' })

type TestResult = 'verified' | 'not_configured' | 'rejected' | 'unavailable'

const org = useOrganization()
const { t } = useI18n()
const { call, failure } = useApi()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('metaIntegration.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const editable = computed(() => org.may.value.editSettings)

const { data, status, error, refresh } = useFetch<{ integration: MetaIntegration | null }>(
  () => org.api('/integrations/meta'),
  { key: () => `meta-integration-${org.slug.value}`, server: false, lazy: true },
)
const integration = computed(() => data.value?.integration ?? null)

const form = reactive({ appId: '', appSecret: '', businessId: '', dataUseCheckupDueOn: '' })
watch(
  integration,
  (i) => {
    Object.assign(form, {
      appId: i?.appId ?? '',
      appSecret: '',
      businessId: i?.businessId ?? '',
      dataUseCheckupDueOn: i?.dataUseCheckupDueOn ?? '',
    })
  },
  { immediate: true },
)

const FIELDS = ['appId', 'appSecret', 'businessId', 'dataUseCheckupDueOn']
const save = reactive({ sending: false, failure: null as ApiFailure | null, done: false })
const fieldError = (field: string) =>
  save.failure?.field === field ? save.failure.message : undefined
const saveError = computed(() =>
  save.failure && !FIELDS.includes(save.failure.field ?? '') ? save.failure.message : null,
)
const optional = (value: string) => (value.trim() === '' ? null : value.trim())

async function submit() {
  Object.assign(save, { sending: true, failure: null, done: false })
  test.result = null
  try {
    await withReauth(async () => {
      data.value = await call<{ integration: MetaIntegration }>(
        'PUT',
        org.api('/integrations/meta'),
        {
          appId: form.appId.trim(),
          ...(form.appSecret.trim() === '' ? {} : { appSecret: form.appSecret }),
          // the unified login waits for the public version (plan 03, Task 7): kept as stored
          configId: integration.value?.configId ?? null,
          businessId: optional(form.businessId),
          dataUseCheckupDueOn: optional(form.dataUseCheckupDueOn),
        },
      )
      form.appSecret = ''
      save.done = true
    })
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) save.failure = failure(e)
  } finally {
    save.sending = false
  }
}

const test = reactive({ sending: false, result: null as TestResult | null, problem: '' })
async function runTest() {
  Object.assign(test, { sending: true, result: null, problem: '' })
  save.done = false
  try {
    const r = await call<{ ok: boolean; result: TestResult }>(
      'POST',
      org.api('/integrations/meta/test'),
    )
    test.result = r.result
    if (r.ok) await refresh()
  } catch (e) {
    test.problem = failure(e).message
  } finally {
    test.sending = false
  }
}

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
const guideSteps = ['create', 'copy', 'checkup'] as const
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-3xl">{{ $t('orgSettings.title') }}</h1>
      <p v-if="!editable" class="text-(--app-text-muted)">{{ $t('orgSettings.ownerOnly') }}</p>
    </header>
    <SettingsTabs />

    <p v-if="status === 'pending' || status === 'idle'" role="status">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="error" role="alert" class="space-y-3">
      <p class="flex items-center gap-2 text-(--app-danger)">
        <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
        {{ $t('account.loadError') }}
      </p>
      <UButton class="min-h-11" color="neutral" variant="outline" @click="() => refresh()">
        {{ $t('account.retry') }}
      </UButton>
    </div>

    <template v-else>
      <section
        aria-labelledby="meta-integration"
        class="space-y-4 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="meta-integration" class="text-lg">{{ $t('metaIntegration.title') }}</h2>
          <UBadge
            :color="integration?.verifiedAt ? 'success' : 'neutral'"
            variant="subtle"
            data-testid="meta-integration-state"
          >
            {{
              integration
                ? integration.verifiedAt
                  ? $t('metaIntegration.verified')
                  : $t('metaIntegration.notVerified')
                : $t('metaIntegration.notConfigured')
            }}
          </UBadge>
        </div>
        <p class="text-sm text-(--app-text-muted)">{{ $t('metaIntegration.explain') }}</p>
        <p v-if="integration" class="text-sm text-(--app-text-muted)">
          {{ $t('metaIntegration.updatedAt', { when: formatDate(integration.updatedAt, true) }) }}
          <template v-if="integration.verifiedAt">
            {{
              $t('metaIntegration.verifiedAt', { when: formatDate(integration.verifiedAt, true) })
            }}
          </template>
        </p>
        <EmptyState
          v-else-if="!editable"
          icon="i-lucide-plug"
          :title="$t('metaIntegration.emptyTitle')"
          :text="$t('metaIntegration.emptyAdmin')"
        />

        <form v-if="integration || editable" class="space-y-4" novalidate @submit.prevent="submit">
          <fieldset :disabled="!editable" class="min-w-0 space-y-4">
            <legend class="sr-only">{{ $t('metaIntegration.title') }}</legend>
            <UFormField
              :label="$t('metaIntegration.appId')"
              name="appId"
              required
              :error="fieldError('appId')"
            >
              <UInput
                v-model="form.appId"
                inputmode="numeric"
                autocomplete="off"
                class="w-full"
                size="xl"
              />
            </UFormField>
            <UFormField
              v-if="editable"
              :label="$t('metaIntegration.appSecret')"
              :help="integration ? $t('metaIntegration.appSecretKeep') : undefined"
              name="appSecret"
              :required="!integration"
              :error="fieldError('appSecret')"
            >
              <UInput
                v-model="form.appSecret"
                type="password"
                autocomplete="new-password"
                class="w-full"
                size="xl"
              />
            </UFormField>
            <p v-else class="text-sm">
              <span class="font-semibold">{{ $t('metaIntegration.appSecret') }}:</span>
              {{ $t('metaIntegration.appSecretSet') }}
            </p>
            <UFormField
              :label="$t('metaIntegration.businessId')"
              :help="$t('metaIntegration.businessIdHelp')"
              name="businessId"
              :error="fieldError('businessId')"
            >
              <UInput
                v-model="form.businessId"
                inputmode="numeric"
                autocomplete="off"
                class="w-full"
                size="xl"
              />
            </UFormField>
            <UFormField
              :label="$t('metaIntegration.dataUseCheckup')"
              :help="$t('metaIntegration.dataUseCheckupHelp')"
              name="dataUseCheckupDueOn"
              :error="fieldError('dataUseCheckupDueOn')"
            >
              <UInput v-model="form.dataUseCheckupDueOn" type="date" class="w-full" size="xl" />
            </UFormField>
            <p v-if="saveError" role="alert" class="text-(--app-danger)">{{ saveError }}</p>
            <div v-if="editable" class="flex flex-wrap items-center gap-3">
              <UButton type="submit" class="min-h-11" :loading="save.sending">
                {{ $t('metaIntegration.save') }}
              </UButton>
              <UButton
                class="min-h-11"
                color="neutral"
                variant="outline"
                :loading="test.sending"
                :disabled="!integration || save.sending"
                @click="runTest"
              >
                {{ $t('metaIntegration.test') }}
              </UButton>
              <p v-if="save.done" role="status" class="text-(--app-success)">
                {{ $t('metaIntegration.saved') }}
              </p>
            </div>
          </fieldset>
        </form>
        <p
          v-if="test.result"
          :role="test.result === 'verified' ? 'status' : 'alert'"
          :class="test.result === 'verified' ? 'text-(--app-success)' : 'text-(--app-danger)'"
        >
          {{ $t(`metaIntegration.testResult.${test.result}`) }}
        </p>
        <p v-else-if="test.problem" role="alert" class="text-(--app-danger)">
          {{ test.problem }}
        </p>
      </section>

      <section
        aria-labelledby="meta-guide"
        class="space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 sm:p-6"
      >
        <h2 id="meta-guide" class="text-lg">{{ $t('metaIntegration.guide.title') }}</h2>
        <ol class="list-decimal space-y-2 pl-5">
          <li v-for="step in guideSteps" :key="step">
            {{ $t(`metaIntegration.guide.${step}`) }}
          </li>
        </ol>
        <p class="rounded-md border border-(--app-border-strong) bg-(--app-surface-sunken) p-3">
          {{ $t('metaIntegration.guide.pagePermissions') }}
        </p>
      </section>

      <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    </template>
  </div>
</template>
