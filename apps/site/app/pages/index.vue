<script setup lang="ts">
useSeoMeta({
  title: 'Feedway · Tutta la tua agenzia, in un solo posto',
  description:
    'Il pannello dove l’agenzia prepara, programma e pubblica i post di tutti i clienti su Instagram e Facebook, e controlla che siano usciti davvero.',
  ogTitle: 'Feedway · Tutta la tua agenzia, in un solo posto',
  ogDescription:
    'Prepara, programma e pubblica i post dei clienti su Instagram e Facebook, e sappi se sono usciti davvero.',
  ogType: 'website',
})

const TABS = [
  {
    id: 'prepara',
    label: 'Prepara il post',
    title: 'Un post per più profili, con l’anteprima vera',
    text: 'Scegli i file, scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. L’anteprima mostra il post come lo vedrà chi lo segue, e i controlli dicono subito cosa manca: un video troppo lungo, una foto troppo alta, un profilo da ricollegare.',
    shot: '/shots/editor.webp',
    alt: 'L’editor di Feedway con un carosello di Forno Luce, l’anteprima del feed e i controlli «Tutto pronto».',
  },
  {
    id: 'libreria',
    label: 'Tieni i file in ordine',
    title: 'La libreria di ogni cliente, con le cartelle',
    text: 'Foto e video di ogni cliente in un posto solo, con cartelle e tag. Carichi anche una cartella intera o uno zip dal computer; Feedway prepara le copie giuste per Instagram e Facebook e toglie la posizione e i dati della fotocamera.',
    shot: '/shots/libreria.webp',
    alt: 'La libreria di Feedway con le foto dei clienti divise per cartelle.',
  },
  {
    id: 'clienti',
    label: 'Segui ogni cliente',
    title: 'Ogni cliente con i suoi profili e i suoi post',
    text: 'Per ogni cliente vedi i profili collegati, i post in programma e quelli usciti, la libreria e chi del team ci lavora. Un post appartiene a un solo cliente e usa solo i suoi profili: niente post sulla Pagina sbagliata.',
    shot: '/shots/cliente.webp',
    alt: 'La pagina di un cliente in Feedway con i profili collegati e i prossimi post.',
  },
] as const

const active = ref<(typeof TABS)[number]['id']>('prepara')
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

const SOON = [
  ['Notifiche', 'un avviso quando un post non esce o un profilo va ricollegato.'],
  ['Calendario', 'il mese e la settimana di tutti i clienti in una vista.'],
  ['Piano editoriale', 'le idee del mese prima che diventino post.'],
  ['Calendario per il cliente', 'un link da mandare al cliente per fargli vedere cosa esce.'],
  ['Approvazione del cliente', 'il cliente approva o chiede una modifica dal telefono.'],
  ['TikTok e LinkedIn', 'uno alla volta, dopo Instagram e Facebook.'],
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
    'Posso usarlo dal telefono?',
    'Sì. Feedway è pensato prima per il computer, ma da telefono vedi Oggi, prepari un post, programmi e controlli l’esito.',
  ],
  [
    'Quanti clienti e quante persone posso aggiungere?',
    'Lo vediamo insieme durante la demo, in base a quanti clienti segui e a come lavora il team.',
  ],
  [
    'Funziona con TikTok e LinkedIn?',
    'Non ancora. Oggi Feedway pubblica su Instagram e Facebook; le altre piattaforme arriveranno una alla volta.',
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
            Feedway è il pannello dove l’agenzia prepara, programma e pubblica i post di tutti i
            clienti su Instagram e Facebook. E dopo l’uscita controlla che siano online davvero.
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
        <h2 id="product-title" class="section-title">Dal file al post, senza cambiare app.</h2>
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

    <!-- 7 · In arrivo -->
    <section class="band" aria-labelledby="soon-title">
      <div class="wrap split">
        <div>
          <h2 id="soon-title">Le prossime cose che arrivano.</h2>
          <p class="section-lead">
            Feedway cresce un pezzo alla volta, e mostriamo solo quello che c’è. Queste sono le
            prossime funzioni in programma.
          </p>
        </div>
        <dl class="soon">
          <div v-for="[title, text] in SOON" :key="title">
            <dt>{{ title }}</dt>
            <dd>{{ text }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 8 · Domande -->
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

    <!-- 9 · Chiusura -->
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
