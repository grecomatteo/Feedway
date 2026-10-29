# ADR 016 · Modulo "Richiedi una demo" sul sito pubblico

| | |
|---|---|
| **Stato** | Proposta: il modulo è deciso da Matteo (2026-10-29), la soluzione tecnica va accettata |
| **Data** | 2026-10-29 |
| **Specifica** | v9, §14.5; [hub per l'agenzia](../superpowers/specs/2026-10-29-feedway-hub-agenzia.md) §10 |
| **Modifica** | ADR 013 in due punti: "nessun modulo che raccolga dati personali nella 1.0" e "non ha server" (la funzione del modulo è l'unica parte server). Il resto di ADR 013 resta valido |

## Contesto
La landing ha come azione principale "Richiedi una demo". Matteo ha deciso che il pulsante apre un modulo: chi è interessato inserisce i suoi dati e a Matteo arriva un'email per parlarne. L'ADR 013 escludeva moduli nella 1.0 e la specifica (§14.5) li rimandava alla 2.0. Il sito resta statico, senza database e senza cookie.

## Decisione
- **Campi:** nome, nome dell'agenzia, email (obbligatori); telefono, numero di clienti gestiti e messaggio (facoltativi). Sotto il pulsante, il collegamento all'informativa: i dati servono solo a rispondere alla richiesta.
- **Invio:** una sola funzione server di Cloudflare Pages (`/api/richiesta-demo`) dentro `apps/site`. Controlla i campi e manda un'email all'indirizzo di Matteo con Cloudflare Email Routing (invio verso un indirizzo verificato), con l'email di chi scrive come "Rispondi a". L'indirizzo di destinazione sta nei segreti di Cloudflare, mai nel repository.
- **Nessun salvataggio:** il sito non conserva le richieste. Restano solo nella casella di Matteo.
- **Anti-spam senza cookie:** un campo nascosto che le persone non compilano, un tempo minimo di compilazione e un limite di invii per indirizzo IP con le regole di Cloudflare. Le protezioni anti-bot che mettono cookie restano spente (ADR 013).
- **Dopo l'invio:** la pagina conferma "Richiesta inviata, ti scriviamo noi". Nessuna email automatica a chi ha scritto, così il modulo non si può usare per mandare email a terzi.
- **Senza JavaScript** il modulo funziona lo stesso (invio normale con pagina di conferma).

## Alternative scartate
- **Solo un indirizzo email (`mailto:`)**: è la soluzione dell'ADR 013, ma Matteo vuole un modulo con dati ordinati.
- **Servizi esterni di moduli** (Formspree, Tally e simili): un fornitore in più che riceve dati personali, spesso con cookie o script di terzi.
- **Invio dal pannello sulla VPS**: renderebbe pubblica un'API del pannello, contro ADR 005 e ADR 013.
- **Servizi di invio email a pagamento** (Resend e simili): validi se Email Routing non basta; si valutano solo in quel caso.

## Conseguenze
- `apps/site` non è più solo statico: ha una funzione server, sempre senza accesso a dati, API o database del pannello. dependency-cruiser continua a vietare ogni import oltre `packages/ui` e `packages/config`.
- Servono su Cloudflare: Email Routing attivo sul dominio, l'indirizzo di Matteo verificato, il segreto con l'indirizzo. Li configura Matteo.
- L'informativa privacy del sito va aggiornata prima del lancio (dati raccolti, finalità, conservazione nella casella email).
- Test: validazione dei campi, campo nascosto, risposta senza JavaScript; l'invio reale è "non verificato" finché non si prova sul dominio vero.
- **Da verificare:** se l'invio con Email Routing (`send_email`) è disponibile direttamente nelle funzioni di Pages o solo nei Worker. Nel secondo caso la funzione di Pages chiama un piccolo Worker dedicato con un service binding. Vanno verificati anche il piano gratuito e i limiti.
- Quando questa ADR è accettata, ADR 013 passa a "In parte modificata da ADR 016" e il piano della tappa 10 aggiunge modulo, segreti Cloudflare e test.
