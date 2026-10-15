# ADR 004 · Autorizzazione nell'applicazione più Row Level Security

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-15) |
| **Data** | 2026-10-15 |
| **Specifica** | v9 |

## Contesto
Più agenzie nello stesso database. Un filtro dimenticato in una query non deve mai esporre dati di un'altra agenzia.

## Decisione
Doppia barriera. **Applicazione**: un'unica funzione `can()` testata su ogni combinazione, repository sempre filtrati. **Database**: RLS su ogni tabella con `organization_id`, policy `org_isolation` sull'organizzazione impostata nella transazione; `app_runtime` senza `BYPASSRLS`. L'ambito di sistema si apre solo con `runAsSystem`, consentito per regola di lint in pochi moduli.

## Alternative scartate
- **Solo applicazione**: un errore in una query diventa una fuga di dati.
- **Solo RLS**: i permessi per ruolo e spazio sono troppo ricchi per stare comodamente in policy SQL.

## Conseguenze
- Ogni tabella nuova deve avere `organization_id`, RLS e i permessi per `app_runtime` (ricetta in `docs/moduli.md`).
- Batteria di test di isolamento su ogni rotta e lavoro.
- Piccolo costo sulle query, misurato nella prova di carico.
