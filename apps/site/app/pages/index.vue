<script setup lang="ts">
import type { Feature } from '~/features'

useSeoMeta({
  title: 'Feedway · Tutta la tua agenzia, in un solo posto',
  description:
    'Clienti, team, piano editoriale, attività e pubblicazioni su Instagram e Facebook in un solo pannello, che controlla che ogni post sia uscito davvero.',
  ogTitle: 'Feedway · Tutta la tua agenzia, in un solo posto',
  ogDescription:
    'Il pannello per le agenzie: prepara, programma e pubblica i post dei clienti, e sai se sono usciti davvero.',
  ogType: 'website',
})

interface Item {
  text: string
  feature?: Feature
}
interface Tab {
  id: string
  label: string
  title: string
  text: string
  shot: string
  alt: string
  items: Item[]
}

const TABS: readonly Tab[] = [
  {
    id: 'pianifica',
    label: 'Pianifica',
    title: 'Il mese, scritto come su un’agenda',
    text: 'Decidi cosa esce e quando: il 10 il reel, il 12 il carosello del menu. Chi carica i file vede cosa manca e per quando, e con un clic il contenuto diventa un post già compilato.',
    shot: 'piano',
    alt: 'Il piano editoriale di dicembre per Forno Luce.',
    items: [
      { text: 'Piano editoriale', feature: 'editorialPlan' },
      { text: 'Calendario di tutti i clienti', feature: 'calendar' },
      { text: 'Calendario su Google o Apple', feature: 'calendarSync' },
    ],
  },
  {
    id: 'produci',
    label: 'Produci',
    title: 'La libreria di ogni cliente',
    text: 'Foto e video in cartelle, con i tag. Carichi anche una cartella intera o uno zip: Feedway prepara le copie giuste e toglie la posizione dalle foto.',
    shot: 'libreria',
    alt: 'La libreria con le foto dei clienti divise per cartelle.',
    items: [
      { text: 'Libreria per cliente, con cartelle e tag' },
      { text: 'Shooting con invito e promemoria', feature: 'shootings' },
      { text: 'Materiali caricati dal cliente', feature: 'clientUploads' },
    ],
  },
  {
    id: 'pubblica',
    label: 'Pubblica e verifica',
    title: 'Un post per più profili, con l’anteprima vera',
    text: 'Scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. I controlli dicono cosa manca prima di programmare.',
    shot: 'editor',
    alt: 'L’editor con un carosello di Forno Luce e l’anteprima del feed.',
    items: [
      { text: 'Feed, caroselli, reel e storie' },
      { text: 'Controlli prima di programmare' },
      { text: 'Verifica dopo l’uscita' },
    ],
  },
  {
    id: 'coordina',
    label: 'Coordina il team',
    title: 'Le attività dell’agenzia, accanto ai post',
    text: 'Lo shooting di giovedì, i testi da scrivere, il report da mandare. Ogni attività ha una scadenza, le persone assegnate e il cliente a cui si riferisce.',
    shot: 'attivita',
    alt: 'L’elenco delle attività: una in ritardo, tre per oggi.',
    items: [
      { text: 'Ruoli per cliente' },
      { text: 'Attività e to-do', feature: 'tasks' },
      { text: 'Note, guide interne e scheda del cliente', feature: 'notes' },
    ],
  },
  {
    id: 'avvisi',
    label: 'Resta avvisato',
    title: 'Se qualcosa non va, lo sai subito',
    text: 'Un post non uscito o un profilo da ricollegare arrivano a chi deve sistemarli. Scegli tu cosa ricevere e le ore di silenzio; gli errori passano sempre.',
    shot: 'notifiche',
    alt: 'Le notifiche: un reel non uscito, una Pagina da ricollegare.',
    items: [
      { text: 'Nel pannello, per email e su Telegram', feature: 'notifications' },
      { text: 'Riepilogo della giornata alle 8', feature: 'dailyDigest' },
      { text: 'Notifiche sul telefono', feature: 'pushNotifications' },
    ],
  },
  {
    id: 'misura',
    label: 'Misura',
    title: 'Il report del mese, pronto da mandare',
    text: 'Per ogni cliente i post pubblicati, le persone raggiunte, le interazioni e i post andati meglio. Lo scarichi con il tuo logo.',
    shot: 'statistiche',
    alt: 'Le statistiche di novembre per Forno Luce.',
    items: [
      { text: 'Statistiche per cliente', feature: 'stats' },
      { text: 'Report con il tuo logo', feature: 'reports' },
      { text: 'Orario migliore per pubblicare', feature: 'bestTime' },
    ],
  },
]

