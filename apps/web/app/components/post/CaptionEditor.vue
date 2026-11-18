<script setup lang="ts">
import type { CaptionTemplateDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { captionStats } from '@app/domain'
import { META_LIMITS } from '@app/domain/platforms/meta'
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Testo» (RF-32, §11.2 point 4; design E1): one common text with the counters of each platform
 * the post goes to, counted here with `captionStats` and no call (D-57). «Testo diverso per
 * piattaforma» opens a tab per platform of the chosen accounts, starting from a copy of the
 * common text; «Torna al testo comune» drops that tab's text, with «Annulla». A story has no
 * text: the box goes, the text stays in the draft and comes back with another type (D-60).
 * «Inserisci» puts a template of the client where the cursor is, in the tab shown (§11.7, E8c).
 */
const props = defineProps<{
  editor: PostEditor
  platforms: ('instagram' | 'facebook')[]
  /** the client's templates; null while they load */
  templates: CaptionTemplateDto[] | null
  /** «Gestisci i modelli»: the client's content settings, for who manages them */
  manageTo: string | null
}>()
const { t } = useI18n()
const e = props.editor

type Tab = 'instagram' | 'facebook'
const tab = ref<Tab>('instagram')
const tabs = computed<Tab[]>(() =>
  props.platforms.length > 0 ? props.platforms : ['instagram', 'facebook'],
)
watch(tabs, (list) => {
  if (!list.includes(tab.value) && list[0]) tab.value = list[0]
})

const LIMITS = {
  instagram: {
    characters: META_LIMITS.instagramCaptionCharacters.value,
    hashtags: META_LIMITS.instagramCaptionHashtags.value,
    mentions: META_LIMITS.instagramCaptionMentions.value,
  },
  facebook: { characters: META_LIMITS.facebookCaptionCharacters.value },
} as const
const fmt = new Intl.NumberFormat('it-IT', { useGrouping: 'always' })

/** The counters of a text against the limits of a platform: «214 di 2.200 caratteri · …». */
function counters(text: string, platform: Tab) {
  const s = captionStats(text)
  const l = LIMITS[platform]
  const parts = [
    {
      text: t('posts.caption.characters', {
        n: fmt.format(s.characters),
        limit: fmt.format(l.characters),
      }),
      over: s.characters > l.characters,
    },
  ]
  if ('hashtags' in l) {
    parts.push({
      text: t('posts.caption.hashtags', { n: s.hashtags, limit: l.hashtags }),
      over: s.hashtags > l.hashtags,
    })
    parts.push({
      text: t('posts.caption.mentions', { n: s.mentions, limit: l.mentions }),
      over: s.mentions > l.mentions,
    })
  }
  return parts
}

const text = computed({
  get: () => (e.split.value ? (e.caption[tab.value] ?? '') : e.caption.common),
  set: (value: string) => {
    if (e.split.value) e.caption[tab.value] = value
    else e.caption.common = value
    e.touched()
  },
})

// «Torna al testo comune», with «Annulla» for a few seconds
const undo = ref<{ tab: Tab; text: string } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined
function backToCommon() {
  undo.value = { tab: tab.value, text: e.caption[tab.value] ?? '' }
  e.caption[tab.value] = e.caption.common
  e.touched()
  clearTimeout(undoTimer)
  undoTimer = setTimeout(() => (undo.value = null), 8000)
}
function undoBack() {
  if (!undo.value) return
  e.caption[undo.value.tab] = undo.value.text
  undo.value = null
  e.touched()
}
onBeforeUnmount(() => clearTimeout(undoTimer))

// ---- «Inserisci»: where the cursor is, or at the end if the box never had it
const box = ref<HTMLTextAreaElement | null>(null)
const TEMPLATE_ICON: Record<CaptionTemplateDto['kind'], string> = {
  signature: 'i-lucide-signature',
  hashtags: 'i-lucide-hash',
  caption: 'i-lucide-file-text',
}
const KIND_ORDER: CaptionTemplateDto['kind'][] = ['signature', 'hashtags', 'caption']
function insert(x: CaptionTemplateDto) {
  const el = box.value
  const now = text.value
  const start = el ? el.selectionStart : now.length
  const end = el ? el.selectionEnd : now.length
  const before = now.slice(0, start)
  // a signature or hashtags go on a paragraph of their own
  const gap =
    x.kind !== 'caption' && before.trim() !== '' && !before.endsWith('\n\n')
      ? before.endsWith('\n')
        ? '\n'
        : '\n\n'
      : ''
  const inserted = gap + x.body
  text.value = before + inserted + now.slice(end)
  const at = start + inserted.length
  void nextTick(() => {
    el?.focus()
    el?.setSelectionRange(at, at)
  })
}
const preview = (body: string) => {
  const line = body.replace(/\s+/g, ' ').trim()
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}
const insertItems = computed<DropdownMenuItem[][]>(() => {
  const list = props.templates ?? []
  const groups: DropdownMenuItem[][] = KIND_ORDER.map((kind) => list.filter((x) => x.kind === kind))
    .filter((g) => g.length > 0)
    .map((g) => [
      { type: 'label', label: t(`contentSettings.templates.kinds.${g[0]?.kind ?? 'caption'}`) },
      ...g.map((x) => ({
        label: x.name,
        description: preview(x.body),
        icon: TEMPLATE_ICON[x.kind],
        onSelect: () => insert(x),
      })),
    ])
  if (list.length === 0) groups.push([{ label: t('posts.caption.noTemplates'), disabled: true }])
  if (props.manageTo)
    groups.push([{ label: t('posts.caption.manageTemplates'), to: props.manageTo }])
  return groups
})

const ICON: Record<Tab, string> = { instagram: 'i-lucide-instagram', facebook: 'i-lucide-facebook' }
</script>

<template>
  <section aria-labelledby="post-caption" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="post-caption" class="text-lg">{{ $t('posts.caption.title') }}</h2>
      <USwitch
        v-if="e.type.value !== 'story'"
        :model-value="e.split.value"
        :label="$t('posts.caption.split')"
        :disabled="!e.editable.value"
        @update:model-value="e.setSplit($event)"
      />
    </div>
    <p v-if="e.type.value === 'story'" class="text-sm text-(--app-text-muted)">
      {{ $t('posts.caption.story') }}
    </p>
    <div
      v-else
      class="overflow-hidden rounded-lg border border-(--app-field-border) bg-(--app-card) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--app-focus)"
    >
      <div class="flex items-center justify-between gap-2 border-b border-(--app-border) pr-2">
        <div
          v-if="e.split.value"
          role="tablist"
          :aria-label="$t('posts.caption.platforms')"
          class="flex gap-1 px-2"
        >
          <button
            v-for="p in tabs"
            :key="p"
            role="tab"
            type="button"
            :aria-selected="tab === p"
            :aria-controls="'post-caption-text'"
            class="flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm"
            :class="
              tab === p
                ? 'border-(--app-brand) font-semibold'
                : 'border-transparent text-(--app-text-muted)'
            "
            @click="tab = p"
          >
            <UIcon :name="ICON[p]" class="size-4" aria-hidden="true" />
            {{ $t(`rules.platforms.${p}`) }}
          </button>
        </div>
        <p v-else class="px-4 py-2 text-sm text-(--app-text-muted)">
          {{ $t('posts.caption.common') }}
        </p>
        <UDropdownMenu
          v-if="e.editable.value"
          :items="insertItems"
          :content="{ align: 'end' }"
          :ui="{ content: 'w-80 max-w-[calc(100vw-2rem)]', itemDescription: 'truncate' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="relative min-h-10 after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-['']"
            icon="i-lucide-plus"
            trailing-icon="i-lucide-chevron-down"
            :loading="templates === null"
          >
            {{ $t('posts.caption.insert') }}
          </UButton>
        </UDropdownMenu>
      </div>
      <label for="post-caption-text" class="sr-only">{{
        e.split.value
          ? $t('posts.caption.textFor', { platform: $t(`rules.platforms.${tab}`) })
          : $t('posts.caption.common')
      }}</label>
      <textarea
        id="post-caption-text"
        ref="box"
        v-model="text"
        rows="6"
        :readonly="!e.editable.value"
        :placeholder="$t('posts.caption.placeholder')"
        class="block w-full resize-y bg-transparent px-4 py-3 text-base outline-none"
        data-caption
      />
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t border-(--app-border) bg-(--app-surface-sunken) px-4 py-2 text-xs"
      >
        <div class="flex flex-col gap-1">
          <template v-if="e.split.value">
            <p class="tabular-nums" data-counters>
              <template v-for="(c, i) in counters(text, tab)" :key="i">
                <span v-if="i > 0" aria-hidden="true"> · </span>
                <span :class="c.over ? 'font-semibold text-(--app-danger)' : ''">{{ c.text }}</span>
              </template>
            </p>
          </template>
          <template v-else>
            <p v-for="p in tabs" :key="p" class="tabular-nums" data-counters>
              <span class="font-medium">{{ $t(`rules.platforms.${p}`) }}:</span>
              <template v-for="(c, i) in counters(text, p)" :key="i">
                <span aria-hidden="true">{{ i > 0 ? ' · ' : ' ' }}</span>
                <span :class="c.over ? 'font-semibold text-(--app-danger)' : ''">{{ c.text }}</span>
              </template>
            </p>
          </template>
        </div>
        <UButton
          v-if="e.split.value && e.editable.value"
          color="neutral"
          variant="ghost"
          size="sm"
          class="min-h-10"
          icon="i-lucide-undo-2"
          @click="backToCommon"
        >
          {{ $t('posts.caption.backToCommon') }}
        </UButton>
      </div>
    </div>
    <p v-if="undo" role="status" class="flex items-center gap-2 text-sm">
      {{ $t('posts.caption.backDone', { platform: $t(`rules.platforms.${undo.tab}`) }) }}
      <UButton color="neutral" variant="link" class="min-h-10" @click="undoBack">
        {{ $t('posts.caption.undo') }}
      </UButton>
    </p>
    <p v-else-if="e.split.value" class="text-sm text-(--app-text-muted)">
      {{ $t('posts.caption.splitHint') }}
    </p>
  </section>
</template>
