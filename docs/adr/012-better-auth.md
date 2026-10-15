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
