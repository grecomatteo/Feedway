<script setup lang="ts">
import { DigestChannel } from '@app/contracts'
import type {
  NotificationChannel,
  NotificationKindName,
  NotificationLevel,
  NotificationPreferences,
  NotificationSettings,
} from '@app/contracts'

/**
 * «Profilo e preferenze» → Notifiche (plan 08 Task 6, §12.3, P4): one row per kind the person can
 * get, with its channels; then when they arrive: the level below which they stay in the panel,
 * the quiet hours, the morning digest and «Tutto ovunque». Saved as soon as something changes,
 * like the rest of the page (screen 23 has no «Salva»).
 */
const { t } = useI18n()
const { call, failure } = useApi()

const prefs = ref<NotificationPreferences | null>(null)
const loadFailed = ref(false)
const saved = ref(false)
const problem = ref<string | null>(null)

async function load() {
  loadFailed.value = false
  try {
    prefs.value = await call<NotificationPreferences>('GET', '/api/v1/me/notifications/preferences')
  } catch {
    loadFailed.value = true
  }
}
onMounted(load)

async function send(run: () => Promise<NotificationPreferences>) {
  saved.value = false
  problem.value = null
  try {
    prefs.value = await run()
    saved.value = true
  } catch (e) {
    problem.value = failure(e).message
    // what is on screen goes back to what is saved
    await load()
  }
}

const CHANNELS: NotificationChannel[] = ['panel', 'telegram', 'email']

function toggle(kind: NotificationKindName, channel: NotificationChannel, on: boolean) {
  const row = prefs.value?.kinds.find((k) => k.kind === kind)
  if (!row) return
  const channels = on
    ? CHANNELS.filter((c) => c === channel || row.channels.includes(c))
    : row.channels.filter((c) => c !== channel)
  row.channels = channels
  void send(() => call('PUT', '/api/v1/me/notifications/preferences/kinds', { kind, channels }))
}
const reset = (kind: NotificationKindName) =>
  send(() => call('PUT', '/api/v1/me/notifications/preferences/kinds', { kind, channels: null }))

function saveSettings(change: (s: NotificationSettings) => NotificationSettings) {
  if (!prefs.value) return
  const next = change(structuredClone(toRaw(prefs.value.settings)))
  prefs.value.settings = next
  void send(() => call('PUT', '/api/v1/me/notifications/preferences', next))
}

const levels = computed(() =>
  (['info', 'success', 'warning', 'error', 'critical'] as NotificationLevel[]).map((value) => ({
    value,
    label: t(`notifications.prefs.minLevels.${value}`),
  })),
)
const minLevel = computed({
  get: () => prefs.value?.settings.minLevel ?? 'info',
  set: (minLevel: NotificationLevel) => saveSettings((s) => ({ ...s, minLevel })),
})
const quietOn = computed({
  get: () => prefs.value?.settings.quietHours !== null,
  set: (on: boolean) =>
    saveSettings((s) => ({ ...s, quietHours: on ? { start: '22:00', end: '07:00' } : null })),
})
const quiet = (part: 'start' | 'end') =>
  computed({
    get: () => prefs.value?.settings.quietHours?.[part] ?? '',
    set: (value: string) =>
      saveSettings((s) => ({
        ...s,
        quietHours: s.quietHours ? { ...s.quietHours, [part]: value } : s.quietHours,
      })),
  })
const quietStart = quiet('start')
const quietEnd = quiet('end')
const digestOn = computed({
  get: () => prefs.value?.settings.digest.enabled ?? true,
  set: (enabled: boolean) =>
    saveSettings((s) => ({
      ...s,
      digest: {
        ...s.digest,
        enabled,
        days: enabled && s.digest.days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : s.digest.days,
      },
    })),
})
const digestTime = computed({
  get: () => prefs.value?.settings.digest.time ?? '08:00',
  set: (time: string) => saveSettings((s) => ({ ...s, digest: { ...s.digest, time } })),
})
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const
function toggleDay(day: number) {
  saveSettings((s) => {
    const days = s.digest.days.includes(day)
      ? s.digest.days.filter((d) => d !== day)
      : [...s.digest.days, day].sort((a, b) => a - b)
    // no day left is the digest off
    return { ...s, digest: { ...s.digest, days, enabled: days.length > 0 && s.digest.enabled } }
  })
}
const DIGEST_CHANNELS = DigestChannel.options
function toggleDigestChannel(channel: DigestChannel, on: boolean) {
  saveSettings((s) => {
    const channels = DIGEST_CHANNELS.filter((c) =>
      c === channel ? on : s.digest.channels.includes(c),
    )
    // the last one stays: a digest goes somewhere, or it is turned off
    return channels.length === 0 ? s : { ...s, digest: { ...s.digest, channels } }
  })
}
const onlyDigestChannel = (channel: DigestChannel) => {
  const channels = prefs.value?.settings.digest.channels ?? []
  return channels.length === 1 && channels[0] === channel
}
const everything = computed({
  get: () => prefs.value?.settings.everythingEverywhere ?? false,
  set: (everythingEverywhere: boolean) => saveSettings((s) => ({ ...s, everythingEverywhere })),
})

// the posts first, then the accounts and Meta, then the platform
const GROUP_ORDER = { post: 0, account: 1, system: 2 } as const
const kindsInOrder = computed(() =>
  [...(prefs.value?.kinds ?? [])].sort(
    (x, y) => GROUP_ORDER[kindGroup(x.kind)] - GROUP_ORDER[kindGroup(y.kind)],
  ),
)
const kindName = (kind: NotificationKindName) => t(`notifications.kinds.${kindKey(kind)}`)
</script>

