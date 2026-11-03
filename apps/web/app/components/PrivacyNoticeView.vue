<script setup lang="ts">
import type { PrivacyNotice } from '@app/contracts'

const props = defineProps<{ notice: PrivacyNotice }>()
const { t } = useI18n()

const DAY = 86_400_000
const HOUR = 3_600_000
/** A period of the code, in words: days, hours or minutes. */
function period(ms: number): string {
  if (ms >= DAY) return t('privacyNotice.days', { n: Math.round(ms / DAY) }, Math.round(ms / DAY))
  if (ms >= HOUR)
    return t('privacyNotice.hours', { n: Math.round(ms / HOUR) }, Math.round(ms / HOUR))
  return t('privacyNotice.minutes', { n: Math.round(ms / 60_000) }, Math.round(ms / 60_000))
}
const retention = computed(() => {
  const r = props.notice.retention
  return [
    t('privacyNotice.retention.sessions', { period: period(r.expiredSessionsMs) }),
    t('privacyNotice.retention.devices', { period: period(r.knownDevicesMs) }),
    t('privacyNotice.retention.auditIp', { period: period(r.auditIpMs) }),
    t('privacyNotice.retention.exports', { period: period(r.dataExportMs) }),
    t('privacyNotice.retention.avatarStaging', { period: period(r.avatarStagingMs) }),
    t('privacyNotice.retention.disabled', {
      period: period(r.disabledUserMs),
      notice: period(r.anonymizationNoticeMs),
    }),
  ]
})
const cookies = computed(() =>
  props.notice.cookies.map((c) => ({
    name: c.name,
    purpose: t(`privacyNotice.cookies.${c.purpose}`),
    duration:
      c.maxAgeSeconds === null ? t('privacyNotice.untilClosed') : period(c.maxAgeSeconds * 1000),
  })),
)
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-2" aria-labelledby="privacy-controller">
      <h2 id="privacy-controller" class="text-xl">{{ $t('privacyNotice.controllerTitle') }}</h2>
      <template v-if="notice.controllerName">
        <p>
          {{
            $t('privacyNotice.controller', {
              name: notice.controllerName,
              agency: notice.organizationName ?? notice.controllerName,
            })
          }}
        </p>
        <p>
          {{ $t('privacyNotice.contact') }}
          <a :href="`mailto:${notice.contactEmail}`" class="underline">{{ notice.contactEmail }}</a>
        </p>
        <p v-if="notice.extraText" class="whitespace-pre-line">{{ notice.extraText }}</p>
      </template>
      <p v-else class="text-(--app-text-muted)">
        {{ $t('privacyNotice.notFilled') }}
      </p>
    </section>

    <section class="space-y-2" aria-labelledby="privacy-what">
      <h2 id="privacy-what" class="text-xl">{{ $t('privacyNotice.whatTitle') }}</h2>
      <p>{{ $t('privacyNotice.what') }}</p>
      <p>{{ $t('privacyNotice.why') }}</p>
    </section>

    <section class="space-y-2" aria-labelledby="privacy-retention">
      <h2 id="privacy-retention" class="text-xl">{{ $t('privacyNotice.retentionTitle') }}</h2>
      <ul class="list-disc space-y-1 pl-5">
        <li v-for="line in retention" :key="line">{{ line }}</li>
      </ul>
    </section>

    <section class="space-y-2" aria-labelledby="privacy-cookies">
      <h2 id="privacy-cookies" class="text-xl">{{ $t('privacyNotice.cookiesTitle') }}</h2>
      <p>{{ $t('privacyNotice.cookiesIntro') }}</p>
      <ul class="space-y-2">
        <li v-for="c in cookies" :key="c.name">
          <code class="break-all">{{ c.name }}</code
          >: {{ c.purpose }} ({{ c.duration }})
        </li>
      </ul>
    </section>

    <section class="space-y-2" aria-labelledby="privacy-rights">
      <h2 id="privacy-rights" class="text-xl">{{ $t('privacyNotice.rightsTitle') }}</h2>
      <p>{{ $t('privacyNotice.rights') }}</p>
    </section>
  </div>
</template>
