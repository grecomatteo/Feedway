<script setup lang="ts">
import type { PostCheckResponse } from '@app/contracts'
import type { PostEditor } from '~/composables/usePostEditor'
import { missingFiles, properType, type PostType } from '~/utils/post-editor'

/**
 * «Riepilogo delle destinazioni» (§11.2 point 7, F04; design E1, E6d–E6f): first the warnings
 * to answer (their options as large radios, «Annulla» closes without choosing, D-52), then the
 * blocks with the way to fix them, then one row per account with what goes out there and which
 * files do not (D-56), last the automatic fixes in one sentence.
 */
const props = defineProps<{ editor: PostEditor; accounts: Map<string, ProfileAccount> }>()
const emit = defineEmits<{ goto: [section: string] }>()
const { t } = useI18n()
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
      what: d.format && d.platform ? t(`rules.formats.${d.platform}.${d.format}`) : null,
      files: d.media.length,
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
const DOT: Record<string, string> = {
  ok: 'bg-(--app-success)',
  warning: 'bg-(--app-warning)',
  block: 'bg-(--app-danger)',
}
const pending = computed(() => report.value?.unresolved.length ?? 0)
defineExpose({ proposal })
const switchTo = (type: PostType) => e.chooseType(type)
</script>

<template>
  <section
    id="post-summary"
    aria-labelledby="post-summary-title"
    class="flex scroll-mt-6 flex-col gap-3"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="post-summary-title" class="text-lg">{{ $t('posts.summary.title') }}</h2>
      <p v-if="pending > 0" class="text-sm text-(--app-text-muted)">
        {{ $t('posts.summary.pending', { n: pending }, pending) }}
      </p>
    </div>
    <p v-if="e.checkProblem.value" role="alert" class="text-sm text-(--app-danger)">
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
        class="flex flex-col gap-3 rounded-xl border-2 p-4"
        :class="o.chosen ? 'border-(--app-border)' : 'border-(--app-warning)'"
      >
        <legend class="sr-only">{{ msg(o).title }}</legend>
        <p class="flex items-start gap-2 font-semibold">
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0 text-(--app-warning)"
            aria-hidden="true"
          />
          {{ msg(o).title }}
        </p>
        <p v-if="subject(o)" class="text-xs text-(--app-text-muted)">{{ subject(o) }}</p>
        <p class="text-sm">{{ msg(o).text }}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="(option, i) in o.options ?? []"
            :key="option"
            class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2"
            :class="
              choosing[o.key] === option
                ? 'border-2 border-(--app-text) bg-(--app-brand-soft)'
                : 'border-(--app-border)'
            "
          >
            <input
              type="radio"
              class="size-5 accent-(--app-brand)"
              :name="`choice-${o.key}`"
              :value="option"
              :checked="choosing[o.key] === option"
              :disabled="!e.editable.value"
              @change="e.choose(o.key, option)"
            />
            <span class="text-sm">
              {{ msg(o).options[i] }}
              <span v-if="o.recommended === option" class="text-xs text-(--app-text-muted)">
                · {{ $t('posts.summary.recommended') }}</span
              >
            </span>
          </label>
        </div>
        <UButton
          v-if="o.chosen && e.editable.value"
          color="neutral"
          variant="link"
          class="min-h-10 self-start"
          @click="e.choose(o.key, null)"
        >
          {{ $t('posts.summary.undoChoice') }}
        </UButton>
      </fieldset>

      <!-- the blocks -->
      <div
        v-for="o in blocks"
        :key="o.key"
        :data-outcome="o.code"
        class="flex flex-col gap-2 rounded-xl border-2 border-(--app-danger) p-4"
      >
        <p class="flex items-start gap-2 font-semibold">
          <UIcon
            name="i-lucide-octagon-x"
            class="mt-0.5 size-4 shrink-0 text-(--app-danger)"
            aria-hidden="true"
          />
          {{ msg(o).title }}
        </p>
        <p v-if="subject(o)" class="text-xs text-(--app-text-muted)">{{ subject(o) }}</p>
        <p class="text-sm">{{ msg(o).text }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="o.code === 'type_not_supported' && proposal && e.editable.value"
            class="min-h-11"
            @click="switchTo(proposal)"
          >
            {{ $t('posts.summary.switchTo', { type: $t(`posts.type.${proposal}`) }) }}
          </UButton>
          <UButton
            v-if="fixAt(o)"
            color="neutral"
            variant="outline"
            class="min-h-11"
            @click="emit('goto', fixAt(o)!.section)"
          >
            {{ fixAt(o)!.label }}
          </UButton>
        </div>
      </div>
      <div
        v-if="proposal && !blocks.some((o) => o.code === 'type_not_supported') && e.editable.value"
        class="flex flex-col gap-2 rounded-xl border-2 border-(--app-danger) p-4"
        data-outcome="type_mismatch"
      >
        <p class="font-semibold">{{ $t('posts.summary.typeMismatch') }}</p>
        <UButton class="min-h-11 self-start" @click="switchTo(proposal)">
          {{ $t('posts.summary.switchTo', { type: $t(`posts.type.${proposal}`) }) }}
        </UButton>
      </div>

      <!-- one row per account -->
      <ul
        v-if="rows.length > 0"
        class="divide-y divide-(--app-border) overflow-hidden rounded-xl border border-(--app-border) bg-(--app-card)"
      >
        <li
          v-for="r in rows"
          :key="r.id"
          class="flex flex-col gap-1 px-4 py-3"
          :data-destination="r.id"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <UIcon
              :name="ICON[r.platform ?? ''] ?? 'i-lucide-at-sign'"
              class="size-4"
              aria-hidden="true"
            />
            <span class="font-medium">{{ handleOf(r.id) }}</span>
            <span class="min-w-0 flex-1 text-sm text-(--app-text-muted)">
              <template v-if="r.what">
                {{ r.what }} · {{ $t('posts.summary.files', { n: r.files }, r.files) }} ·
                {{ r.own ? $t('posts.summary.ownText') : $t('posts.summary.commonText') }}
              </template>
              <template v-else>{{ $t('posts.summary.notGoing') }}</template>
            </span>
            <span class="flex items-center gap-1.5 text-sm">
              <span class="size-2 rounded-full" :class="DOT[r.tone]" aria-hidden="true" />
              {{ r.state }}
            </span>
          </div>
          <p v-for="m in r.missing" :key="m" class="text-sm text-(--app-danger)" data-missing>
            {{ $t('posts.summary.missingOn', { what: m, account: handleOf(r.id) }) }}
          </p>
        </li>
      </ul>

      <!-- the fixes, in one sentence -->
      <div v-if="fixes.length > 0" class="flex flex-col gap-1 text-sm text-(--app-text-muted)">
        <p class="flex items-start gap-2">
          <UIcon name="i-lucide-wand-sparkles" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {{ $t('posts.summary.fixes', { n: fixes.length, what: fixSentence }, fixes.length) }}
        </p>
        <UButton
          color="neutral"
          variant="link"
          class="min-h-10 self-start"
          :aria-expanded="open"
          @click="open = !open"
        >
          {{ open ? $t('posts.summary.hideDetails') : $t('posts.summary.showDetails') }}
        </UButton>
        <ul v-if="open" class="list-disc pl-6">
          <li v-for="o in fixes" :key="o.key">
            <span v-if="subject(o)">{{ subject(o) }}: </span>{{ msg(o).text }}
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
