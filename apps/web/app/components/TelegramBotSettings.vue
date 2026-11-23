<script setup lang="ts">
import type { TelegramBot } from '@app/contracts'
import type { ApiFailure } from '~/composables/useApi'

/**
 * A Telegram bot (plan 08 Scelta 8): the platform's, or an agency's own. The token goes in, is
 * tried with Telegram and never comes back: the group shows the bot's name and when its token
 * was saved. «Sostituisci token» opens the field again; «Togli il bot» asks first.
 */
const props = defineProps<{
  /** `/api/v1/platform/telegram-bot` or the agency's `/integrations/telegram` */
  api: string
  /** The key of the fetch, one per bot */
  cacheKey: string
  editable: boolean
  /** platform: the default bot; agency: the bot instead of the platform's */
  scope: 'platform' | 'agency'
  withReauth: <T>(fn: () => Promise<T>) => Promise<T>
}>()

const { t } = useI18n()
const { call, failure } = useApi()

const { data, status, error, refresh } = useFetch<{ bot: TelegramBot | null }>(() => props.api, {
  key: () => props.cacheKey,
  server: false,
  lazy: true,
})
const bot = computed(() => data.value?.bot ?? null)

const state = computed(() => {
  const b = bot.value
  if (!b) return { tone: 'neutral' as const, label: t(`telegramBot.none.${props.scope}`) }
  if (b.rejectedAt) return { tone: 'danger' as const, label: t('telegramBot.rejected') }
  return { tone: 'success' as const, label: t('telegramBot.active') }
})

const form = reactive({
  open: false,
  token: '',
  sending: false,
  failure: null as ApiFailure | null,
})
const saved = ref<'saved' | 'removed' | null>(null)
const tokenError = computed(() =>
  form.failure && (form.failure.field === 'token' || form.failure.status === 422)
    ? form.failure.message
    : undefined,
)
const formError = computed(() =>
  form.failure && tokenError.value === undefined ? form.failure.message : null,
)
const showForm = computed(() => props.editable && (form.open || (data.value && !bot.value)))

async function save() {
  Object.assign(form, { sending: true, failure: null })
  saved.value = null
  try {
    await props.withReauth(async () => {
      const r = await call<{ bot: TelegramBot }>('PUT', props.api, { token: form.token })
      data.value = { bot: r.bot }
    })
    Object.assign(form, { open: false, token: '' })
    saved.value = 'saved'
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) form.failure = failure(e)
  } finally {
    form.sending = false
  }
}

const removal = reactive({ open: false, sending: false, problem: '' })
async function remove() {
  Object.assign(removal, { sending: true, problem: '' })
  try {
    await props.withReauth(() => call('DELETE', props.api))
    data.value = { bot: null }
    Object.assign(removal, { open: false })
    Object.assign(form, { open: false, token: '' })
    saved.value = 'removed'
  } catch (e) {
    if (!(e instanceof ReauthCancelled)) removal.problem = failure(e).message
  } finally {
    removal.sending = false
  }
}

const guideSteps = ['open', 'newbot', 'copy', 'paste'] as const
</script>

