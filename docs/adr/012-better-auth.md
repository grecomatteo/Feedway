# ADR 012 · Accesso e account con Better Auth

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15) |
| **Data** | 2026-10-15 |
| **Specifica** | v9, §15.1 |

## Contesto
Servono registrazione da invito, login con password e passkey, 2FA, sessioni revocabili, reset, cambio email, limitazione dei tentativi; in futuro accesso con Google. Il progetto ha già un proprio modello di organizzazioni, ruoli per spazio e RLS.

## Decisione
**Better Auth** per l'autenticazione (account, sessioni, 2FA, passkey, reset, cambio email, limitazione dei tentativi), dentro il pannello, sul nostro Postgres con l'adattatore Drizzle. Organizzazioni, ruoli, spazi, inviti, RLS e registro restano nostri. Plugin attivi solo `twoFactor` e `@better-auth/passkey`; non usati `organization`, `admin`, `oidcProvider`, `mcp`. Dettagli in `docs/superpowers/specs/2026-10-15-account-personale-proposta.md` §2.

## Alternative scartate
- **Login scritto nel progetto su librerie standard**: più codice da scrivere e mantenere.
- **Clerk o WorkOS**: dati del team negli Stati Uniti, dipendenza da un servizio esterno per entrare nel pannello, costi per 2FA e passkey (Clerk).

## Conseguenze
- Meno codice di autenticazione; "Accedi con Google" diventa un'impostazione.
- Libreria giovane con diversi avvisi di sicurezza nel 2026: versione fissata, aggiornamenti di sicurezza immediati, test dei flussi di accesso obbligatori a ogni aggiornamento.
- Quattro punti da verificare con un test all'inizio della tappa 2 (proposta §2.4).

## Verifiche preliminari (2026-10-18, Better Auth 1.7.10)
Prove a mano su Postgres 16 prima dei test di contratto del Task 1 della tappa 2, che le riprodurranno in CI. Gli altri punti (V2 lato server completo, V6–V9, passkey su `*.localhost`) restano da provare nel Task 1.

| Punto | Esito osservato | Decisione |
|---|---|---|
| V1 segreto TOTP e codici di recupero | Non sono in chiaro (cifrati con la chiave di Better Auth) | Si usa la cifratura della libreria; resta da provare la rotazione con `BETTER_AUTH_SECRETS` |
| V3 tentativi falliti | Il gancio `after` vede percorso, email tentata ed esito (`APIError`) | Il registro dei fallimenti sta nel gancio `after` |
| V4 token di sessione | Salvato **in chiaro** nella tabella `sessions` (il cookie porta lo stesso token firmato) | Si accetta come scelta della libreria; si aggiorna §20 della specifica: rete interna, backup cifrati, tabella letta solo dal modulo identity |
| V5 cookie `__Host-` | Con `useSecureCookies: true` il nome diventa `__Secure-__Host-session` (perde la garanzia `__Host-`). Con `useSecureCookies: false`, attributo `secure: true` esplicito e nome `__Host-session` il cookie esce con il nome esatto, `Secure`, `HttpOnly`, `Path=/`, senza `Domain`, e viene riletto | Si usa questa seconda configurazione per tutti i cookie di Better Auth (sessione, 2FA, passkey) |
| V10 gancio `before` sulle chiamate lato server | Gira, ma con `ctx.request` assente | I controlli sui percorsi valgono solo se `ctx.request` è presente, come previsto dal piano |

## Verifiche della tappa 2 (Better Auth 1.7.10, 2026-10-18)
Fissate da `packages/infrastructure/src/auth/contract/better-auth-contract.int.test.ts` e da `apps/web/tests/e2e/passkey-localhost.spec.ts` (`pnpm test:auth-contract`). Un aggiornamento della libreria che cambia uno di questi comportamenti fa fallire la CI.

