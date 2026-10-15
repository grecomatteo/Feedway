<script setup lang="ts">
import { MEDIA } from '~/fixtures/scenario'
import { TARGET_VIEW, TYPE_LABEL, account, capitalize, dt, fullWhen, now, postStatus, workspace } from '~/utils/format'

definePageMeta({ layout: 'demo' })

const { state, can, update, setTargets } = useDemo()
const route = useRoute()
const toast = useToast()
const post = computed(() => state.value.posts.find(p => p.id === route.params.id))
const ws = computed(() => (post.value ? workspace(post.value.workspaceId) : null))
const st = computed(() => (post.value ? postStatus(post.value) : null))
useHead({ title: () => (ws.value ? `Post · ${ws.value.short} · Feedway demo` : 'Post non trovato') })

const reconnected = ref<string[]>([])
const time = (iso?: string) => (iso ? dt(iso).toFormat('d LLL, HH:mm:ss') : '—')

// Simulates the moment of publishing for a scheduled post.
function simulateRun() {
  const p = post.value!
  update(p.id, { status: 'done' })
  const at = dt(p.scheduledAt).plus({ seconds: 40 }).toISO()!
  setTargets(p.id, id => (id === 'fl-instagram-lab'
    ? { state: 'failed', updatedAt: at, error: 'Permesso di pubblicazione revocato dopo la programmazione.' }
    : { state: 'confirmed', updatedAt: at }))
  toast.add({ title: 'Simulazione dell’uscita completata', description: p.targets.some(t => t.accountId === 'fl-instagram-lab') ? 'Una destinazione ha un problema.' : 'Tutte le destinazioni confermate.', color: 'neutral' })
}

function retry(accountId: string) {
  const p = post.value!
  setTargets(p.id, (id, s) => (id === accountId ? { state: 'retrying', error: undefined, updatedAt: now().toISO()! } : { state: s }))
  setTimeout(() => {
    setTargets(p.id, (id, s) => (id === accountId ? { state: 'confirmed', updatedAt: now().plus({ seconds: 35 }).toISO()! } : { state: s }))
    toast.add({ title: `Confermato su ${account(accountId).name}`, description: 'Le altre destinazioni non sono state ripubblicate.', color: 'success' })
  }, 1600)
}

// The demo user is Giulia R.: personal notes of other people are never listed.
const ME = 'Giulia R.'
const visibleNotes = computed(() => (post.value?.notes ?? []).filter(n => n.visibility === 'team' || n.author === ME))
const noteBody = ref('')
const noteVisibility = ref<'team' | 'personal'>('team')
function addNote() {
  const p = post.value!
  update(p.id, { notes: [...(p.notes ?? []), { id: `n${Date.now()}`, author: ME, body: noteBody.value.trim(), visibility: noteVisibility.value, at: now().toISO()! }] })
  noteBody.value = ''
}

function verifyUnknown(accountId: string) {
  const p = post.value!
  setTargets(p.id, (id, s) => (id === accountId ? { state: 'confirmed', nextCheck: undefined, updatedAt: now().toISO()! } : { state: s }))
  toast.add({ title: 'Verifica conclusa', description: 'Il post era uscito: nessun nuovo invio, nessun doppione.', color: 'success' })
}
</script>

