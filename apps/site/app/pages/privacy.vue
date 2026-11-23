<script setup lang="ts">
import { LEGAL } from '~/legal'

useSeoMeta({
  title: 'Informativa privacy · Feedway',
  description:
    'Quali dati tratta Feedway, sul sito e nell’app collegata a Facebook e Instagram, per quanto li conserva e come chiederne la cancellazione.',
})
</script>

<template>
  <LegalPage title="Informativa privacy" :updated-on="LEGAL.updatedOn">
    <p class="lead">
      Questa pagina spiega quali dati personali tratta Feedway, perché, per quanto tempo e come puoi
      chiederne la cancellazione. Vale per questo sito e per l’app Feedway collegata a Facebook e
      Instagram.
    </p>

    <h2 id="titolare">Chi tratta i dati</h2>
    <p>
      Il titolare del trattamento è <LegalValue :value="LEGAL.controllerName" /><template
        v-if="LEGAL.controllerDetails"
        >, {{ LEGAL.controllerDetails }}</template
      >. Per qualsiasi domanda o richiesta sui tuoi dati scrivi a <LegalEmail />.
    </p>

    <h2 id="sito">Questo sito</h2>
    <p>
      Il sito non usa cookie, non ha statistiche, pubblicità o pulsanti di social network e non
      carica caratteri o script da altri siti. Per questo non c’è un banner dei cookie.
    </p>
    <p>
      Il sito è ospitato da Cloudflare, che per consegnare le pagine e proteggerle dagli attacchi
      tratta l’indirizzo IP e i dati tecnici della richiesta (browser, pagina, ora) come
      responsabile del trattamento. Cloudflare conserva questi dati secondo la propria
      <a href="https://www.cloudflare.com/it-it/privacypolicy/" rel="noopener">informativa</a>.
    </p>

    <h3 id="demo">Il modulo «Richiedi una demo»</h3>
    <p>
      Se compili il modulo, ci mandi il tuo nome, il nome dell’agenzia e l’email, e se vuoi il
      telefono, quanti clienti gestisci e un messaggio. Li usiamo solo per risponderti e organizzare
      la demo, su tua richiesta (art. 6.1.b del GDPR, misure precontrattuali). Il sito non li salva:
      arrivano per email al titolare e restano nella sua casella per al massimo 12 mesi dall’ultimo
      contatto, poi si cancellano. Non li usiamo per newsletter o pubblicità e non li diamo ad
      altri.
    </p>

    <h2 id="app">L’app Feedway e i dati di Facebook e Instagram</h2>
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
        un account, conservato cifrato e usato solo per pubblicare e controllare i post;
      </li>
      <li>
        l’<strong>identificativo, il nome, il nome utente e la foto del profilo</strong> delle
        Pagine Facebook e degli account Instagram collegati, per mostrarli nel pannello;
      </li>
      <li>
        per ogni post pubblicato da Feedway, l’<strong>identificativo e il link</strong> che Meta
        restituisce e lo <strong>stato della pubblicazione</strong>, per sapere se il post è uscito
        davvero;
      </li>
      <li>
        l’<strong>identificativo dell’utente o dell’utente di sistema</strong> che ha collegato
        l’account e il <strong>nome del Business</strong>, per sapere da quale collegamento arriva;
      </li>
      <li>
        la <strong>scadenza del codice</strong> e i <strong>limiti di pubblicazione</strong> che
        Meta indica, per avvisare quando un account va ricollegato o è vicino al limite.
      </li>
    </ul>
    <p>
      Feedway non legge messaggi, commenti, follower, statistiche o dati delle persone che seguono
      le Pagine e gli account. Non vende i dati, non li usa per pubblicità o profilazione e non li
      condivide con altri, se non con Meta stessa per pubblicare i contenuti che l’agenzia ha
      preparato.
    </p>
    <p>
      Le foto e i video da pubblicare li carica l’agenzia, che li tratta per conto dei suoi clienti.
      Per farli scaricare a Meta, Feedway li espone per il tempo necessario a un indirizzo casuale,
      non elencato e non indicizzato dai motori di ricerca, e ne toglie la posizione e i dati della
      fotocamera.
    </p>
    <p>
      I dati stanno su un server gestito dal titolare, con accesso riservato alle persone
      dell’agenzia, ognuna con il proprio ruolo, e ogni agenzia separata dalle altre.
    </p>

    <h3 id="conservazione">Per quanto li conserviamo</h3>
    <ul>
      <li>
        Codici di accesso e dati delle Pagine e degli account: finché l’account resta collegato a
        Feedway. Si cancellano entro 30 giorni da quando l’agenzia lo scollega o tu ne chiedi la
        cancellazione.
      </li>
      <li>
        Foto e video: finché l’agenzia li tiene in Feedway; quando li elimina si cancellano subito,
        con le copie preparate per Meta.
      </li>
      <li>
        Identificativi e stato dei post pubblicati: finché l’agenzia usa Feedway, come storico del
        lavoro svolto.
      </li>
    </ul>

    <h2 id="cancellazione">Come chiedere la cancellazione dei dati</h2>
    <p>
      Puoi chiedere in qualsiasi momento la cancellazione dei dati che Feedway ha ricevuto da
      Facebook o Instagram. I passi sono nella pagina
      <NuxtLink to="/cancellazione-dati">Cancellazione dei dati</NuxtLink>.
    </p>

    <h2 id="diritti">I tuoi diritti</h2>
    <p>
      Puoi chiedere di vedere i tuoi dati, correggerli, cancellarli, limitarne l’uso, opporti al
      trattamento e riceverli in un formato leggibile (artt. 15–22 del GDPR), scrivendo a
      <LegalEmail />. Rispondiamo entro 30 giorni. Se pensi che i tuoi dati siano trattati in modo
      scorretto puoi fare reclamo al
      <a href="https://www.garanteprivacy.it/" rel="noopener"
        >Garante per la protezione dei dati personali</a
      >.
    </p>

    <h2 id="modifiche">Modifiche</h2>
    <p>
      Se cambiamo questa informativa aggiorniamo la data in cima alla pagina. Per i cambiamenti
      importanti avvisiamo le agenzie che usano Feedway.
    </p>
  </LegalPage>
</template>