| Punto | Esito | Decisione per i Task successivi |
|---|---|---|
| V1 2FA a riposo | Segreto e codici di recupero cifrati dalla libreria. Dopo una rotazione (`secrets: [v2, v1]`) un utente con 2FA attiva completa ancora l'accesso | Si usa la cifratura di Better Auth (chiave `BETTER_AUTH_SECRET`, rotazione con `BETTER_AUTH_SECRETS`); nessun involucro nostro |
| V2 creazione lato server | Con `disableSignUp: true` anche `auth.api.signUpEmail` è rifiutato ("sign up is not enabled"). `internalAdapter.createUser(utente, { method: 'admin' })` accetta il nostro `id`; `linkAccount` con `providerId: 'credential'` e password della libreria permette poi `signInEmail`. In 1.7 `createUser` vuole il secondo argomento (origine) | L'attivazione da invito (Task 12) usa `internalAdapter.createUser` + `linkAccount`, mai `signUpEmail` |
| V3 tentativi falliti | Il gancio `after` vede percorso, email tentata ed esito (`APIError`) per `/sign-in/email` e `/two-factor/verify-totp` | Il registro dei fallimenti sta nel gancio `after` (Task 11) |
| V4 token di sessione | In chiaro in `sessions.token` | Accettato; §20 della specifica aggiornato |
| V5 cookie `__Host-` | Con `useSecureCookies: false`, `defaultCookieAttributes.secure: true` e nome esplicito il cookie esce `__Host-session; Path=/; Secure; HttpOnly; SameSite=Lax` senza `Domain` e viene riletto. Con `useSecureCookies: true` diventa `__Secure-__Host-session`. Anche i cookie di sfida si rinominano da `advanced.cookies`: `two_factor` e `better-auth-passkey`; senza nome esplicito restano `better-auth.*` | `cookie-names.ts` nomina tutti e tre: `__Host-session`, `__Host-two-factor`, `__Host-passkey-challenge` |
| Passkey su `*.localhost` | Registrazione e accesso riescono in Chromium con autenticatore virtuale su `http://app.feedway.localhost:<porta>` con `rpID` `app.feedway.localhost`; il cookie `Secure` viene accettato su http | Sviluppo ed E2E restano su `app.feedway.localhost` (§17.1), senza certificato autofirmato |
| V6 ID e reimpostazione | `advanced.database.generateId` produce UUID v7 per utenti e sessioni, tabelle al plurale con `usePlural`. `sendResetPassword` riceve l'URL nella stessa catena asincrona; con `revokeSessionsOnPasswordReset: true` le sessioni dell'utente si chiudono | Il link da copiare per Owner e Admin (Task 15) si cattura con `AsyncLocalStorage` nel callback; `revokeSessionsOnPasswordReset: true` nella configurazione |
| V7 riconferma con TOTP | `verify-totp` con la sessione in uso **sostituisce** la sessione (nuovo id, la vecchia sparisce): non è una verifica neutra | La riconferma (Task 13) accetta password e passkey, non il codice TOTP |
| V8 sessione aperta da noi | `internalAdapter.createSession(userId, false, { authMethod }, true)` + `setSessionCookie(ctx, …)` dentro un endpoint di un nostro plugin produce lo stesso nome e gli stessi attributi di un accesso vero, con firma accettata da `getSession`; una firma alterata è rifiutata. Il quarto argomento (`overrideAll: true`) è indispensabile, altrimenti il valore di default del campo vince sull'override | `Auth.openSession` (Task 9) chiama un endpoint interno di un plugin nostro; nessuna firma scritta a mano |
| V9 `verify-totp` in attivazione | Crea una **nuova** sessione e cancella la precedente; la nuova ha `auth_method` predefinito (`password`) | `databaseHooks.session.create.before` assegna il metodo dal percorso (`/two-factor/verify-totp` → `password_totp`, `/two-factor/verify-backup-code` → `password_backup_code`, passkey → `passkey`, `/sign-in/email` → `password`) |
| V10 gancio `before` | Gira anche sulle chiamate `auth.api.*`, con `ctx.request` assente; sulla chiamata HTTP è presente | L'elenco dei percorsi consentiti vale solo con `ctx.request` presente; le chiamate lato server partono dai nostri casi d'uso |
| Codice TOTP riusato | Lo stesso codice è accettato due volte nella sua finestra di validità, in due accessi diversi: la libreria non ricorda i codici già usati. Fissato da `packages/infrastructure/src/auth/second-factor.int.test.ts` (Task 14) | Accettato: il codice dura pochi secondi, serve anche la password, e i tentativi sono limitati (10 al minuto per IP sui percorsi `two-factor/*`, blocco dell'account dopo 10 codici sbagliati). Se una versione della libreria lo rifiuta, il test fallisce e la riga si aggiorna |

Moduli nativi: `@node-rs/argon2` arriva con il pacchetto di piattaforma, senza script di installazione (il Dockerfile usa `--ignore-scripts`); il job `image` della CI carica `@node-rs/argon2` dentro le immagini amd64 e arm64 (sotto QEMU) e calcola un hash.
