<script setup lang="ts">
/**
 * The agency's Meta app (spec §8.3): App ID and App Secret checked by Meta when saved, the
 * Business Manager id for the guides and the Data Use Checkup date. Saving needs a recent
 * confirmation (withReauth of the page). Used by Impostazioni → Integrazioni and by the first
 * setup (§8.1 step 1).
 */
import type { MetaIntegration } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

/** As `MetaTestResult` of the contract. */
type TestResult = 'verified' | 'not_configured' | 'rejected' | 'unavailable'

const props = defineProps<{
  integration: MetaIntegration | null
  editable: boolean
  withReauth: WithReauth
}>()
const emit = defineEmits<{
  'update:integration': [integration: MetaIntegration]
  /** Saved and accepted by Meta; a test only updates the date. */
  saved: []
}>()
const org = useOrganization()
const { call, failure } = useApi()

const form = reactive({ appId: '', appSecret: '', businessId: '', dataUseCheckupDueOn: '' })
watch(
  () => props.integration,
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
    await props.withReauth(async () => {
      const r = await call<{ integration: MetaIntegration }>('PUT', org.api('/integrations/meta'), {
        appId: form.appId.trim(),
        ...(form.appSecret.trim() === '' ? {} : { appSecret: form.appSecret }),
        // the unified login waits for the public version (plan 03, Task 7): kept as stored
        configId: props.integration?.configId ?? null,
        businessId: optional(form.businessId),
        dataUseCheckupDueOn: optional(form.dataUseCheckupDueOn),
      })
      emit('update:integration', r.integration)
      form.appSecret = ''
      save.done = true
      emit('saved')
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
    // the dates only: a refetch would swap the form for "loading" and drop what was typed
    const now = new Date().toISOString()
    if (r.ok && props.integration)
      emit('update:integration', { ...props.integration, verifiedAt: now, rejectedAt: null })
    else if (r.result === 'rejected' && props.integration)
      emit('update:integration', { ...props.integration, verifiedAt: null, rejectedAt: now })
  } catch (e) {
    test.problem = failure(e).message
  } finally {
    test.sending = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <form class="space-y-4" novalidate @submit.prevent="submit">
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
  </div>
</template>