const TOOLS = [
  ['message-square', 'Chat dei clienti', '--x:-34%;--y:-38%;--r:-4deg'],
  ['folder-open', 'Cartelle dei file', '--x:30%;--y:-42%;--r:3deg'],
  ['sheet', 'Foglio delle ore', '--x:-42%;--y:-2%;--r:2deg'],
  ['mail', 'Email', '--x:40%;--y:2%;--r:-3deg'],
  ['sticky-note', 'Note sul telefono', '--x:-30%;--y:38%;--r:-2deg'],
  ['send', 'Un post alla volta su Meta', '--x:32%;--y:40%;--r:4deg'],
] as const

const ROLES = [
  ['Titolare', '«Come stanno i clienti, e cosa non è uscito oggi?»', 'Tutti i clienti e il team'],
  [
    'Account manager',
    '«Cosa aspetta il cliente da noi, e cosa aspettiamo da lui?»',
    'I clienti che segue',
  ],
  ['Social media manager', '«Cosa esce oggi, e cosa manca per domani?»', 'Oggi e il calendario'],
  ['Copywriter', '«Quali testi devo scrivere, e per quando?»', 'Le bozze e le sue attività'],
  ['Grafico', '«Cosa devo produrre, con quali materiali?»', 'La libreria e le sue attività'],
  [
    'Collaboratore esterno',
    '«Cosa mi tocca, e niente altro.»',
    'Solo il cliente per cui è invitato',
  ],
] as const

interface Outcome {
  title: string
  pill: string
  tone: 'bad' | 'warn'
  last: string
  note: string
}
const OUTCOMES: readonly Outcome[] = [
  {
    title: 'Reel, mer 14 ottobre, 18:00',
    pill: '4 confermate · 1 con problema',
    tone: 'bad',
    last: 'Con problema',
    note: 'Permesso revocato su Forno Luce Lab. Ricolleghi l’account e riprovi solo lì: le altre quattro destinazioni non ricevono il post due volte.',
  },
  {
    title: 'Foto, mar 13 ottobre, 18:00',
    pill: '4 confermate · 1 da accertare',
    tone: 'warn',
    last: 'Da accertare',
    note: 'Meta non ha ancora risposto per Forno Luce Lab. Feedway lo scrive come «da accertare» e blocca un nuovo invio finché non è chiaro.',
  },
]
const CONFIRMED = [
  ['instagram', 'Forno Luce Centro'],
  ['facebook', 'Forno Luce Centro'],
  ['instagram', 'Forno Luce Nord'],
  ['facebook', 'Forno Luce Nord'],
] as const

const TRUST = [
  ['plug', 'Solo le API ufficiali di Meta, senza trucchi per aggirarle'],
  ['key-round', 'Accesso con passkey o con password e secondo fattore'],
  ['scroll-text', 'Ogni azione registrata: chi ha fatto cosa e quando'],
  ['shield', 'Agenzie separate: nessuna vede i clienti delle altre'],
  ['lock', 'Nessuna password dei clienti, e i codici di Meta sono cifrati'],
] as const

