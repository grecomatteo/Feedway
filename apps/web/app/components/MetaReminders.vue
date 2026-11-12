<script setup lang="ts">
import type { MetaReminder } from '@app/contracts'

/** The red notice of «Account social» (spec §8.4, RF-21): until stage 8 it lives only here. */
const props = defineProps<{ items: MetaReminder[] }>()
const { t } = useI18n()

const day = (iso: string) => formatDate(`${iso}T12:00:00Z`)
const when = (daysLeft: number) =>
  daysLeft === 0 ? t('metaReminders.today') : t('metaReminders.inDays', { n: daysLeft }, daysLeft)

const lines = computed(() =>
  props.items.map((r) => {
    switch (r.kind) {
      case 'graph_version_sunset':
        return r.daysLeft < 0
          ? t('metaReminders.graphRetired', { version: r.version, date: day(r.dueOn) })
          : t('metaReminders.graphSunset', {
              version: r.version,
              date: day(r.dueOn),
              when: when(r.daysLeft),
            })
      case 'data_use_checkup':
        return r.daysLeft < 0
          ? t('metaReminders.checkupOverdue', { date: day(r.dueOn) })
          : t('metaReminders.checkupDue', { date: day(r.dueOn), when: when(r.daysLeft) })
      case 'access_revoked':
        return t('metaReminders.accessRevoked')
      case 'token_expiring':
        return t('metaReminders.tokenExpiring', { date: formatDate(r.expiresAt, true) })
    }
  }),
)
</script>

<template>
  <section
    v-if="items.length > 0"
    aria-labelledby="meta-reminders"
    class="space-y-2 rounded-xl border border-(--app-danger) bg-(--app-surface) p-4"
  >
    <h2 id="meta-reminders" class="flex items-center gap-2 text-lg text-(--app-danger)">
      <UIcon name="i-lucide-triangle-alert" aria-hidden="true" />
      {{ $t('metaReminders.title') }}
    </h2>
    <ul class="list-disc space-y-1 pl-5">
      <li v-for="(line, i) in lines" :key="i">{{ line }}</li>
    </ul>
  </section>
</template>
