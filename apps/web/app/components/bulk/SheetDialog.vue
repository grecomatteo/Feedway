<script setup lang="ts">
import { saveBlob } from '~/utils/download'
import {
  SHEET_TEMPLATE,
  SheetError,
  filesAsked,
  readSheet,
  sheetRows,
  type SheetAccount,
  type SheetImport,
  type SheetRow,
  type SheetRowProblem,
} from '~/utils/sheet-import'

/**
 * «Da un foglio» (spec §11.6 point 2, plan 09 Task 11): a CSV or an .xlsx prepared elsewhere,
 * read here, each row checked; then the files it names, chosen from the computer and matched by
 * name. The rows with every file found go into the table, which sends them as always.
 */
const props = defineProps<{
  accounts: SheetAccount[]
  /** how many rows the table still takes */
  room: number
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ add: [rows: SheetRow[], files: Map<string, File>] }>()
const { t } = useI18n()

const sheetName = ref<string | null>(null)
const result = ref<SheetImport | null>(null)
const problem = ref<string | null>(null)
const files = ref(new Map<string, File>())
watch(open, (now) => {
  if (!now) return
  sheetName.value = null
  result.value = null
  problem.value = null
  files.value = new Map()
})

const sheetInput = ref<HTMLInputElement | null>(null)
const filesInput = ref<HTMLInputElement | null>(null)
async function pickedSheet(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  sheetName.value = file.name
  problem.value = null
  result.value = null
  try {
    result.value = sheetRows(await readSheet(file), props.accounts, props.room)
  } catch (e) {
    problem.value =
      e instanceof SheetError ? t(`bulk.sheet.error.${e.problem}`) : t('bulk.sheet.error.not_sheet')
  }
}
function pickedFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const next = new Map(files.value)
  for (const f of input.files ?? []) next.set(f.name, f)
  files.value = next
  input.value = ''
}

const asked = computed(() => (result.value ? filesAsked(result.value.rows) : []))
const found = computed(() => asked.value.filter((n) => files.value.has(n)))
const ready = computed(
  () => result.value?.rows.filter((r) => r.fileNames.every((n) => files.value.has(n))) ?? [],
)
const waiting = computed(() => (result.value?.rows.length ?? 0) - ready.value.length)

const problemText = (p: SheetRowProblem) =>
  t(`bulk.sheet.problem.${p.code}`, 'value' in p ? { value: p.value } : {})

function template() {
  // a BOM, so Excel in Italian opens it with the accents right
  saveBlob(
    new Blob([`﻿${SHEET_TEMPLATE}\r\n`], { type: 'text/csv;charset=utf-8' }),
    t('bulk.sheet.templateName'),
  )
}
function add() {
  if (ready.value.length === 0) return
  emit('add', ready.value, files.value)
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('bulk.sheet.title')"
    :description="$t('bulk.sheet.text')"
    :ui="{ content: 'max-w-[40rem]' }"
  >
    <template #body>
      <div class="space-y-5" data-sheet-dialog>
        <input
          ref="sheetInput"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          data-sheet-input
          @change="pickedSheet"
        />
        <input
          ref="filesInput"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mov"
          class="sr-only"
          tabindex="-1"
          aria-hidden="true"
          data-sheet-files-input
          @change="pickedFiles"
        />

        <section class="space-y-2">
          <h3 class="font-medium">{{ $t('bulk.sheet.step1') }}</h3>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-file-spreadsheet"
              data-sheet-choose
              @click="sheetInput?.click()"
            >
              {{ sheetName ? $t('bulk.sheet.another') : $t('bulk.sheet.choose') }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-download"
              data-sheet-template
              @click="template"
            >
              {{ $t('bulk.sheet.template') }}
            </UButton>
          </div>
          <p class="text-detail text-(--app-text-muted)">{{ $t('bulk.sheet.columns') }}</p>
          <p v-if="problem" role="alert" class="text-(--app-danger)">{{ problem }}</p>
          <template v-if="result">
            <p
              v-if="result.missing.length > 0"
              role="alert"
              class="text-(--app-danger)"
              data-sheet-missing
            >
              {{
                $t('bulk.sheet.missing', {
                  list: result.missing.map((c) => $t(`bulk.sheet.column.${c}`)).join(', '),
                })
              }}
            </p>
            <p v-else data-sheet-read>
              <span class="font-medium">{{ sheetName }}</span>
              · {{ $t('bulk.sheet.rows', result.rows.length) }}
            </p>
            <ul
              v-if="result.problems.length > 0"
              class="space-y-1 text-detail text-(--app-warning)"
              data-sheet-problems
            >
              <li v-for="(p, i) in result.problems" :key="i">
                {{ $t('bulk.sheet.line', { line: p.line }) }}: {{ problemText(p.problem) }}
              </li>
            </ul>
            <p v-if="result.leftOut > 0" class="text-detail text-(--app-warning)">
              {{ $t('bulk.sheet.leftOut', result.leftOut) }}
            </p>
          </template>
        </section>

        <section v-if="result && result.rows.length > 0" class="space-y-2">
          <h3 class="font-medium">{{ $t('bulk.sheet.step2') }}</h3>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-images"
              data-sheet-files
              @click="filesInput?.click()"
            >
              {{ $t('bulk.sheet.files') }}
            </UButton>
            <span class="text-detail text-(--app-text-muted) tabular-nums" aria-live="polite">
              {{ $t('bulk.sheet.found', { found: found.length, n: asked.length }) }}
            </span>
          </div>
          <ul class="max-h-48 overflow-y-auto rounded-card border border-(--app-border)">
            <li
              v-for="name in asked"
              :key="name"
              class="flex items-center gap-2 border-b border-(--app-border) px-3 py-1.5 text-detail last:border-b-0"
              :data-sheet-file="name"
            >
              <UIcon
                :name="files.has(name) ? 'i-lucide-check' : 'i-lucide-circle-dashed'"
                class="size-4 shrink-0"
                :class="files.has(name) ? 'text-(--app-success)' : 'text-(--app-text-muted)'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate">{{ name }}</span>
              <span class="shrink-0 text-(--app-text-muted)">{{
                files.has(name) ? $t('bulk.sheet.fileFound') : $t('bulk.sheet.fileMissing')
              }}</span>
            </li>
          </ul>
          <p v-if="waiting > 0" class="text-detail text-(--app-text-muted)">
            {{ $t('bulk.sheet.waiting', waiting) }}
          </p>
        </section>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="open = false">
          {{ $t('bulk.sheet.cancel') }}
        </UButton>
        <UButton
          :aria-disabled="ready.length === 0 ? 'true' : undefined"
          :class="ready.length === 0 ? 'opacity-50' : ''"
          data-sheet-add
          @click="add"
        >
          {{ $t('bulk.sheet.add', ready.length) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
