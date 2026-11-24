<script setup lang="ts">
import type { MyTelegramBot } from '@app/contracts'

/**
 * «Collega Telegram» in Profilo e preferenze (plan 08 Task 7): one row per bot that writes to the
 * person, the platform's and each agency's own. «Collega» opens the bot with a code valid 15
 * minutes; the row says «Collegato» once the person pressed «Avvia» there.
 */
const { t } = useI18n()
const { call, failure } = useApi()

const { data, error, refresh } = useFetch<{ bots: MyTelegramBot[] }>('/api/v1/me/telegram', {
  key: 'me-telegram',
  server: false,
  lazy: true,
})
const bots = computed(() => data.value?.bots ?? [])

/** The address of the open link of each bot, until it is used or expires */
const opened = reactive<Record<string, { url: string; expiresAt: string }>>({})
const busy = ref<string | null>(null)
const problem = ref('')

function stateOf(bot: MyTelegramBot) {
  if (bot.linkedAt) return { tone: 'success' as const, label: t('account.telegram.linked') }
  if (bot.pendingUntil || opened[bot.bot])
    return { tone: 'warning' as const, label: t('account.telegram.pending') }
  return { tone: 'neutral' as const, label: t('account.telegram.notLinked') }
}

function forWhom(bot: MyTelegramBot) {
  const names = [...(bot.platform ? [t('account.telegram.platform')] : []), ...bot.agencies]
  return t('account.telegram.for', { names: names.join(', ') })
}

// while a link waits for «Avvia», the page looks again every few seconds
let timer: ReturnType<typeof setInterval> | undefined
const waiting = computed(() => bots.value.some((b) => !b.linkedAt && opened[b.bot]))
watch(waiting, (now) => {
  clearInterval(timer)
  if (now)
    timer = setInterval(() => {
      for (const [key, link] of Object.entries(opened))
        if (new Date(link.expiresAt) < new Date()) Reflect.deleteProperty(opened, key)
      void refresh()
    }, 3000)
})
watch(bots, (list) => {
  for (const b of list) if (b.linkedAt) Reflect.deleteProperty(opened, b.bot)
})
onBeforeUnmount(() => {
  clearInterval(timer)
})

async function connect(bot: MyTelegramBot) {
  problem.value = ''
  busy.value = bot.bot
  try {
    opened[bot.bot] = await call<{ url: string; expiresAt: string }>(
      'POST',
      '/api/v1/me/telegram/links',
      { bot: bot.bot },
    )
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    busy.value = null
  }
}

async function disconnect(bot: MyTelegramBot) {
  problem.value = ''
  busy.value = bot.bot
  try {
    await call('DELETE', `/api/v1/me/telegram/links/${encodeURIComponent(bot.bot)}`)
    Reflect.deleteProperty(opened, bot.bot)
    await refresh()
  } catch (e) {
    problem.value = failure(e).message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <SettingsGroup :title="$t('account.telegram.title')">
    <LoadFailed v-if="error" :text="$t('account.telegram.loadError')" @retry="() => refresh()" />
    <ListSkeleton v-else-if="!data" :label="$t('account.loading')" :rows="1" :action="false" />
    <p v-else-if="bots.length === 0" class="p-4 text-(--app-text-muted)">
      {{ $t('account.telegram.none') }}
    </p>
    <template v-else>
      <SettingsRow
        v-for="bot in bots"
        :key="bot.bot"
        :label="`@${bot.botUsername}`"
        :data-testid="`telegram-link-${bot.bot}`"
      >
        <div class="grid min-w-0 flex-1 gap-1">
          <StatusDot
            :tone="stateOf(bot).tone"
            :label="stateOf(bot).label"
            class="text-detail"
            data-testid="telegram-link-state"
          />
          <span class="text-detail text-(--app-text-muted)">{{ forWhom(bot) }}</span>
          <p v-if="opened[bot.bot] && !bot.linkedAt" class="text-detail">
            {{ $t('account.telegram.pressStart') }}
          </p>
        </div>
        <template v-if="bot.linkedAt">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="busy === bot.bot"
            data-testid="telegram-unlink"
            @click="disconnect(bot)"
          >
            {{ $t('account.telegram.unlink') }}
          </UButton>
        </template>
        <template v-else-if="opened[bot.bot]">
          <UButton
            :to="opened[bot.bot]?.url"
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            icon="i-lucide-send"
            data-testid="telegram-open"
          >
            {{ $t('account.telegram.open') }}
          </UButton>
        </template>
        <UButton
          v-else
          color="neutral"
          variant="outline"
          size="sm"
          :loading="busy === bot.bot"
          data-testid="telegram-link"
          @click="connect(bot)"
        >
          {{ $t('account.telegram.link') }}
        </UButton>
      </SettingsRow>
      <p v-if="problem" role="alert" class="border-t border-(--app-border) p-4 text-(--app-danger)">
        {{ problem }}
      </p>
    </template>
  </SettingsGroup>
</template>
