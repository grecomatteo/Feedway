# ADR 022 · App Meta in Live (sostituisce un punto dell'ADR 015)

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-11-23 |
| **Specifica** | §3, §8.0, §19, §20 |

## Contesto
L'[ADR 015](015-collegamenti-account-multipli.md) dice che «l'app Meta resta in modalità sviluppo» e che la revisione dell'app serve solo per aprire ad altre agenzie. La specifica lo ripete (§8.0: «nessuna revisione necessaria per l'uso interno»). Valeva per quello che si era visto l'11/11: i post si vedevano in una finestra anonima.

La prova della 0.13.0 (21–23/11, D-119) l'ha smentito per Facebook. Con l'app in **Sviluppo** i post con il testo pubblicati da Feedway sulla Pagina li vede solo chi ha un ruolo nell'app; da un profilo esterno si vedono solo foto e reel nelle loro sezioni. Su Instagram i post sono pubblici. Per l'uso vero su Facebook, anche sulle Pagine dell'agenzia, l'app deve essere in **Live**.

Meta non documenta un campo della Graph API che dica se l'app è in Sviluppo o in Live: il nodo `Application` non lo ha. Una libreria di terzi nomina `app_ad_debug_info.is_app_in_dev_mode`, che la documentazione di Meta non elenca (non verificato su Meta vera).

## Decisione
L'app Meta di ogni agenzia passa in **Live con accesso standard**. L'**accesso avanzato**, con la verifica dell'azienda e l'App Review, si chiede prima del primo cliente vero (tappa 12, o prima se Matteo lo vuole).

1. **Live con accesso standard** basta per le Pagine e gli Instagram del Business di chi ha un ruolo nell'app (per Feedway: il Business di Matteo). Meta chiede:
   - un'informativa privacy **pubblica** e le istruzioni per chiedere la cancellazione dei dati. Stanno sul sito pubblico (`apps/site`, D-119 decisa (b)), non sull'host pubblico del pannello, che resta com'è (`/m/*`, `/robots.txt`);
   - l'icona 1024×1024, la categoria, l'uso aziendale e il Data Use Checkup.
2. **Accesso avanzato** (verifica dell'azienda e App Review) per le Pagine e gli Instagram dei clienti che non sono nel Business dell'agenzia, secondo la documentazione di Meta (non verificato: il 12/11 la Pagina di un cliente partner si è collegata anche in Sviluppo). I permessi da chiedere sono in D-119; con la copertina vera su Facebook (D-120.9) se ne aggiungono due. Servono un video per permesso e un modo per mostrare a Meta un pannello chiuso in Tailscale.
3. **Feedway non legge la modalità da Meta.** L'Owner la dice in Impostazioni → Integrazioni → Meta, con l'interruttore «L'app è in Live» (`appLive` nella configurazione dell'integrazione, falso finché non lo accende, anche per le integrazioni salvate prima). Finché è spento, il gruppo «App Meta» mostra in ambra «In Sviluppo» e la riga dice che i post su Facebook li vede solo chi ha un ruolo nell'app. L'interruttore si salva come il resto dell'app (riconferma recente, prova con Meta, voce nel registro attività).
4. La guida del passaggio è [`docs/runbooks/meta-app-live.md`](../runbooks/meta-app-live.md).

Sostituisce il punto dell'ADR 015 «L'app Meta resta in modalità sviluppo […] La revisione dell'app serve solo per aprire ad altre agenzie (2.0)». Il resto dell'ADR 015, già in parte modificato dall'ADR 020, non cambia.

## Alternative scartate
- **Restare in Sviluppo e aggiungere come tester chi deve vedere i post:** il pubblico di una Pagina non si aggiunge come tester. Non serve all'uso vero.
- **Leggere la modalità con `app_ad_debug_info.is_app_in_dev_mode`:** il campo non è nella documentazione di Meta e può sparire o cambiare senza preavviso. La guida chiede di provarlo una volta su Meta vera: se risponde, una tappa dopo può leggerlo e lasciare l'interruttore come riserva.
- **Informativa su `/privacy` dell'host pubblico:** cambia la specifica §16.1 e mette pagine nuove su un host che serve solo file per Meta. Matteo ha scelto il sito pubblico (D-119 (b), 23/11).

## Conseguenze
- Prima del Live si tolgono dalla Pagina i post di prova: con il Live diventano pubblici.
- L'avviso dipende dall'Owner: se l'app torna in Sviluppo su Meta e nessuno spegne l'interruttore, Feedway non lo sa. La guida lo dice, e dice cosa controllare dopo il passaggio.
- Dopo il Live va controllato che Instagram resti pubblico e che il token dell'utente di sistema funzioni con gli stessi permessi (non verificato finché Matteo non lo prova).
- Il Data Use Checkup diventa obbligatorio una volta all'anno: la sua scadenza, già nell'integrazione, alimenta il promemoria esistente.
- Cambiano la specifica §3 (glossario), §8.0, §19 e §20, e i controlli della messa in produzione della tappa 12 (accesso avanzato prima del primo cliente vero).