const FAQ = [
  [
    'Posso usarlo dal telefono?',
    'Sì. Feedway è pensato prima per il computer, ma dal telefono vedi Oggi, prepari un post, programmi e controlli l’esito.',
  ],
  [
    'Serve una Pagina Facebook?',
    'Solo per pubblicare su Facebook. Per Instagram basta un account professionale, anche senza Pagina.',
  ],
  [
    'Il cliente deve registrarsi?',
    'No. Riceve un link al suo calendario, con password e scadenza se vuoi. Il link per il cliente è tra le funzioni in arrivo.',
  ],
  [
    'Quanti clienti e quante persone posso aggiungere?',
    'Lo vediamo insieme durante la demo, in base a quanti clienti segui e a come lavora il team.',
  ],
  [
    'Che succede se un post non esce?',
    'Feedway te lo dice in Oggi, con il motivo e cosa fare. Con «Riprova» pubblica solo dove non è uscito.',
  ],
  [
    'Funziona con TikTok e LinkedIn?',
    'Non ancora. Oggi Instagram e Facebook; gli altri arrivano uno alla volta.',
  ],
  [
    'Dove stanno i dati?',
    'Su un server gestito da noi, con le agenzie separate tra loro. Cosa teniamo e per quanto è scritto nell’informativa privacy.',
  ],
] as const

// Tabs: click, or arrow keys / Home / End on the tab list (WAI-ARIA tabs pattern).
const active = ref(0)
const tabButtons = ref<HTMLButtonElement[]>([])
function selectTab(i: number, focus = false) {
  active.value = (i + TABS.length) % TABS.length
  if (focus) tabButtons.value[active.value]?.focus()
}
function onTabKey(e: KeyboardEvent) {
  const moves: Record<string, number> = {
    ArrowRight: active.value + 1,
    ArrowLeft: active.value - 1,
    Home: 0,
    End: TABS.length - 1,
  }
  const next = moves[e.key]
  if (next === undefined) return
  e.preventDefault()
  selectTab(next, true)
}

// Motion and the 3D scene load after the first paint, only on this page (ADR 023).
const root = ref<HTMLElement>()
const hero = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const noWebgl = ref(false)
const stops: (() => void)[] = []
let unmounted = false

onMounted(async () => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [{ gsap, ScrollTrigger, startSectionMotion }, scene] = await Promise.all([
    import('~/landing/motion'),
    import('~/landing/hero-scene'),
  ])
  if (unmounted || !root.value || !hero.value || !canvas.value) return
  stops.push(startSectionMotion(root.value))
  if (!scene.webglAvailable()) {
    noWebgl.value = true
    return
  }
  try {
    const stop = await scene.startHeroScene({
      canvas: canvas.value,
      hero: hero.value,
      steps: [...hero.value.querySelectorAll<HTMLElement>('.steps li')],
      reduce,
      gsap,
      ScrollTrigger,
    })
    if (unmounted) stop()
    else stops.push(stop)
  } catch {
    // the picture behind the canvas stays: the page is complete without the scene
    noWebgl.value = true
  }
})
onBeforeUnmount(() => {
  unmounted = true
  for (const stop of stops.splice(0)) stop()
})
</script>

