<script setup lang="ts">
import type { Feature } from '~/features'

useSeoMeta({
  title: 'Feedway · Tutta la tua agenzia, in un solo posto',
  description:
    'Il pannello dove l’agenzia prepara, programma e pubblica i post di tutti i clienti su Instagram e Facebook, e controlla che siano usciti davvero.',
  ogTitle: 'Feedway · Tutta la tua agenzia, in un solo posto',
  ogDescription:
    'Prepara, programma e pubblica i post dei clienti su Instagram e Facebook, e sappi se sono usciti davvero.',
  ogType: 'website',
})

interface Tab {
  id: string
  label: string
  feature?: Feature
  title: string
  text: string
  shot: string
  alt: string
}

const TABS: readonly Tab[] = [
  {
    id: 'pianifica',
    label: 'Pianifica',
    feature: 'editorialPlan',
    title: 'Il piano del mese, scritto come su un’agenda',
    text: 'Decidi cosa esce e quando: «il 10 il reel, il 12 il carosello del menu». Per ogni giorno scrivi tipo, titolo e una nota per chi prepara. Chi carica i file vede subito cosa manca e per quando, e con un clic il contenuto diventa un post già compilato.',
    shot: '/shots/piano.webp',
    alt: 'Il piano editoriale di dicembre per Forno Luce, con i contenuti del mese e il modulo per aggiungerne uno.',
  },
  {
    id: 'prepara',
    label: 'Prepara',
    title: 'Un post per più profili, con l’anteprima vera',
    text: 'Scegli i file, scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. L’anteprima mostra il post come lo vedrà chi lo segue, e i controlli dicono subito cosa manca: un video troppo lungo, una foto troppo alta, un profilo da ricollegare.',
    shot: '/shots/editor.webp',
    alt: 'L’editor di Feedway con un carosello di Forno Luce, l’anteprima del feed e i controlli «Tutto pronto».',
  },
  {
    id: 'libreria',
    label: 'Libreria',
    title: 'La libreria di ogni cliente, con le cartelle',
    text: 'Foto e video di ogni cliente in un posto solo, con cartelle e tag. Carichi anche una cartella intera o uno zip dal computer; Feedway prepara le copie giuste per Instagram e Facebook e toglie la posizione e i dati della fotocamera.',
    shot: '/shots/libreria.webp',
    alt: 'La libreria di Feedway con le foto dei clienti divise per cartelle.',
  },
  {
    id: 'calendario',
    label: 'Calendario',
    feature: 'calendar',
    title: 'Tutti i clienti in un solo calendario',
    text: 'Il mese, la settimana o l’elenco, per tutti i clienti o per uno solo. Ogni post ha il suo stato: programmato, pubblicato, non uscito. I contenuti del piano ancora da preparare si vedono tratteggiati, e diventano gialli quando mancano meno di 36 ore.',
    shot: '/shots/calendario.webp',
    alt: 'Il calendario di novembre con i post di cinque clienti, uno non uscito e due bozze.',
  },
  {
    id: 'avvisi',
    label: 'Avvisi',
    feature: 'notifications',
    title: 'Se qualcosa non va, lo sai subito',
    text: 'Un post non uscito, un profilo da ricollegare, un contenuto da preparare entro domani: arriva nel pannello, per email o su Telegram, a chi deve sistemarlo. Alle 8 un riepilogo della giornata. Scegli tu cosa ricevere e le ore di silenzio; gli errori passano sempre.',
    shot: '/shots/notifiche.webp',
    alt: 'Le notifiche di Feedway: un reel non uscito, una Pagina da ricollegare, un post pubblicato.',
  },
  {
    id: 'attivita',
    label: 'Attività',
    feature: 'tasks',
    title: 'Le attività dell’agenzia, accanto ai post',
    text: 'Lo shooting di giovedì, i testi da scrivere, il report da mandare: ogni attività ha una scadenza, le persone a cui è assegnata e, se serve, il post o il cliente a cui si riferisce. Vedi le tue, quelle dell’agenzia o quelle di un cliente, e le scadenze compaiono anche nel calendario.',
    shot: '/shots/attivita.webp',
    alt: 'L’elenco delle attività: una in ritardo, tre per oggi, due nei prossimi giorni.',
  },
]

const active = ref('pianifica')
const tabRefs = ref<HTMLButtonElement[]>([])

