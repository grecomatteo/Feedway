# ADR 013 · Sito pubblico statico separato dal pannello

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15). Modifica in corso: ADR 016 (proposta) toglie i punti "nessun modulo" e "non ha server" per il modulo "Richiedi una demo" |
| **Data** | 2026-10-15 |
| **Specifica** | v9, §14.5 |

## Contesto
Matteo vuole una landing che presenti Feedway e porti all'accesso alla parte privata. Il pannello deve restare privato (ADR 005), la VPS ha risorse limitate (2 core) e il sito deve essere veloce e trovato dai motori di ricerca.

## Decisione
- Il sito è un'app a sé, `apps/site`: **Nuxt 4 in generazione statica** (`nuxt generate`) con i token di colore di `packages/ui` e il nome da `PRODUCT_NAME`; logo e immagini sono file nel repository. Non ha server, database, login né dati delle agenzie.
- È ospitato su **Cloudflare Pages** sul dominio principale (`tuodominio.it`); il pannello sta su `app.tuodominio.it`, l'host pubblico su `pub.tuodominio.it`.
- Il pulsante "Accedi" porta alla pagina di accesso del pannello. Il modulo di accesso non sta mai nel sito.
- `apps/site` importa solo `packages/ui` e `PRODUCT_NAME` da `packages/config`, verificato da dependency-cruiser.
- Nessun cookie e nessun modulo che raccolga dati personali nella 1.0.

## Alternative scartate
- **Landing dentro il pannello** (stesso Nuxt, stesso host): renderebbe pubblico l'host del pannello e le sue API, e legherebbe il sito ai rilasci e ai guasti della VPS.
- **Servita dal container web su un terzo host**: un host pubblico in più da proteggere sulla VPS, e sito offline durante aggiornamenti e guasti.
- **Astro o un altro generatore statico**: valido, ma un secondo framework da imparare e aggiornare; Nuxt in generazione statica basta.
- **CMS** (WordPress o servizi esterni): un servizio in più da proteggere e pagare per pochi testi.

## Conseguenze
- Serve il dominio su Cloudflare e un token API di Cloudflare nei segreti del repository GitHub, inserito da Matteo.
- Controllo obbligatorio `site` nella CI (build, axe, collegamenti) a ogni PR; workflow `site-deploy.yml` per anteprime e pubblicazione, solo quando cambiano `apps/site` o `packages/ui`.
- Tema solo automatico e protezioni anti-bot di Cloudflare spente sull'host del sito, così il sito non mette cookie.
- I cookie del pannello sono legati al solo host del pannello, con prefisso `__Host-` se Better Auth lo consente (§15.2): il sito sul dominio principale non li riceve né li sovrascrive.
- Senza Cloudflare, la stessa build si può servire da qualsiasi hosting statico senza cambiare codice.
