# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica. Usa **GitHub → Security → Report a vulnerability** (segnalazione privata) di questo repository.

Indica: cosa hai trovato, come riprodurlo, quale versione, l'impatto che immagini. Ricevi una prima risposta entro 3 giorni lavorativi.

## Versioni supportate

Solo l'ultima versione rilasciata riceve correzioni di sicurezza.

## Come gestiamo una segnalazione

1. Conferma e valutazione della gravità (CVSS).
2. Correzione in un ramo privato (GitHub Security Advisory), con un test che riproduce il problema.
3. Rilascio di una patch e avviso nella release.
4. Se sono coinvolti dati personali: procedura in `docs/runbooks/violazione-dati.md` (notifica al Garante entro 72 ore quando dovuta).

## Cosa facciamo per prevenire

- Dipendenze aggiornate con Renovate, `pnpm audit` e analisi dell'immagine con Trivy in CI.
- Ricerca di segreti con gitleaks in CI; CodeQL e la protezione dai push si attivano se il repository diventa pubblico o ha GitHub Advanced Security.
- Segreti cifrati nel database, mai nei log, mai al browser.
- Isolamento tra agenzie con doppia barriera (applicazione + Row Level Security), con test dedicati.

## Eccezioni note ai container

I contenitori di Feedway (web, worker, migrazione) girano senza privilegi: utente `10001`, filesystem in sola lettura, nessuna capability. Due immagini di terzi fanno eccezione, per scelta:

- **Postgres** parte come root solo per preparare la cartella dei dati e poi passa all'utente `postgres`. Non ha `read_only` né `cap_drop` perché l'immagine ufficiale ha bisogno di scrivere e di cambiare utente all'avvio. Resta chiuso: nessuna porta sull'host, solo nella rete interna, `no-new-privileges`.
- **Tailscale** (contenitore laterale) gira come root dentro il contenitore per gestire il proprio stato. Usa la modalità senza interfaccia di rete (`TS_USERSPACE`), quindi non servono `NET_ADMIN` né dispositivi dell'host. Ha `no-new-privileges`, un volume solo per lo stato e nessuna porta pubblicata.

Se in futuro si vuole stringere ancora, va provato su una VPS prima di cambiare i file di Compose.
