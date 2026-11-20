<script setup lang="ts">
import type { PostCheckResponse } from '@app/contracts'
import type { PostEditor } from '~/composables/usePostEditor'
import { CROP_MIN_SIDE, canCrop } from '~/utils/crop-box'
import { missingFiles, properType, type PostType } from '~/utils/post-editor'
import PostEditorRow from './EditorRow.vue'

/**
 * «Controlli» (§11.2 point 7, F04; screens 08 and 09): how the post stands («Tutto pronto»,
 * «1 scelta da fare»), the warnings to answer in an amber box (their options as rows, «Annulla»
 * closes without choosing, D-52), the blocks with the way to fix them, one row per account with
 * what goes out there, its state and the files that do not (D-56), last «4 correzioni fatte da
 * Feedway. Dettagli». Under the preview from 1024 px (`column`), the last row of the form below.
 */
const props = withDefaults(
  defineProps<{
    editor: PostEditor
    accounts: Map<string, ProfileAccount>
    /** the copies are read from the library, Editor and up (D-72) */
    showFiles: boolean
    placement?: 'row' | 'column'
  }>(),
  { placement: 'row' },
)
const emit = defineEmits<{ goto: [section: string] }>()
const { t, n } = useI18n()
const e = props.editor

type Outcome = PostCheckResponse['outcomes'][number]
const report = computed(() => e.report.value)
const outcomes = computed(() => report.value?.outcomes ?? [])
const warnings = computed(() => outcomes.value.filter((o) => o.level === 'warning'))
const blocks = computed(() => outcomes.value.filter((o) => o.level === 'block'))
const fixes = computed(() => outcomes.value.filter((o) => o.level === 'fix'))
const open = ref(false)

const msg = (o: Outcome) => ruleMessage(o, (key, values) => t(key, values ?? {}))
const handleOf = (id: string) => {
  const a = props.accounts.get(id)
  if (!a) return t('posts.summary.unknownAccount')
  return a.platform === 'instagram' && a.username ? `@${a.username}` : a.name
}
const ordinal = (n: number) => t('posts.summary.place', { n })
/** «File 3», «su Instagram, @fornoluce»: whom an outcome is about. */
function subject(o: Outcome): string {
  const parts: string[] = []
  if (o.subject.kind === 'media') parts.push(t('posts.summary.file', { n: o.subject.index + 1 }))
  if (o.subject.kind === 'cover') parts.push(t('posts.summary.cover'))
  if (o.subject.kind === 'destination') parts.push(handleOf(o.subject.accountId))
  else if (o.platform) {
    const on = (report.value?.destinations ?? [])
      .filter((d) => d.platform === o.platform && d.outcomeKeys.includes(o.key))
      .map((d) => handleOf(d.accountId))
    parts.push(
      t('posts.summary.on', {
        platform: t(`rules.platforms.${o.platform}`),
        accounts: on.join(', '),
      }),
    )
  }
  return parts.join(' · ')
}

/** Where a block is fixed: the section of the editor it sends to. */
function fixAt(o: Outcome): { section: string; label: string } | null {
  if (o.code === 'scheduled_in_past' || o.code.startsWith('time_'))
    return { section: 'post-when', label: t('posts.summary.toWhen') }
  if (o.code.startsWith('caption_') || o.code.startsWith('too_many_'))
    return { section: 'post-caption', label: t('posts.summary.toCaption') }
  if (o.subject.kind === 'destination' || o.code === 'no_destinations')
    return { section: 'post-destinations', label: t('posts.summary.toDestinations') }
  if (o.subject.kind === 'media' || o.code.startsWith('media_') || o.code === 'no_media')
    return { section: 'post-media', label: t('posts.summary.toMedia') }
  return null
}
const proposal = computed(() => (e.type.value ? properType(e.type.value, e.kinds.value) : null))

