<script setup lang="ts">
import type { MediaDto } from '@app/contracts'
import { CALENDAR_MOVING } from '~/composables/useCalendarMove'
import { newPostQuery } from '~/utils/new-post-address'

/**
 * «Libreria» of the calendar (spec §11.4, plan 09 Scelta 5): the client's library in small, in a
 * column beside the calendar, closed until asked. The folders in a menu, the search, «Tutti» or
 * «Nei post»; a file is dragged onto a day to start a post of that day with it, or «Usa in un
 * post» opens the editor with it. Only on a computer: the phone has no room beside the days.
 */
const props = defineProps<{ client: WorkspaceView }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const org = useOrganization()
const route = useRoute()

const lib = useLibrary(
  computed(() => props.client.id),
  { lazy: true },
)
const { filter, folders } = lib
onMounted(() => void lib.load())

const folderItems = computed(() => [
  { value: 'all', label: t('library.folders.all') },
  { value: 'none', label: t('library.folders.none') },
  ...folderTree(folders.value).map((f) => ({ value: f.id, label: f.path })),
])
const folder = computed({
  get: () => filter.folder ?? 'all',
  set: (v: string) => (filter.folder = v === 'all' ? null : v),
})
const use = computed({
  get: () => (filter.inPosts ? 'inPosts' : 'all'),
  set: (v: 'all' | 'inPosts') => (filter.inPosts = v === 'inPosts'),
})

const shown = computed(() =>
  lib.files.value.filter((f) => f.status === 'ready' || f.status === 'processing'),
)
const thumb = (f: MediaDto) => {
  const variant = thumbnailOf(f)
  return variant ? lib.fileUrl(f, variant) : null
}
/** «Usa in un post»: the editor of a new post with the file, in the profile of the context */
const editorWith = (f: MediaDto) => {
  const profilo = route.query['profilo']
  return {
    path: org.to(`/spazi/${encodeURIComponent(props.client.slug)}/post/nuovo`),
    query: {
      ...newPostQuery({ fileIds: [f.id] }),
      ...(typeof profilo === 'string' && profilo !== '' ? { profilo } : {}),
    },
  }
}

const moving = inject(CALENDAR_MOVING, null)
</script>

<template>
  <aside
    class="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-3 overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface) p-3"
    :aria-label="$t('calendar.library.title')"
    data-calendar-library
  >
    <div class="flex items-center gap-2">
      <h2 class="min-w-0 flex-1 truncate text-[14px] leading-5 font-semibold">
        {{ $t('calendar.library.title') }}
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        class="size-8 justify-center"
        :aria-label="$t('calendar.library.close')"
        data-calendar-library-close
        @click="emit('close')"
      />
    </div>
    <p class="text-caption text-(--app-text-muted)">{{ $t('calendar.library.hint') }}</p>
    <USelect
      v-model="folder"
      :items="folderItems"
      :aria-label="$t('library.folders.choose')"
      icon="i-lucide-folder"
      class="w-full"
    />
    <SearchField v-model="filter.q" :label="$t('calendar.library.search')" />
    <SegmentedFilter
      v-model="use"
      wide
      :label="$t('calendar.library.use')"
      :options="[
        { value: 'all', label: t('calendar.library.all') },
        { value: 'inPosts', label: t('calendar.library.inPosts') },
      ]"
    />

    <div class="-mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-1">
      <ListSkeleton
        v-if="lib.status.value === 'pending' && shown.length === 0"
        :rows="3"
        :action="false"
      />
      <LoadFailed
        v-else-if="lib.status.value === 'error'"
        :text="$t('calendar.library.failed')"
        @retry="lib.load()"
      />
      <p v-else-if="shown.length === 0" class="text-detail text-(--app-text-muted)">
        {{ $t('calendar.library.empty') }}
      </p>
      <ul
        v-else
        class="grid grid-cols-2 gap-x-2 gap-y-3"
        :aria-label="$t('calendar.library.files')"
      >
        <li
          v-for="f in shown"
          :key="f.id"
          class="flex min-w-0 flex-col gap-1"
          :data-library-file="f.id"
        >
          <div
            :draggable="moving ? 'true' : 'false'"
            class="flex aspect-[4/5] w-full cursor-grab items-center justify-center overflow-hidden rounded-thumb bg-(--app-surface-sunken) text-(--app-text-muted) outline outline-1 -outline-offset-1 outline-(--app-img-outline) active:cursor-grabbing"
            :class="moving?.liftedFile.value === f.id ? 'opacity-40' : ''"
            :title="$t('calendar.library.drag')"
            data-library-drag
            @dragstart="moving?.liftFile($event, f.id)"
            @dragend="moving?.settle()"
          >
            <img
              v-if="thumb(f)"
              :src="thumb(f)!"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              class="size-full object-cover"
            />
            <UIcon
              v-else
              :name="f.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'"
              class="size-6"
              aria-hidden="true"
            />
          </div>
          <p class="truncate text-caption" :title="f.originalName">{{ f.originalName }}</p>
          <UButton
            :to="editorWith(f)"
            color="neutral"
            variant="outline"
            size="sm"
            class="justify-center"
            :aria-label="$t('calendar.library.useFor', { name: f.originalName })"
            data-library-use
          >
            {{ $t('calendar.library.useInPost') }}
          </UButton>
        </li>
      </ul>
      <UButton
        v-if="lib.next.value"
        color="neutral"
        variant="outline"
        class="mt-3 w-full justify-center"
        :loading="lib.loadingMore.value"
        @click="lib.more()"
      >
        {{ $t('calendar.library.more') }}
      </UButton>
    </div>
  </aside>
</template>
