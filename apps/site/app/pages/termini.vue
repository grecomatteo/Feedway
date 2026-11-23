<script setup lang="ts">
import { LEGAL } from '~/legal'

useSeoMeta({
  title: 'Termini di servizio · Feedway',
  description:
    'Le condizioni d’uso di questo sito e del servizio Feedway per le agenzie di comunicazione.',
})
</script>

<template>
  <LegalPage title="Termini di servizio" :updated-on="LEGAL.updatedOn">
    <p class="lead">
      Queste condizioni valgono per chi visita questo sito e per le agenzie che usano Feedway.
      Prezzi, durata, livelli di servizio e altre condizioni economiche stanno nel contratto che
      firmiamo con ogni agenzia.
    </p>

    <h2 id="chi">Chi offre il servizio</h2>
    <p>
      Feedway è offerto da <LegalValue :value="LEGAL.controllerName" /><template
        v-if="LEGAL.controllerDetails"
        >, {{ LEGAL.controllerDetails }}</template
      >. Per qualsiasi domanda scrivi a <LegalEmail />.
    </p>

    <h2 id="servizio">Il servizio</h2>
    <p>
      Feedway è un pannello per le agenzie di comunicazione: serve a preparare, programmare e
      pubblicare i post dei loro clienti su Instagram e Facebook, e a controllare che siano usciti.
      Non c’è una registrazione libera: un’agenzia comincia dopo la demo e la firma del contratto, e
      le persone dell’agenzia entrano su invito.
    </p>
    <p>
      <strong
        >Feedway è riservato a chi lo usa per la propria attività professionale o d’impresa</strong
      >
      e non è offerto ai consumatori. Per questo al rapporto con l’agenzia non si applicano le norme
      del Codice del consumo pensate per i consumatori.
    </p>
    <p>
      Le funzioni segnate su questo sito con «In arrivo» sono in preparazione: le descriviamo per
      far capire dove va Feedway, ma non sono ancora disponibili e non promettiamo una data. Cosa è
      compreso nel servizio lo dice il contratto.
    </p>
    <p>
      Feedway non è un prodotto di Meta e non è approvato o sponsorizzato da Meta. Facebook e
      Instagram sono marchi di Meta Platforms, Inc.
    </p>

    <h2 id="contratto">Contratto e termini</h2>
    <p>
      Se il contratto firmato con l’agenzia dice qualcosa di diverso da questi termini, vale il
      contratto. Le clausole che la legge chiede di approvare per iscritto (artt. 1341 e 1342 del
      Codice civile), come i limiti di responsabilità, la sospensione e il foro, valgono per
      l’agenzia quando le approva nel contratto.
    </p>

    <h2 id="uso">Come si usa</h2>
    <ul>
      <li>
        L’agenzia collega solo Pagine e account che ha il diritto di gestire, con il permesso dei
        suoi clienti.
      </li>
      <li>
        L’agenzia è responsabile dei contenuti che carica e pubblica: ha i diritti su testi, foto,
        video e musica, e rispetta la legge e le condizioni e le regole di Meta, di Facebook e di
        Instagram.
      </li>
      <li>
        Ogni persona tiene per sé le proprie credenziali e usa il proprio account. Chi gestisce
        l’agenzia sceglie chi entra e con quale ruolo, e ci avvisa subito se pensa che un account
        sia stato usato da altri.
      </li>
      <li>
        Non si usa Feedway per contenuti illeciti, spam o per aggirare i limiti delle piattaforme, e
        non si prova ad accedere a dati di altre agenzie o a parti del servizio non previste.
      </li>
    </ul>

    <h2 id="pubblicazione">La pubblicazione</h2>
    <p>
      Feedway pubblica con le API ufficiali di Meta, quindi dipende dal loro funzionamento. Facciamo
      il possibile perché ogni post esca all’ora giusta e controlliamo dopo la pubblicazione se è
      uscito; se non esce, Feedway lo segnala con il motivo. Non possiamo garantire che Meta accetti
      ogni contenuto né che il servizio sia sempre disponibile: può fermarsi per manutenzione, per
      un guasto o per una scelta di Meta.
    </p>

    <h2 id="responsabilita">Responsabilità</h2>
    <p>
      Rispondiamo dei danni causati dal servizio nei limiti previsti dal contratto. Non rispondiamo
      dei contenuti pubblicati dall’agenzia, delle decisioni di Meta (per esempio un post rifiutato
      o un account limitato) né dei guasti di servizi che non controlliamo. Questi limiti non
      valgono in caso di dolo o colpa grave (art. 1229 del Codice civile). Se un terzo ci chiede un
      risarcimento per un contenuto pubblicato dall’agenzia, l’agenzia ci tiene indenni.
    </p>

    <h2 id="proprieta">Proprietà</h2>
    <p>
      Il software di Feedway, il marchio e i testi e le immagini di questo sito sono nostri, salvo i
      marchi di altri citati. Con il contratto l’agenzia riceve il diritto di usare Feedway per il
      suo lavoro, per la durata del contratto. I contenuti che l’agenzia carica restano suoi e dei
      suoi clienti: li usiamo solo per dare il servizio.
    </p>

    <h2 id="dati">I dati</h2>
    <p>
      Come trattiamo i dati personali è scritto nell’<NuxtLink to="/privacy"
        >informativa privacy</NuxtLink
      >. Per i dati dei clienti dell’agenzia trattiamo per conto dell’agenzia, come responsabile del
      trattamento (art. 28 del GDPR), secondo l’accordo sul trattamento dei dati che firmiamo con
      lei insieme al contratto.
    </p>

    <h2 id="sospensione">Sospensione e chiusura</h2>
    <p>
      Possiamo sospendere un account che viola queste condizioni, la legge o le regole di Meta,
      avvisando l’agenzia prima quando possibile, o subito dopo quando serve fermare un danno.
      L’agenzia può chiudere il servizio come previsto dal contratto. Alla chiusura l’agenzia ha 30
      giorni per scaricare i suoi contenuti, e se serve la aiutiamo; poi cancelliamo i suoi dati
      come previsto dall’accordo sul trattamento dei dati.
    </p>

    <h2 id="legge">Legge e foro</h2>
    <p>
      Valgono la legge italiana e, per le controversie con le agenzie, il foro
      <LegalValue :value="LEGAL.court" fallback="competente per legge" />.
    </p>

    <h2 id="modifiche">Modifiche</h2>
    <p>
      Se cambiamo queste condizioni aggiorniamo la data in cima alla pagina e avvisiamo le agenzie
      almeno 30 giorni prima che i cambiamenti importanti valgano. Chi non è d’accordo può recedere
      dal contratto senza penali prima di quella data.
    </p>
  </LegalPage>
</template>