<template>
  <main id="contenuto" ref="root" class="landing" :class="{ 'no-webgl': noWebgl }">
    <section ref="hero" class="hero hero-a" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <h1 id="hero-title">Tutta la tua agenzia, in un solo posto.</h1>
          <p class="lead">
            Clienti, team, piano editoriale, attività e pubblicazioni. Feedway mette in ordine il
            lavoro di ogni giorno e controlla che ogni post sia uscito.
          </p>
          <div class="cta">
            <NuxtLink class="btn btn-primary btn-lg" to="/richiedi-una-demo"
              >Richiedi una demo <SiteIcon name="arrow-right" class="icon-arrow"
            /></NuxtLink>
            <a class="btn btn-outline btn-lg" href="#prodotto">Guarda il prodotto</a>
          </div>
          <ol class="steps" aria-label="Come esce un post">
            <li>
              <span class="num">1</span>
              <div>
                <strong>Scrivi il post una volta</strong>
                <p>File, testo e profili, con l’anteprima vera.</p>
              </div>
            </li>
            <li>
              <span class="num">2</span>
              <div>
                <strong>Feedway lo prepara per ogni profilo</strong>
                <p>Misure e formato giusti per feed e storie.</p>
              </div>
            </li>
            <li>
              <span class="num">3</span>
              <div>
                <strong>Controlla che sia uscito</strong>
                <p>Se Meta non lo pubblica, sai subito perché.</p>
              </div>
            </li>
          </ol>
        </div>
        <div class="stage" aria-hidden="true">
          <canvas ref="canvas" />
          <noscript>
            <img class="stage-fallback" src="/shots/oggi.webp" alt="" width="2000" height="1250" />
          </noscript>
          <img
            v-if="noWebgl"
            class="stage-fallback"
            src="/shots/oggi.webp"
            alt=""
            width="2000"
            height="1250"
          />
        </div>
      </div>
    </section>

    <section class="section problem" aria-labelledby="problem-title">
      <div class="wrap problem-grid">
        <div class="problem-copy">
          <h2 id="problem-title">Sei app aperte, nessuna che sappia cosa fanno le altre.</h2>
          <p class="lead">
            I messaggi dei clienti in chat, i file su Drive, le ore su un foglio, i post su Meta. Il
            cliente scrive alle 23, il file giusto è in una conversazione di tre settimane fa e
            nessuno sa se il post di ieri è uscito davvero.
          </p>
        </div>
        <div class="converge" aria-hidden="true">
          <span v-for="[icon, label, pos] in TOOLS" :key="label" class="tool" :style="pos"
            ><SiteIcon :name="icon" />{{ label }}</span
          >
          <div class="hub">
            <img src="/brand/feedway-horizontal-carbone.svg" alt="" width="124" height="36" />
            <ul>
              <li><SiteIcon name="check" />Clienti e messaggi</li>
              <li><SiteIcon name="check" />File e materiali</li>
              <li><SiteIcon name="check" />Ore e attività</li>
              <li><SiteIcon name="check" />Pubblicazione verificata</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section id="prodotto" class="section peach" aria-labelledby="product-title">
      <div class="wrap">
        <div class="section-head">
          <h2 id="product-title">Ogni cosa al suo posto. Ogni persona sa cosa fare.</h2>
          <p class="lead">
            Feedway non serve solo a pubblicare. Tiene insieme il piano, i file, le attività del
            team e i numeri di ogni cliente.
          </p>
        </div>
        <div class="tabs" role="tablist" aria-label="Cosa fai con Feedway" @keydown="onTabKey">
          <button
            v-for="(tab, i) in TABS"
            :id="`tab-${tab.id}`"
            :key="tab.id"
            ref="tabButtons"
            type="button"
            role="tab"
            :aria-controls="`pan-${tab.id}`"
            :aria-selected="active === i"
            :tabindex="active === i ? 0 : -1"
            @click="selectTab(i)"
          >
            {{ tab.label }}
          </button>
        </div>
        <div
          v-for="(tab, i) in TABS"
          :id="`pan-${tab.id}`"
          :key="tab.id"
          class="tab-panel"
          role="tabpanel"
          :aria-labelledby="`tab-${tab.id}`"
          :hidden="active !== i"
        >
          <div class="tab-copy">
            <h3>{{ tab.title }}</h3>
            <p>{{ tab.text }}</p>
            <ul class="feat">
              <li v-for="item in tab.items" :key="item.text">
                {{ item.text }} <SoonMark v-if="item.feature" :feature="item.feature" />
              </li>
            </ul>
          </div>
          <figure class="shot">
            <img
              :src="`/shots/${tab.shot}.webp`"
              :alt="tab.alt"
              :loading="i === 0 ? undefined : 'lazy'"
              width="2000"
              height="1250"
            />
          </figure>
        </div>
      </div>
    </section>

    <section id="team" class="section" aria-labelledby="team-title">
      <div class="wrap">
        <div class="section-head">
          <h2 id="team-title">Ognuno vede quello che gli serve. Niente di più.</h2>
        </div>
        <dl class="roles">
          <div v-for="[role, question, where] in ROLES" :key="role">
            <dt>{{ role }}</dt>
            <dd>{{ question }}</dd>
            <dd class="where">{{ where }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section id="cliente" class="section client" aria-labelledby="client-title">
      <div class="wrap client-grid">
        <div class="section-head">
          <h2 id="client-title">Il tuo cliente ha il suo spazio. Con il tuo marchio.</h2>
          <p class="lead">
            Vede il calendario, approva, carica le foto e legge il report del mese. Le vostre
            conversazioni interne non le vede mai.
          </p>
          <ul class="checks">
            <li>
              <SiteIcon name="link" />Un link al suo calendario, con password e scadenza
              <SoonMark feature="clientLink" />
            </li>
            <li>
              <SiteIcon name="thumbs-up" />Approvazioni dal telefono, attivabili per cliente
              <SoonMark feature="clientApproval" />
            </li>
            <li>
              <SiteIcon name="upload" />Materiali caricati dal cliente nella sua libreria
              <SoonMark feature="clientUploads" />
            </li>
          </ul>
        </div>
        <div class="phone-stage">
          <div class="notice" aria-hidden="true">
            <SiteIcon name="bell" />
            <div>
              <small>Adesso</small>Paola di Orto Vivo ha approvato il carosello del 19 ottobre.
            </div>
          </div>
          <div class="phone">
            <img
              src="/shots/tel-condiviso.webp"
              alt="Il calendario condiviso con il cliente, aperto sul telefono."
              loading="lazy"
              width="780"
              height="1688"
            />
          </div>
        </div>
      </div>
    </section>

    <section id="pubblicazione" class="section carbon" aria-labelledby="publish-title">
      <div class="wrap publish">
        <div class="section-head">
          <h2 id="publish-title">Lo sai quando un post è uscito. Davvero.</h2>
          <p class="lead">
            Dopo l’ora programmata Feedway chiede a Meta se il post c’è. Se manca, lo scrive con il
            motivo e ti dice cosa fare. Con «Riprova» pubblica solo dove non è uscito.
          </p>
          <p class="platforms">
            <span><SiteIcon name="instagram" />Instagram</span>
            <span><SiteIcon name="facebook" />Facebook</span>
            <span class="later">TikTok <SoonMark feature="tiktok" /></span>
            <span class="later">LinkedIn <SoonMark feature="linkedin" /></span>
          </p>
        </div>
        <ol class="timeline" aria-label="Il percorso di un post">
          <li>
            <span class="t num">11:58</span>
            <div>
              <strong>Programmato</strong>
              <p>Copie pronte per @fornoluce e la Pagina Forno Luce.</p>
            </div>
          </li>
          <li>
            <span class="t num">12:00</span>
            <div>
              <strong>In pubblicazione</strong>
              <p>Feedway manda il post a Instagram e a Facebook.</p>
            </div>
          </li>
          <li>
            <span class="t num">12:01</span>
            <div>
              <strong>Verifica</strong>
              <p>Chiede a Meta se il post è davvero sul profilo.</p>
            </div>
          </li>
          <li class="done">
            <span class="t num">12:01</span>
            <div>
              <strong><SiteIcon name="circle-check" />Pubblicato su 2 profili</strong>
              <p>Con il link al post su Instagram e su Facebook.</p>
            </div>
          </li>
        </ol>
      </div>
      <div class="wrap outcomes">
        <article v-for="o in OUTCOMES" :key="o.title" class="outcome">
          <header>
            <strong>{{ o.title }}</strong
            ><span class="pill" :class="o.tone">{{ o.pill }}</span>
          </header>
          <ul>
            <li v-for="[icon, name] in CONFIRMED" :key="icon + name" data-status="confirmed">
              <SiteIcon :name="icon" />{{ name
              }}<span class="st ok"><SiteIcon name="circle-check" />Confermato</span>
            </li>
            <li :class="`row-${o.tone}`" :data-status="o.tone === 'bad' ? 'failed' : 'unknown'">
              <SiteIcon name="instagram" />Forno Luce Lab<span class="st" :class="o.tone"
                ><SiteIcon :name="o.tone === 'bad' ? 'circle-alert' : 'clock'" />{{ o.last }}</span
              >
            </li>
          </ul>
          <p>{{ o.note }}</p>
        </article>
      </div>
    </section>

    <section id="numeri" class="section numbers" aria-labelledby="numbers-title">
      <div class="wrap numbers-grid">
        <div class="section-head">
          <h2 id="numbers-title">Sai quanto ti costa ogni cliente. <SoonMark feature="costs" /></h2>
          <p class="lead">
            Ore lavorate, contratti, rinnovi e margine per cliente. A fine mese il report di cosa è
            uscito e come è andato, con il tuo logo.
          </p>
        </div>
        <figure class="numbers-shot">
          <div class="window">
            <img
              src="/shots/statistiche.webp"
              alt="Il report di novembre di Forno Luce con i post pubblicati e le visualizzazioni."
              loading="lazy"
              width="2000"
              height="1250"
            />
          </div>
        </figure>
      </div>
    </section>

    <section class="section sunken" aria-labelledby="start-title">
      <div class="wrap">
        <div class="section-head">
          <h2 id="start-title">Pronto in un pomeriggio.</h2>
        </div>
        <ol class="start-steps">
          <li>
            <span class="num">1</span>
            <h3>Ci sentiamo per la demo</h3>
            <p>Mezz’ora in videochiamata: ci racconti come lavorate e quanti clienti seguite.</p>
          </li>
          <li>
            <span class="num">2</span>
            <h3>Prepariamo la tua agenzia</h3>
            <p>Crei l’agenzia e inviti il team: ognuno riceve un’email con il suo ruolo.</p>
          </li>
          <li>
            <span class="num">3</span>
            <h3>Colleghi i profili</h3>
            <p>
              Instagram e Pagine Facebook con le API ufficiali di Meta. Il primo lo facciamo
              insieme.
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section class="section" aria-labelledby="trust-title">
      <div class="wrap split">
        <h2 id="trust-title">I dati dei tuoi clienti restano tuoi.</h2>
        <ul class="trust">
          <li v-for="[icon, text] in TRUST" :key="icon"><SiteIcon :name="icon" />{{ text }}</li>
        </ul>
      </div>
    </section>

    <section id="domande" class="section sunken faq" aria-labelledby="faq-title">
      <div class="wrap split">
        <h2 id="faq-title">Domande frequenti</h2>
        <div>
          <details v-for="([q, a], i) in FAQ" :key="q" :open="i === 0">
            <summary>{{ q }} <SiteIcon name="chevron-down" /></summary>
            <p>{{ a }}</p>
          </details>
        </div>
      </div>
    </section>

    <section class="closing-orange" aria-labelledby="closing-title">
      <div class="wrap closing-grid">
        <div>
          <h2 id="closing-title">Smetti di cercare. Inizia a lavorare.</h2>
          <p class="lead">
            Mezz’ora in videochiamata: ci racconti come lavorate oggi e ti mostriamo il pannello con
            i tuoi profili.
          </p>
        </div>
        <NuxtLink class="btn btn-ink btn-lg" to="/richiedi-una-demo"
          >Richiedi una demo <SiteIcon name="arrow-right" class="icon-arrow"
        /></NuxtLink>
      </div>
    </section>
  </main>
</template>
