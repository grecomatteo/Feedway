<script setup lang="ts">
import type { Me, PrivacyNotice } from '@app/contracts'

definePageMeta({ layout: 'personal' })

/**
 * «Privacy» of the settings: the person's data to download and, inside an agency, the agency's
 * notice (it used to be a page of its own, `/<agenzia>/privacy`, which now leads here). Deleting
 * the account lives in Sicurezza (screen 24).
 */
const { t } = useI18n()
const org = useOrganization()

useHead({ title: () => t('dataExport.title') })

const { data: me, error } = useFetch<Me>('/api/v1/me', { key: 'me', server: false, lazy: true })
const signedOut = computed(() => error.value?.statusCode === 401)
const {
  data: notice,
  status: noticeStatus,
  error: noticeError,
  refresh: refreshNotice,
} = useFetch<PrivacyNotice>(() => org.api('/privacy'), {
  key: () => `privacy-${org.slug.value}`,
  server: false,
  lazy: true,
  immediate: org.active.value,
})
</script>

<template>
  <SettingsShell>
    <p v-if="signedOut" role="alert" class="flex items-center gap-2 text-(--app-danger)">
      <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
      {{ $t('account.signedOut') }}
    </p>
    <template v-else>
      <DataExportPanel :me="me ?? null" />
      <SettingsGroup
        v-if="org.active.value"
        :title="$t('privacyNotice.ofAgency', { agency: org.organization.value?.name ?? '' })"
      >
        <div class="p-4">
          <p v-if="noticeStatus === 'pending' || noticeStatus === 'idle'" role="status">
            {{ $t('account.loading') }}
          </p>
          <div v-else-if="noticeError" role="alert" class="space-y-3">
            <p class="text-(--app-danger)">{{ $t('account.loadError') }}</p>
            <UButton color="neutral" variant="outline" @click="() => refreshNotice()">
              {{ $t('account.retry') }}
            </UButton>
          </div>
          <PrivacyNoticeView v-else-if="notice" :notice="notice" class="max-w-prose" />
        </div>
      </SettingsGroup>
    </template>
  </SettingsShell>
</template>
