# Feedway dagli agenti: server MCP, OAuth e API

Studio e proposta del 25 novembre 2026, su richiesta di Matteo: «parlare con Feedway da una chat (Claude, ChatGPT o un altro agente), mettere la foto e la caption, dire quando esce, e il post si programma da solo; incollare il calendario di un cliente e farlo diventare il suo piano editoriale».

Stato: **proposta, da approvare da Matteo**. Le scelte aperte sono in [decisioni aperte](../../decisioni-aperte.md), voce D-132. Nessuna riga di codice è stata scritta. Sostituisce, quando approvata, la predisposizione di §18.3 della [specifica](2026-10-15-feedway-design.md).

Ciò che viene da documentazione di terzi è scritto con la fonte; ciò che non è stato provato su Claude o ChatGPT veri è segnato **non verificato** e va provato nel primo task (§12, F0).

---

## 1. In breve

- **Si può fare, e bene.** La strada giusta è un **server MCP remoto** di Feedway, con accesso **OAuth 2.1** dal proprio account Feedway, costruito **sugli stessi casi d'uso** del pannello. Funziona con Claude (web, desktop, telefono, Claude Code), con ChatGPT e con ogni agente che parla MCP. Le stesse regole servono anche un'**API REST con token personali** per script e automazioni (n8n, Make), che costa poco in più perché l'API `/api/v1` esiste già.
- **Un plugin no**: lega Feedway a una sola app. MCP è lo standard che usano tutte; in ChatGPT un'«app» o un «plugin» è proprio un server MCP impacchettato.
- **La foto dalla chat** è il punto più delicato. ChatGPT passa i file allegati a uno strumento (`openai/fileParams`). Claude oggi, per quanto documentato, **non** passa un allegato della chat a un connettore remoto: per Claude servono un **link di caricamento** (si apre, si sceglie la foto dal telefono, fatto), l'importazione **da un indirizzo** (Drive, Dropbox, un'immagine generata) e la scelta **dalla libreria**. Con Claude Code o Claude Desktop con i file locali, l'agente carica direttamente dal disco.
- **Sicurezza:** ogni collegamento è legato a una persona e a un'agenzia, con i suoi permessi e ruoli di sempre; ambiti (`lettura`, `bozze`, `programmazione`, `pubblicazione`) scelti alla conferma; si revoca dal pannello in un clic; tutto finisce nel registro attività con l'origine `mcp` e il nome dell'agente. **Pubblicare subito** è spento finché non si accende apposta. Ogni importazione in blocco passa da un'**anteprima** che la chat mostra prima della conferma.
- **Dove metterlo:** propongo una tappa sua, **«Agenti»**, tra la 10 e la 11, così la revisione di sicurezza e la prova di carico della tappa 11 coprono anche il server MCP prima della messa in produzione. Richiede che la programmazione in blocco (tappa 9, Task 10–11) sia finita.
- **Costi:** nessun costo fisso nuovo per Feedway (stesso server, stesso database; un tunnel gratuito). Per usarlo serve un piano di Claude o ChatGPT che ammetta i connettori personalizzati. Lavoro stimato: **13 task in circa 10 thread**.

---

## 2. Cosa si vuole fare: i casi d'uso

| # | Detto in chat | Cosa fa Feedway |
|---|---|---|
| U1 | «Questa foto per Forno Luce, caption così, giovedì alle 18 su Instagram e Facebook» | Carica la foto nella libreria del cliente, crea il post con le caption per piattaforma, lo controlla con le regole, mostra l'anteprima e, alla conferma, lo programma |
| U2 | «Ecco il calendario di dicembre di Forno Luce» (testo incollato, PDF, Excel, foto di un foglio) | L'agente legge il calendario, Feedway riceve le righe, le normalizza e mostra un'**anteprima** (date, orari, tipo, note, conflitti con le fasce e con ciò che c'è già); alla conferma diventano voci del **piano editoriale** |
| U3 | «Prepara i post di dicembre con queste 12 foto, sulle fasce libere» | Programmazione **in blocco**: abbina file e righe, distribuisce sulle fasce libere, anteprima, conferma, riepilogo con «Annulla» |
| U4 | «Cosa esce domani?» «Cosa è da sistemare?» «Com'è andato il reel di ieri?» | Letture: calendario, «Oggi», «Da sistemare», esiti della pubblicazione |
| U5 | «Sposta il post di venerdì a lunedì alle 12» «Annulla quello di sabato» | Sposta, riporta in bozza, annulla, con il controllo della versione |
| U6 | «Scrivimi tre caption nel tono di Forno Luce» | L'agente legge la scheda del cliente, i modelli di caption e gli ultimi post; scrive lui (l'AI è della chat, non di Feedway) |
| U7 | «Trasforma le voci del piano della prossima settimana in bozze» | «Prepara» del piano editoriale, voce per voce o in gruppo |
| U8 | Script o automazione («ogni lunedì carica i file della cartella Drive X») | Stessi casi d'uso dall'API REST con un token personale |

Il valore vero è U1 e U2: il lavoro di scrittura si fa già in chat; oggi bisogna poi ricopiarlo a mano nel pannello.

---

## 3. MCP, API o plugin: il confronto