const rows = computed(() =>
  (report.value?.destinations ?? []).map((d) => {
    const keys = new Set(d.outcomeKeys)
    const mine = outcomes.value.filter(
      (o) => keys.has(o.key) || report.value?.postKeys.includes(o.key),
    )
    const blocked = mine.some((o) => o.level === 'block') || d.format === null
    const open = mine.filter((o) => o.level === 'warning' && !o.chosen).length
    const missing =
      d.format === null || e.type.value === null
        ? []
        : missingFiles(e.kinds.value, d.media).map((m) =>
            t(m.kind === 'video' ? 'posts.summary.missingVideo' : 'posts.summary.missingPhoto', {
              place: ordinal(m.index + 1),
            }),
          )
    return {
      id: d.accountId,
      platform: d.platform,
      what: d.format && d.platform ? whatOf(d.platform, d.format, d.media) : null,
      own:
        d.platform !== null &&
        e.split.value &&
        (e.caption[d.platform] ?? '').trim() !== '' &&
        e.caption[d.platform] !== e.caption.common,
      missing,
      tone: blocked ? 'block' : open > 0 ? 'warning' : 'ok',
      state: blocked
        ? t('posts.summary.blocked')
        : open > 0
          ? t('posts.summary.toChoose', { n: open }, open)
          : t('posts.summary.ready'),
    }
  }),
)
/** «Carosello, 2 foto», «Post con 2 foto», «Reel»: what goes out on an account (screen 08). */
function whatOf(platform: string, format: string, media: readonly number[]): string {
  const kinds = media.map((i) => e.kinds.value[i]?.kind)
  const photos = kinds.filter((k) => k === 'image').length
  if (format === 'multi_photo') return t('posts.summary.postWithPhotos', { n: photos }, photos)
  const label = t(`rules.formats.${platform}.${format}`)
  if (format !== 'carousel') return label
  const files =
    photos === kinds.length
      ? t('posts.summary.photos', { n: photos }, photos)
      : photos === 0
        ? t('posts.summary.videos', { n: kinds.length }, kinds.length)
        : t('posts.summary.files', { n: kinds.length }, kinds.length)
  return `${label}, ${files}`
}
/** How the post stands, beside «Controlli». */
const overall = computed<{ label: string; tone: 'success' | 'warning' | 'danger' } | null>(() => {
  if (!report.value) return null
  const blocked = blocks.value.length + (proposal.value ? 1 : 0)
  if (blocked > 0)
    return { label: t('posts.summary.blocks', { n: blocked }, blocked), tone: 'danger' }
  if (pending.value > 0)
    return {
      label: t('posts.summary.pending', { n: pending.value }, pending.value),
      tone: 'warning',
    }
  return { label: t('posts.summary.allReady'), tone: 'success' }
})
const fixSentence = computed(() => {
  const titles = fixes.value.map((o) => msg(o).title.toLowerCase())
  return titles.filter((x, i) => titles.indexOf(x) === i).join(', ')
})
const choosing = ref<Record<string, string>>({})
watch(
  warnings,
  (list) => {
    choosing.value = Object.fromEntries(list.map((o) => [o.key, o.chosen ?? '']))
  },
  { immediate: true },
)
const ICON: Record<string, string> = {
  instagram: 'i-lucide-instagram',
  facebook: 'i-lucide-facebook',
}
const TONE = { ok: 'success', warning: 'warning', block: 'danger' } as const
const pending = computed(() => report.value?.unresolved.length ?? 0)
defineExpose({ proposal })
const switchTo = (type: PostType) => e.chooseType(type)

// ---- «Ritaglia»: the box, moved by the person (D-61)
const cropping = ref<Outcome | null>(null)
/** The photo holds a box to move (D-61); a smaller one is cut in the middle, with no box. */
const movable = (o: Outcome) =>
  !!o.cropRatio &&
  canCrop({
    width: Number(o.params.width),
    height: Number(o.params.height),
    ratio: o.cropRatio,
    minSide: CROP_MIN_SIDE,
  })
function pick(o: Outcome, option: string) {
  if (option === 'crop' && movable(o)) {
    openCrop(o)
    return
  }
  e.choose(o.key, option)
}
function openCrop(o: Outcome) {
  cropping.value = o
}
function closeCrop() {
  // the radio goes back to the answer given
  const o = cropping.value
  cropping.value = null
  if (o) choosing.value = { ...choosing.value, [o.key]: o.chosen ?? '' }
}
function applyCrop(crop: { x: number; y: number; width: number; height: number }) {
  const o = cropping.value
  cropping.value = null
  if (o) e.choose(o.key, 'crop', crop)
}
const ratioLabel = (r: number) =>
  Math.abs(r - 0.8) < 0.01
    ? '4:5'
    : Math.abs(r - 9 / 16) < 0.01
      ? '9:16'
      : `${n(r, { maximumFractionDigits: 2 })}:1`
/**
 * The photo a cover outcome is about, from its key (`<code>:cover:<mediaId>[:<platform>]`): the
 * box opens on the photo the report measured, even if the cover changed since.
 */