<template>
  <div v-if="!post || !ws || !st" class="p-8">
    <h1 class="fw-title text-xl">Post non trovato</h1>
    <p class="mt-2 text-sm text-[var(--text-muted)]">Forse la demo è stata ripristinata.</p>
    <NuxtLink to="/demo/calendario" class="fw-btn mt-4">Torna al calendario</NuxtLink>
  </div>

  <div v-else class="flex flex-col gap-5 px-4 py-5 lg:px-7">
    <header class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <nav aria-label="Percorso" class="text-xs text-[var(--text-muted)]"><NuxtLink to="/demo/calendario" class="underline">Calendario</NuxtLink> / {{ capitalize(dt(post.scheduledAt).toFormat('ccc d LLLL')) }}</nav>
        <h1 class="fw-title text-2xl">{{ TYPE_LABEL[post.type] }} · {{ ws.short }} · {{ dt(post.scheduledAt).toFormat("cccc d LLLL, HH:mm") }}</h1>
      </div>
      <StatusBadge :status="st" />
    </header>

    <div class="flex flex-col gap-7 lg:flex-row">
      <div class="flex w-full flex-col gap-3 lg:w-[300px]">
        <img :src="post.cover ?? MEDIA[post.media]" alt="Media del post" class="aspect-[4/5] w-full rounded-xl object-cover">
        <p class="text-[13px] leading-relaxed">{{ post.caption }}</p>
        <p class="text-xs text-[var(--text-muted)]">{{ fullWhen(post.scheduledAt) }} · creato da {{ post.createdBy }}</p>
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div v-if="post.status === 'draft'" class="rounded-xl bg-[var(--surface-sunken)] p-4 text-sm">
          <p class="font-semibold">Bozza: non verrà pubblicata da sola.</p>
          <p class="mt-1 text-[var(--text-muted)]">{{ can.schedule ? 'Apri l’editor per completarla e programmarla.' : 'Un Manager la può controllare e programmare.' }}</p>
        </div>
        <div v-if="post.status === 'scheduled'" class="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--info-soft)] p-4 text-sm">
          <p class="min-w-0 flex-1"><strong>Programmato.</strong> Modificabile fino all'inizio della preparazione, pochi minuti prima dell'uscita.</p>
          <button v-if="can.schedule" type="button" class="fw-btn" @click="simulateRun"><UIcon name="i-lucide-fast-forward" class="size-4" aria-hidden="true" />Simula l'orario di uscita</button>
        </div>

        <h2 class="fw-title text-[17px]">Esito per destinazione</h2>
        <div class="fw-card overflow-hidden">
          <table class="w-full text-left text-sm">
            <thead class="bg-[var(--surface-sunken)] text-xs text-[var(--text-muted)]">
              <tr><th class="px-4 py-2.5 font-semibold">Account</th><th class="px-4 py-2.5 font-semibold">Stato</th><th class="px-4 py-2.5 font-semibold max-md:hidden">Ultimo aggiornamento</th><th class="px-4 py-2.5 font-semibold max-md:hidden">Prossimo passo</th></tr>
            </thead>
            <tbody>
              <template v-for="t in post.targets" :key="t.accountId">
                <tr class="border-t border-[var(--border)]" :class="t.state === 'failed' ? 'bg-[var(--danger-soft)]' : t.state === 'unknown' ? 'bg-[var(--warning-soft)]' : ''">
                  <td class="px-4 py-3"><span class="flex items-center gap-2 font-semibold"><UIcon :name="`i-lucide-${account(t.accountId).platform}`" class="size-[18px]" aria-hidden="true" />{{ account(t.accountId).name }}<span class="sr-only"> ({{ account(t.accountId).platform === 'instagram' ? 'Instagram' : 'Facebook' }})</span></span></td>
                  <td class="px-4 py-3"><StatusBadge :status="post.status === 'done' || t.state !== 'pending' ? TARGET_VIEW[t.state] : (post.status === 'draft' ? { label: 'Bozza', icon: 'i-lucide-pencil-line', tone: 'neutral' } : TARGET_VIEW.pending)" /></td>
                  <td class="tabular px-4 py-3 text-[13px] text-[var(--text-muted)] max-md:hidden">{{ time(t.updatedAt) }}</td>
                  <td class="px-4 py-3 text-[13px] max-md:hidden">
                    <template v-if="t.state === 'confirmed'"><span class="underline underline-offset-2">Apri su {{ account(t.accountId).platform === 'instagram' ? 'Instagram' : 'Facebook' }}</span></template>
                    <template v-else-if="t.state === 'failed'"><strong>Ricollega l'account, poi riprova</strong></template>
                    <template v-else-if="t.state === 'unknown'"><strong>Verifica automatica alle {{ t.nextCheck ? dt(t.nextCheck).toFormat('HH:mm') : '—' }}</strong></template>
                    <template v-else-if="t.state === 'retrying'">Nuovo tentativo in corso…</template>
                    <template v-else>—</template>
                  </td>
                </tr>
                <tr v-if="t.state === 'failed'" class="bg-[var(--danger-soft)]">
                  <td colspan="4" class="px-4 pb-4 pl-11">
                    <p class="text-[13px]">{{ t.error }} Il post non è uscito su questo account.</p>
                    <p class="mt-1 text-xs text-[var(--text-muted)]">Può risolvere: Admin o Manager di {{ ws.short }}, da Account social.</p>
                    <div v-if="can.retry" class="mt-2.5 flex flex-wrap items-center gap-2.5">
                      <button v-if="!reconnected.includes(t.accountId)" type="button" class="fw-btn" @click="reconnected.push(t.accountId)"><UIcon name="i-lucide-plug" class="size-4" aria-hidden="true" />Ricollega l'account (simulato)</button>
                      <button v-else type="button" class="fw-btn fw-btn--primary" @click="retry(t.accountId)"><UIcon name="i-lucide-rotate-cw" class="size-4" aria-hidden="true" />Riprova solo su {{ account(t.accountId).name }}</button>
                      <span class="text-xs text-[var(--text-muted)]">Le destinazioni confermate non verranno ripubblicate.</span>
                    </div>
                    <p v-else class="mt-2 text-xs">Il tuo ruolo ({{ state.role }}) non può riprovare: avvisa un Manager.</p>
                  </td>
                </tr>
                <tr v-if="t.state === 'unknown'" class="bg-[var(--warning-soft)]">
                  <td colspan="4" class="px-4 pb-4 pl-11">
                    <p class="text-[13px]">Meta ha ricevuto la richiesta ma non ha ancora confermato. Stiamo verificando: <strong>nuovo invio bloccato</strong> per evitare un doppione.</p>
                    <button type="button" class="fw-btn mt-2.5" @click="verifyUnknown(t.accountId)"><UIcon name="i-lucide-fast-forward" class="size-4" aria-hidden="true" />Simula la verifica conclusa</button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <details class="fw-card px-3 py-2.5 text-[13px]">
          <summary class="cursor-pointer font-semibold">Cronologia tecnica</summary>
          <ul class="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <li v-for="t in post.targets" :key="t.accountId" class="tabular">{{ time(t.updatedAt) }} · {{ account(t.accountId).name }} ({{ account(t.accountId).platform === 'instagram' ? 'Instagram' : 'Facebook' }}) · {{ TARGET_VIEW[t.state].label }}</li>
          </ul>
        </details>

        <section aria-labelledby="h-note" class="flex flex-col gap-2.5">
          <h2 id="h-note" class="fw-title text-[17px]">Note interne</h2>
          <p class="text-xs text-[var(--text-muted)]">Il cliente non le vede mai, nemmeno nel link condiviso.</p>
          <p v-if="!visibleNotes.length" class="text-sm text-[var(--text-muted)]">Nessuna nota.</p>
          <ul class="flex flex-col gap-2">
            <li v-for="n in visibleNotes" :key="n.id" class="fw-card p-3">
              <p class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-semibold">{{ n.author }}</span>
                <span class="text-[var(--text-muted)]">{{ dt(n.at).toFormat('d LLL, HH:mm') }}</span>
                <span class="fw-badge !py-0.5 !text-[11px]" :class="n.visibility === 'personal' ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)]' : 'bg-[var(--info-soft)] text-[var(--info)]'">
                  <UIcon :name="n.visibility === 'personal' ? 'i-lucide-lock' : 'i-lucide-users'" class="size-3" aria-hidden="true" />{{ n.visibility === 'personal' ? 'Solo per me' : `Team di ${ws.short}` }}
                </span>
              </p>
              <p class="mt-1.5 text-sm">{{ n.body }}</p>
            </li>
          </ul>
          <form v-if="can.create" class="fw-card flex flex-col gap-2.5 p-3" @submit.prevent="addNote">
            <label for="nota" class="text-[13px] font-semibold">Aggiungi una nota</label>
            <textarea id="nota" v-model="noteBody" rows="2" class="fw-input resize-y" />
            <div class="flex flex-wrap items-center gap-3">
              <fieldset class="flex flex-wrap gap-3 text-[13px]">
                <legend class="sr-only">Chi può vedere la nota</legend>
                <label class="flex items-center gap-1.5"><input v-model="noteVisibility" type="radio" value="team" class="accent-[#242321]">Per il team di {{ ws.short }}</label>
                <label class="flex items-center gap-1.5"><input v-model="noteVisibility" type="radio" value="personal" class="accent-[#242321]">Solo per me</label>
              </fieldset>
              <span class="flex-1" />
              <button type="submit" class="fw-btn !min-h-9 !text-[13px]" :disabled="!noteBody.trim()">Aggiungi nota</button>
            </div>
          </form>
        </section>
      </div>
    </div>
  </div>
</template>
