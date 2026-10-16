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
