<script setup lang="ts">
import type { WorkspaceView } from '~/composables/useOrganization'

/**
 * «Per quale cliente fai il piano?» (spec §11.12): from «Tutti i clienti» the plan asks for its
 * client, and the choice becomes the context. The clients where the person plans; when there is
 * none, those they see, to read (D-123.23).
 */
const open = defineModel<boolean>('open', { required: true })
defineProps<{ clients: { workspace: WorkspaceView; readOnly: boolean }[] }>()
const emit = defineEmits<{ choose: [slug: string] }>()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('plan.choose.title')"
    :description="$t('plan.choose.text')"
    :close="false"
    :ui="{
      overlay: 'bg-[rgb(36_35_33/0.4)]',
      content:
        'w-[420px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
      header: 'min-h-0 border-0 px-5 pt-5 pb-1',
      title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em]',
      description: 'text-(--app-text-muted)',
      body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
    }"
    data-plan-clients
  >
    <template #body>
      <p v-if="clients.length === 0" class="text-(--app-text-muted)">
        {{ $t('plan.choose.none') }}
      </p>
      <ul v-else class="max-h-80 overflow-y-auto rounded-card border border-(--app-border)">
        <li
          v-for="c in clients"
          :key="c.workspace.id"
          class="border-t border-(--app-border) first:border-t-0"
        >
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-3 px-3 text-start hover:bg-(--app-surface-sunken)"
            @click="emit('choose', c.workspace.slug)"
          >
            <RowAvatar :name="c.workspace.name" :src="c.workspace.photoUrl ?? null" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ c.workspace.name }}</span>
            <span v-if="c.readOnly" class="shrink-0 text-detail text-(--app-text-muted)">
              {{ $t('plan.choose.readOnly') }}
            </span>
          </button>
        </li>
      </ul>
    </template>
  </UModal>
</template>
