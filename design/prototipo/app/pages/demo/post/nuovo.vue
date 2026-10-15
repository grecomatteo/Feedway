<script setup lang="ts">
import { DateTime } from 'luxon'
import { ACCOUNT_GROUP, MEDIA, WORKSPACES, ZONE, type Post, type PostType } from '~/data/scenario'
import { TYPE_LABEL, capitalize, now, relative, resolveLocal } from '~/utils/format'

definePageMeta({ layout: 'demo' })
useHead({ title: 'Nuovo post · Feedway demo' })

const { state, can, upsert } = useDemo()
const route = useRoute()
const toast = useToast()

// --- Client and destinations -------------------------------------------------
const clientId = ref<string | null>(state.value.client !== 'all' ? state.value.client : null)
const ws = computed(() => WORKSPACES.find(w => w.id === clientId.value) ?? null)
const selected = ref<string[]>([])
watch(clientId, () => { selected.value = [] })
const healthy = computed(() => ws.value?.accounts.filter(a => a.health === 'healthy') ?? [])
function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}
function useGroup() { selected.value = [...ACCOUNT_GROUP.targetIds] }
const platforms = computed(() => [...new Set(ws.value?.accounts.filter(a => selected.value.includes(a.id)).map(a => a.platform) ?? [])])

// --- Media upload simulation ------------------------------------------------
type Phase = 'none' | 'uploading' | 'offline' | 'analyzing' | 'converting' | 'ready' | 'failed'
const phase = ref<Phase>('none')
const progress = ref(0)
const mediaKey = ref<string>('forno-lab')
const isVideo = ref(true)
let timer: ReturnType<typeof setInterval> | undefined
const PHASE_LABEL: Record<Phase, string> = {
  none: '', uploading: 'Caricamento del file', offline: 'Connessione persa', analyzing: 'Analisi del file', converting: 'Conversione per Instagram e Facebook', ready: 'Caricato, analizzato e convertito · pronto', failed: 'Caricamento non riuscito',
}
function tick() {
  progress.value = Math.min(100, progress.value + 7)
  if (progress.value < 100) return
  clearInterval(timer)
  if (phase.value === 'uploading') {
    phase.value = 'analyzing'; progress.value = 0
    setTimeout(() => { phase.value = 'converting'; progress.value = 0; timer = setInterval(tick, 120) }, 700)
  }
  else if (phase.value === 'converting') phase.value = 'ready'
}
function startUpload() {
  mediaKey.value = clientId.value === 'studio-forma' ? 'forma-pilates' : clientId.value === 'orto-vivo' ? 'orto-cucina' : 'forno-lab'
  isVideo.value = true; phase.value = 'uploading'; progress.value = 0
  clearInterval(timer); timer = setInterval(tick, 120)
}
function dropConnection() { clearInterval(timer); phase.value = 'offline' }
function resume() { phase.value = 'uploading'; timer = setInterval(tick, 120) }
function pickFromLibrary(key: string) { clearInterval(timer); mediaKey.value = key; isVideo.value = false; phase.value = 'ready'; progress.value = 100 }
onBeforeUnmount(() => clearInterval(timer))
const type = computed<PostType>(() => (isVideo.value ? 'reel' : 'photo'))
const MEDIA_PREFIX: Record<string, string> = { 'forno-luce': 'forno', 'studio-forma': 'forma', 'orto-vivo': 'orto' }
const libraryForClient = computed(() => Object.keys(MEDIA).filter(k => k.startsWith(MEDIA_PREFIX[clientId.value ?? 'forno-luce']!)))

// --- Caption and truthful draft saving ---------------------------------------
const caption = ref('Il laboratorio apre le porte: prepariamo insieme il pane di domani. Sabato dalle 9 alle 12, via Roma 14. #fornoluce #panefresco')
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')
const savedAt = ref('')
let saveT: ReturnType<typeof setTimeout> | undefined
watch([caption, selected, clientId], () => {
  saveState.value = 'saving'
  clearTimeout(saveT)
  saveT = setTimeout(() => { saveState.value = 'saved'; savedAt.value = DateTime.now().setZone(ZONE).toFormat('HH:mm') }, 800)
}, { deep: true })