function onTabKey(event: KeyboardEvent, index: number) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (step === 0) return
  event.preventDefault()
  const next = (index + step + TABS.length) % TABS.length
  const tab = TABS[next]
  if (!tab) return
  active.value = tab.id
  tabRefs.value[next]?.focus()
}

const ROLES = [
  ['Owner e Admin', 'gestiscono l’agenzia, gli utenti e il collegamento con Meta.'],
  ['Manager', 'segue il cliente: profili, impostazioni e persone.'],
  ['Publisher', 'programma e pubblica i post del cliente.'],
  ['Editor', 'prepara le bozze, che un Publisher poi programma.'],
  ['Viewer', 'guarda i post e la libreria, senza toccare niente.'],
] as const

const TRUST = [
  [
    'plug',
    'Solo le API ufficiali di Meta',
    'Niente password dei clienti: il collegamento passa da Meta, con i permessi che concedi tu.',
  ],
  [
    'key-round',
    'Accesso con passkey o secondo fattore',
    'Obbligatorio per chi gestisce l’agenzia, e le azioni delicate chiedono una conferma.',
  ],
  [
    'lock',
    'Agenzie separate e codici cifrati',
    'Ogni agenzia vede solo i suoi dati, e i codici di accesso a Meta sono cifrati.',
  ],
  [
    'scroll-text',
    'Ogni azione registrata',
    'Chi ha programmato, modificato o pubblicato, e quando: lo trovi nel registro attività.',
  ],
] as const

const FAQ = [
  [
    'Serve una Pagina Facebook?',
    'Solo per pubblicare su Facebook, perché lì si pubblica su una Pagina. Per Instagram basta un account professionale (aziendale o creator), anche senza Pagina. Il primo collegamento lo facciamo insieme.',
  ],
  [
    'Che succede se un post non esce?',
    'Feedway te lo dice in Oggi e nella pagina del post, con il motivo scritto in chiaro e cosa fare. Con «Riprova» pubblica solo dove non è uscito: le altre destinazioni non ricevono il post due volte.',
  ],
  [
    'Il cliente deve registrarsi?',
    'No. Riceve un link al suo calendario, con password e scadenza se vuoi, e da lì approva i post. Il link per il cliente è tra le funzioni in arrivo.',
  ],
  [
    'Posso usarlo dal telefono?',
    'Sì. Feedway è pensato prima per il computer, ma da telefono vedi Oggi, prepari un post, programmi e controlli l’esito.',
  ],
  [
    'Quanti clienti e quante persone posso aggiungere?',
    'Lo vediamo insieme durante la demo, in base a quanti clienti segui e a come lavora il team.',
  ],
  [
    'Funziona con TikTok e LinkedIn?',
    'Non ancora. Oggi Feedway pubblica su Instagram e Facebook; TikTok e LinkedIn arriveranno uno alla volta.',
  ],
  [
    'Dove stanno i dati?',
    'Su un server dedicato, con le agenzie separate tra loro. Cosa teniamo e come chiederne la cancellazione è scritto nell’informativa privacy.',
  ],
] as const
</script>

