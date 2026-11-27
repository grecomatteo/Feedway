<script setup lang="ts">
import type { PostOutcomeResponse } from '@app/contracts'
import type { StatusTone } from '~/components/StatusDot.vue'

type Collaborators = NonNullable<PostOutcomeResponse['destinations'][number]['collaborators']>

/**
 * The invitations of a destination on Instagram (plan 09 Scelta 13, D-125), on the page of the
 * outcome: each name with its state as the worker last read it from Meta, and «Aggiorna», which
 * asks the worker to read them again. The page never calls Meta.
 */
const props = defineProps<{
  collaborators: Collaborators
  /** the account, for the name of the button */
  account: string
  /** «Aggiorna» is there: the post went out with the invitations */
  canRefresh: boolean
  refreshing: boolean
  /** the post's zone: the page shows one clock (as «Esito») */
  timeZone: string
}>()
const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()

const TONE: Record<Collaborators['people'][number]['status'], StatusTone> = {
  waiting: 'neutral',
  pending: 'info',
  accepted: 'success',
  declined: 'danger',
  not_sent: 'warning',
  unknown: 'neutral',
}
const readAt = computed(() =>
  props.collaborators.readAt
    ? t('posts.outcome.collaborators.readAt', {
        when: formatRelative(props.collaborators.readAt, {
          sentence: true,
          timeZone: props.timeZone,
        }),
      })
    : null,
)
</script>

<template>
  <div class="flex flex-col gap-1.5 pt-1" data-outcome-collaborators>
    <p class="text-detail text-(--app-text-muted)">
      {{ $t('posts.outcome.collaborators.title') }}
    </p>
    <ul class="flex flex-col gap-1">
      <li
        v-for="p in collaborators.people"
        :key="p.username"
        class="flex min-w-0 items-center justify-between gap-3 text-detail"
        data-outcome-collaborator
      >
        <span class="min-w-0 truncate">@{{ p.username }}</span>
        <StatusDot
          :label="$t(`posts.outcome.collaborators.status.${p.status}`)"
          :tone="TONE[p.status]"
        />
      </li>
    </ul>
    <p v-if="collaborators.notSentCode !== null" class="text-detail text-(--app-text)">
      {{ $t('posts.outcome.collaborators.notSent') }}
    </p>
    <div v-else-if="canRefresh" class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-refresh-cw"
        class="-ms-2 max-md:min-h-control"
        :loading="refreshing"
        :aria-label="$t('posts.outcome.collaborators.refreshOn', { account })"
        data-outcome-collaborators-refresh
        @click="emit('refresh')"
      >
        {{ $t('posts.outcome.collaborators.refresh') }}
      </UButton>
      <span v-if="readAt" class="text-detail text-(--app-text-muted)" aria-live="polite">
        {{ readAt }}
      </span>
    </div>
  </div>
</template>