<template>
  <div class="grid gap-8">
    <SettingsGroup :title="$t('telegramBot.title')">
      <template #aside>
        <p v-if="saved" role="status" class="text-detail text-(--app-success)">
          {{ $t(`telegramBot.${saved}`) }}
        </p>
        <StatusDot
          v-if="data"
          :tone="state.tone"
          :label="state.label"
          class="text-detail"
          data-testid="telegram-bot-state"
        />
      </template>
      <ListSkeleton
        v-if="!data && !error && (status === 'pending' || status === 'idle')"
        :label="$t('account.loading')"
        :rows="2"
        :action="false"
      />
      <LoadFailed v-else-if="error" :text="$t('telegramBot.loadError')" @retry="() => refresh()" />
      <template v-else>
        <template v-if="bot">
          <SettingsRow :label="$t('telegramBot.bot')">
            <a
              :href="`https://t.me/${bot.botUsername}`"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium underline-offset-2 hover:underline"
              data-testid="telegram-bot-name"
              >@{{ bot.botUsername }}</a
            >
          </SettingsRow>
          <SettingsRow :label="$t('telegramBot.token')">
            <span class="text-(--app-text-muted)">{{
              $t('telegramBot.tokenSaved', { when: formatDate(bot.updatedAt) })
            }}</span>
            <template v-if="editable && !form.open">
              <UButton color="neutral" variant="outline" size="sm" @click="form.open = true">
                {{ $t('telegramBot.replace') }}
              </UButton>
              <UButton
                color="error"
                variant="ghost"
                size="sm"
                data-testid="telegram-bot-remove"
                @click="removal.open = true"
              >
                {{ $t(`telegramBot.remove.${scope}`) }}
              </UButton>
            </template>
          </SettingsRow>
          <p
            v-if="bot.rejectedAt"
            role="alert"
            class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
          >
            {{ $t('telegramBot.rejectedAt', { when: formatDate(bot.rejectedAt, { time: true }) }) }}
          </p>
        </template>
        <div v-else-if="!editable" class="p-4">
          <p class="text-(--app-text-muted)">{{ $t(`telegramBot.explain.${scope}`) }}</p>
        </div>

        <form
          v-if="showForm"
          class="grid gap-4 p-4 sm:p-5"
          :class="bot ? 'border-t border-(--app-border)' : ''"
          novalidate
          @submit.prevent="save"
        >
          <p v-if="!bot" class="text-detail text-(--app-text-muted)">
            {{ $t(`telegramBot.explain.${scope}`) }}
          </p>
          <UFormField
            :label="$t('telegramBot.tokenField')"
            :help="$t('telegramBot.tokenHelp')"
            name="telegram-token"
            required
            :error="tokenError"
          >
            <UInput
              v-model="form.token"
              type="password"
              autocomplete="off"
              spellcheck="false"
              class="w-full"
              data-testid="telegram-bot-token"
            />
          </UFormField>
          <p v-if="formError" role="alert" class="text-(--app-danger)">{{ formError }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <UButton
              type="submit"
              class="min-h-control"
              :loading="form.sending"
              :disabled="form.token.trim() === ''"
            >
              {{ $t('telegramBot.save') }}
            </UButton>
            <UButton
              v-if="bot"
              color="neutral"
              variant="ghost"
              class="min-h-control"
              @click="Object.assign(form, { open: false, token: '', failure: null })"
            >
              {{ $t('telegramBot.cancel') }}
            </UButton>
          </div>
        </form>
      </template>
    </SettingsGroup>

    <SettingsGroup
      v-if="editable && data && (!bot || form.open)"
      :title="$t('telegramBot.guide.title')"
    >
      <ol class="grid list-decimal gap-2 p-4 pl-9">
        <li v-for="step in guideSteps" :key="step">{{ $t(`telegramBot.guide.${step}`) }}</li>
      </ol>
    </SettingsGroup>

    <UModal
      v-model:open="removal.open"
      :title="$t(`telegramBot.remove.${scope}`)"
      :description="$t(`telegramBot.removeExplain.${scope}`)"
      :close="false"
      :ui="DIALOG_UI"
    >
      <template #body>
        <!-- the explanation is the dialog's description: said once -->
        <p v-if="removal.problem" role="alert" class="text-(--app-danger)">
          {{ removal.problem }}
        </p>
      </template>
      <template #footer>
        <UButton
          class="max-md:flex-1 max-md:justify-center"
          color="neutral"
          variant="outline"
          @click="removal.open = false"
        >
          {{ $t('telegramBot.cancel') }}
        </UButton>
        <UButton
          class="max-md:flex-1 max-md:justify-center"
          color="error"
          :loading="removal.sending"
          data-testid="telegram-bot-remove-confirm"
          @click="remove"
        >
          {{ $t(`telegramBot.remove.${scope}`) }}
        </UButton>
      </template>
    </UModal>
  </div>
</template>