function coverSrcOf(key: string) {
  const [, , id] = key.split(':')
  const ofFile = id !== undefined && id !== 'instagram' && id !== 'facebook'
  const c = e.cover.value
  if (!ofFile || (c?.source === 'image' && c.mediaId === id)) return e.coverSrc.value
  return e.fileUrl(id, 'ig_feed')
}
const crop = computed(() => {
  const o = cropping.value
  if (!o?.cropRatio) return null
  const width = Number(o.params.width)
  const height = Number(o.params.height)
  let id: string | null = null
  let name = t('posts.summary.cover')
  if (o.subject.kind === 'media') {
    id = e.reportMedia.value[o.subject.index] ?? null
    name =
      e.files.value.find((f) => f.id === id)?.name ??
      t('posts.summary.file', { n: o.subject.index + 1 })
  }
  const label = ratioLabel(o.cropRatio)
  return {
    title: t(o.subject.kind === 'cover' ? 'posts.crop.titleCover' : 'posts.crop.titleFeed'),
    subtitle: [name, `${String(width)}×${String(height)}`, subject(o)].filter(Boolean).join(' · '),
    src: !props.showFiles
      ? null
      : o.subject.kind === 'cover'
        ? coverSrcOf(o.key)
        : id
          ? e.fileUrl(id, 'ig_feed')
          : null,
    width,
    height,
    ratio: o.cropRatio,
    label,
    initial: e.choices.value.find((c) => c.key === o.key)?.crop ?? null,
  }
})
</script>

