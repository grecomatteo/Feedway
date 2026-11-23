<script setup lang="ts">
import { LEGAL } from '~/legal'

useSeoMeta({
  title: 'Informativa privacy · Feedway',
  description:
    'Quali dati tratta Feedway, sul sito e nell’app collegata a Facebook e Instagram, per quanto li conserva e come chiederne la cancellazione.',
})

// One row per Meta permission the app asks for: what Feedway does with it, nothing more.
const PERMISSIONS = [
  ['pages_show_list', 'elencare le Pagine Facebook che chi collega può gestire, per sceglierle.'],
  [
    'business_management',
    'trovare le Pagine e gli account Instagram del Business, quando il collegamento passa da un utente di sistema.',
  ],
  ['pages_read_engagement', 'leggere identificativo, nome e foto della Pagina.'],
  ['pages_manage_posts', 'pubblicare sulla Pagina i post che l’agenzia ha programmato.'],
  ['instagram_basic', 'leggere identificativo, nome utente e foto dell’account Instagram.'],
  [
    'instagram_content_publish',
    'pubblicare sull’account Instagram i post che l’agenzia ha programmato.',
  ],
  ['pages_manage_engagement', 'facoltativo: caricare su Facebook la copertina scelta per un reel.'],
  [
    'pages_read_user_content',
    'facoltativo: caricare su Facebook la copertina scelta per un reel (Meta lo chiede insieme al precedente).',
  ],
] as const
</script>