// --- When ---------------------------------------------------------------------
const mode = ref<'now' | 'date' | 'slot'>('date')
const date = ref((route.query.data as string) || '2026-10-16')
const time = ref('18:00')
const candidates = computed(() => resolveLocal(date.value, time.value))
const ambiguousPick = ref<number | null>(null)
watch([date, time], () => { ambiguousPick.value = null })
const NEXT_SLOT = '2026-10-17T10:00:00+02:00'
const instant = computed<DateTime | null>(() => {
  if (mode.value === 'now') return now()
  if (mode.value === 'slot') return DateTime.fromISO(NEXT_SLOT, { zone: ZONE })
  if (candidates.value.length === 1) return candidates.value[0]!
  if (candidates.value.length === 2 && ambiguousPick.value !== null) return candidates.value[ambiguousPick.value]!
  return null
})
const whenLabel = computed(() => (instant.value ? `${capitalize(instant.value.setLocale('it').toFormat("cccc d LLLL yyyy, HH:mm"))} (${instant.value.toFormat('ZZ')}) · ${ZONE}` : ''))

// --- Checks -------------------------------------------------------------------
const cropAck = ref(false)
const blocks = computed(() => {
  const b: { id: string, text: string, fix: string }[] = []
  if (!ws.value) b.push({ id: 'client', text: 'Scegli il cliente.', fix: 'Un post appartiene a un solo cliente.' })
  else if (!selected.value.length) b.push({ id: 'acc', text: 'Nessuna destinazione selezionata.', fix: 'Seleziona almeno un account di questo cliente.' })
  if (phase.value !== 'ready') b.push({ id: 'media', text: phase.value === 'none' ? 'Manca il media.' : 'Il media non è ancora pronto.', fix: phase.value === 'offline' ? 'Riprendi il caricamento.' : 'Attendi la fine della conversione o scegli un file della libreria.' })
  if (!caption.value.trim()) b.push({ id: 'cap', text: 'Caption vuota.', fix: 'Scrivi la caption: è la stessa su tutte le destinazioni.' })
  if (mode.value === 'date' && candidates.value.length === 2 && ambiguousPick.value === null) b.push({ id: 'dst', text: 'Ora ambigua per il cambio dell’ora.', fix: 'Scegli quale delle due 02:30 intendi.' })
  if (mode.value === 'date' && candidates.value.length === 0) b.push({ id: 'gap', text: 'Questa ora non esiste in Europe/Rome.', fix: 'Scegli un altro orario.' })
  if (instant.value && mode.value === 'date' && instant.value < now()) b.push({ id: 'past', text: 'La data è nel passato.', fix: 'Scegli una data futura o «Pubblica ora».' })
  return b
})
const warnings = computed(() => (type.value === 'reel' && platforms.value.includes('instagram') && !cropAck.value ? 1 : 0))
const canSchedule = computed(() => can.value.schedule && blocks.value.length === 0 && warnings.value === 0)

// --- Preview -----------------------------------------------------------------
const previewTab = ref<'instagram' | 'facebook'>('instagram')
watch(platforms, (p) => { if (p.length && !p.includes(previewTab.value)) previewTab.value = p[0]! })
const firstOf = (pf: string) => ws.value?.accounts.find(a => a.platform === pf && selected.value.includes(a.id))

// --- Submit ------------------------------------------------------------------
const confirmOpen = ref(false)
function buildPost(status: Post['status']): Post {
  return {
    id: `post-n${Date.now()}`, workspaceId: ws.value!.id, type: type.value, caption: caption.value,
    scheduledAt: (instant.value ?? DateTime.fromISO(`${date.value}T${time.value}`, { zone: ZONE })).toISO()!,
    media: mediaKey.value, status, targets: selected.value.map(accountId => ({ accountId, state: 'pending' as const })), createdBy: 'Giulia R.',
  }
}
async function schedule() {
  const p = buildPost('scheduled')
  upsert(p)
  confirmOpen.value = false
  toast.add({ title: `Programmato su ${p.targets.length} account`, description: 'Simulazione: nessuna pubblicazione reale.', color: 'success' })
  await navigateTo(`/demo/post/${p.id}`)
}
async function saveDraft() {
  if (!ws.value) { toast.add({ title: 'Scegli prima il cliente', color: 'warning' }); return }
  const p = buildPost('draft')
  upsert(p)
  toast.add({ title: 'Bozza salvata in questo browser', description: 'Non pubblicherà da sola.', color: 'neutral' })
  await navigateTo(`/demo/post/${p.id}`)
}
</script>