<template>
  <component
    :is="placement === 'row' ? PostEditorRow : 'section'"
    id="post-summary"
    v-bind="
      placement === 'row'
        ? {
            heading: 'post-summary-title',
            label: $t('posts.summary.title'),
            detail: overall?.label,
          }
        : { 'aria-labelledby': 'post-summary-title' }
    "
    class="scroll-mt-20"
    data-checks
  >
    <div v-if="placement === 'column'" class="mb-3 flex min-h-control items-center gap-2">
      <h2 id="post-summary-title" class="flex-1">{{ $t('posts.summary.title') }}</h2>
      <StatusDot v-if="overall" :label="overall.label" :tone="overall.tone" class="text-detail" />
    </div>
    <div class="flex flex-col gap-3">
      <p v-if="e.checkProblem.value" role="alert" class="text-detail text-(--app-danger)">
        {{ $t('posts.summary.checkFailed') }} {{ e.checkProblem.value }}
      </p>
      <ListSkeleton v-if="!report && e.checking.value" />
      <p v-else-if="!report" class="text-(--app-text-muted)">{{ $t('posts.summary.empty') }}</p>
      <template v-else>
        <!-- the warnings to answer -->
        <fieldset
          v-for="o in warnings"
          :key="o.key"
          :data-outcome="o.code"
          class="grid gap-2.5 rounded-card border p-3.5"
          :class="
            o.chosen
              ? 'border-(--app-border) bg-(--app-surface)'
              : 'border-(--app-warning-dot) bg-(--app-warning-soft)'
          "
        >
          <legend class="sr-only">{{ msg(o).title }}</legend>
          <p class="flex items-center gap-2 font-semibold">
            <UIcon
              name="i-lucide-triangle-alert"
              class="size-4 shrink-0 text-(--app-warning-dot)"
              aria-hidden="true"
            />
            {{ msg(o).title }}
          </p>
          <p v-if="subject(o)" class="text-caption text-(--app-text-muted)">{{ subject(o) }}</p>
          <p>{{ msg(o).text }}</p>
          <label
            v-for="(option, i) in o.options ?? []"
            :key="option"
            class="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-control border bg-(--app-surface) px-3 py-2 max-md:min-h-11"
            :class="
              choosing[o.key] === option
                ? 'border-(--app-text) shadow-[0_0_0_1px_var(--app-text)]'
                : 'border-(--app-border-strong)'
            "
          >
            <input
              type="radio"
              class="size-4 shrink-0 accent-(--app-text)"
              :name="`choice-${o.key}`"
              :value="option"
              :checked="choosing[o.key] === option"
              :disabled="!e.editable.value"
              @change="pick(o, option)"
            />
            <span>
              {{ msg(o).options[i] }}
              <span v-if="o.recommended === option" class="text-caption text-(--app-text-muted)">
                · {{ $t('posts.summary.recommended') }}</span
              >
            </span>
          </label>
          <div v-if="o.chosen && e.editable.value" class="flex flex-wrap gap-2">
            <UButton
              v-if="o.chosen === 'crop' && movable(o)"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-crop"
              @click="openCrop(o)"
            >
              {{ $t('posts.crop.edit') }}
            </UButton>
            <UButton color="neutral" variant="link" size="sm" @click="e.choose(o.key, null)">
              {{ $t('posts.summary.undoChoice') }}
            </UButton>
          </div>
        </fieldset>

        <!-- the blocks -->
        <div
          v-for="o in blocks"
          :key="o.key"
          :data-outcome="o.code"
          class="grid gap-2 rounded-card border border-(--app-danger) bg-(--app-danger-soft) p-3.5"
        >
          <p class="flex items-center gap-2 font-semibold">
            <UIcon
              name="i-lucide-octagon-x"
              class="size-4 shrink-0 text-(--app-danger)"
              aria-hidden="true"
            />
            {{ msg(o).title }}
          </p>
          <p v-if="subject(o)" class="text-caption text-(--app-text-muted)">{{ subject(o) }}</p>
          <p>{{ msg(o).text }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="o.code === 'type_not_supported' && proposal && e.editable.value"
              color="neutral"
              variant="outline"
              size="sm"
              @click="switchTo(proposal)"
            >
              {{ $t('posts.summary.switchTo', { type: $t(`posts.type.${proposal}`) }) }}
            </UButton>
            <UButton
              v-if="fixAt(o)"
              color="neutral"
              variant="outline"
              size="sm"
              @click="emit('goto', fixAt(o)!.section)"
            >
              {{ fixAt(o)!.label }}
            </UButton>
          </div>
        </div>
        <div
          v-if="
            proposal && !blocks.some((o) => o.code === 'type_not_supported') && e.editable.value
          "
          class="grid gap-2 rounded-card border border-(--app-danger) bg-(--app-danger-soft) p-3.5"
          data-outcome="type_mismatch"
        >
          <p class="font-semibold">{{ $t('posts.summary.typeMismatch') }}</p>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            class="justify-self-start"
            @click="switchTo(proposal)"
          >
            {{ $t('posts.summary.switchTo', { type: $t(`posts.type.${proposal}`) }) }}
          </UButton>
        </div>

        <!-- one row per account -->
        <ul
          v-if="rows.length > 0"
          class="overflow-hidden rounded-card border border-(--app-border) bg-(--app-surface)"
        >
          <li
            v-for="r in rows"
            :key="r.id"
            class="border-t border-(--app-border) px-3 py-1.5 first:border-t-0"
            :data-destination="r.id"
          >
            <div
              class="grid min-h-8 grid-cols-[1.125rem_minmax(0,1fr)_auto] items-center gap-x-2.5"
            >
              <UIcon
                :name="ICON[r.platform ?? ''] ?? 'i-lucide-at-sign'"
                class="size-4"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ handleOf(r.id) }}</span>
                <span class="block truncate text-caption text-(--app-text-muted)">
                  <template v-if="r.what">
                    {{ r.what
                    }}<template v-if="r.own"> · {{ $t('posts.summary.ownText') }}</template>
                  </template>
                  <template v-else>{{ $t('posts.summary.notGoing') }}</template>
                </span>
              </span>
              <StatusDot :label="r.state" :tone="TONE[r.tone]" />
            </div>
            <p
              v-for="m in r.missing"
              :key="m"
              class="pb-1 ps-7 text-caption text-(--app-danger)"
              data-missing
            >
              {{ $t('posts.summary.missingOn', { what: m, account: handleOf(r.id) }) }}
            </p>
          </li>
        </ul>

        <!-- the fixes, in one sentence -->
        <div v-if="fixes.length > 0" class="text-detail text-(--app-text-muted)">
          <p>
            {{ $t('posts.summary.fixes', { n: fixes.length }, fixes.length) }}
            <button
              type="button"
              class="font-semibold text-(--app-text) underline-offset-3 hover:underline"
              :aria-expanded="open"
              :title="fixSentence"
              @click="open = !open"
            >
              {{ open ? $t('posts.summary.hideDetails') : $t('posts.summary.showDetails') }}
            </button>
          </p>
          <ul v-if="open" class="mt-1.5 list-disc ps-5">
            <li v-for="o in fixes" :key="o.key">
              <span v-if="subject(o)">{{ subject(o) }}: </span>{{ msg(o).text }}
            </li>
          </ul>
        </div>
      </template>
      <PostCropBox
        v-if="crop"
        :open="cropping !== null"
        :title="crop.title"
        :subtitle="crop.subtitle"
        :src="crop.src"
        :width="crop.width"
        :height="crop.height"
        :ratio="crop.ratio"
        :ratio-label="crop.label"
        :initial="crop.initial"
        @apply="applyCrop"
        @close="closeCrop"
      />
    </div>
  </component>
</template>
