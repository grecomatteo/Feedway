<script setup lang="ts">
import type { Me, Palette } from '@app/contracts'
import { paletteIds, palettes } from '@app/ui'
import type { Theme } from '@app/ui'

/**
 * The colour palettes, each previewed by day and by night. A choice applies at once and is saved
 * in the profile, so it follows the person on every device.
 */
const { t } = useI18n()
const { call } = useApi()
const palette = usePalette()
const session = useSession()

const result = ref<'saved' | 'failed' | null>(null)
/** What the server holds: a failed save comes back to it. */
let confirmed: Palette = palette.value
/** One save at a time, in order: while one is out, only the latest choice waits for its turn. */
let sending = false
let waiting: Palette | null = null

async function choose(next: Palette) {
  palette.value = next
  result.value = null
  waiting = next
  if (sending) return
  sending = true
  while (waiting !== null) {
    const value: Palette = waiting
    waiting = null
    if (value === confirmed) {
      if (waiting === null) result.value = 'saved'
      continue
    }
    try {
      const me = await call<Me>('PATCH', '/api/v1/me', { palette: value })
      confirmed = me.palette
      if (session.view.value.state === 'active') session.view.value = { state: 'active', me }
      if (waiting === null) result.value = 'saved'
    } catch {
      if (waiting === null) {
        palette.value = confirmed
        result.value = 'failed'
      }
    }
  }
  sending = false
}

// the swatches of a preview: the palette's own colours, whatever palette the page is in now
const swatch = (theme: Theme) => ({
  page: { background: theme.bg },
  card: { background: theme.surface, borderColor: theme.border },
  text: { background: theme.text },
  muted: { background: theme['text-muted'] },
  accent: { background: theme.brand, color: theme['on-brand'] },
})
const previews = computed(() =>
  paletteIds.map((id) => ({
    id,
    name: t(`palette.names.${id}`),
    day: swatch(palettes[id].light),
    night: swatch(palettes[id].dark),
  })),
)
</script>

<template>
  <fieldset class="space-y-3" aria-describedby="palette-help">
    <legend class="text-sm font-medium">{{ $t('palette.label') }}</legend>
    <p id="palette-help" class="text-sm text-(--app-text-muted)">{{ $t('palette.help') }}</p>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <label
        v-for="p in previews"
        :key="p.id"
        :data-palette-option="p.id"
        class="group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-(--app-border) bg-(--app-surface) p-2 has-checked:border-(--app-focus) has-checked:ring-1 has-checked:ring-(--app-focus) has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--app-focus) hover:border-(--app-field-border)"
      >
        <input
          type="radio"
          name="palette"
          class="sr-only"
          :value="p.id"
          :checked="palette === p.id"
          @change="choose(p.id)"
        />
        <span class="flex h-16 overflow-hidden rounded-lg" aria-hidden="true">
          <span
            v-for="(half, i) in [p.day, p.night]"
            :key="i"
            class="flex flex-1 flex-col justify-between p-1.5"
            :style="half.page"
          >
            <span class="block space-y-1 rounded-sm border p-1" :style="half.card">
              <span class="block h-1 w-4/5 rounded-full" :style="half.text" />
              <span class="block h-1 w-1/2 rounded-full" :style="half.muted" />
            </span>
            <span
              class="flex h-3.5 w-8 items-center justify-center self-start rounded-sm"
              :style="half.accent"
            >
              <span class="block h-0.5 w-4 rounded-full bg-current" />
            </span>
          </span>
        </span>
        <span class="flex min-h-6 items-center justify-between gap-1 px-0.5">
          <span class="flex flex-col leading-tight">
            <span class="text-sm font-medium">{{ p.name }}</span>
            <span v-if="p.id === 'feedway'" class="text-xs text-(--app-text-muted)">
              {{ $t('palette.default') }}
            </span>
          </span>
          <UIcon
            name="i-lucide-check"
            class="size-4 shrink-0 opacity-0 group-has-checked:opacity-100"
            aria-hidden="true"
          />
        </span>
      </label>
    </div>
    <!-- always there, so screen readers hear what appears in it -->
    <p role="status" class="min-h-5 text-sm text-(--app-success)">
      <template v-if="result === 'saved'">{{ $t('palette.saved') }}</template>
    </p>
    <p v-if="result === 'failed'" role="alert" class="text-sm text-(--app-danger)">
      {{ $t('palette.failed') }}
    </p>
  </fieldset>
</template>
