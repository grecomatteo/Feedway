<script setup lang="ts">
import type { CaptionTemplateDto } from '@app/contracts'
import type { DropdownMenuItem } from '@nuxt/ui'
import { captionStats } from '@app/domain'
import { META_LIMITS } from '@app/domain/platforms/meta'
import type { PostEditor } from '~/composables/usePostEditor'

/**
 * «Testo» (RF-32, §11.2 point 4; screen 08): one common text; at the foot of the box «Inserisci»
 * and the counters of each platform the post goes to, counted here with `captionStats` and no
 * call (D-57). «Testo diverso per Instagram e Facebook», under the box, opens a tab per platform
 * of the chosen accounts, starting from a copy of the
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
const ICON: Record<Tab, string> = { instagram: 'i-lucide-instagram', facebook: 'i-lucide-facebook' }

/**
 * The counters of a text against the limits of a platform, short as at the foot of the box
 * («85 / 2.200», «# 0 / 30») and whole for a screen reader («85 di 2.200 caratteri»).
 */
function counters(text: string, platform: Tab) {
  const s = captionStats(text)
  const l = LIMITS[platform]
  const parts: { icon: string; short: string; long: string; over: boolean; wide?: boolean }[] = [
    {
      icon: ICON[platform],
      short:
        platform === 'facebook' && s.characters <= l.characters
          ? fmt.format(s.characters)
          : `${fmt.format(s.characters)} / ${fmt.format(l.characters)}`,
      long: t('posts.caption.characters', {
        n: fmt.format(s.characters),
        limit: fmt.format(l.characters),
      }),
      over: s.characters > l.characters,
    },
  ]
  if ('hashtags' in l) {
    parts.push({
      icon: 'i-lucide-hash',
      short: `${String(s.hashtags)} / ${String(l.hashtags)}`,
      long: t('posts.caption.hashtags', { n: s.hashtags, limit: l.hashtags }),
      over: s.hashtags > l.hashtags,
      wide: true,
    })
    // the mentions only when there are some: the box keeps to what matters
    if (s.mentions > 0)
      parts.push({
        icon: 'i-lucide-at-sign',
        short: `${String(s.mentions)} / ${String(l.mentions)}`,
        long: t('posts.caption.mentions', { n: s.mentions, limit: l.mentions }),
        over: s.mentions > l.mentions,
        wide: true,
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
</script>

<template>
  <PostEditorRow heading="post-caption" :label="$t('posts.caption.title')">
    <p v-if="e.type.value === 'story'" class="pt-2 text-(--app-text-muted)">
      {{ $t('posts.caption.story') }}
    </p>
    <template v-else>
      <div
        class="overflow-hidden rounded-control border border-(--app-field-border) bg-(--app-surface) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--app-focus)"
      >
        <div
          v-if="e.split.value"
          role="tablist"
          :aria-label="$t('posts.caption.platforms')"
          class="flex gap-1 border-b border-(--app-border) px-2"
        >
          <button
            v-for="p in tabs"
            :key="p"
            role="tab"
            type="button"
            :aria-selected="tab === p"
            :aria-controls="'post-caption-text'"
            class="flex h-control items-center gap-2 border-b-2 px-2.5 font-medium"
            :class="
              tab === p
                ? 'border-(--app-text) font-semibold'
                : 'border-transparent text-(--app-text-muted) hover:text-(--app-text)'
            "
            @click="tab = p"
          >
            <UIcon :name="ICON[p]" class="size-4" aria-hidden="true" />
            {{ $t(`rules.platforms.${p}`) }}
          </button>
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
          rows="5"
          :readonly="!e.editable.value"
          :placeholder="$t('posts.caption.placeholder')"
          class="block max-h-[60vh] min-h-33 w-full resize-none bg-transparent [field-sizing:content] px-3 py-2.5 text-[0.9375rem] leading-[1.375rem] outline-none placeholder:text-(--app-text-muted) max-md:min-h-30 max-md:text-base max-md:leading-[1.4375rem]"
          data-caption
        />
        <div
          class="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-(--app-border) p-1.5 text-xs text-(--app-text-muted)"
        >
          <UDropdownMenu
            v-if="e.editable.value"
            :items="insertItems"
            :content="{ align: 'start' }"
            :ui="{ content: 'w-80 max-w-[calc(100vw-2rem)]', itemDescription: 'truncate' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-text-cursor-input"
              :loading="templates === null"
            >
              {{ $t('posts.caption.insert') }}
            </UButton>
          </UDropdownMenu>
          <span class="flex-1" />
          <span
            v-for="p in e.split.value ? [tab] : tabs"
            :key="p"
            class="inline-flex flex-wrap items-center gap-x-3.5 pe-1.5 tabular-nums"
            data-counters
          >
            <span class="sr-only">{{ $t(`rules.platforms.${p}`) }}:</span>
            <span
              v-for="(c, i) in counters(text, p)"
              :key="i"
              class="items-center gap-[5px]"
              :class="[
                c.over ? 'font-semibold text-(--app-danger)' : '',
                c.wide && !c.over ? 'inline-flex max-md:contents' : 'inline-flex',
              ]"
            >
              <!-- on a phone the hashtags' counter is only read, not shown (screen 08) -->
              <UIcon
                :name="c.icon"
                class="size-[13px]"
                :class="c.wide && !c.over ? 'max-md:hidden' : ''"
                aria-hidden="true"
              />
              <span aria-hidden="true" :class="c.wide && !c.over ? 'max-md:hidden' : ''">{{
                c.short
              }}</span>
              <span class="sr-only">{{ c.long }}</span>
            </span>
          </span>
        </div>
      </div>
      <!-- with one platform there is nothing to tell apart (screen 09, B5) -->
      <div
        v-if="e.split.value || platforms.length !== 1"
        class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <USwitch
          :model-value="e.split.value"
          :label="$t('posts.caption.split')"
          :disabled="!e.editable.value"
          @update:model-value="e.setSplit($event)"
        />
        <UButton
          v-if="e.split.value && e.editable.value"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-undo-2"
          @click="backToCommon"
        >
          {{ $t('posts.caption.backToCommon') }}
        </UButton>
      </div>
      <p v-if="undo" role="status" class="mt-2 flex items-center gap-2 text-detail">
        {{ $t('posts.caption.backDone', { platform: $t(`rules.platforms.${undo.tab}`) }) }}
        <UButton color="neutral" variant="link" size="sm" @click="undoBack">
          {{ $t('posts.caption.undo') }}
        </UButton>
      </p>
      <p v-else-if="e.split.value" class="mt-2 text-detail text-(--app-text-muted)">
        {{ $t('posts.caption.splitHint') }}
      </p>
    </template>
  </PostEditorRow>
</template>
