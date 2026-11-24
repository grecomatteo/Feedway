<script setup lang="ts">
/**
 * Piattaforma → Integrazioni (plan 08 Task 7): what is set once for every agency, for the platform
 * administrator only. Outside any agency's panel, in the pages-before-the-panel look (D-99), as
 * «Email di sistema». The Telegram bot, then the worker's beats and the external watch (Task 9).
 */
definePageMeta({ layout: 'auth', authWide: true })

const { t } = useI18n()
const session = useSession()
const { open: reauthOpen, withReauth, done: reauthDone } = useReauth()

useHead({ title: () => t('platformIntegrations.title') })

const home = computed(() => {
  if (session.view.value.state !== 'active') return null
  const to = session.home(session.view.value.me)
  return to === '/account' ? null : to
})
const passkeys = computed(() =>
  session.view.value.state === 'active' ? session.view.value.me.secondFactor.passkeys : 0,
)
</script>

<template>
  <div class="grid gap-8">
    <div class="grid gap-1 text-center">
      <h1>{{ $t('platformIntegrations.title') }}</h1>
      <p class="mx-auto text-detail text-(--app-text-muted)">
        {{ $t('platformIntegrations.explain') }}
      </p>
    </div>

    <TelegramBotSettings
      api="/api/v1/platform/telegram-bot"
      cache-key="platform-telegram-bot"
      scope="platform"
      editable
      :with-reauth="withReauth"
    />

    <PlatformMonitoringSettings :with-reauth="withReauth" />

    <ReauthDialog v-model:open="reauthOpen" :passkeys="passkeys" @done="reauthDone" />
    <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <UButton v-if="home" :to="home" color="neutral" variant="ghost" icon="i-lucide-arrow-left">
        {{ $t('nav.agency') }}
      </UButton>
      <UButton to="/account" color="neutral" variant="ghost" icon="i-lucide-settings">
        {{ $t('nav.settings') }}
      </UButton>
      <SignOutButton />
    </div>
  </div>
</template>
