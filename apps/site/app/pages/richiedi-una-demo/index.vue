<script setup lang="ts">
import { LIMITS, parseDemoRequest, type DemoField, type FieldError } from '#shared/demo-request'

useSeoMeta({
  title: 'Richiedi una demo · Feedway',
  description: 'Lascia i tuoi dati: ti scriviamo noi per mostrarti Feedway con i tuoi clienti.',
})

type State = 'idle' | 'sending' | 'sent' | 'failed'
const state = ref<State>('idle')
const errors = ref<Partial<Record<DemoField, FieldError>>>({})
const startedAt = ref('')
const route = useRoute()
const serverError = computed(() => route.query.errore as string | undefined)

onMounted(() => {
  startedAt.value = String(Date.now())
})

const MESSAGES: Record<FieldError, string> = {
  required: 'Scrivilo qui, ci serve per risponderti.',
  email: 'Controlla l’email: manca qualcosa, per esempio la @.',
  tooLong: 'È troppo lungo.',
}

const LABELS: Record<DemoField, string> = {
  name: 'Nome e cognome',
  agency: 'Agenzia',
  email: 'Email',
  phone: 'Telefono',
  clients: 'Quanti clienti gestite',
  message: 'Messaggio',
}

async function submit(event: Event) {
  const form = event.target as HTMLFormElement
  const data = new FormData(form)
  // the page checks only the fields: the anti-spam checks are the function's
  const fields = { ...Object.fromEntries(data.entries()), website: '', startedAt: '1' }
  const parsed = parseDemoRequest(fields, Date.now())
  if (!parsed.ok && parsed.reason === 'invalid') {
    errors.value = parsed.errors
    await nextTick()
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  errors.value = {}
  state.value = 'sending'
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      // urlencoded like the no-JS post, so the function reads one format
      body: new URLSearchParams([...data.entries()].map(([k, v]) => [k, String(v)])),
      headers: { accept: 'application/json' },
    })
    const body = (await res.json()) as { ok: boolean; errors?: typeof errors.value }
    if (body.ok) {
      state.value = 'sent'
      await nextTick()
      document.getElementById('inviata')?.focus()
    } else if (body.errors && Object.keys(body.errors).length > 0) {
      errors.value = body.errors
      state.value = 'idle'
    } else {
      state.value = 'failed'
    }
  } catch {
    state.value = 'failed'
  }
}

function describedBy(field: DemoField, hint?: boolean) {
  const ids = [errors.value[field] ? `${field}-errore` : '', hint ? `${field}-aiuto` : '']
  return ids.filter(Boolean).join(' ') || undefined
}
</script>

<template>
  <main id="contenuto" class="demo wrap">
    <div class="demo-intro">
      <h1>Richiedi una demo</h1>
      <p class="lead">
        Ti mostriamo Feedway con i tuoi clienti, in mezz’ora di videochiamata. Lascia i tuoi dati e
        ti scriviamo noi, di solito entro un giorno lavorativo.
      </p>
      <ul class="demo-points">
        <li>Nessun account da creare e nessun pagamento.</li>
        <li>Rispondiamo da una persona, non da un sistema automatico.</li>
        <li>Usiamo i tuoi dati solo per risponderti.</li>
      </ul>
    </div>

    <section
      v-if="state === 'sent'"
      id="inviata"
      class="demo-card sent"
      tabindex="-1"
      aria-labelledby="inviata-titolo"
    >
      <span class="sent-mark" aria-hidden="true">✓</span>
      <h2 id="inviata-titolo">Richiesta inviata, ti scriviamo noi</h2>
      <p class="muted">
        Ti rispondiamo all’email che hai indicato. Se non ci senti entro due giorni lavorativi,
        guarda anche nella posta indesiderata.
      </p>
      <NuxtLink to="/" class="btn btn-outline">Torna alla pagina iniziale</NuxtLink>
    </section>

    <form
      v-else
      class="demo-card"
      action="/api/richiesta-demo"
      method="post"
      novalidate
      :aria-busy="state === 'sending'"
      @submit.prevent="submit"
    >
      <p v-if="state === 'failed' || serverError" class="form-alert" role="alert">
        Non siamo riusciti a inviare la richiesta. Riprova tra qualche minuto.
      </p>

      <div class="field-row">
        <div v-for="field in ['name', 'agency'] as const" :key="field" class="field">
          <label :for="field">{{ LABELS[field] }}</label>
          <input
            :id="field"
            :name="field"
            type="text"
            required
            :maxlength="LIMITS[field]"
            :autocomplete="field === 'name' ? 'name' : 'organization'"
            :aria-invalid="errors[field] ? 'true' : undefined"
            :aria-describedby="describedBy(field)"
          />
          <p v-if="errors[field]" :id="`${field}-errore`" class="field-error">
            {{ MESSAGES[errors[field] ?? 'required'] }}
          </p>
        </div>
      </div>

      <div class="field">
        <label for="email">{{ LABELS.email }}</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          :maxlength="LIMITS.email"
          autocomplete="email"
          inputmode="email"
          :aria-invalid="errors.email ? 'true' : undefined"
          :aria-describedby="describedBy('email')"
        />
        <p v-if="errors.email" id="email-errore" class="field-error">
          {{ MESSAGES[errors.email] }}
        </p>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="phone">{{ LABELS.phone }} <span class="optional">facoltativo</span></label>
          <input id="phone" name="phone" type="tel" :maxlength="LIMITS.phone" autocomplete="tel" />
        </div>
        <div class="field">
          <label for="clients"
            >{{ LABELS.clients }} <span class="optional">facoltativo</span></label
          >
          <select id="clients" name="clients">
            <option value="">Scegli</option>
            <option>da 1 a 5</option>
            <option>da 6 a 15</option>
            <option>da 16 a 40</option>
            <option>più di 40</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="message">{{ LABELS.message }} <span class="optional">facoltativo</span></label>
        <textarea
          id="message"
          name="message"
          rows="4"
          :maxlength="LIMITS.message"
          :aria-invalid="errors.message ? 'true' : undefined"
          :aria-describedby="describedBy('message', true)"
        />
        <p id="message-aiuto" class="field-hint">
          Per esempio come lavorate oggi, o cosa vorreste vedere.
        </p>
        <p v-if="errors.message" id="message-errore" class="field-error">
          {{ MESSAGES[errors.message] }}
        </p>
      </div>

      <!-- people never see this field; bots fill it -->
      <div class="trap" aria-hidden="true">
        <label for="website">Sito web</label>
        <input id="website" name="website" type="text" tabindex="-1" autocomplete="off" />
      </div>
      <input type="hidden" name="startedAt" :value="startedAt" />

      <div class="form-foot">
        <button type="submit" class="btn btn-primary" :disabled="state === 'sending'">
          {{ state === 'sending' ? 'Invio in corso…' : 'Invia la richiesta' }}
        </button>
        <p class="field-hint">
          Usiamo questi dati solo per risponderti, come spiega l’<NuxtLink to="/privacy#demo"
            >informativa privacy</NuxtLink
          >.
        </p>
      </div>
    </form>
  </main>
</template>