<template>
  <LegalPage title="Informativa privacy" :updated-on="LEGAL.updatedOn">
    <p class="lead">
      Questa pagina spiega quali dati personali tratta Feedway, perché, per quanto tempo e come puoi
      chiederne la cancellazione. Vale per questo sito e per l’app Feedway collegata a Facebook e
      Instagram.
    </p>
    <nav aria-label="In questa pagina" class="legal-toc">
      <a href="#titolare">Chi tratta i dati</a>
      <a href="#sito">Questo sito</a>
      <a href="#account">Chi usa Feedway</a>
      <a href="#meta">I dati di Facebook e Instagram</a>
      <a href="#fornitori">Fornitori e trasferimenti</a>
      <a href="#conservazione">Per quanto li conserviamo</a>
      <a href="#cancellazione">Cancellazione</a>
      <a href="#diritti">I tuoi diritti</a>
    </nav>

    <h2 id="titolare">Chi tratta i dati</h2>
    <p>
      Feedway è offerto da <LegalValue :value="LEGAL.controllerName" /><template
        v-if="LEGAL.controllerDetails"
        >, {{ LEGAL.controllerDetails }}</template
      >. Per qualsiasi domanda o richiesta sui tuoi dati scrivi a <LegalEmail />. Non abbiamo
      nominato un responsabile della protezione dei dati (DPO), perché non è obbligatorio per la
      nostra attività.
    </p>
    <p>I ruoli cambiano secondo i dati:</p>
    <ul>
      <li>
        per questo sito, il modulo «Richiedi una demo» e gli account delle persone che usano Feedway
        siamo noi il <strong>titolare</strong> del trattamento;
      </li>
      <li>
        per i contenuti e i profili che un’agenzia gestisce in Feedway per i suoi clienti (post,
        foto e video, Pagine e account collegati) il titolare è l’<strong>agenzia</strong>, e noi li
        trattiamo per suo conto come <strong>responsabile</strong> (art. 28 del GDPR), secondo
        l’accordo che firmiamo con lei.
      </li>
    </ul>
    <p>
      In tutti e due i casi puoi chiedere a noi la cancellazione dei dati che Feedway ha ricevuto da
      Facebook o Instagram: riceviamo la richiesta, avvisiamo l’agenzia e cancelliamo i dati come
      previsto dall’accordo con lei.
    </p>

    <h2 id="sito">Questo sito</h2>
    <p>
      Il sito non usa cookie, non ha statistiche, pubblicità o pulsanti di social network e non
      carica caratteri o script da altri siti. Per questo non c’è un banner dei cookie.
    </p>
    <p>
      Il sito è ospitato da Cloudflare, che per consegnare le pagine e proteggerle dagli attacchi
      tratta l’indirizzo IP e i dati tecnici della richiesta (browser, pagina, ora) come nostro
      responsabile del trattamento. La base giuridica è il nostro legittimo interesse a tenere il
      sito raggiungibile e sicuro (art. 6.1.f del GDPR). Cloudflare conserva questi dati secondo la
      propria
      <a href="https://www.cloudflare.com/it-it/privacypolicy/" rel="noopener">informativa</a>.
    </p>

    <h3 id="demo">Il modulo «Richiedi una demo»</h3>
    <p>
      Se compili il modulo, ci mandi il tuo nome, il nome dell’agenzia e l’email, e se vuoi il
      telefono, quanti clienti gestisci e un messaggio. Li usiamo solo per risponderti e organizzare
      la demo, su tua richiesta (art. 6.1.b del GDPR, misure precontrattuali). Nome, agenzia ed
      email servono per risponderti: senza, non possiamo farlo. Il sito non li salva: arrivano per
      email, attraverso Cloudflare, nella nostra casella (<LegalValue
        :value="LEGAL.mailboxProvider"
        fallback="un servizio di posta"
      />) e ci restano al massimo 12 mesi dall’ultimo contatto, poi li cancelliamo. Non li usiamo
      per newsletter o pubblicità e non li diamo ad altri.
    </p>

    <h2 id="account">Chi usa Feedway</h2>
    <p>
      Feedway non ha una registrazione libera: le persone di un’agenzia entrano su invito. Per ogni
      persona trattiamo nome, soprannome e foto se li aggiunge, email, password (conservata solo
      come impronta, mai in chiaro) o passkey, secondo fattore, i dispositivi e le sessioni con cui
      accede (indirizzo IP e browser) e le azioni che fa nel pannello, che finiscono nel registro
      attività dell’agenzia.
    </p>
    <p>
      Servono a dare il servizio che l’agenzia ci ha chiesto: per il contratto con l’agenzia (art.
      6.1.b del GDPR) e, per le persone che l’agenzia invita, per il nostro legittimo interesse a
      dare loro l’accesso che l’agenzia ha chiesto (art. 6.1.f). Servono anche a proteggere gli
      account e i dati dei clienti, per esempio bloccando un accesso sospetto (nostro legittimo
      interesse, art. 6.1.f). Senza email e credenziali non si può accedere. Ogni persona può
      scaricare i propri dati e chiedere la chiusura del proprio account.
    </p>

    <h2 id="meta">I dati di Facebook e Instagram</h2>
    <p>
      Feedway è uno strumento per le agenzie di comunicazione: serve a preparare, programmare e
      pubblicare i post dei clienti sulle Pagine Facebook e sugli account Instagram professionali
      che l’agenzia gestisce. Si collega a Meta solo con le API ufficiali e solo con i permessi che
      chi collega l’account concede.
    </p>
    <p>Dai prodotti di Meta Feedway conserva soltanto:</p>
    <ul>
      <li>
        il <strong>codice di accesso</strong> (token) che Meta rilascia quando colleghi una Pagina o
        un account, conservato cifrato, mai mostrato e usato solo per pubblicare i post, controllare
        che siano usciti e tenere aggiornato lo stato degli account collegati;
      </li>
      <li>
        l’<strong>identificativo, il nome, il nome utente e la foto del profilo</strong> delle
        Pagine Facebook e degli account Instagram collegati, per mostrarli nel pannello;
      </li>
      <li>
        l’<strong>elenco dei permessi concessi</strong>, l’<strong
          >identificativo dell’utente o dell’utente di sistema</strong
        >
        che ha collegato l’account e il <strong>nome del Business</strong>, per sapere da quale
        collegamento arriva e cosa può fare;
      </li>
      <li>
        per ogni post pubblicato da Feedway, l’<strong>identificativo e il link</strong> che Meta
        restituisce e lo <strong>stato della pubblicazione</strong>, per sapere se il post è uscito
        davvero;
      </li>
      <li>
        la <strong>scadenza del codice</strong> e i <strong>limiti di pubblicazione</strong> che
        Meta indica, per avvisare quando un account va ricollegato o è vicino al limite.
      </li>
    </ul>
    <p>
      Per controllare che un post sia uscito davvero, Feedway legge anche gli ultimi post
      dell’account (testo, data e link) e li confronta con quello pubblicato: non li conserva.
    </p>
    <p>Ogni permesso che Feedway chiede a Meta serve a una cosa sola:</p>
    <dl class="legal-permissions">
      <div v-for="[name, use] in PERMISSIONS" :key="name">
        <dt>
          <code>{{ name }}</code>
        </dt>
        <dd>{{ use }}</dd>
      </div>
    </dl>
    <p>
      Feedway non legge messaggi, commenti, follower, statistiche o dati delle persone che seguono
      le Pagine e gli account. Non vende i dati, non li usa per pubblicità o profilazione, non li
      usa per addestrare modelli di intelligenza artificiale e non li condivide con altri, se non
      con Meta stessa per pubblicare i contenuti che l’agenzia ha preparato. Nessuna decisione che
      ti riguarda viene presa in modo automatico.
    </p>
    <p>
      Le foto e i video da pubblicare li carica l’agenzia. Per farli scaricare a Meta, Feedway ne
      prepara una copia, la espone per il tempo necessario a un indirizzo casuale, non elencato e
      non indicizzato dai motori di ricerca, e ne toglie la posizione e i dati della fotocamera.
    </p>

    <h2 id="fornitori">Fornitori e trasferimenti</h2>
    <p>
      I dati li vedono solo le persone dell’agenzia, ognuna con il suo ruolo, e questi fornitori:
    </p>
    <ul>
      <li>
        il server del pannello:
        <LegalValue :value="LEGAL.hostingProvider" fallback="un fornitore di server privato" />,
        nostro responsabile del trattamento;
      </li>
      <li>
        le email del pannello (inviti, avvisi):
        <LegalValue :value="LEGAL.emailProvider" fallback="un servizio di invio email" />;
      </li>
      <li>Cloudflare, che ospita questo sito e consegna le richieste del modulo;</li>
      <li>
        la casella che riceve le richieste di demo e le email sulla privacy:
        <LegalValue :value="LEGAL.mailboxProvider" fallback="un servizio di posta" />;
      </li>
      <li>
        Tailscale, la rete privata da cui le persone dell’agenzia raggiungono il pannello e da cui
        Meta scarica le copie da pubblicare;
      </li>
      <li>
        Meta Platforms Ireland, che riceve i contenuti da pubblicare e li tratta secondo le proprie
        condizioni.
      </li>
    </ul>
    <p>
      Cloudflare, Google, Oracle, Tailscale e Meta possono trattare dati negli Stati Uniti. Avviene
      con la decisione di adeguatezza della Commissione europea sul Data Privacy Framework UE–USA,
      per chi vi aderisce, o con le clausole contrattuali tipo approvate dalla Commissione (artt. 45
      e 46 del GDPR). Puoi chiederne una copia scrivendo a <LegalEmail />.
    </p>

    <h2 id="conservazione">Per quanto li conserviamo</h2>
    <ul>
      <li>
        Codici di accesso e dati delle Pagine e degli account: finché l’agenzia li usa in Feedway.
        Se l’accesso viene tolto, da Facebook o da chi l’aveva dato, l’account resta in Feedway come
        inattivo e non può più pubblicare, finché tu o l’agenzia non ne chiedete la cancellazione:
        allora lo cancelliamo entro 30 giorni.
      </li>
      <li>
        Foto e video: finché l’agenzia li tiene in Feedway. Le copie preparate per Meta si
        cancellano di norma 7 giorni dopo la pubblicazione.
      </li>
      <li>
        Identificativi e stato dei post pubblicati: finché l’agenzia usa Feedway, come storico del
        lavoro svolto.
      </li>
      <li>
        Account delle persone: finché la persona li usa. Con «Elimina il mio account» nome, email,
        foto e credenziali si cancellano subito e al loro posto resta «Utente rimosso». Un account
        disattivato si cancella allo stesso modo dopo 24 mesi, e l’agenzia lo sa 30 giorni prima.
      </li>
      <li>
        Sessioni scadute: cancellate dopo 30 giorni. Dispositivi da cui si accede: cancellati dopo
        12 mesi senza uso.
      </li>
      <li>
        Registro attività dell’agenzia: resta finché l’agenzia usa Feedway, perché serve a
        ricostruire chi ha fatto cosa. Dopo 90 giorni l’indirizzo IP delle voci si accorcia, così
        non indica più un singolo dispositivo, e chi ha eliminato il proprio account compare come
        «Utente rimosso».
      </li>
      <li>
        Quando un’agenzia smette di usare Feedway, cancelliamo i suoi dati come previsto
        dall’accordo con lei.
      </li>
      <li>Richieste di demo: al massimo 12 mesi dall’ultimo contatto.</li>
    </ul>
    <p>
      I post già pubblicati su Facebook e Instagram restano lì anche quando Feedway cancella i suoi
      dati: li gestisci da Facebook o Instagram.
    </p>

    <h2 id="cancellazione">Come chiedere la cancellazione dei dati</h2>
    <p>
      Puoi chiedere in qualsiasi momento la cancellazione dei dati che Feedway ha ricevuto da
      Facebook o Instagram, in due modi:
    </p>
    <ul>
      <li>
        togli Feedway dalle app collegate nelle impostazioni di Facebook, così non può più usare il
        codice di accesso;
      </li>
      <li>
        scrivi a <LegalEmail subject="Richiesta di cancellazione dei dati" /> e indica la Pagina o
        l’account: cancelliamo tutto entro 30 giorni e ti confermiamo quando è fatto.
      </li>
    </ul>
    <p>
      I passi uno per uno sono nella pagina
      <NuxtLink to="/cancellazione-dati">Cancellazione dei dati</NuxtLink>.
    </p>

    <h2 id="diritti">I tuoi diritti</h2>
    <p>
      Puoi chiedere di vedere i tuoi dati, correggerli, cancellarli, limitarne l’uso e riceverli in
      un formato leggibile (artt. 15–20 del GDPR), scrivendo a <LegalEmail />.
    </p>
    <p>
      <strong
        >Puoi anche opporti in qualsiasi momento ai trattamenti basati sul nostro legittimo
        interesse</strong
      >
      (art. 21 del GDPR): ci fermiamo, a meno che ci siano motivi legittimi più forti dei tuoi
      interessi o servano per difendere un diritto in giudizio.
    </p>
    <p>
      Rispondiamo entro un mese dalla richiesta. Se la richiesta è complessa possiamo prendere altri
      due mesi, e in quel caso te lo diciamo entro il primo mese con il motivo (art. 12 del GDPR).
      La risposta è gratuita. Se non siamo sicuri di chi sei, possiamo chiederti di dimostrarlo
      prima di rispondere. Per i dati che trattiamo per conto di un’agenzia giriamo la richiesta
      all’agenzia e la aiutiamo a risponderti.
    </p>
    <p>
      Non trattiamo dati sulla base del consenso, quindi non c’è un consenso da revocare. Se pensi
      che i tuoi dati siano trattati in modo scorretto puoi fare reclamo al
      <a href="https://www.garanteprivacy.it/" rel="noopener"
        >Garante per la protezione dei dati personali</a
      >
      o all’autorità di controllo del Paese dell’Unione in cui vivi o lavori (art. 77 del GDPR).
    </p>

    <h2 id="modifiche">Modifiche</h2>
    <p>
      Se cambiamo questa informativa aggiorniamo la data in cima alla pagina. Per i cambiamenti
      importanti avvisiamo le agenzie che usano Feedway. Le condizioni d’uso del servizio sono nei
      <NuxtLink to="/termini">Termini di servizio</NuxtLink>.
    </p>
  </LegalPage>
</template>