| | **Server MCP remoto** | **API REST pubblica** | **Plugin / app di una piattaforma** | **Action di un GPT (OpenAPI)** |
|---|---|---|---|---|
| Da dove si usa | Claude (web, desktop, telefono, Code), ChatGPT, Cursor, agenti con SDK MCP | Script, n8n, Make, Zapier, Claude Code con `curl` | Una sola app | Solo un GPT personalizzato di ChatGPT |
| Accesso | OAuth 2.1 standard, la chat lo gestisce da sola | Token personale | Quello della piattaforma | OAuth o chiave, per GPT |
| L'agente capisce cosa fare | Sì: strumenti descritti per un modello, con annotazioni (sola lettura, distruttivo) | Solo se gli si spiega l'API | Sì | In parte |
| File dalla chat | ChatGPT sì (`openai/fileParams`); Claude con link di caricamento | Caricamento a pezzi che esiste | Dipende | Limitato |
| Anteprime grafiche in chat | Sì, con MCP Apps (estensione) | No | Sì | No |
| Lavoro | Medio: un'app sottile sui casi d'uso esistenti | Piccolo: c'è già, manca l'accesso con token | Uno per piattaforma | Piccolo ma vale per una sola app |

**Scelta proposta:** MCP remoto come strada principale, più l'API REST con token personali (ADR 006 l'aveva già prevista), sugli stessi casi d'uso e con le stesse regole. Nessun plugin dedicato: in ChatGPT il server MCP si pubblica come app; in Claude come connettore.

---

## 4. Lo stato dell'arte, verificato il 25/11/2026

### 4.1 Il protocollo

