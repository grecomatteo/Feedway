<script setup lang="ts">
import { LEGAL } from '~/legal'

useSeoMeta({
  title: 'Cancellazione dei dati · Feedway',
  description:
    'Come chiedere la cancellazione dei dati che Feedway ha ricevuto da Facebook e Instagram.',
})
</script>

<template>
  <LegalPage title="Cancellazione dei dati" :updated-on="LEGAL.updatedOn">
    <p class="lead">
      Puoi chiedere in qualsiasi momento la cancellazione dei dati che Feedway ha ricevuto da
      Facebook o Instagram. Ecco come.
    </p>

    <h2 id="scollega">1. Togli l’accesso a Feedway</h2>
    <p>Da Facebook, così Feedway non può più usare il codice di accesso:</p>
    <ol>
      <li>apri Facebook e vai in <strong>Impostazioni e privacy → Impostazioni</strong>;</li>
      <li>scegli <strong>Integrazioni aziendali</strong> (o <strong>App e siti web</strong>);</li>
      <li>trova <strong>Feedway</strong> e premi <strong>Rimuovi</strong>.</li>
    </ol>
    <p>
      Se l’account è stato collegato dal Business Manager dell’agenzia, chiedi all’agenzia di
      togliere a Feedway l’accesso dal suo Business Manager, oppure togli all’agenzia l’accesso alla
      Pagina o all’account Instagram dalle impostazioni di Meta Business.
    </p>

    <h2 id="richiesta">2. Chiedi la cancellazione</h2>
    <p>
      Scrivi a <LegalEmail subject="Richiesta di cancellazione dei dati" /> con oggetto «Richiesta
      di cancellazione dei dati» e indica il nome della Pagina Facebook o dell’account Instagram.
      Non mandare password o codici.
    </p>

    <h2 id="cosa-succede">3. Cosa succede dopo</h2>
    <ul>
      <li>
        Ti rispondiamo per conferma entro 7 giorni, e se serve ti chiediamo di provare che l’account
        è tuo.
      </li>
      <li>
        Entro 30 giorni cancelliamo l’identificativo, il nome e la foto della Pagina o dell’account,
        gli identificativi e i link dei post che Feedway ha pubblicato lì e il codice di accesso, se
        serviva solo a quella Pagina o a quell’account.
      </li>
      <li>
        Ti scriviamo quando la cancellazione è fatta, e lo diciamo all’agenzia che l’aveva
        collegato.
      </li>
      <li>
        Le foto e i video che l’agenzia ha caricato in Feedway sono suoi: se vuoi che li cancelli,
        giriamo la richiesta all’agenzia.
      </li>
    </ul>
    <p>
      Teniamo solo una nota con la data della richiesta e della cancellazione, per poter dimostrare
      di averla eseguita; non contiene i dati cancellati.
    </p>
    <p>
      I post già pubblicati su Facebook e Instagram restano lì: li gestisci tu da Facebook o
      Instagram. Cosa tratta Feedway e perché è spiegato nell’<NuxtLink to="/privacy"
        >informativa privacy</NuxtLink
      >.
    </p>
  </LegalPage>
</template>