<template>
  <div v-if="!can.create" class="grid min-h-full place-items-center p-8 text-center">
    <div class="max-w-md">
      <UIcon name="i-lucide-lock" class="mx-auto size-8 text-[var(--text-muted)]" aria-hidden="true" />
      <h1 class="fw-title mt-3 text-xl">Non puoi creare post</h1>
      <p class="mt-2 text-sm text-[var(--text-muted)]">Con il ruolo Viewer puoi consultare calendario e cronologia. Per preparare contenuti serve il ruolo Editor o Manager.</p>
      <NuxtLink to="/demo/calendario" class="fw-btn mt-4">Torna al calendario</NuxtLink>
    </div>
  </div>

  <div v-else class="flex min-h-full flex-col">
    <header class="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-4 lg:px-7">
      <div class="min-w-0 flex-1">
        <nav aria-label="Percorso" class="text-xs text-[var(--text-muted)]"><NuxtLink to="/demo/calendario" class="underline">Calendario</NuxtLink> / Nuovo post</nav>
        <h1 class="fw-title text-2xl">Nuovo post{{ ws ? ` · ${ws.short}` : '' }}</h1>
      </div>
      <p class="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]" role="status" aria-live="polite">
        <template v-if="saveState === 'saving'"><UIcon name="i-lucide-loader" class="size-4 animate-spin" aria-hidden="true" />Salvataggio in questo browser…</template>
        <template v-else-if="saveState === 'saved'"><UIcon name="i-lucide-hard-drive" class="size-4 text-[var(--success)]" aria-hidden="true" />Bozza locale salvata alle {{ savedAt }} (solo in questo browser)</template>
      </p>
    </header>

    <div class="flex flex-1 flex-col gap-8 px-4 pb-32 pt-5 lg:flex-row lg:px-7">
      <div class="flex min-w-0 flex-1 flex-col gap-7">
        <!-- Client -->
        <section aria-labelledby="h-cliente">
          <h2 id="h-cliente" class="fw-title text-base">Cliente</h2>
          <div v-if="!ws" class="mt-2 grid gap-2 sm:grid-cols-3">
            <p class="text-[13px] text-[var(--text-muted)] sm:col-span-3">Stai guardando «Tutti i clienti»: scegli a chi appartiene questo post.</p>
            <button v-for="w in WORKSPACES" :key="w.id" type="button" class="fw-card flex items-center gap-2 p-3 text-left text-sm font-semibold hover:border-[var(--border-strong)]" @click="clientId = w.id">
              <span class="size-2.5 rounded-full" :style="{ background: w.color }" />{{ w.short }}
            </button>
          </div>
          <p v-else class="mt-1 flex items-center gap-2 text-sm"><span class="size-2.5 rounded-full" :style="{ background: ws.color }" />{{ ws.name }}
            <button type="button" class="fw-link text-[13px]" @click="clientId = null">Cambia cliente</button></p>
        </section>

        <!-- Destinations -->
        <section v-if="ws" aria-labelledby="h-dest">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="h-dest" class="fw-title flex-1 text-base">Destinazioni</h2>
            <span class="text-xs text-[var(--text-muted)]">{{ selected.length }} di {{ ws.accounts.length }} account di {{ ws.short }}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <button v-if="ws.id === ACCOUNT_GROUP.workspaceId" type="button" class="inline-flex items-center gap-1.5 rounded-full border border-[var(--fw-carbone)] bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-semibold" @click="useGroup"><UIcon name="i-lucide-layers" class="size-3.5" aria-hidden="true" />{{ ACCOUNT_GROUP.name }}</button>
            <button type="button" class="fw-link text-xs" @click="selected = healthy.map(a => a.id)">Seleziona tutti gli account attivi di {{ ws.short }}</button>
          </div>
          <ul class="mt-3 grid gap-2 md:grid-cols-2">
            <li v-for="a in ws.accounts" :key="a.id">
              <label class="flex items-center gap-3 rounded-lg border px-3 py-2.5" :class="a.health === 'healthy' ? 'cursor-pointer border-[var(--border)] bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface-sunken)]'">
                <input type="checkbox" class="size-5 accent-[#FF762E]" :checked="selected.includes(a.id)" :disabled="a.health !== 'healthy'" @change="toggle(a.id)">
                <UIcon :name="`i-lucide-${a.platform}`" class="size-5" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold" :class="a.health !== 'healthy' ? 'text-[var(--text-muted)]' : ''">{{ a.name }}</span>
                  <span class="block text-xs text-[var(--text-muted)]">{{ a.platform === 'instagram' ? 'Instagram' : 'Facebook' }} · {{ a.health === 'healthy' ? a.handle : 'permesso scaduto, non selezionabile' }}</span>
                </span>
                <span v-if="a.health === 'healthy'" class="inline-flex items-center gap-1 text-xs font-semibold text-[var(--success)]"><UIcon name="i-lucide-circle-check" class="size-4" aria-hidden="true" />Attivo</span>
                <span v-else class="inline-flex items-center gap-1 text-right text-xs font-semibold text-[var(--danger)]"><UIcon name="i-lucide-circle-alert" class="size-4" aria-hidden="true" />Da ricollegare</span>
              </label>
            </li>
          </ul>
        </section>

        <!-- Media -->
        <section aria-labelledby="h-media">
          <div class="flex items-center gap-2">
            <h2 id="h-media" class="fw-title flex-1 text-base">Media e tipo</h2>
            <span v-if="phase === 'ready'" class="text-xs text-[var(--text-muted)]">Tipo suggerito dal file: {{ TYPE_LABEL[type] }}{{ isVideo ? ' 9:16' : '' }}</span>
          </div>
          <div v-if="!can.upload" class="mt-2 text-sm text-[var(--text-muted)]">Il tuo ruolo non può caricare file.</div>
          <div v-else class="mt-2 flex flex-wrap items-start gap-4">
            <div class="relative h-[128px] w-[72px] overflow-hidden rounded-lg bg-[var(--surface-sunken)]">
              <img v-if="phase !== 'none'" :src="MEDIA[mediaKey]" alt="" class="size-full object-cover" :class="phase === 'ready' ? '' : 'opacity-50'">
              <span v-if="phase === 'ready' && isVideo" class="absolute bottom-1.5 left-1.5 rounded bg-[#242321d9] px-1.5 text-[11px] font-semibold text-white">0:24</span>
            </div>
            <div class="min-w-60 flex-1 space-y-2">
              <div v-if="phase === 'none'" class="flex flex-wrap gap-2">
                <button type="button" class="fw-btn" @click="startUpload"><UIcon name="i-lucide-upload" class="size-4" aria-hidden="true" />Carica video di esempio</button>
              </div>
              <template v-else>
                <p class="text-[13px] font-semibold">laboratorio-porte-aperte.mp4 · 24 s · 1080×1920</p>
                <div class="rounded-lg p-2.5" :class="phase === 'ready' ? 'bg-[var(--success-soft)]' : phase === 'offline' ? 'bg-[var(--warning-soft)]' : 'bg-[var(--info-soft)]'" role="status" aria-live="polite">
                  <p class="text-xs font-bold" :style="{ color: phase === 'ready' ? 'var(--success)' : phase === 'offline' ? 'var(--warning)' : 'var(--info)' }">
                    {{ PHASE_LABEL[phase] }}<template v-if="['uploading', 'converting'].includes(phase)"> · {{ progress }}%</template>
                  </p>
                  <div v-if="phase !== 'ready'" class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="PHASE_LABEL[phase]">
                    <div class="h-full bg-[var(--info)]" :style="{ width: `${progress}%` }" />
                  </div>
                  <p v-if="phase === 'offline'" class="mt-1.5 text-xs">Caricato il {{ progress }}%. Riprenderà da qui: caption e scelte sono conservate.</p>
                  <p v-if="phase === 'uploading'" class="mt-1.5 text-xs text-[var(--text-muted)]">Al 100% il file è caricato, ma servono ancora analisi e conversione.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="phase === 'uploading'" type="button" class="fw-btn !min-h-9 !text-[13px]" @click="dropConnection">Simula connessione persa</button>
                  <button v-if="phase === 'offline'" type="button" class="fw-btn !min-h-9 !text-[13px]" @click="resume"><UIcon name="i-lucide-play" class="size-4" aria-hidden="true" />Riprendi il caricamento</button>
                </div>
              </template>
              <details class="text-[13px]">
                <summary class="cursor-pointer font-semibold underline underline-offset-2">Oppure usa un'immagine della libreria</summary>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button v-for="k in libraryForClient" :key="k" type="button" class="overflow-hidden rounded-md border border-[var(--border)]" :aria-label="`Usa ${k}`" @click="pickFromLibrary(k)">
                    <img :src="MEDIA[k]" alt="" class="h-16 w-14 object-cover" loading="lazy">
                  </button>
                </div>
              </details>
            </div>
          </div>
        </section>

        <!-- Caption -->
        <section aria-labelledby="h-cap">
          <div class="flex items-center gap-2">
            <h2 id="h-cap" class="fw-title flex-1 text-base"><label for="caption">Caption</label></h2>
            <span class="text-xs text-[var(--text-muted)]">Una sola caption per tutte le destinazioni</span>
          </div>
          <textarea id="caption" v-model="caption" rows="4" maxlength="2200" class="fw-input mt-2 resize-y leading-relaxed" aria-describedby="cap-count" />
          <p id="cap-count" class="mt-1 text-right text-xs text-[var(--text-muted)]">{{ caption.length }} / 2.200</p>
        </section>

        <!-- When -->
        <section aria-labelledby="h-when">
          <div class="flex items-center gap-2"><h2 id="h-when" class="fw-title flex-1 text-base">Quando</h2><span class="text-xs text-[var(--text-muted)]">{{ ZONE }}</span></div>
          <div role="radiogroup" aria-labelledby="h-when" class="mt-2 flex flex-wrap gap-2">
            <label v-for="[v, l] in ([['now', 'Pubblica ora'], ['date', 'Data e ora'], ['slot', 'Prossima fascia libera']] as const)" :key="v" class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-semibold" :class="mode === v ? 'border-[var(--fw-carbone)] bg-[var(--brand-soft)]' : 'border-[var(--border)] bg-[var(--surface)]'">
              <input v-model="mode" type="radio" name="mode" :value="v" class="accent-[#242321]">{{ l }}
            </label>
          </div>
          <div v-if="mode === 'date'" class="mt-3 flex flex-wrap items-end gap-3">
            <label class="text-[13px] font-semibold">Data<input v-model="date" type="date" class="fw-input mt-1 w-44"></label>
            <label class="text-[13px] font-semibold">Ora<input v-model="time" type="time" class="fw-input mt-1 w-32"></label>
            <button type="button" class="fw-link text-xs" @click="date = '2026-10-25'; time = '02:30'">Prova l'ora ambigua del 25 ottobre</button>
          </div>
          <fieldset v-if="mode === 'date' && candidates.length === 2" class="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3">
            <legend class="px-1 text-[13px] font-bold text-[var(--warning)]">Il 25 ottobre le 02:30 esistono due volte</legend>
            <p class="text-[13px]">Alle 03:00 l'orologio torna alle 02:00. Scegli quale istante intendi: non lo decidiamo noi.</p>
            <label v-for="(c, i) in candidates" :key="c.toMillis()" class="mt-2 flex items-center gap-2 text-[13px]">
              <input v-model="ambiguousPick" type="radio" name="dst" :value="i" class="accent-[#242321]">
              {{ i === 0 ? 'Prima del cambio: 02:30 ora legale (UTC+2)' : 'Dopo il cambio: 02:30 ora solare (UTC+1), un\'ora più tardi' }}
            </label>
          </fieldset>
          <p v-if="mode === 'now'" class="mt-3 rounded-lg bg-[var(--info-soft)] p-3 text-[13px]">«Pubblica ora» avvia una pubblicazione reale nel prodotto. In questo prototipo è simulata.</p>
          <p v-if="instant" class="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] font-semibold"><UIcon name="i-lucide-calendar-clock" class="size-4" aria-hidden="true" />{{ whenLabel }} · {{ relative(instant.toISO()!) }}</p>
        </section>
      </div>

      <!-- Preview and checks -->
      <aside class="flex w-full flex-col gap-3.5 lg:w-[380px]" aria-label="Anteprima e controlli">
        <div v-if="platforms.length" role="tablist" aria-label="Anteprima per piattaforma" class="flex gap-0.5 rounded-[9px] bg-[var(--surface-sunken)] p-[3px]">
          <button v-for="pf in platforms" :key="pf" type="button" role="tab" :aria-selected="previewTab === pf" class="flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-xs" :class="previewTab === pf ? 'border-[var(--border)] bg-[var(--surface)] font-bold' : 'border-transparent text-[var(--text-muted)]'" @click="previewTab = pf">
            <UIcon :name="`i-lucide-${pf}`" class="size-3.5" aria-hidden="true" />{{ pf === 'instagram' ? 'Instagram' : 'Facebook' }}
          </button>
        </div>
        <div role="tabpanel" class="relative overflow-hidden rounded-2xl bg-[var(--surface-sunken)]" :class="isVideo ? 'aspect-[9/16] max-h-[420px]' : 'aspect-[4/5]'">
          <img v-if="phase !== 'none'" :src="MEDIA[mediaKey]" alt="Anteprima del media" class="absolute inset-0 size-full object-cover">
          <div v-else class="absolute inset-0 grid place-items-center text-sm text-[var(--text-muted)]">Nessun media</div>
          <div v-if="firstOf(previewTab)" class="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-[#242321b3] px-2 py-1 text-xs font-semibold text-white">
            <span class="size-5 rounded-full" :style="{ background: ws?.color }" />{{ firstOf(previewTab)?.handle }}
          </div>
          <div v-if="caption" class="absolute inset-x-3 bottom-3 rounded-lg border border-white/40 bg-[#242321b3] p-2.5 text-xs text-white">
            <p class="line-clamp-2">{{ caption }}</p>
            <p v-if="isVideo" class="mt-1 text-[11px] text-white/80">Area coperta dall'interfaccia (indicativa)</p>
          </div>
        </div>
        <p class="text-[11px] text-[var(--text-muted)]">Anteprima approssimata: proporzioni e ritaglio effettivi, interfaccia Meta indicativa.</p>

        <section aria-labelledby="h-checks" class="flex flex-col gap-2" aria-live="polite">
          <h2 id="h-checks" class="fw-title text-sm">Controlli · {{ blocks.length ? `${blocks.length} da risolvere` : warnings ? '1 avviso da confermare' : 'tutto pronto' }}</h2>
          <div v-for="b in blocks" :key="b.id" class="flex gap-2.5 rounded-lg bg-[var(--danger-soft)] p-2.5">
            <UIcon name="i-lucide-octagon-x" class="size-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
            <div><p class="text-[13px] font-bold text-[var(--danger)]">Blocco · {{ b.text }}</p><p class="text-xs">{{ b.fix }}</p></div>
          </div>
          <div v-if="type === 'reel' && platforms.includes('instagram')" class="flex gap-2.5 rounded-lg p-2.5" :class="cropAck ? 'bg-[var(--success-soft)]' : 'bg-[var(--warning-soft)]'">
            <UIcon :name="cropAck ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" class="size-4 shrink-0" :style="{ color: cropAck ? 'var(--success)' : 'var(--warning)' }" aria-hidden="true" />
            <div>
              <p class="text-[13px] font-bold" :style="{ color: cropAck ? 'var(--success)' : 'var(--warning)' }">Avviso · copertina ritagliata nella griglia</p>
              <p class="text-xs">Nella griglia Instagram la copertina 9:16 appare ritagliata al centro.</p>
              <label class="mt-1.5 flex items-center gap-2 text-xs font-semibold"><input v-model="cropAck" type="checkbox" class="size-4 accent-[#FF762E]">Ho controllato il ritaglio, va bene così</label>
            </div>
          </div>
          <div v-if="!blocks.length" class="flex gap-2.5 rounded-lg bg-[var(--success-soft)] p-2.5">
            <UIcon name="i-lucide-circle-check" class="size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
            <p class="text-[13px] font-bold text-[var(--success)]">Formato, durata, peso e account attivi: controlli superati</p>
          </div>
        </section>
      </aside>
    </div>

    <div class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-7">
      <p class="min-w-0 flex-1 text-[13px] font-semibold">
        <template v-if="ws">{{ ws.short }} · {{ TYPE_LABEL[type] }} · {{ selected.length }} account<template v-if="instant"> · {{ instant.setLocale('it').toFormat('ccc d LLL, HH:mm') }} {{ ZONE }}</template></template>
        <template v-else>Scegli il cliente per continuare</template>
      </p>
      <template v-if="can.schedule">
        <button type="button" class="fw-btn" @click="saveDraft">Salva bozza</button>
        <button type="button" class="fw-btn fw-btn--primary" :disabled="!canSchedule" :aria-describedby="!canSchedule ? 'h-checks' : undefined" @click="confirmOpen = true">
          <UIcon name="i-lucide-calendar-check" class="size-[18px]" aria-hidden="true" />{{ mode === 'now' ? 'Pubblica ora' : 'Programma' }} su {{ selected.length }} account
        </button>
      </template>
      <template v-else>
        <span class="text-xs text-[var(--text-muted)]">Con il ruolo Editor salvi la bozza: la programma un Manager.</span>
        <button type="button" class="fw-btn fw-btn--primary" @click="saveDraft"><UIcon name="i-lucide-save" class="size-[18px]" aria-hidden="true" />Salva bozza</button>
      </template>
    </div>

    <UModal v-model:open="confirmOpen" :title="mode === 'now' ? 'Pubblicare adesso?' : 'Confermi la programmazione?'" description="Controlla il riepilogo prima di confermare.">
      <template #body>
        <dl v-if="ws" class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-[var(--text-muted)]">Cliente</dt><dd class="font-semibold">{{ ws.name }}</dd>
          <dt class="text-[var(--text-muted)]">Tipo</dt><dd>{{ TYPE_LABEL[type] }}</dd>
          <dt class="text-[var(--text-muted)]">Account</dt>
          <dd><ul><li v-for="id in selected" :key="id" class="flex items-center gap-1.5"><UIcon :name="`i-lucide-${ws.accounts.find(a => a.id === id)!.platform}`" class="size-3.5" aria-hidden="true" />{{ ws.accounts.find(a => a.id === id)!.name }}</li></ul></dd>
          <dt class="text-[var(--text-muted)]">Quando</dt><dd class="font-semibold">{{ whenLabel }}</dd>
          <dt class="text-[var(--text-muted)]">Controlli</dt><dd>Nessun blocco, avviso confermato</dd>
        </dl>
        <p class="mt-4 rounded-lg bg-[var(--info-soft)] p-2.5 text-xs">Prototipo: la conferma non pubblica nulla. Nel prodotto, {{ mode === 'now' ? 'questa azione avvia la pubblicazione reale.' : 'il post resta modificabile fino alla preparazione.' }}</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <button type="button" class="fw-btn" @click="confirmOpen = false">Torna a modificare</button>
          <button type="button" class="fw-btn fw-btn--primary" @click="schedule">{{ mode === 'now' ? 'Pubblica ora' : 'Programma' }} su {{ selected.length }} account</button>
        </div>
      </template>
    </UModal>
  </div>
</template>