- **Versione corrente: 2026-07-28** (uscita il 28 luglio 2026; le precedenti sono 2025-11-25 e 2025-06-18). Fonti: [WorkOS](https://workos.com/blog/mcp-2026-spec-agent-authentication), [Scalekit](https://www.scalekit.com/blog/mcp-authorization-guide), [DEV](https://dev.to/instatunnel/mcp-auth-gets-real-what-the-2026-07-28-spec-means-for-local-mcp-servers-behind-a-tunnel-2dg1). Le ho lette da fonti secondarie concordi; il testo ufficiale va riletto nel task F0.
- **Trasporto:** Streamable HTTP. Con la 2026-07-28 spariscono la stretta di mano `initialize` e l'`Mcp-Session-Id`: ogni richiesta porta versione e capacità in `_meta`, quindi **il server è senza stato** e qualsiasi processo può rispondere. Si adatta bene alla regola di Feedway «nessuno stato nella memoria dei processi» (piano generale §4).
- **Accesso:** il server MCP è una *risorsa protetta* OAuth 2.1. Deve pubblicare `/.well-known/oauth-protected-resource` (RFC 9728) e rispondere 401 con `WWW-Authenticate`; il client manda `resource` (RFC 8707) e usa PKCE S256; il controllo `iss` (RFC 9207) è obbligatorio. La registrazione del client preferita è **CIMD** (il `client_id` è un indirizzo https con i dati del client); la registrazione dinamica (DCR, RFC 7591) è deprecata ma resta almeno fino a luglio 2027. Ambiti in più si chiedono con 403 `insufficient_scope` (*step-up*). Vietato passare il token ricevuto ad altri servizi.
- **Strumenti:** schema d'ingresso JSON Schema 2020-12, risultato strutturato (`outputSchema`, `structuredContent`), annotazioni `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, e un `title` leggibile.
- **Estensioni:** *MCP Apps* (interfacce HTML nella chat, risorse `ui://`), *Tasks* per i lavori lunghi. Non fanno parte del nucleo: si usano solo dove il client le supporta.
- **Elicitation** (il server chiede una conferma o un dato all'utente durante la chiamata): esiste nella specifica, ma il supporto nei client è **non verificato**. Il disegno qui sotto non ne dipende.

### 4.2 Claude

- Si aggiunge da *Impostazioni → Connettori → Aggiungi connettore personalizzato* con l'indirizzo del server; vale su web, desktop e telefono. Callback OAuth `https://claude.ai/api/mcp/auth_callback`; Claude Code usa `localhost`. Fonte: [sunpeak](https://sunpeak.ai/blogs/claude-connectors-tutorial/), [guida di Claude](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities), [MCP](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-remote-servers).
- Si possono accendere e spegnere i singoli strumenti per connettore.
- Limiti riportati: circa 150.000 caratteri per risultato e 240 s per chiamata (da verificare).
- **Allegati della chat verso un connettore remoto: nessuna via documentata** ([sunpeak](https://sunpeak.ai/blogs/file-uploads-mcp-apps/)). Quindi per Claude: link di caricamento, indirizzo, libreria. **Non verificato** se Claude possa passare un'immagine in base64 a uno strumento: anche se lo facesse, un modello che riscrive megabyte in base64 è lento e fragile, quindi non lo usiamo.
- Gli indirizzi da cui chiamano i server di Anthropic sono pubblicati (riportato `160.79.104.0/21`, da verificare): utili per un filtro in più davanti al server.

### 4.3 ChatGPT

- Un server MCP diventa un'**app** (dentro un *plugin*, l'unità che si installa e si pubblica). Si prova con la *modalità sviluppatore* e si può pubblicare nella directory. Piani che lo permettono: **non verificato**. Fonte: [OpenAI, riferimento](https://developers.openai.com/plugins/reference).
- **File dalla chat: sì.** Lo strumento dichiara in `_meta["openai/fileParams"]` quali campi sono file; ChatGPT passa per ognuno `{ download_url, file_id, mime_type, file_name }`. L'indirizzo è temporaneo: il server lo scarica subito, senza scriverlo nei log. Fonti: [OpenAI](https://developers.openai.com/plugins/reference), [PR di un progetto che lo usa](https://github.com/pinbridge/pinbridge-mcp/pull/19). Durata dell'indirizzo e peso massimo: **non verificati**.
- Uno strumento con `destructiveHint` fa chiedere la conferma all'utente prima della chiamata.
- OAuth come sopra; ChatGPT vuole PKCE S256 e manda `resource`.

### 4.4 Altri

Cursor, VS Code, Le Chat di Mistral, Gemini CLI e gli SDK di agenti (Claude Agent SDK, OpenAI Agents SDK) parlano MCP remoto con OAuth. Un server fatto bene per Claude e ChatGPT funziona anche con loro.

---

## 5. Architettura in Feedway

### 5.1 Il quadro

```
 Claude / ChatGPT / agente                     Persona nel browser
          │  MCP (Streamable HTTP, Bearer)            │  accesso e conferma
          ▼                                           ▼
 ┌───────────────────────┐   token opachi   ┌───────────────────────────┐
 │ apps/mcp              │ ───────────────▶ │ apps/web                  │
 │ server MCP senza stato│   (stesso DB)    │ server di autorizzazione  │
 │ registro strumenti    │                  │ OAuth 2.1 (Better Auth)   │
 │ limiti, idempotenza   │                  │ pagina «Collega un agente»│
 └──────────┬────────────┘                  │ Impostazioni → Agenti     │
            │ stessi casi d'uso             │ /carica/<link> (upload)   │
            ▼                               └────────────┬──────────────┘
   packages/application (posts, media, plan, calendar, …) │
            ▼                                             │
   PostgreSQL con RLS  ◀─────────────────────────────────┘
```

- **`apps/mcp`** (come già previsto in §7 della specifica): un processo Node a sé, nella stessa immagine Docker, un servizio in più nel Compose. Non ha cookie, CSRF né pagine: solo `POST /mcp` con token, i metadati RFC 9728 e il controllo di salute. Separarlo dal pannello tiene piccola la superficie esposta a Internet. Usa l'SDK ufficiale TypeScript di MCP (dipendenza nuova: ADR 024).
- **Il server di autorizzazione sta in `apps/web`**, perché l'accesso (password, passkey, 2FA) e la pagina di conferma sono del pannello. Proposta: i plugin **OAuth 2.1 Provider** e **CIMD** di Better Auth ([documentazione](https://www.better-auth.com/docs/plugins/oauth-provider), [CIMD](https://better-auth.com/docs/plugins/cimd)), già sulla nostra libreria e sul nostro database. L'ADR 012 oggi li vieta (vietava `oidcProvider` e `mcp`): va aggiornata con un'ADR nuova dopo la prova del task F0 (supporto di `resource`, rotazione dei refresh token, `iss`, legame con l'agenzia). Alternativa se la prova non va: `oidc-provider` di panva (certificato OpenID, molto maturo) dentro `apps/web`. Scrivere un server di autorizzazione da zero è sconsigliato. D-132 punto 2.
- **Token opachi**, non JWT: stringhe casuali di 256 bit con prefisso (`fwa_` accesso, `fwr_` rinnovo), salvate come hash. `apps/mcp` li cerca nel database a ogni richiesta: revoca immediata, nessuna chiave da ruotare, nessuna cache in memoria. Accesso 1 ora; rinnovo 30 giorni, ruotato a ogni uso, con il riuso di un token vecchio che revoca tutta la famiglia.
- **Un collegamento = una persona + un'agenzia.** Alla conferma la persona sceglie l'agenzia (se ne ha più d'una) e gli ambiti. A ogni chiamata l'attore si ricostruisce come nel pannello (`requireOrgActor`): se la persona viene disattivata, tolta dall'agenzia o cambia ruolo, vale subito.

### 5.2 Gli strumenti stanno nei moduli

Come dicono già [moduli.md](../../moduli.md) §3 punto 9 e la specifica §7.3, ogni modulo registra i suoi strumenti nel suo `module.ts`:

```ts
// packages/application/src/mcp-tool.ts (nessuna dipendenza dall'SDK MCP)
export interface McpTool<I extends z.ZodType, O extends z.ZodType> {
  name: string                 // 'schedule_post'
  title: string                // chiave di traduzione: «Programma un post»
  description: string          // per il modello, con esempi
  scope: AgentScope            // 'read' | 'drafts' | 'schedule' | 'publish'
  annotations: { readOnly: boolean; destructive: boolean; idempotent: boolean }
  input: I                     // Zod 4 → JSON Schema 2020-12 con z.toJSONSchema
  output: O
  fileParams?: string[]        // campi file per ChatGPT
  run(ctx: McpToolContext, input: z.output<I>): Promise<z.input<O>>
}
```

- `run` chiama **lo stesso caso d'uso** della rotta del pannello, che fa `can()` e `uow.run({ organizationId, userId })`. Nessuna regola nuova nei casi d'uso, nessuna logica negli strumenti oltre a tradurre. Il permesso lo controlla il caso d'uso; l'ambito lo controlla `apps/mcp` prima.
- `modules.test.ts` si allarga: ogni strumento ha un nome unico, un ambito, le annotazioni coerenti (uno strumento di sola lettura non ha ambito di scrittura), un titolo tradotto, uno schema senza campi liberi (`strictObject`).
- Un modulo spento per l'agenzia (`organizations.settings.modules`) non elenca i suoi strumenti per quell'agenzia.
- **L'origine nel registro.** Oggi i casi d'uso scrivono `source: 'panel'` a mano (44 punti). Serve un passo di preparazione: l'origine viaggia con la richiesta (`RequestContext.source: 'panel' | 'api' | 'mcp'`) e il registro scrive anche il collegamento e il nome del client in `data` (`{ via: 'Claude', connectionId }`). Il pannello mostra «Matteo, con Claude» nel registro e nell'esito del post.

### 5.3 Modifiche ad altre parti

| Parte | Cosa |
|---|---|
| `packages/domain` | Ambiti degli agenti e loro rapporto con i permessi; regole dell'anteprima in blocco (riuso di quelle della tappa 9) |
| `packages/application` | Tipo `McpTool`, origine nella richiesta, casi d'uso nuovi: `importMediaFromUrl`, `createUploadLink`, `previewPlanImport`/`confirmPlanImport`, `previewBulkSchedule`/`confirmBulkSchedule`, `listAgentConnections`, `revokeAgentConnection` |
| `packages/infrastructure` | Tabelle (§7), scaricamento sicuro dagli indirizzi (§8.6), adattatori |
| `packages/contracts` | Schemi degli strumenti riusati dalle rotte dove coincidono |
| `apps/web` | Server di autorizzazione, pagina di conferma, *Impostazioni → Agenti collegati*, *Il mio account → Token personali*, pagina `/carica/<link>`, Bearer sull'API `/api/v1` |
| `apps/mcp` | Nuovo |
| Lettore di CSV ed Excel (tappa 9, Task 11) | Oggi è nel browser (`apps/web/app/utils/sheet-import.ts`). Va spostato in un pacchetto comune, così il server legge anche un Excel arrivato da ChatGPT |
| Docker e VPS | Servizio `mcp`, indirizzo pubblico dedicato (§9.4) |

---

## 6. Gli strumenti

Nomi in inglese (convenzione del codice; i modelli li usano meglio), **titolo e descrizioni per l'utente in italiano**. Ogni strumento di scrittura accetta `idempotencyKey` (§8.5); ogni modifica di un post vuole la `version` letta (409 se è cambiata). Le date si danno come `localDate` + `localTime` nel fuso dell'agenzia, come nel pannello; ogni risposta ripete la data scritta per esteso («giovedì 27 novembre 2026, 18:00, ora di Roma»), così l'agente la conferma all'utente senza fare conti.

Legenda ambito: **L** lettura, **B** bozze, **P** programmazione, **X** pubblicazione. Annotazioni: 🔒 sola lettura, ⚠️ distruttivo (la chat chiede conferma).

### 6.1 Contesto e clienti

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `get_context` 🔒 | L | Chi sono, agenzia, ruolo, fuso, ambiti del collegamento, moduli accesi, data e ora di adesso | `me`, impostazioni |
| `find_client` 🔒 | L | Cerca un cliente per nome anche approssimato («forno luce», «FL»): restituisce i candidati con id e account | `workspaces.list` |
| `list_clients` 🔒 | L | Clienti visibili, con account collegati e salute | `workspaces.list`, `accounts` |
| `get_client` 🔒 | L | Scheda: account e profili (IG + Pagina), orario predefinito, fasce orarie, etichette, modelli di caption, gruppi di account, ultimi post | `workspaces`, `posts`, `time-slots` |
| `list_accounts` 🔒 | L | Account social di un cliente con stato (token, salute, quota) | `accounts` |

### 6.2 Calendario e stato

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `get_today` 🔒 | L | «Oggi»: cosa esce oggi e domani, bozze da finire, da sistemare, piano da preparare | `agenda` |
| `get_calendar` 🔒 | L | Post e voci del piano in un periodo (max 42 giorni), per cliente o tutti, filtri per stato ed etichetta | `calendar.getCalendar` |
| `list_posts` 🔒 | L | Post per stato (bozza, programmato, pubblicato, non riuscito), con ricerca nel testo | `posts.list` |
| `get_post` 🔒 | L | Un post completo: file, caption per piattaforma, destinazioni, data, controlli, versione, note | `posts.get` |
| `get_post_outcome` 🔒 | L | Esito per destinazione, link al post pubblicato, errore tradotto | `posts.outcome` |
| `list_issues` 🔒 | L | «Da sistemare»: post non riusciti, account da ricollegare, file non riusciti | `agenda.issues` |
| `get_instagram_grid` 🔒 | L | Griglia del profilo: pubblicati e programmati in ordine (tappa 9, Task 12) | `calendar` |
| `next_free_slot` 🔒 | L | Prossima fascia libera di un cliente dopo una data | `posts.nextFreeSlot` |
| `list_notifications` 🔒 | L | Notifiche non lette | `notifications.centre` |
| `mark_notifications_read` | L | Segna lette | `notifications` |

### 6.3 Libreria e file

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `search_media` 🔒 | L | Cerca nella libreria di un cliente per nome, cartella, tipo, data, «non ancora usato» | `media.list` |
| `get_media` 🔒 | L | Un file: tipo, misure, durata, stato dell'elaborazione, dove è usato, miniatura (come immagine piccola nel risultato, così il modello la vede) | `media.get` |
| `list_folders` 🔒 / `create_folder` | L / B | Cartelle | `media.folders` |
| `upload_media` | B | **ChatGPT:** riceve i file allegati (`fileParams`), li scarica e li mette nella libreria del cliente. Restituisce gli id e lo stato | nuovo `importMediaFromStream` sopra `uploads` |
| `create_upload_link` | B | **Claude e tutti:** crea un link di caricamento per un cliente e una cartella, valido 30 minuti; l'utente lo apre e sceglie le foto dal telefono o dal computer. Restituisce il link e un id da seguire | nuovo `createUploadLink` |
| `get_upload_link_status` 🔒 | L | Cosa è arrivato da quel link | idem |
| `import_media_from_url` | B | Scarica da un indirizzo https (Drive o Dropbox condivisi, immagine generata da un altro strumento), con i controlli di §8.6 | nuovo `importMediaFromUrl` |
| `wait_for_media` 🔒 | L | Aspetta fino a 60 s che i file siano pronti (le conversioni dei video sono lente) e dice lo stato | `media.get` |

### 6.4 Post

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `check_post` 🔒 | L | Prova un post senza salvarlo: controlli di Meta e di Feedway, avvisi con le scelte possibili | `rules.checkPost` |
| `create_post_draft` | B | Bozza con tipo, file, caption (comune o per piattaforma), destinazioni (per id, username o «tutti gli account del cliente»), etichette, data facoltativa. Restituisce controlli e **anteprima** | `posts.createDraft` |
| `update_post_draft` | B | Cambia una bozza (con `version`) | `posts.update` |
| `schedule_post` ⚠️ | P | Programma una bozza o crea e programma in un passo. Se un controllo blocca, resta bozza e dice perché | `posts.schedule` / `createScheduled` |
| `reschedule_post` ⚠️ | P | Sposta data e ora di un programmato | `posts.update` + `schedule` |
| `unschedule_post` | P | Riporta in bozza | `posts.unschedule` |
| `cancel_post` ⚠️ | P | Annulla un programmato | `posts.cancel` |
| `duplicate_post` | B | Copia su altre date dello stesso cliente | `posts.duplicate` (tappa 9) |
| `delete_draft` ⚠️ | B | Elimina una bozza (va negli «Eliminati», tappa 9 Task 14) | `posts.delete` |
| `publish_now` ⚠️ | X | Pubblica subito. **Spento di base** (§8.3) | `posts.publishNow` |
| `retry_destination` ⚠️ | X | Riprova una destinazione non riuscita | `posts.retry` |
| `add_post_note` / `list_post_notes` | B / L | Note interne del post | `posts.notes` |
| `list_caption_templates` 🔒 / `list_labels` 🔒 | L | Modelli di caption ed etichette del cliente | `content-settings` |

### 6.5 Piano editoriale

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `list_plan` 🔒 | L | Voci del piano di un cliente in un periodo, con stato (da preparare, preparata, in ritardo) | `plan.listPlan` |
| `preview_plan_import` 🔒 | L | Riceve le righe che l'agente ha letto da un testo, PDF o Excel (data, ora facoltativa, tipo, titolo, nota, account) o un file Excel/CSV (ChatGPT); le controlla e restituisce un'**anteprima**: righe valide, righe con problemi (data passata, account sconosciuto, doppione), confronti con ciò che c'è già. Restituisce un `previewId` valido 30 minuti | nuovo, sulle regole di `plan` |
| `confirm_plan_import` ⚠️ | B | Crea le voci dell'anteprima, tutte o alcune righe. Restituisce il riepilogo e il link al piano | `plan.createPlanItem` in una transazione |
| `create_plan_item` / `update_plan_item` / `move_plan_item` / `remove_plan_item` | B | Una voce alla volta | `plan` |
| `prepare_plan_items` | B | «Prepara»: una o più voci diventano bozze | `plan.preparePlanItem` |

### 6.6 In blocco

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `preview_bulk_schedule` 🔒 | L | Fino a 50 righe (file, caption, destinazioni, data o «fascia libera»): abbina, distribuisce sulle fasce, controlla ogni riga, restituisce l'anteprima e un `previewId` | regole di `bulk.import` (tappa 9, Task 10) |
| `confirm_bulk_schedule` ⚠️ | P | Esegue l'anteprima: programmati, bozze dove un controllo blocca, errori per riga | `bulk.import` |
| `get_bulk_import` 🔒 | L | Stato e riepilogo | `bulk` |
| `undo_bulk_import` ⚠️ | P | «Annulla» nella finestra consentita | `undoBulkImport` |

### 6.7 Registro (solo chi lo vede nel pannello)

| Strumento | Amb. | Cosa fa | Caso d'uso |
|---|---|---|---|
| `get_activity` 🔒 | L | Registro attività filtrato (chi ha fatto cosa su un cliente) | `audit-log` |

### 6.8 Fuori di proposito

Utenti, ruoli e inviti; integrazioni e token di Meta; collegamento degli account; impostazioni dell'agenzia e della piattaforma; privacy, esportazioni e cancellazioni; sicurezza, sessioni e 2FA; Telegram. Sono azioni rare, delicate e da fare guardando il pannello: lasciarle a un agente allarga il danno di un errore o di un'istruzione nascosta senza un vantaggio vero. D-132 punto 6.

### 6.9 Oltre gli strumenti

- **Prompt MCP** (comandi pronti che la chat mostra): «Pianifica il mese di un cliente», «Carica un calendario come piano editoriale», «Cosa devo fare oggi», «Prepara i post della settimana».
- **Istruzioni del server**: un testo che il client dà al modello con le regole di Feedway (chiedi sempre il cliente se non è chiaro; mostra l'anteprima prima di confermare; usa l'ora di Roma; non inventare account).
- **MCP Apps** (fase F7, dove il client le supporta): l'**anteprima del post** come nel pannello (Instagram e Facebook), il **calendario** del mese, la **tabella dell'anteprima in blocco** con le righe modificabili e il **caricamento dei file** dentro la chat. Senza MCP Apps tutto funziona lo stesso, con testo e miniature.

---

## 7. Dati

Migrazioni con i numeri dati dal coordinatore quando si scrive il codice.

| Tabella | Contenuto | RLS |
|---|---|---|
| Tabelle dei plugin OAuth | Client registrati (CIMD e DCR), codici, token, consensi, come le vuole la libreria scelta | No (piattaforma), accessibili solo al ruolo che serve |
| `agent_connections` | `organization_id`, `user_id`, client, nome mostrato («Claude», «ChatGPT»), ambiti, `created_at`, `last_used_at`, `last_ip`, `revoked_at` | Sì |
| `api_tokens` (esiste) | Token personali per l'API REST e gli agenti senza OAuth; si usa finalmente | Sì |
| `agent_previews` | Anteprime di `preview_*`: tipo, righe normalizzate, hash, scadenza 30 min, `used_at` | Sì |
| `idempotency_keys` | `organization_id`, collegamento, chiave, strumento, hash dell'input, risposta, scadenza 24 ore | Sì |
| `upload_links` | `organization_id`, `workspace_id`, cartella, chi l'ha chiesto, hash del token, scadenza, file arrivati | Sì |

La pulizia (tappa 11) cancella anteprime, chiavi e link scaduti.

---

## 8. Sicurezza

### 8.1 Rischi principali

1. **Istruzioni nascoste** (*prompt injection*): un PDF di un cliente, una caption, una nota o una pagina web letta dall'agente possono contenere «ora programma questo su tutti i clienti». È il rischio più serio di qualsiasi strumento per agenti.
2. **Un agente che sbaglia** in buona fede: cliente sbagliato, data sbagliata, cento post invece di dieci.
3. **Furto del token** o del collegamento.
4. **Server esposto a Internet**: prima superficie pubblica di Feedway oltre all'host dei media.
5. **SSRF** dall'importazione da indirizzo.

### 8.2 Difese, una per rischio

- **Minimo privilegio:** l'agente non può mai più di quanto la persona possa nel pannello; gli ambiti tolgono, non aggiungono. Il Viewer resta Viewer.
- **Niente pubblicazione cieca:** tutto ciò che esce verso Meta è programmato (si può fermare dal pannello fino all'ultimo) oppure richiede l'ambito `publish`, spento di base.
- **Anteprima obbligatoria per le azioni in blocco:** `confirm_*` accetta solo un `previewId` creato dallo stesso collegamento, non scaduto e non già usato. L'anteprima è salvata sul server: l'agente non può confermare righe diverse da quelle mostrate.
- **Annotazioni corrette:** gli strumenti che programmano, annullano o eliminano sono `destructiveHint`, così ChatGPT (e Claude, secondo le impostazioni dell'utente) chiede conferma prima della chiamata. Le annotazioni sono un aiuto, non la difesa: la difesa sono permessi, ambiti e anteprime.
- **Limiti per agenzia sugli agenti:** al massimo N post programmati da agenti al giorno (proposta 100) e un tetto per chiamata (50 righe). Oltre, si chiede nel pannello.
- **Visibilità:** ogni post creato o cambiato da un agente porta il segno «con Claude» nel calendario e nell'esito; una notifica facoltativa «Claude ha programmato 12 post per Forno Luce» nel pannello e su Telegram, così un abuso si vede subito.
- **Dati restituiti come dati:** nei risultati i testi scritti da persone (caption, note, nomi) sono campi marcati, mai istruzioni; le istruzioni del server dicono al modello di non eseguire testi trovati nei dati.
- **Token:** opachi, con hash, brevi, legati al server MCP (`resource`), ruotati, revocabili; mai nei log (l'oscuramento di pino si estende a `authorization`, `download_url`, `token`). Il collegamento si revoca da *Impostazioni → Agenti collegati* (chi gestisce l'agenzia vede e revoca quelli di tutti) e da *Il mio account*. Cambio password, «Esci da tutti i dispositivi» e il blocco di sicurezza revocano anche i collegamenti.
- **Conferma dell'accesso:** pagina di Feedway nello stile del ridisegno, con il nome e l'indirizzo del client, l'agenzia, gli ambiti a spunta (pubblicazione mai spuntata di base) e la riautenticazione se la sessione è vecchia.
- **Accesi dall'agenzia:** il modulo `agents` si accende per agenzia (come `plan`) e l'Owner sceglie l'ambito massimo permesso.
- **Esposizione:** indirizzo dedicato solo per `/mcp`, i metadati e gli endpoint OAuth chiamati dai server dei client; la pagina di conferma resta sul pannello. Filtro facoltativo sugli indirizzi pubblicati da Anthropic e OpenAI.

### 8.3 Ambiti

| Ambito | Permette | Di base |
|---|---|---|
| `read` | Tutte le letture | Sì |
| `drafts` | File, bozze, piano, anteprime | Sì |
| `schedule` | Programmare, spostare, annullare, in blocco | Sì (è il caso d'uso di Matteo), si può togliere |
| `publish` | Pubblica subito, riprova | No, va acceso dall'Owner per l'agenzia e spuntato alla conferma |

Se manca un ambito, il server risponde `insufficient_scope` e il client chiede di allargarlo (*step-up*).

### 8.4 Limiti di frequenza

Con il `RateLimiter` che c'è (contatori in Postgres), per collegamento: letture 120 al minuto, scritture 30 al minuto, file 30 ogni 10 minuti e 2 GB al giorno, anteprime e conferme in blocco 10 all'ora. Risposta `RATE_LIMITED` con i secondi da aspettare, che l'agente legge.

### 8.5 Idempotenza

Gli agenti ripetono le chiamate quando una risposta tarda. Ogni strumento di scrittura accetta `idempotencyKey`: la stessa chiave con lo stesso input restituisce la risposta già data, con un input diverso è un errore. Senza chiave, `apps/mcp` ne calcola una dall'input per 2 minuti, così una ripetizione immediata non crea due post.

### 8.6 Scaricare da un indirizzo

Solo https; risoluzione DNS una volta e connessione a quell'indirizzo, rifiutati indirizzi privati, locali e di servizio (anche dopo un reindirizzamento, al massimo 3); tetto di peso e di tempo come il caricamento normale; tipo controllato dai byte, non dal nome; nessun cookie e nessuna intestazione nostra. Il file poi entra nella stessa analisi della libreria (tappa 4). Vale anche per i `download_url` di ChatGPT.

### 8.7 Revisione dedicata

È un caso da revisione di sicurezza dedicata ([flusso Git](../../flusso-git.md) §Revisione): accesso, token, superficie pubblica, file da Internet.

---

## 9. Comportamento ed errori

### 9.1 Errori

- Gli errori dei casi d'uso (`DomainError` con `code`) diventano risultati con `isError: true`, `structuredContent: { code, message, hint }`: messaggio in italiano per l'utente e un suggerimento per l'agente («`ACCOUNT_NOT_IN_CLIENT`: l'account non è di questo cliente; usa `list_accounts`»). Si traducono in un solo punto, come `http-errors.ts`.
- Errori di protocollo solo per richieste malformate. 401 con `WWW-Authenticate` per token mancante o scaduto, 403 `insufficient_scope` per ambiti.
- 409 di versione: il risultato contiene lo stato di adesso, così l'agente rilegge e ripropone.
- Un risultato lungo (calendario di un mese) è paginato e sotto i 100.000 caratteri.

### 9.2 Ambiguità

Il server non indovina. Due clienti che somigliano a «Forno» → `find_client` li restituisce entrambi e l'agente chiede. Un'ora saltata dal cambio d'ora segue la regola che c'è (D-49). Una data nel passato è un errore con il suggerimento.

### 9.3 File lenti

Un video in conversione: `create_post_draft` lo accetta, `schedule_post` segue le regole di oggi (blocca se il file non sarà pronto). `wait_for_media` permette all'agente di aspettare e riprovare.

### 9.4 Indirizzo pubblico

Il pannello oggi è dietro Tailscale. Claude e ChatGPT chiamano il server MCP dai loro server, quindi `/mcp` e gli endpoint dei token devono essere raggiungibili da Internet: un indirizzo dedicato (per esempio `mcp.<dominio>`) con Cloudflare Tunnel o Tailscale Funnel come l'host pubblico dei media, separato da `PUBLIC_HOST` come già detto in §18.3. La pagina di conferma e `/carica/<link>` restano sul pannello: le apre la persona dal suo browser. Se il telefono di chi carica non ha Tailscale, il link di caricamento va sull'indirizzo pubblico con il suo token; D-132 punto 4.

---

## 10. Test

| Livello | Cosa |
|---|---|
| Unit | Registro degli strumenti (nomi, ambiti, annotazioni, titoli, schemi stretti); traduzione degli errori; normalizzazione delle righe di piano e in blocco; idempotenza; controlli dell'indirizzo (IP privati, reindirizzamenti, DNS che cambia) |
| Integrazione (Testcontainers) | Ogni strumento chiamato con il client MCP dell'SDK contro `apps/mcp` vero: **matrice ruolo × strumento**; **batteria di isolamento**: ogni strumento con id di un'altra agenzia risponde «non trovato», come le rotte; ambiti mancanti; anteprima di un altro collegamento rifiutata; token revocato, scaduto, di un'altra risorsa |
| OAuth | PKCE, `redirect_uri` sbagliato, `resource` sbagliata, `iss`, codice usato due volte, rotazione del rinnovo con riuso che revoca la famiglia, CIMD con documento non valido, persona disattivata a metà |
| Contratto | Fotografia di `tools/list` (schemi e descrizioni): un cambiamento non voluto fa fallire il test |
| E2E (Playwright, axe) | Pagina di conferma, «Agenti collegati», token personali, `/carica/<link>` da telefono |
| Con un modello (facoltativo) | Una ventina di conversazioni di esempio («programma questa foto giovedì») con l'elenco delle chiamate attese, fatte girare a mano prima di un rilascio; richiede una chiave API, mai in CI |
| Reale, con Matteo | Claude web e telefono, Claude Code, ChatGPT in modalità sviluppatore: i casi U1–U7 con il finto Graph API e poi con gli account di prova. Ciò che non è provato resta «non verificato» |

Il MCP Inspector ufficiale si usa a mano durante lo sviluppo.

---

## 11. Costi

- **Feedway:** nessun servizio a pagamento nuovo. Il server MCP è un processo leggero (qualche decina di MB) sulla stessa VPS; Cloudflare Tunnel e Tailscale Funnel sono gratuiti. Il traffico dei file è quello di oggi.
- **Chi usa la chat:** serve un piano che ammetta i connettori personalizzati. Su Claude, un account gratuito ne ammette uno ([sunpeak](https://sunpeak.ai/blogs/claude-connectors-tutorial/)), i piani a pagamento di più; su ChatGPT la modalità sviluppatore e le app dipendono dal piano: **non verificato**, da controllare nel task F0. L'AI (scrivere caption, leggere un PDF) la paga l'abbonamento della chat, non Feedway.
- **Pubblicazione nelle directory** di Claude e ChatGPT: non serve per uso interno; serve solo per la 2.0 aperta ad altre agenzie, con revisione, informativa e account di prova.
- **Lavoro:** 13 task, circa 10 thread (§12).

---

## 12. Collocazione e task

### 12.1 Dove

| Opzione | Pro | Contro |
|---|---|---|
| (a) Subito dopo la tappa 9 | Matteo lo usa prima | Esce prima della revisione di sicurezza della tappa 11; ritarda condivisione e brand |
| **(b) Tappa «Agenti» tra la 10 e la 11** (consigliata) | La tappa 11 (sicurezza, carico, runbook) lo copre; arriva con piano editoriale e in blocco finiti; la 1.0 lo comprende | La 1.0 slitta di una tappa |
| (c) Versione 1.4, come in §18.2 | Nessun ritardo per la 1.0 | Mesi di attesa per la funzione che Matteo vuole di più |

La tappa ha la sua minor e la sua prova; il piano eseguibile si scrive mentre si chiude la tappa 10, come le altre.

### 12.2 Task proposti

| # | Task | Dipende da |
|---|---|---|
| F0 | **Prova tecnica (spike)**: server MCP «ciao» con l'SDK, OAuth con i plugin di Better Auth, collegato a Claude web, Claude Code e ChatGPT in modalità sviluppatore dietro un tunnel di prova; verifica di tutti i punti «non verificato» di §4; ADR 024 (SDK MCP) e ADR 025 (server di autorizzazione) | — |
| F1 | Origine nella richiesta (`panel` / `api` / `mcp`) al posto dei `source: 'panel'` scritti a mano | — |
| F2 | Server di autorizzazione, `agent_connections`, pagina di conferma, Impostazioni → Agenti collegati, revoche | F0 |
| F3 | `apps/mcp`: trasporto senza stato, token, ambiti, limiti, idempotenza, errori, tipo `McpTool` e registro nei moduli, batteria di isolamento degli strumenti, servizio Docker e indirizzo pubblico | F1, F2 |
| F4 | Strumenti di lettura (6.1, 6.2, 6.7) | F3 |
| F5 | File: `upload_media` (ChatGPT), `create_upload_link` e `/carica/<link>`, `import_media_from_url`, `search_media`, `wait_for_media` | F3 |
| F6 | Post: bozze, controlli, programmazione, spostamenti, annullamenti, duplica, note; segno «con Claude» e notifica | F4, F5 |
| F7 | Piano editoriale: anteprima e conferma dell'importazione, voci, «Prepara»; lettore CSV/Excel nel pacchetto comune | F4, tappa 9 Task 11 |
| F8 | In blocco: anteprima, conferma, stato, annulla | F6, tappa 9 Task 10 |
| F9 | Token personali e Bearer sull'API `/api/v1`, pagina in «Il mio account», documentazione OpenAPI pubblica | F2 |
| F10 | MCP Apps: anteprima del post, calendario, tabella in blocco, caricamento in chat | F6, F8 |
| F11 | Prompt e istruzioni del server; guida «Collega Feedway a Claude e ChatGPT» per Matteo e per la landing | F6 |
| F12 | Revisione di fine tappa, correzioni, rilascio e guida della prova sulla VPS | tutti |

F1 si può fare anche prima, in qualsiasi momento: è un piccolo lavoro di pulizia che non cambia nulla per l'utente.

---

## 13. Cosa resta fuori

- Feedway che chiama un modello AI per conto suo (assistente per le caption della 1.4): con MCP l'AI è quella della chat dell'utente, che è già pagata e migliore.
- Agenti che agiscono senza una persona (un agente di agenzia con un suo account): si valuta dopo, con un ruolo di servizio e ambiti suoi.
- Pubblicazione nelle directory pubbliche di Claude e ChatGPT: con la 2.0.
- Webhook in uscita verso gli agenti: 1.1, come da specifica.
