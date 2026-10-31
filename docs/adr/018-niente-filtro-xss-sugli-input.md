# ADR 018 · Niente filtro anti-XSS sugli input

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-30) |
| **Data** | 2026-10-30 |
| **Specifica** | v9, §15 (sicurezza del pannello); piano della tappa 2, nota di esecuzione del Task 19 |

## Contesto
`nuxt-security` attiva per impostazione predefinita un validatore XSS su GET e POST: se un campo contiene testo simile all'HTML risponde 400, prima ancora della validazione della rotta. Nella revisione del Task 19 si era visto che rifiuta input validi:

- il mittente dell'email di sistema scritto come `Feedway <noreply@esempio.it>`;
- una password con `<` e `>`;
- in futuro, didascalie dei post e note che contengono questi caratteri.

Il filtro non protegge da un XSS vero: lavora su un elenco di schemi, si aggira con codifiche diverse, e non guarda PATCH, PUT o i dati che arrivano da altre fonti (Meta, import).

## Decisione
**Il validatore XSS di `nuxt-security` è spento** (`security.xssValidator: false` in `apps/web/nuxt.config.ts`). I dati si salvano come arrivano, dopo la validazione con Zod del contratto. La difesa contro l'XSS sta in uscita:

- Vue mette sempre il testo come testo; nel pannello non si usa `v-html` (oggi non compare da nessuna parte) salvo un'ADR che lo giustifichi;
- le rotte `/api` rispondono JSON con `X-Content-Type-Options: nosniff`, `cache-control: no-store` e CSP `default-src 'none'`;
- le pagine hanno una CSP con `nonce` e `strict-dynamic`, senza script in linea;
- le email si compongono con i modelli, che codificano i valori; il mittente passa a `nodemailer` come oggetto `{ name, address }`.

Il limite sulla dimensione dei corpi resta in `server/middleware/03.request-body.ts`.

## Alternative scartate
- **Spegnerlo solo su alcune rotte**: ogni nuovo campo di testo libero (password, didascalie, note) richiederebbe un'eccezione, e una dimenticata diventa un errore che l'utente non capisce.
- **Lasciarlo acceso**: la pagina «Email di sistema» non accetterebbe il mittente nella forma usuale e alcune password valide sarebbero rifiutate.

## Conseguenze
- Un test (`tests/api/http-layer.int.test.ts`) controlla che un testo come `<script>…</script>` arrivi alla rotta e riceva la sua risposta normale, non un 400.
- Chi aggiunge una superficie che mostra HTML (anteprime, email in HTML con testo dell'utente) deve codificare i valori e spiegarlo nella PR.