<template>
  <LoadFailed v-if="loadFailed" :text="$t('notifications.prefs.loadError')" @retry="load()" />
  <template v-else-if="prefs">
    <SettingsGroup :title="$t('notifications.prefs.title')" data-notification-kinds>
      <template #aside>
        <p role="status" class="text-detail text-(--app-text-muted)">
          <template v-if="saved">{{ $t('account.saved') }}</template>
        </p>
      </template>
      <SettingsRow
        v-for="row in kindsInOrder"
        :key="row.kind"
        :label="kindName(row.kind)"
        :hint="row.channels.length === 0 ? $t('notifications.prefs.off') : null"
        data-kind-row
      >
        <fieldset class="m-0 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-0 p-0">
          <legend class="sr-only">
            {{ $t('notifications.prefs.kindChannels', { kind: kindName(row.kind) }) }}
          </legend>
          <UCheckbox
            v-for="channel in CHANNELS"
            :key="channel"
            :model-value="row.channels.includes(channel)"
            :label="$t(`notifications.channels.${channel}`)"
            :data-channel="channel"
            @update:model-value="(on) => toggle(row.kind, channel, on === true)"
          />
          <UButton
            v-if="row.changed"
            color="neutral"
            variant="ghost"
            size="sm"
            class="ms-auto"
            :aria-label="$t('notifications.prefs.resetLabel', { kind: kindName(row.kind) })"
            @click="reset(row.kind)"
            >{{ $t('notifications.prefs.reset') }}</UButton
          >
        </fieldset>
      </SettingsRow>
      <p
        v-if="problem"
        role="alert"
        class="border-t border-(--app-border) px-4 py-3 text-(--app-danger)"
      >
        {{ problem }}
      </p>
    </SettingsGroup>

    <SettingsGroup :title="$t('notifications.prefs.when')" data-notification-settings>
      <SettingsRow
        :label="$t('notifications.prefs.minLevel')"
        :hint="$t('notifications.prefs.minLevelHelp')"
        for="notifications-min-level"
      >
        <USelect
          id="notifications-min-level"
          v-model="minLevel"
          :items="levels"
          class="w-full max-w-[360px]"
          :ui="{ base: 'bg-(--app-surface)' }"
        />
      </SettingsRow>
      <SettingsRow
        :label="$t('notifications.prefs.quiet')"
        :hint="$t('notifications.prefs.quietHelp')"
      >
        <USwitch v-model="quietOn" :aria-label="$t('notifications.prefs.quiet')" />
        <template v-if="quietOn">
          <span class="text-(--app-text-muted)">{{ $t('notifications.prefs.quietFrom') }}</span>
          <TimeField v-model="quietStart" :label="$t('notifications.prefs.quietFrom')" />
          <span class="text-(--app-text-muted)">{{ $t('notifications.prefs.quietTo') }}</span>
          <TimeField v-model="quietEnd" :label="$t('notifications.prefs.quietTo')" />
        </template>
      </SettingsRow>
      <SettingsRow
        :label="$t('notifications.prefs.digest')"
        :hint="$t('notifications.prefs.digestHelp')"
      >
        <USwitch v-model="digestOn" :aria-label="$t('notifications.prefs.digest')" />
        <template v-if="digestOn">
          <span class="text-(--app-text-muted)">{{ $t('notifications.prefs.digestAt') }}</span>
          <TimeField v-model="digestTime" :label="$t('notifications.prefs.digestAt')" />
          <div
            role="group"
            :aria-label="$t('notifications.prefs.digestDays')"
            class="flex gap-1"
            data-digest-days
          >
            <button
              v-for="day in DAYS"
              :key="day"
              type="button"
              :aria-pressed="prefs.settings.digest.days.includes(day)"
              :aria-label="$t(`notifications.prefs.dayNames.${day}`)"
              class="flex size-8 items-center justify-center rounded-full border border-(--app-border-strong) text-detail font-medium text-(--app-text-muted) transition-colors duration-150 outline-none hover:bg-(--app-nav-hover) focus-visible:ring-2 focus-visible:ring-(--app-focus) aria-pressed:border-(--app-text) aria-pressed:bg-(--app-nav-hover) aria-pressed:font-semibold aria-pressed:text-(--app-text)"
              @click="toggleDay(day)"
            >
              {{ $t(`notifications.prefs.days.${day}`) }}
            </button>
          </div>
          <fieldset
            class="m-0 flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-0 p-0"
            data-digest-channels
          >
            <legend class="sr-only">{{ $t('notifications.prefs.digestChannels') }}</legend>
            <UCheckbox
              v-for="channel in DIGEST_CHANNELS"
              :key="channel"
              :model-value="prefs.settings.digest.channels.includes(channel)"
              :disabled="onlyDigestChannel(channel)"
              :label="$t(`notifications.channels.${channel}`)"
              :data-channel="channel"
              @update:model-value="(on) => toggleDigestChannel(channel, on === true)"
            />
          </fieldset>
        </template>
      </SettingsRow>
      <SettingsRow
        :label="$t('notifications.prefs.everything')"
        :hint="$t('notifications.prefs.everythingHelp')"
        inline
      >
        <USwitch v-model="everything" :aria-label="$t('notifications.prefs.everything')" />
      </SettingsRow>
    </SettingsGroup>
  </template>
</template>
