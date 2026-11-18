<script setup lang="ts">
import type { UploadItem, UploadStore } from '~/composables/useUploads'

/**
 * The uploads in the corner (D-21, Matteo 18/11: «come su Drive, in basso a destra»): a file
 * started in the library or in the editor goes on while the person moves around the panel, and
 * here they see it, pause it or cancel it. A page that draws the uploads of a client itself (the
 * library, the editor) takes them out of here while it is open.
 */
const { t } = useI18n()
const org = useOrganization()
const { data: workspaces } = useWorkspaces()
const { line, tone, showsBar, barPercent, workPercent } = useUploadLine()

const visible = computed(() =>
  uploadStores().filter(
    (s) => s.orgSlug === org.slug.value && s.shown.value === 0 && s.items.value.length > 0,
  ),
)
const items = computed(() => visible.value.flatMap((s) => s.items.value))
const active = computed(() => visible.value.some((s) => s.totals.value.active))
const busy = computed(() =>
  items.value.filter((i) => !['ready', 'failed', 'rejected', 'error'].includes(i.state)),
)
const open = ref(true)

const title = computed(() =>
  busy.value.length > 0
    ? t('upload.dock.uploading', { n: busy.value.length }, busy.value.length)
    : t('upload.dock.done', { n: items.value.length }, items.value.length),
)
const overall = computed(() => {
  const all = visible.value.map((s) => s.totals.value)
  const size = all.reduce((n, x) => n + x.size, 0)
  const sent = all.reduce((n, x) => n + x.sent, 0)
  return size > 0 ? Math.floor((sent / size) * 100) : 0
})

const clientOf = (s: UploadStore) =>
  workspaces.value?.items.find((w) => w.id === s.workspaceId) ?? null
const libraryOf = (s: UploadStore) => {
  const c = clientOf(s)
  return c ? org.to(`/spazi/${encodeURIComponent(c.slug)}/libreria`) : null
}

/** Closes the dock: what is finished goes away, what still runs goes on behind it. */
function close() {
  for (const s of visible.value) s.clearFinished()
  if (active.value) open.value = false
}
const canPause = (i: UploadItem) => ['queued', 'hashing', 'uploading', 'offline'].includes(i.state)
const canResume = (i: UploadItem) => ['paused', 'error'].includes(i.state)
const canCancel = (i: UploadItem) =>
  !['completing', 'processing', 'ready', 'failed'].includes(i.state)
const announcement = computed(() =>
  visible.value
    .map((s) => s.announcement.value)
    .filter(Boolean)
    .join(' '),
)
</script>

<template>
  <section
    v-if="visible.length > 0"
    :aria-label="$t('upload.title')"
    data-testid="uploads-dock"
    class="fixed right-2 bottom-20 left-2 z-40 rounded-lg border border-(--app-border) bg-(--app-surface) shadow-lg sm:left-auto sm:w-96 md:right-4 md:bottom-4"
  >
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <header class="flex items-center gap-2 py-1 pr-1 pl-4">
      <p class="min-w-0 flex-1 text-sm font-semibold">
        {{ title }}
        <span v-if="busy.length > 0" class="font-normal text-(--app-text-muted) tabular-nums"
          >· {{ overall }}%</span
        >
      </p>
      <UButton
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
        :aria-label="open ? $t('upload.dock.collapse') : $t('upload.dock.expand')"
        :aria-expanded="open"
        @click="open = !open"
      />
      <UButton
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        icon="i-lucide-x"
        :aria-label="active ? $t('upload.dock.hide') : $t('upload.dock.close')"
        @click="close"
      />
    </header>
    <div
      v-if="!open && busy.length > 0"
      class="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-(--app-surface-sunken)"
      aria-hidden="true"
    >
      <div class="h-full bg-(--app-brand)" :style="{ width: `${overall}%` }" />
    </div>
    <div v-if="open" class="max-h-[50dvh] overflow-y-auto border-t border-(--app-border)">
      <div v-for="s in visible" :key="s.workspaceId" class="py-2">
        <p
          v-if="visible.length > 1 || clientOf(s)"
          class="flex items-center justify-between gap-2 px-4 pb-1 text-xs text-(--app-text-muted)"
        >
          <span class="truncate">{{ clientOf(s)?.name }}</span>
          <NuxtLink v-if="libraryOf(s)" :to="libraryOf(s)!" class="shrink-0 underline">{{
            $t('upload.dock.openLibrary')
          }}</NuxtLink>
        </p>
        <ul>
          <li
            v-for="i in s.items.value"
            :key="i.key"
            class="flex items-center gap-2 py-1 pr-1 pl-4"
          >
            <UIcon
              :name="i.kind === 'video' ? 'i-lucide-film' : 'i-lucide-image'"
              class="size-4 shrink-0 text-(--app-text-muted)"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p class="line-clamp-2 text-sm break-all" :title="i.name">{{ i.name }}</p>
              <p class="text-xs" :class="tone(i)">{{ line(i) }}</p>
              <div
                v-if="showsBar(i)"
                role="progressbar"
                :aria-label="$t('upload.progressLabel', { name: i.name })"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="
                  i.state === 'processing' && workPercent(i) === null ? undefined : barPercent(i)
                "
                class="mt-1 h-1 overflow-hidden rounded-full bg-(--app-surface-sunken)"
              >
                <div class="h-full bg-(--app-brand)" :style="{ width: `${barPercent(i)}%` }" />
              </div>
            </div>
            <UButton
              v-if="canPause(i)"
              color="neutral"
              variant="ghost"
              class="size-10 shrink-0 justify-center"
              icon="i-lucide-pause"
              :aria-label="$t('upload.pauseFor', { name: i.name })"
              @click="s.pause(i)"
            />
            <UButton
              v-else-if="canResume(i)"
              color="neutral"
              variant="ghost"
              class="size-10 shrink-0 justify-center"
              icon="i-lucide-play"
              :aria-label="$t('upload.resumeFor', { name: i.name })"
              @click="s.resume(i)"
            />
            <UButton
              v-if="canCancel(i)"
              color="neutral"
              variant="ghost"
              class="size-10 shrink-0 justify-center"
              icon="i-lucide-x"
              :aria-label="$t('upload.cancelFor', { name: i.name })"
              @click="s.cancel(i)"
            />
            <UButton
              v-else-if="!showsBar(i)"
              color="neutral"
              variant="ghost"
              class="size-10 shrink-0 justify-center"
              icon="i-lucide-x"
              :aria-label="$t('upload.dismissFor', { name: i.name })"
              @click="s.dismiss(i)"
            />
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
