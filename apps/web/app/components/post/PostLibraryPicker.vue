<script setup lang="ts">
import type { MediaDto } from '@app/contracts'

/**
 * «Dalla libreria» (§11.2 point 3): the client's library in a window, to choose one or more
 * files, in the order they are ticked.
 */
const props = defineProps<{ client: WorkspaceView; exclude: string[] }>()
const emit = defineEmits<{ pick: [MediaDto[]] }>()
const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()

const workspaceId = computed(() => props.client.id)
const lib = useLibrary(workspaceId)
const chosen = ref<MediaDto[]>([])
watch(open, (now) => {
  if (!now) return
  chosen.value = []
  void lib.load()
})
const shown = computed(() =>
  lib.files.value.filter((f) => !props.exclude.includes(f.id) && f.status !== 'uploading'),
)
const isChosen = (f: MediaDto) => chosen.value.some((c) => c.id === f.id)
function toggle(f: MediaDto) {
  chosen.value = isChosen(f) ? chosen.value.filter((c) => c.id !== f.id) : [...chosen.value, f]
}
const thumb = (f: MediaDto) => {
  const variant = thumbnailOf(f)
  return variant ? lib.fileUrl(f, variant) : null
}
function done() {
  emit('pick', chosen.value)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('posts.library.title')"
    :description="$t('posts.library.text')"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <SearchField
            v-model="lib.filter.q"
            :label="$t('posts.library.search')"
            class="flex-1"
            @update:model-value="lib.load()"
          />
          <SegmentedFilter
            v-model="lib.filter.kind"
            :label="$t('posts.library.kind')"
            :options="[
              { value: 'all', label: t('posts.library.all') },
              { value: 'image', label: t('posts.library.photos') },
              { value: 'video', label: t('posts.library.videos') },
            ]"
            @update:model-value="lib.load()"
          />
        </div>
        <ListSkeleton v-if="lib.status.value === 'pending' && shown.length === 0" />
        <p v-else-if="lib.status.value === 'error'" role="alert" class="text-(--app-danger)">
          {{ $t('posts.library.error') }}
        </p>
        <p v-else-if="shown.length === 0" class="text-(--app-text-muted)">
          {{ $t('posts.library.empty') }}
        </p>
        <ul
          v-else
          :aria-label="$t('posts.library.title')"
          class="grid grid-cols-3 gap-2 sm:grid-cols-5"
        >
          <li v-for="f in shown" :key="f.id">
            <button
              type="button"
              :aria-pressed="isChosen(f)"
              :aria-label="f.originalName"
              class="relative block aspect-[4/5] w-full overflow-hidden rounded-lg border-2 bg-(--app-surface-sunken)"
              :class="isChosen(f) ? 'border-(--app-brand)' : 'border-transparent'"
              @click="toggle(f)"
            >
              <img v-if="thumb(f)" :src="thumb(f)!" alt="" class="size-full object-cover" />
              <UIcon
                v-else
                :name="f.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'"
                class="size-6 text-(--app-text-muted)"
                aria-hidden="true"
              />
              <span
                v-if="isChosen(f)"
                class="absolute top-1 left-1 flex size-6 items-center justify-center rounded-full bg-(--app-brand) text-xs font-semibold text-(--app-on-brand) tabular-nums"
                aria-hidden="true"
                >{{ chosen.findIndex((c) => c.id === f.id) + 1 }}</span
              >
            </button>
            <p class="mt-1 line-clamp-2 text-xs break-all" :title="f.originalName">
              {{ f.originalName }}
            </p>
          </li>
        </ul>
        <UButton
          v-if="lib.next.value"
          color="neutral"
          variant="outline"
          class="min-h-11 self-start"
          :loading="lib.loadingMore.value"
          @click="lib.more()"
        >
          {{ $t('posts.library.more') }}
        </UButton>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-3">
        <UButton color="neutral" variant="ghost" class="min-h-11" @click="open = false">
          {{ $t('security.cancel') }}
        </UButton>
        <UButton class="min-h-11" :disabled="chosen.length === 0" @click="done">
          {{ $t('posts.library.add', { n: chosen.length }, chosen.length) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
