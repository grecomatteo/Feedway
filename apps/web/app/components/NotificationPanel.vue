<script setup lang="ts">
import type { NotificationItem } from '@app/contracts'

/**
 * What the bell opens (screen 05): «Notifiche» with «Segna tutte come lette», the latest rows and,
 * at the end, the page with every notification and its filters (plan 08 Task 6).
 */
const props = withDefaults(defineProps<{ phone?: boolean }>(), { phone: false })
const emit = defineEmits<{ close: [] }>()

const LATEST = 8
const { t } = useI18n()
const org = useOrganization()
const { list, markAll, unread } = useNotifications()

const items = ref<NotificationItem[] | null>(null)
const problem = ref<string | null>(null)
const marking = ref(false)

async function load() {
  problem.value = null
  try {
    items.value = (await list({ limit: String(LATEST) })).items
  } catch {
    problem.value = t('notifications.loadError')
  }
}
onMounted(load)

async function readAll() {
  marking.value = true
  problem.value = null
  try {
    await markAll()
    const at = new Date().toISOString()
    items.value = (items.value ?? []).map((i) => (i.readAt ? i : { ...i, readAt: at }))
  } catch {
    problem.value = t('notifications.actionError')
  } finally {
    marking.value = false
  }
}
</script>

<template>
  <section aria-labelledby="notifications-panel-title" :class="props.phone ? '' : 'p-2'">
    <header class="flex min-h-9 items-center justify-between gap-3 px-2 pb-1">
      <h2 id="notifications-panel-title" class="font-display text-[17px] font-semibold">
        {{ $t('notifications.title') }}
        <span v-if="unread" class="ms-1 font-sans text-detail font-normal text-(--app-text-muted)">
          <span aria-hidden="true">{{ unread }}</span>
          <span class="sr-only">{{ $t('notifications.unreadCount', { n: unread }, unread) }}</span>
        </span>
      </h2>
      <UButton
        v-if="unread"
        color="neutral"
        variant="link"
        size="sm"
        class="px-0 text-(--app-text) underline underline-offset-4"
        :loading="marking"
        @click="readAll"
        >{{ $t('notifications.markAll') }}</UButton
      >
    </header>
    <p v-if="problem" role="alert" class="px-2 py-2 text-detail text-(--app-danger)">
      {{ problem }}
    </p>
    <p v-if="items === null && !problem" role="status" class="px-2 py-4 text-(--app-text-muted)">
      {{ $t('account.loading') }}
    </p>
    <div v-else-if="items !== null && items.length === 0" class="px-2 py-4" data-empty-state>
      <p class="font-medium">{{ $t('notifications.empty') }}</p>
      <p class="text-detail text-(--app-text-muted)">{{ $t('notifications.emptyHelp') }}</p>
    </div>
    <NotificationList v-else-if="items !== null" :items="items" @opened="emit('close')" />
    <footer v-if="org.slug.value" class="border-t border-(--app-border) px-2 pt-2">
      <UButton
        :to="org.to('/notifiche')"
        color="neutral"
        variant="link"
        size="sm"
        class="px-0 text-(--app-text) underline underline-offset-4"
        @click="emit('close')"
        >{{ $t('notifications.seeAll') }}</UButton
      >
    </footer>
  </section>
</template>
