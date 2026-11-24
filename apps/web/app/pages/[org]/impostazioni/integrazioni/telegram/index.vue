<script setup lang="ts">
/**
 * Impostazioni → Integrazioni → Telegram (plan 08 Scelta 8): the agency's own bot instead of the
 * platform's. Only the Owner changes it, the Admin reads it (spec §10.2).
 */
definePageMeta({ layout: 'agency' })

const org = useOrganization()
const context = useContextQuery()
const { t } = useI18n()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('telegramBot.title') })
if (!org.may.value.viewSettings) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

const passkeys = computed(() => org.me.value?.secondFactor.passkeys ?? 0)
</script>

<template>
  <SettingsShell>
    <div class="-mb-4">
      <NuxtLink
        :to="{ path: org.to('/impostazioni/integrazioni'), query: context }"
        class="mb-2 inline-flex items-center gap-1.5 text-detail text-(--app-text-muted) hover:text-(--app-text)"
      >
        <UIcon name="i-lucide-arrow-left" class="size-3.5" aria-hidden="true" />
        {{ $t('integrations.back') }}
      </NuxtLink>
      <h2 class="flex min-h-9 items-center font-display text-lg font-semibold tracking-[-0.01em]">
        {{ $t('telegramBot.title') }}
      </h2>
    </div>
    <TelegramBotSettings
      :api="org.api('/integrations/telegram')"
      :cache-key="`telegram-bot-${org.slug.value}`"
      scope="agency"
      :editable="org.may.value.editSettings"
      :with-reauth="withReauth"
    />
    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
  </SettingsShell>
</template>
