<script setup lang="ts">
import type { NotificationItem } from '@app/contracts'

/**
 * The rows of the notification centre (screen 05): the kind's icon, the title with the orange dot
 * while unread, what happened and the time. A row opens where it is dealt with and is marked as
 * read (plan 08 Task 6); without a place to open, it is only marked. On the page of every
 * notification (`deliveries`) each row also says what happened outside the panel.
 */
const props = withDefaults(
  defineProps<{
    items: readonly NotificationItem[]
    /** The page: the agency's name when the person has more than one, and the channels */
    deliveries?: boolean
    agencies?: boolean
  }>(),
  { deliveries: false, agencies: false },
)
const emit = defineEmits<{ opened: [item: NotificationItem]; failed: [] }>()

const { t } = useI18n()
const org = useOrganization()
const { markRead } = useNotifications()
const timeZone = computed(() => org.me.value?.timezone ?? null)

async function open(item: NotificationItem) {
  try {
    await markRead(item)
  } catch {
    // the row stays unread; the place still opens, the dot says the rest
    emit('failed')
  }
  emit('opened', item)
  if (item.link) await navigateTo(item.link.path)
}

const lastSpace = (title: string) => title.lastIndexOf(' ') + 1
const head = (title: string) => title.slice(0, lastSpace(title))
const tail = (title: string) => title.slice(lastSpace(title))

const secondLine = (item: NotificationItem) => {
  const parts = [item.detail]
  // the client only when the line does not name it already (a post's line names its account)
  const place = props.agencies ? item.context : (item.context?.split(' · ')[1] ?? null)
  if (place && !item.detail?.includes(place)) parts.push(place)
  return parts.filter(Boolean).join(' · ')
}
</script>

<template>
  <ul class="divide-y divide-(--app-border)">
    <li v-for="item in props.items" :key="item.id" data-notification>
      <button
        type="button"
        class="group flex w-full items-start gap-3 rounded-control px-2 py-3 text-start transition-colors duration-150 outline-none hover:bg-(--app-nav-hover) focus-visible:ring-2 focus-visible:ring-(--app-focus) focus-visible:ring-inset"
        :data-unread="item.readAt === null || undefined"
        @click="open(item)"
      >
        <UIcon
          :name="notificationIcon(item.kind)"
          class="mt-0.5 size-[18px] shrink-0 text-(--app-text)"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span class="block leading-snug font-medium text-(--app-text)">
            <!-- the dot stays with the last word, as in screen 05 -->
            {{ head(item.title)
            }}<span class="whitespace-nowrap"
              >{{ tail(item.title)
              }}<span
                v-if="item.readAt === null"
                class="ms-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-(--app-brand) align-middle"
                aria-hidden="true"
            /></span>
            <span v-if="item.readAt === null" class="sr-only">{{
              `, ${t('notifications.unread')}`
            }}</span>
          </span>
          <span
            v-if="secondLine(item)"
            class="mt-0.5 line-clamp-2 text-detail leading-snug text-(--app-text-muted)"
            >{{ secondLine(item) }}</span
          >
          <span
            v-if="props.deliveries && deliveryLines(item, t).length > 0"
            class="mt-1 block text-caption text-(--app-text-muted)"
            data-deliveries
            >{{ deliveryLines(item, t).join(' · ') }}</span
          >
          <span v-if="item.link" class="sr-only">{{ `, ${item.link.label}` }}</span>
        </span>
        <time
          :datetime="item.createdAt"
          class="shrink-0 pt-0.5 text-caption text-(--app-text-muted) tabular-nums"
          >{{ notificationTime(item.createdAt, { timeZone }) }}</time
        >
      </button>
    </li>
  </ul>
</template>