<template>
  <main id="contenuto">
    <!-- 1 · Apertura -->
    <section class="hero" aria-labelledby="hero-title">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <h1 id="hero-title">Tutta la tua agenzia, in un solo posto.</h1>
          <p class="hero-lead">
            Clienti, team, contenuti e pubblicazioni: Feedway mette in ordine il lavoro di ogni
            giorno, dentro e fuori l’agenzia. E quando un post esce, controlla che sia online
            davvero.
          </p>
          <div class="hero-cta">
            <NuxtLink to="/richiedi-una-demo" class="btn btn-primary btn-lg"
              >Richiedi una demo</NuxtLink
            >
            <p class="muted">Ti rispondiamo noi, per email. Nessun account da creare.</p>
          </div>
        </div>
        <figure class="frame hero-frame">
          <picture>
            <source
              media="(max-width: 40rem)"
              srcset="/shots/tel-oggi.webp"
              width="780"
              height="1688"
            />
            <img
              src="/shots/oggi.webp"
              width="1680"
              height="992"
              fetchpriority="high"
              alt="La pagina Oggi di Feedway: tre cose da sistemare, i post in uscita della settimana per quattro clienti, le bozze da finire."
            />
          </picture>
        </figure>
      </div>
    </section>

    <!-- 2 · Il problema -->
    <section class="band problem" aria-labelledby="problem-title">
      <div class="wrap split">
        <h2 id="problem-title">Sei app aperte, nessuna che sappia cosa fanno le altre.</h2>
        <div class="problem-copy">
          <p>
            I file del cliente in una chat, il piano in un foglio, la pubblicazione su Meta un
            profilo alla volta. E la sera nessuno sa con certezza se il post delle 18 è uscito.
          </p>
          <p>
            In Feedway apri una pagina, <strong>Oggi</strong>, e vedi per tutti i clienti cosa esce,
            cosa non è uscito e cosa va sistemato, con il pulsante per rimediare accanto.
          </p>
        </div>
      </div>
    </section>

    <!-- 3 · Il prodotto -->
    <section id="prodotto" class="band" aria-labelledby="product-title">
      <div class="wrap">
        <h2 id="product-title" class="section-title">
          Ogni cosa al suo posto. Ogni persona sa cosa fare.
        </h2>
        <div class="tabs" role="tablist" aria-label="Cosa fai con Feedway">
          <button
            v-for="(tab, i) in TABS"
            :id="`tab-${tab.id}`"
            :key="tab.id"
            ref="tabRefs"
            type="button"
            role="tab"
            :aria-selected="active === tab.id"
            :aria-controls="`pannello-${tab.id}`"
            :tabindex="active === tab.id ? 0 : -1"
            @click="active = tab.id"
            @keydown="onTabKey($event, i)"
          >
            {{ tab.label }}
            <SoonMark :feature="tab.feature" />
          </button>
        </div>
        <div
          v-for="tab in TABS"
          v-show="active === tab.id"
          :id="`pannello-${tab.id}`"
          :key="tab.id"
          class="tab-panel"
          role="tabpanel"
          :aria-labelledby="`tab-${tab.id}`"
        >
          <div class="tab-copy">
            <SoonMark :feature="tab.feature" />
            <h3>{{ tab.title }}</h3>
            <p>{{ tab.text }}</p>
          </div>
          <figure class="frame">
            <img :src="tab.shot" width="2000" height="1250" decoding="async" :alt="tab.alt" />
          </figure>
        </div>
      </div>
    </section>

    <!-- 4 · Il momento: la pubblicazione verificata -->
    <section id="pubblicazione" class="carbon" aria-labelledby="publish-title">
      <div class="wrap split split-wide">
        <div class="dark-copy">
          <h2 id="publish-title">Lo sai quando un post è uscito. Davvero.</h2>
          <p>
            Prima di programmare, Feedway controlla file, formati e limiti di ogni profilo. All’ora
            giusta pubblica, poi torna a guardare dopo 3, 10 e 30 minuti.
          </p>
          <p>
            Se qualcosa non è uscito te lo dice, con il motivo e il modo di rimediare. Il testo può
            essere diverso per Instagram e per Facebook.
          </p>
          <ul class="platforms" aria-label="Dove pubblica">
            <li>Instagram</li>
            <li>Facebook</li>
            <li>TikTok <SoonMark feature="tiktok" /></li>
            <li>LinkedIn <SoonMark feature="linkedin" /></li>
          </ul>
        </div>
        <PublishOutcome />
      </div>
    </section>

    <!-- 5 · Il team -->
    <section class="band" aria-labelledby="team-title">
      <div class="wrap split">
        <div>
          <h2 id="team-title">Ognuno lavora sui clienti che segue.</h2>
          <p class="section-lead">
            Inviti le persone dell’agenzia e scegli, cliente per cliente, cosa possono fare. Chi non
            segue un cliente non lo vede.
          </p>
        </div>
        <dl class="roles">
          <div v-for="[role, text] in ROLES" :key="role" class="role">
            <dt>{{ role }}</dt>
            <dd>{{ text }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 6 · Fiducia -->
    <section class="band sunken" aria-labelledby="trust-title">
      <div class="wrap">
        <h2 id="trust-title" class="section-title">I dati dei tuoi clienti restano tuoi.</h2>
        <ul class="trust">
          <li v-for="[icon, title, text] in TRUST" :key="title">
            <SiteIcon :name="icon" />
            <div>
              <h3>{{ title }}</h3>
              <p>{{ text }}</p>
            </div>
          </li>
        </ul>
        <p class="trust-foot">
          Cosa teniamo, per quanto e come chiederne la cancellazione:
          <NuxtLink to="/privacy">informativa privacy</NuxtLink>.
        </p>
      </div>
    </section>

    <!-- 7 · Il cliente -->
    <section id="cliente" class="band" aria-labelledby="client-title">
      <div class="wrap split split-wide feature-split">
        <div>
          <h2 id="client-title">Il tuo cliente vede il suo calendario. E approva dal telefono.</h2>
          <p class="section-lead">
            Basta rincorrere il cliente su WhatsApp per sapere se un post va bene. Gli mandi un link
            e da lì trova tutto quello che esce, con le anteprime.
          </p>
          <ul class="points">
            <li>
              <h3>Un link, nessun account <SoonMark feature="clientLink" /></h3>
              <p>
                Il calendario del solo suo spazio, con password e scadenza se vuoi. Vede i post e
                gli orari, mai le note interne o gli altri clienti.
              </p>
            </li>
            <li>
              <h3>«Approva» o «Chiedi una modifica» <SoonMark feature="clientApproval" /></h3>
              <p>
                Il cliente risponde dal telefono, con un commento se chiede una modifica. Tu lo sai
                subito, e il post mostra chi ha approvato e quando.
              </p>
            </li>
          </ul>
        </div>
        <figure class="frame phone-frame">
          <img
            src="/shots/tel-condiviso.webp"
            width="780"
            height="1688"
            loading="lazy"
            decoding="async"
            alt="Il calendario di dicembre visto dal cliente sul telefono: un reel da approvare, un carosello approvato, una foto in preparazione."
          />
        </figure>
      </div>
    </section>

    <!-- 8 · I numeri -->
    <section id="numeri" class="band" aria-labelledby="numbers-title">
      <div class="wrap">
        <div class="numbers-head">
          <h2 id="numbers-title">
            Il report del mese, pronto da mandare. <SoonMark feature="stats" />
          </h2>
          <p class="section-lead">
            Per ogni cliente: post pubblicati, persone raggiunte, interazioni, nuovi follower e i
            post che sono andati meglio. Lo scarichi con il tuo logo e lo mandi così com’è.
          </p>
        </div>
        <figure class="frame">
          <img
            src="/shots/statistiche.webp"
            width="2000"
            height="1250"
            loading="lazy"
            decoding="async"
            alt="Le statistiche di novembre per Forno Luce: 18 post, 24.310 persone raggiunte, le settimane e i post migliori."
          />
        </figure>
      </div>
    </section>

    <!-- 9 · Come si comincia -->
    <section class="band" aria-labelledby="start-title">
      <div class="wrap split">
        <h2 id="start-title">Come si comincia.</h2>
        <ol class="steps">
          <li>
            <h3>Ci sentiamo per la demo</h3>
            <p>
              Mezz’ora in videochiamata: ci racconti come lavora l’agenzia e ti mostriamo Feedway.
            </p>
          </li>
          <li>
            <h3>Prepariamo la tua agenzia</h3>
            <p>Creiamo lo spazio per l’agenzia e i clienti. Tu inviti il team con i suoi ruoli.</p>
          </li>
          <li>
            <h3>Colleghi i profili</h3>
            <p>
              Instagram e Facebook dei clienti si collegano da Meta, con i permessi che concedi tu.
              Il primo collegamento lo facciamo insieme.
            </p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 10 · Domande -->
    <section id="domande" class="band" aria-labelledby="faq-title">
      <div class="wrap split">
        <h2 id="faq-title">Domande frequenti</h2>
        <div class="faq">
          <details v-for="[q, a] in FAQ" :key="q">
            <summary>
              {{ q }}
              <SiteIcon name="chevron-down" />
            </summary>
            <p>{{ a }}</p>
          </details>
        </div>
      </div>
    </section>

    <!-- 11 · Chiusura -->
    <section class="closing" aria-labelledby="closing-title">
      <div class="wrap closing-grid">
        <div>
          <h2 id="closing-title">Vediamo Feedway con i tuoi clienti.</h2>
          <p>Mezz’ora di videochiamata, con i profili e i post veri della tua agenzia.</p>
        </div>
        <NuxtLink to="/richiedi-una-demo" class="btn btn-dark btn-lg">Richiedi una demo</NuxtLink>
      </div>
    </section>
  </main>
</template>
