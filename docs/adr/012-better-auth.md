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
