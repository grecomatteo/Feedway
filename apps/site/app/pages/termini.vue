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
      Prezzi, durata e altre condizioni economiche stanno nel contratto che firmiamo con ogni
      agenzia.
    </p>

    <h2 id="servizio">Il servizio</h2>
    <p>
      Feedway è un pannello per le agenzie di comunicazione: serve a preparare, programmare e
      pubblicare i post dei loro clienti su Instagram e Facebook, e a controllare che siano usciti.
      Lo offre <LegalValue :value="LEGAL.controllerName" /><template v-if="LEGAL.controllerDetails"
        >, {{ LEGAL.controllerDetails }}</template
      >. Non c’è una registrazione libera: un’agenzia comincia dopo la demo, e le persone
      dell’agenzia entrano su invito.
    </p>
    <p>
      Feedway non è un prodotto di Meta e non è approvato o sponsorizzato da Meta. Facebook e
      Instagram sono marchi di Meta Platforms, Inc.
    </p>

    <h2 id="uso">Come si usa</h2>
    <ul>
      <li>
        L’agenzia collega solo Pagine e account che ha il diritto di gestire, con il permesso dei
        suoi clienti.
      </li>
      <li>
        L’agenzia è responsabile dei contenuti che pubblica e rispetta le condizioni e le regole di
        Meta, di Facebook e di Instagram.
      </li>
      <li>
        Ogni persona tiene per sé le proprie credenziali e usa il proprio account. Chi gestisce
        l’agenzia sceglie chi entra e con quale ruolo.
      </li>
      <li>
        Non si usa Feedway per contenuti illeciti, spam o per aggirare i limiti delle piattaforme.
      </li>
    </ul>

    <h2 id="pubblicazione">La pubblicazione</h2>
    <p>
      Feedway pubblica con le API ufficiali di Meta, quindi dipende dal loro funzionamento. Facciamo
      il possibile perché ogni post esca all’ora giusta e controlliamo dopo la pubblicazione se è
      uscito; se non esce, Feedway lo segnala con il motivo. Non possiamo garantire che Meta accetti
      ogni contenuto né che il servizio sia sempre disponibile.
    </p>

    <h2 id="dati">I dati</h2>
    <p>
      Come trattiamo i dati personali è scritto nell’<NuxtLink to="/privacy"
        >informativa privacy</NuxtLink
      >. Per i dati dei clienti dell’agenzia trattiamo per conto dell’agenzia, secondo l’accordo sul
      trattamento dei dati che firmiamo con lei. I contenuti restano dell’agenzia e dei suoi
      clienti.
    </p>

    <h2 id="sospensione">Sospensione e chiusura</h2>
    <p>
      Possiamo sospendere un account che viola queste condizioni o le regole di Meta, avvisando
      l’agenzia quando possibile. L’agenzia può chiudere il servizio come previsto dal contratto; i
      dati si cancellano nei tempi dell’informativa.
    </p>

    <h2 id="legge">Legge e foro</h2>
    <p>
      Valgono la legge italiana e, per le controversie tra professionisti, il foro
      <LegalValue :value="LEGAL.court" fallback="competente per legge" />. Per qualsiasi domanda
      scrivi a <LegalEmail />.
    </p>

    <h2 id="modifiche">Modifiche</h2>
    <p>
      Se cambiamo queste condizioni aggiorniamo la data in cima alla pagina e avvisiamo le agenzie
      prima che i cambiamenti importanti valgano.
    </p>
  </LegalPage>
</template>
