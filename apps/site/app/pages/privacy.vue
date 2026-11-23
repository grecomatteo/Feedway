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
      Facebook o Instagram: ce ne occupiamo noi e avvisiamo l’agenzia.
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
      email e restano nella nostra casella per al massimo 12 mesi dall’ultimo contatto, poi si
      cancellano. Non li usiamo per newsletter o pubblicità e non li diamo ad altri.
    </p>

    <h2 id="account">Chi usa Feedway</h2>
    <p>
      Feedway non ha una registrazione libera: le persone di un’agenzia entrano su invito. Per ogni
      persona trattiamo nome, soprannome e foto se li aggiunge, email, password (conservata solo
      come impronta cifrata) o passkey, secondo fattore, i dispositivi e le sessioni con cui accede
      (indirizzo IP e browser) e le azioni che fa nel pannello, che finiscono nel registro attività
      dell’agenzia.
    </p>
    <p>
      Servono a dare il servizio all’agenzia (art. 6.1.b del GDPR) e a proteggere gli account e i
      dati dei clienti, per esempio bloccando un accesso sospetto (nostro legittimo interesse, art.
      6.1.f). Senza email e credenziali non si può accedere. Ogni persona può scaricare i propri
      dati e chiedere la chiusura del proprio account.
    </p>

    <h2 id="meta">I dati di Facebook e Instagram</h2>
    <p>
      Feedway è uno strumento per le agenzie di comunicazione: serve a preparare, programmare e
      pubblicare i post dei clienti sulle Pagine Facebook e sugli account Instagram professionali
      che l’agenzia gestisce. Si collega a Meta solo con le API ufficiali e solo con i permessi che
      chi collega l’account concede.
    </p>
    <p>Dai prodotti di Meta Feedway riceve e conserva soltanto:</p>
    <ul>
      <li>
        il <strong>codice di accesso</strong> (token) che Meta rilascia quando colleghi una Pagina o
        un account, conservato cifrato, mai mostrato e usato solo per pubblicare e controllare i
        post;
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
        le copie di sicurezza:
        <LegalValue
          :value="LEGAL.backupProvider"
          fallback="un servizio di archiviazione, con accesso riservato"
        />;
      </li>
      <li>
        le email del pannello (inviti, avvisi):
        <LegalValue :value="LEGAL.emailProvider" fallback="un servizio di invio email" />;
      </li>
      <li>Cloudflare, che ospita questo sito;</li>
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
      Cloudflare, Tailscale e Meta possono trattare dati negli Stati Uniti. Avviene con il Data
      Privacy Framework UE–USA o con le clausole contrattuali tipo approvate dalla Commissione
      europea. Puoi chiederne una copia scrivendo a <LegalEmail />.
    </p>

    <h2 id="conservazione">Per quanto li conserviamo</h2>
    <ul>
      <li>
        Codici di accesso e dati delle Pagine e degli account: finché l’account resta collegato a
        Feedway. Si cancellano entro 30 giorni da quando l’agenzia lo scollega o tu ne chiedi la
        cancellazione.
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
        Account delle persone: finché la persona fa parte di un’agenzia. Le sessioni scadute si
        cancellano dopo 30 giorni, i dispositivi dopo 12 mesi senza uso; nel registro attività
        l’indirizzo IP si accorcia dopo 90 giorni e il registro si tiene 24 mesi.
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
      Puoi chiedere di vedere i tuoi dati, correggerli, cancellarli, limitarne l’uso, opporti al
      trattamento e riceverli in un formato leggibile (artt. 15–22 del GDPR), scrivendo a
      <LegalEmail />. Rispondiamo entro 30 giorni. Non trattiamo dati sulla base del consenso,
      quindi non c’è un consenso da revocare. Se pensi che i tuoi dati siano trattati in modo
      scorretto puoi fare reclamo al
      <a href="https://www.garanteprivacy.it/" rel="noopener"
        >Garante per la protezione dei dati personali</a
      >.
    </p>

    <h2 id="modifiche">Modifiche</h2>
    <p>
      Se cambiamo questa informativa aggiorniamo la data in cima alla pagina. Per i cambiamenti
      importanti avvisiamo le agenzie che usano Feedway. Le condizioni d’uso del servizio sono nei
      <NuxtLink to="/termini">Termini di servizio</NuxtLink>.
    </p>
  </LegalPage>
</template>
