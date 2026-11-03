# ADR 015 · Collegamenti account multipli (login Facebook, login Instagram, utente di sistema)

| | |
|---|---|
| **Stato** | Accettata (Matteo, 2026-10-16) |
| **Data** | 2026-10-16 |
| **Specifica** | v9, §8 |

## Contesto
La specifica prevedeva un solo modo per collegare Meta: app, utente di sistema e token incollato, con Pagina Facebook sempre presente. L'agenzia gestisce profili molto diversi: Pagina Facebook con Instagram collegato, profili solo Instagram senza Pagina né app Facebook, e in futuro altre piattaforme (per esempio TikTok). Per l'uso interno, con l'app Meta in modalità sviluppo, il login con un clic è più semplice dell'utente di sistema.

## Decisione
- Ogni account social ha un **collegamento** (`account_connections`) con un **tipo**:
  - `facebook_login`: login con Facebook; copre Pagine e l'Instagram che Meta gli collega.
  - `instagram_login`: login con Instagram; copre profili professionali senza Pagina (permessi `instagram_business_basic` e `instagram_business_content_publish`).
  - `meta_system_user`: utente di sistema con token incollato (modo originale, resta supportato).
- Ogni tipo ha login, rinnovo del token e controllo di salute propri; tutto il resto (spazi, post, destinazioni, calendario, verifica) è uguale per tutti.
- Il pannello ha un solo elenco «Account collegati». Altre piattaforme si aggiungono come nuovo tipo di collegamento, senza toccare il resto; nella 1.0 si costruiscono solo i tipi Meta.
- L'app Meta resta in modalità sviluppo: possono accedere solo le persone con un ruolo nell'app (amministratore, sviluppatore, tester; per Instagram, tester Instagram). La revisione dell'app serve solo per aprire ad altre agenzie (2.0).

## Alternative scartate
- **Solo utente di sistema**: non copre i profili solo Instagram e richiede Business Manager per ogni account.
- **Solo login Facebook**: esclude i profili Instagram senza Pagina.

## Conseguenze
- I token legati a una persona scadono (circa 60 giorni) e vanno rinnovati: la salute dell'account li controlla e avvisa prima della scadenza.
- Cambiano §2.2, §3, §8.1–8.4, §18.2 e lo schema `social_accounts`; il piano della tappa 3 si adegua.
- Da verificare con gli account di prova in tappa 3: comportamento reale di login Facebook e Instagram in modalità sviluppo, rinnovo dei token, inviti dei tester Instagram. Finché non provato su Meta vera, resta «non verificato».
- Segreti sempre cifrati come da [ADR 007](007-segreti-cifrati-nel-database.md).
