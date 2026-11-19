# Ridisegno del pannello: la nuova direzione nel codice

> **Per chi esegue:** usa superpowers:executing-plans. Le regole di `AGENTS.md` prevalgono: un solo agente per task e un revisore separato per ogni PR. Il formato è quello leggero dei piani di tappa: per ogni task trovi obiettivo, schermate, file, cosa fa, test e criteri di fine; il codice si scrive nella PR. **Ogni thread fa un task** (o due piccoli, dove la tabella lo dice), poi scrive l'handoff in `/mnt/project-files/handoff/ridisegno/` e chiede al coordinatore il thread successivo. Se specifica, piano, schermate e codice non sono d'accordo, fermati e segnala.

**Obiettivo:** ogni pagina del pannello diventa **accuratamente uguale** alle schermate della nuova direzione adottata da Matteo il 19/11 (D-81), al computer e al telefono, senza perdere niente di quello che il pannello fa oggi: stessi dati, stessi permessi, stesse rotte, stessi test di comportamento. Cambiano l'aspetto, la struttura delle pagine e il guscio.

**Quando:** **prima della tappa 7** (scelta di Matteo del 19/11). La parte server della tappa 7 (macchina a stati, worker, pubblicazione) non tocca il pannello e può essere pianificata intanto; nessun task della tappa 7 che tocca pagine parte prima della fine di questo piano. Così esiti, «Riprova», pagina del post uscito e «Pubblica subito» nascono una volta sola, già nella grammatica nuova, usando i componenti costruiti qui.

## Fonti

- **Schermate di riferimento** (sono il contratto): `design/esplorazioni/2026-11-19-nuova-direzione/schermate/computer/NN-*.png` (1440×900) e `…/telefono/NN-*.png` (390×844), tema chiaro; copie a 2× in `/mnt/project-files/design-revisione/2026-11-19-nuova-direzione/`.
- **Pagine vive:** `design/esplorazioni/2026-11-19-nuova-direzione/index.html?p=<pagina>`. `base.css` ha token, misure e regole di ogni elemento (è la fonte dei numeri: altezze, raggi, spaziature, colori); `app.js` e `app2.js` hanno la struttura di ogni pagina e i testi. Quando una schermata e `base.css` sembrano diversi, vale la schermata e si segnala.
- **Regole e motivi:** `design/reviews/2026-11-19-nuova-direzione.md` (tabella «Regole», «Guscio», pagina per pagina, «Cosa cambia rispetto a scelte già prese»).
- **Accesso:** la versione corretta con il logo grande al centro e «Accedi» centrato (`?p=accedi`, schermate `01-accedi`), chiesta da Matteo il 19/11.
- **Marchio:** `design/brief-feedway/brand/Feedway-Brand-Kit-v1.0/GUIDA-DEL-MARCHIO.md`; logo dai file originali.
- **Skill:** `impeccable` e, tra le skill del repo, `make-interfaces-feel-better`, `emil-design-eng`, `humanizer` (per i testi). Per la revisione: `design/brief-feedway/06-PROMPT-REVISIONE.md` e i criteri del documento 05.
- **Prova della 0.12.0:** `/mnt/project-files/handoff/tappa-6/ESITI-prova-0.12.0.md` §3, le richieste che hanno originato la direzione.

## Prerequisito

**La PR #249** (`docs/design-nuova-direzione`, revisione, pagine vive, schermate, skill) è fusa su `main`. Oggi è in conflitto su `docs/decisioni-aperte.md`: sul ramo la direzione è «D-80», ma su `main` D-80 sono i difetti della prova e la direzione è **D-81**. Nel risolvere il conflitto la voce del ramo si fonde in D-81 (questo piano la aggiorna già) e D-80 resta quella dei difetti.

## Stato di partenza

Codice di `main` al 19/11 (dopo la #247, rilascio 0.12.0):
- **Token:** `packages/ui/src/tokens.ts` (nomi, cinque palette `feedway`, `blu`, `verde`, `viola`, `grafite`, chiaro e scuro, stati) generati in `@app/ui/tokens.css` (`generate-css.ts`) come `--app-*`; `apps/web/app/assets/main.css` mappa i token su Nuxt UI 4.12 (`--ui-*`) e tiene la scala di pagina di D-63 (`--spacing-gutter`, `--spacing-section`…); `app.config.ts` regola i pulsanti di Nuxt UI. Contrasto provato da `packages/ui/src/contrast.test.ts`.
- **Guscio:** `layouts/agency.vue` con `AppNav.vue`, `ContextSwitcher.vue`, `OrgSwitcher.vue`, `UserMenu.vue`/`UserMenuPanel.vue`, `MobileNav.vue` (barra in basso), `useAgencyNav.ts`; pagine con `PageShell.vue`, `PageHeader.vue`, `SettingsShell.vue`; layout `personal.vue` per `/account/*`, `auth.vue` per l'accesso.
- **Pagine:** Home `pages/[org]/index.vue` (cinque riquadri), Clienti `spazi/index.vue`, cliente `spazi/[slug].vue` con le schede `index` (Panoramica), `post/index`, `libreria`, `contenuti`, `membri`, `account`; editor `spazi/[slug]/post/[postId].vue` e `post/nuovo.vue` con i componenti in `components/post/`; Libreria `libreria.vue` con `MediaLibrary.vue`, `MediaTile.vue`, `MediaDetail.vue`; `utenti.vue`, `registro.vue`, `privacy.vue`, `impostazioni/…`, `account/…`, `accedi/…`.
- **Date:** `utils/format-date.ts` (`dateStyle: 'long'`); alcuni campi usano ancora il formato del browser (`11/18/2026`, `06:00 PM`, punto 6 della revisione).
- **API:** i post si leggono solo per cliente (`GET …/workspaces/{id}/posts`); non c'è una lettura dei post di tutta l'agenzia. `media/{id}/retry` esiste (D-39). Gli utenti hanno l'ultimo accesso nel contratto (`contracts/src/api/users.ts`).
- **E2E:** `apps/web/tests/e2e/*.spec.ts`, quattro progetti (telefono e computer, chiaro e scuro); in locale due incrociati, in CI tutti e quattro. Script di schermate usati nella tappa 6: `/mnt/project-files/handoff/tappa-6/zz-screens-*.spec.ts`.

**Dipendenze nuove:** nessuna. Le icone sono già Lucide (le stesse dell'esplorazione); il confronto delle schermate usa Playwright, già presente.

## Regole del ridisegno

- **Uguale vuol dire:** stessi elementi, nello stesso ordine e nella stessa posizione; stessi testi (salvo i dati); stesse misure di `base.css` (altezze, larghezze fisse, raggi, spaziature, corpo e peso dei caratteri) con tolleranza di 1 px; stessi colori, presi dai token e mai scritti a mano. Ogni differenza voluta o inevitabile va nella sezione **«Differenze dalla schermata»** della PR, con il motivo, e Matteo la vede.
- **Il comportamento non cambia.** Permessi, rotte, salvataggio automatico, blocco ottimistico, controlli, caricamenti, isolamento: tutto resta com'è. I test E2E di comportamento si aggiornano solo nei selettori e nei testi che cambiano davvero; mai cancellati o saltati. Un test che non ha più senso (per esempio i riquadri della Home) si sostituisce con quello della pagina nuova nella stessa PR.
- **Un solo arancio per schermata** (regola della revisione): «Nuovo post» nel guscio, «Programma» nell'editor, «Accedi» nell'accesso; più il conteggio di «Da sistemare» e la sottolineatura della scheda attiva. Selezioni, spunte, interruttori e voce attiva in carbone. Un test lo controlla (Task R1).
- **Niente sottotitoli sotto i titoli.** Una frase solo dove serve, come nelle schermate. I testi nuovi passano da `humanizer` e stanno nei file di traduzione, mai nei componenti.
- **Date e ore all'italiana, sempre a 24 ore:** «venerdì 20 novembre», «ven 20 nov, 18:00», «oggi, 18:00», «domani, 13:00», «ieri alle 18:42». Una sola utilità (Task R1) usata ovunque; nessun campo di data o ora del browser rimane visibile.
- **Tema scuro e palette** funzionano da subito: i token scuri di `base.css` entrano con il Task R1, e ogni task passa axe nei due temi. Le schermate di riferimento sono solo chiare: il confronto di fedeltà si fa sul chiaro; lo scuro e le quattro palette si rifiniscono nel Task R9.
- **Stati:** ogni pagina ha vuoto, caricamento, errore e successo (piano generale §4). Le schermate non li disegnano: si costruiscono con i componenti nuovi (riga «Niente da sistemare.» di `03` come modello del vuoto, scheletri con le misure delle righe) e si mostrano a Matteo nel Task R9.
- **Larghezza:** contenuto pieno fino a 1200 px, poi si ferma (sostituisce «larghezza piena» di D-63); barra laterale 240; margini come in `base.css`.
- **Punti di rottura:** gli stessi del pannello (l'esplorazione cambia a 760 px). Si prova a 390, 768, 1280 e 1440.

## Come si prova la fedeltà

Costruito una volta nel Task R1, usato da ogni task.

1. **Dati di esempio uguali alle schermate.** `apps/web/tests/e2e/support/design-sample.ts` semina l'agenzia «Studio Riva» con Giulia Ferri Owner, i clienti Forno Luce, Osteria Bruna, Gelateria Polo, Ottica Venti, Palestra Arco (più uno archiviato), i profili e gli account come nelle schermate (Forno Luce Bistrot da ricollegare), i post con gli stessi testi e orari, le bozze, i file con le tre foto di `design/feedway-ui-assets/`. Le scritture vanno direttamente nel database di prova con `seed` (come gli E2E di oggi), così si possono avere post nel passato.
2. **Stesso giorno delle schermate.** Il browser si ferma a **giovedì 19 novembre 2026, 10:00 di Roma** con `page.clock.setFixedTime`; le letture del pannello chiedono i periodi al server partendo da quella data, quindi «Oggi», «domani» e la settimana coincidono.
3. **Schermate del codice.** `apps/web/tests/design/shots.spec.ts` (fuori dalla suite di CI, si lancia con `pnpm --filter @app/web design:shots <numeri>`) apre ogni pagina negli stessi stati delle schermate (`04` selettore aperto, `11` conferma, `12` dopo «Programma»…), a 1440×900 e 390×844, e salva `NN-nome.png` in `design/reviews/ridisegno/codice/{computer,telefono}/`.
4. **Confronto affiancato.** Lo stesso comando compone per ogni schermata un'immagine con il riferimento a sinistra e il codice a destra, alla stessa scala, e la salva in `/mnt/project-files/design-revisione/ridisegno/confronti/`. Il thread la guarda prima di aprire la PR e allega a Matteo le principali (istruzioni del progetto).
5. **Misure in CI.** `apps/web/tests/e2e/design-measures.spec.ts` legge gli stili calcolati sulle pagine già fatte: altezza dei controlli 36 al computer e 44 al telefono, righe 52 / 60, titolo di pagina Sora 22, testo 14 / 15, barra laterale 240, contenuto mai oltre 1200, **un solo elemento con fondo `brand` per pagina** (escluso il conteggio). Ogni task aggiunge le sue pagine all'elenco.

## Funzioni che le schermate mostrano e che non esistono

Le schermate le disegnano per far vedere dove andranno. Nel ridisegno si comportano così (D-84 le riassume per Matteo):

| Funzione | Schermate | Nel ridisegno | Arriva con |
|---|---|---|---|
| Calendario | `07`, voce del menu, «Apri il calendario» | La voce c'è, spenta con «Presto», **come nella schermata**; il link «Apri il calendario» non c'è finché non c'è il calendario | tappa 9 |
| Esiti «Pubblicato» / «non uscito», «Riprova» del post, «Reel… non uscito» in «Da sistemare» | `02`, `13`, `14` (colonna Collegamento) | I componenti hanno già le varianti (pallino verde, rosso, «1 non uscito»), provate nella pagina dei componenti; nei dati veri compaiono solo bozze, programmati e annullati | tappa 7 |
| Pagina del post uscito | `13` | Non si costruisce: è una pagina della tappa 7, che la farà con i componenti di qui | tappa 7 |
| «Pubblica subito» e la sua conferma | `08`, `11` | Il segmento c'è, spento con «Presto» (come oggi, P1 della tappa 6); la finestra di conferma non si costruisce | tappa 7 |
| Notifiche e campanella | `05`, guscio | La campanella c'è, spenta con «Presto» al passaggio, senza pannello e senza punto | tappa 8 |
| «Duplica» | menu «⋯» dei post | Non compare | tappa 9 (duplicazione) |
| Settimana «In uscita» in Oggi | `02` | **Si fa**: è una lettura dei post programmati (Task R3) | ridisegno |
| «Prossimo post» e «In programma» nei clienti | `14` | **Si fanno**: lettura nuova (Task R4) | ridisegno |
| Pallino del problema nel selettore del cliente | `04` | **Si fa** con i problemi che esistono già (profilo da ricollegare, file non riuscito) | ridisegno |
| Colonna «Clienti» degli utenti | `21` | **Si fa** se la lettura costa poco (assegnazioni già nel database); altrimenti la colonna si toglie e si segnala (D-84) | ridisegno |
| Filtro della libreria per uso | `19` | **Si fa** con l'etichetta d'uso che esiste già (D-18) | ridisegno |

Due difetti della prova della 0.12.0 (D-80) sono **disegnati** nelle schermate: il punto 4 (in `20` il file di un post programmato dice prima perché non si elimina, con la voce spenta) e il punto 7 (l'etichetta d'uso uguale con ogni filtro, che il filtro per uso richiede). Matteo ha deciso il 19/11 di chiuderli nel Task R6, con la correzione alla radice descritta lì (D-85); gli altri cinque restano nella tappa 7.

## Scelte già prese che il ridisegno cambia

Matteo le ha accettate adottando tutta la direzione (D-81, opzione a). Il Task R10 le scrive in `DESIGN.md` al posto delle vecchie:

| Prima | Ora |
|---|---|
| Riepilogo delle destinazioni in fondo al modulo (18/11) | «Controlli» sotto l'anteprima al computer; in fondo sul telefono |
| Barra delle azioni dell'editor in fondo anche al computer | In alto al computer, in basso sul telefono |
| «Salva bozza» e «Programma» sul telefono | Solo «Programma», con lo stato del salvataggio |
| Voce attiva e spunte in arancio e pesca (Hallmark, 29/10) | Carbone |
| Larghezza piena senza tetto (D-63) | Piena fino a 1200 px |
| Editor dentro il guscio | Pagina senza barra laterale |
| Stile unione: carta e cartoncino (14/11) | Pagina `#FBFAF8`, superfici bianche |
| Home a riquadri | «Oggi» |
| Registro attività e Privacy dell'agenzia come pagine a sé | Dentro Impostazioni |
| Titoli di sezione Sora 18 | Carattere di sistema 14 semigrassetto |

## Come si divide il lavoro

Dieci task in dieci thread, più la revisione di fedeltà e la tela Pencil. Ogni task è una PR (o due dove scritto); dentro un thread si fonde la prima PR prima di aprire la seconda.

| Thread | Task | Schermate | PR | Dipende da |
|---|---|---|---|---|
| 1 | R1 · Fondamenta: token, date, componenti base, strumenti di fedeltà | `00` | 2 | #249 fusa |
| 2 | R2 · Guscio: barra laterale, telefono, selettore, menu della persona | `04`, `06` e il guscio di tutte | 1 | R1 |
| 3 | R3 · Oggi | `02`, `03` | 2 | R2 |
| 4 | R4 · Clienti e pagina del cliente | `14`–`18` | 2 | R2 |
| 5 | R5 · Editor (1): pagina, Tipo, File, Testo | `08`, `09` | 1 | R2 |
| 6 | R6 · Libreria e dettaglio del file | `19`, `20` | 1 | R2 |
| 7 | R7 · Editor (2): Dove, Quando, anteprima, Controlli, telefono, dopo «Programma» | `08`–`10`, `12` | 1–2 | R5, R4 (per `12`) |
| 8 | R8 · Utenti, Impostazioni e accesso | `01`, `21`–`26` | 2 | R2 |
| 9 | R9 · Tema scuro, palette e stati | tutte | 1 | R3–R8 |
| — | Revisione di fedeltà (thread separato, modello più capace con effort alto, nessun codice) | tutte | — | R9 |
| 10 | R10 · Correzioni della revisione, `DESIGN.md`, rilascio e guida della prova | — | 1–2 | revisione |
| a parte | Tela Pencil nuova (quando Pencil è raggiungibile) | tutte | 1 | R1 |

- **In parallelo:** dopo R2, al massimo **due thread insieme**, su pagine diverse: R3 con R5, poi R4 con R6, poi R7 con R8. Si toccano i componenti di R1 solo per aggiungere varianti; chi deve cambiarne uno lo dice nell'handoff e l'altro thread riparte dalla `main` aggiornata.
- **Tela Pencil** (proposta di Matteo): un file nuovo `design/feedway-ui-v2.pen` costruito con i componenti e le variabili di R1, tenendo `design/feedway-ui.pen` com'è. Serve un thread con Pencil raggiungibile: non blocca il codice. **Fatta il 19/11** (`design/feedway-ui-v2.pen`, tavole in `design/tavole/2026-11-19-nuova-tela/`), copiando le schermate dell'esplorazione: quando R1 cambia token o componenti, la tela va riallineata.
- **Handoff** in `/mnt/project-files/handoff/ridisegno/HANDOFF-R<n>.md`: fatto, PR, differenze dalla schermata, scelte prese, cosa resta, non verificato, cosa serve al thread dopo.

## Review Focus

Oltre al piano generale §8:
1. **Niente comportamento perso.** L'editor salva, controlla, programma, riporta in bozza, annulla, avvisa uscendo, mostra il 409 come prima; la libreria carica, sposta, elimina come prima; i permessi di ogni ruolo (Viewer senza miniature, Editor solo bozza) restano. Ogni test E2E di comportamento della 0.12.0 è ancora verde.
2. **Le letture nuove sono isolate.** La lettura dei post di tutta l'agenzia (R3) e i conteggi dei clienti (R4) vedono solo i clienti visibili alla persona, entrano nella batteria di isolamento e nella matrice degli accessi, e non rivelano clienti nascosti nemmeno nei conteggi.
3. **Fedeltà misurata, non a occhio.** Confronti affiancati allegati, misure in CI, differenze elencate.
4. **Telefono.** Una sola riga in alto, barra in basso a cinque voci, editor con una riga in alto e una in basso, tastiera aperta senza coprire «Programma», aree di tocco da 44.
5. **Accessibilità.** Il carbone delle selezioni e il testo secondario `#625E58` reggono il contrasto in ogni palette e nello scuro; il fuoco si vede su ogni controllo; axe verde nei quattro progetti.

---

## Task R1 · Fondamenta: token, date, componenti base, strumenti di fedeltà

**Obiettivo:** le regole della tabella «Regole» della revisione diventano token e componenti, e c'è il modo di misurare la fedeltà. Nessuna pagina cambia struttura, ma tutte prendono i colori, i caratteri e le misure nuove.

**Schermata:** `computer/00-sistema.png` (tavola del sistema).

**PR 1 · Token e date**
- `packages/ui/src/tokens.ts`: valori di `base.css` per la palette `feedway` chiara e scura (`bg #FBFAF8`, `surface #FFFFFF`, `sunken`, `nav`, `hover`, `border`, `border-strong`, `field-border`, `text`, `muted #625E58`, `brand`, `brand-hover`, `on-brand`, `brand-soft`, stati con `warning-dot` e `neutral-dot`, `toast`, `on-toast`, `img-outline`); i nomi dello stile unione (`paper`, `card`, `groove`) diventano alias dei nuovi finché le pagine li usano, poi si tolgono nel Task R9. Le altre quattro palette cambiano solo fondi e neutri con la stessa logica (l'accento resta il loro); il contrasto si prova in `contrast.test.ts` per tutte, chiaro e scuro.
- `main.css`: misure come variabili (`--control` 36 / 44 sul telefono, `--row` 52 / 60, raggi 8 e 10, miniature 6, `--content-max` 1200, ombre `shadow-1` e `shadow-2`), scala dei caratteri (Sora 22 solo per il titolo di pagina, 14 / 15 il testo, 13 i dettagli, cifre tabellari), `h2`/`h3` in carattere di sistema; `app.config.ts`: dimensioni predefinite di pulsanti, campi, select, schede e interruttori di Nuxt UI sulle misure nuove; spunte e interruttori in carbone.
- `apps/web/app/utils/format-date.ts`: `formatDay` («venerdì 20 novembre»), `formatShort` («ven 20 nov, 18:00»), `formatRelative` («oggi, 18:00», «domani, 13:00», «ieri alle 18:42», «lun», «12 nov»), `formatTime` («8:00», 24 ore), tutti con il fuso della persona o dell'agenzia come oggi. Ogni punto del pannello che mostra una data passa di qui.
- **Test prima del codice:** unità per le quattro funzioni (mezzanotte, cambio d'ora 25/10 e 28/3, anno diverso, fuso diverso da Roma); `tokens.test.ts` e `contrast.test.ts` aggiornati (testo secondario 4,5:1 sulla pagina, sulla superficie e sulla voce attiva; bordo dei campi 3:1; etichetta sull'arancio 4,5:1).

**PR 2 · Componenti e strumenti**
- Componenti (in `apps/web/app/components/ui/` o accanto a quelli esistenti, aggiornandoli dove già ci sono): `Avatar` (cliente quadrato, persona tonda, grigio caldo con le iniziali o la foto; sostituisce i cerchi pastello di `RowAvatar.vue` e `UserAvatar.vue`), `StatusDot` (pallino più parola, varianti bozza, programmato, pubblicato, non uscito, da ricollegare, in pausa), `PlatformIcons`, `SectionHead` (titolo 14 semigrassetto, conteggio, link a destra), `ListSurface` e `ListRow` (superficie bianca con righe da 52 e filetti), `Toolbar` (filtro, ricerca e azione con contorno sulla stessa riga), `SegmentedFilter` nella forma nuova, `SettingsRow` (etichetta a sinistra, valore e azione a destra), `Toast` (conferma in basso con un link, come in `12`), `PageShell`/`PageHeader` nuovi (titolo 22 con l'eventuale data accanto, nessun sottotitolo).
- `pages/__test/componenti.vue` diventa la tavola `00`: ogni componente in ogni variante, comprese quelle della tappa 7 (esiti).
- Strumenti di fedeltà: `tests/e2e/support/design-sample.ts`, `tests/design/shots.spec.ts` con lo script `design:shots`, il confronto affiancato, `tests/e2e/design-measures.spec.ts` (all'inizio sulla pagina dei componenti). Vedi «Come si prova la fedeltà».

**Test:** unità delle date; E2E della pagina dei componenti nei quattro progetti con axe; misure; confronto con `00-sistema`.

**Fine:** `pnpm verify` verde; confronto di `00` allegato a Matteo con le pagine principali «prima e dopo i token» (Oggi, Clienti, editor), perché i colori cambiano ovunque già qui.

## Task R2 · Guscio: barra laterale, telefono, selettore, menu della persona

**Obiettivo:** il guscio delle schermate su ogni pagina dell'agenzia.

**Schermate:** il guscio di `02`, `14`, `19`, `21`; `04` (selettore aperto), `06` (menu della persona); telefono `02`, `04`, `06`.

**Cosa fa:**
- **Computer:** barra laterale 240 (`layouts/agency.vue`, `AppNav.vue`): logo e campanella (spenta, «Presto»); selettore del cliente (`ContextSwitcher.vue`) alto 44 con l'avatar quadrato; **«Nuovo post»** arancio, sempre lì: apre `post/nuovo` con il cliente del selettore, o la scelta del cliente da «Tutti i clienti» (come oggi); poi Oggi (con il conteggio di «Da sistemare» del Task R3, all'inizio vuoto), Calendario («Presto»), Clienti, Libreria; il nome dell'agenzia e sotto Utenti e Impostazioni; in fondo la persona con nome e ruolo, che apre il menu `06`.
- **Selettore (`04`):** ricerca, «Tutti i clienti», elenco con avatar quadrati e il pallino sui clienti con un problema (profilo da ricollegare, file non riuscito); sul telefono un foglio dal basso.
- **Telefono:** una sola riga in alto con il selettore e la campanella; la riga dell'agenzia sparisce (l'agenzia si cambia dal menu della persona). Barra in basso (`MobileNav.vue`): Oggi, Calendario («Presto»), **+** arancio, Clienti, Tu. «Tu» apre il menu `06`, che contiene anche Libreria e Utenti.
- **Menu della persona (`06`):** voci e ordine della schermata, con il cambio d'agenzia dove oggi è in `OrgSwitcher.vue` e il tema (`ThemeSwitcher.vue`).
- **Rotte:** «Home» diventa «Oggi» (`/[org]`, stessa rotta); `/[org]/registro` e `/[org]/privacy` restano raggiungibili ma il menu porta alle Impostazioni (le pagine si spostano nel Task R8, con un rinvio dagli indirizzi vecchi).
- `layouts/personal.vue` (pagine `/account/*`) prende lo stesso guscio quando la persona ha un'agenzia, così le Impostazioni del Task R8 sono una sola.

**Test:** `navigation.spec.ts`, `user-menu.spec.ts`, `page-layout.spec.ts` aggiornati; nuovo test del selettore con la ricerca e il pallino; tastiera (Tab nell'ordine visivo, Esc chiude foglio e menu); misure del guscio (240, 44, una riga in alto sul telefono); confronti del guscio su `02`, `04`, `06`, `14`.

**Fine:** `pnpm verify` verde; confronti allegati.

## Task R3 · Oggi

**Obiettivo:** la Home diventa «Oggi» come `02` e `03`, con dati veri.

**PR 1 · La lettura (server)**
- Nel modulo `posts`: caso d'uso `listAgenda(actor, { from, to, workspaceId? })` con i post programmati (e, dalla tappa 7, gli usciti e i non usciti) dei clienti **visibili** alla persona, con ora, prima miniatura, inizio del testo, cliente, piattaforme e stato; `listDraftsToFinish(actor, { limit })` con le bozze più recenti e cosa manca (file, testo, account: calcolato dai campi, senza `checkPost`). Rotte `GET /api/v1/orgs/{org}/agenda` e `GET /api/v1/orgs/{org}/agenda/drafts`, contratti in `contracts`, OpenAPI.
- «Da sistemare» del ridisegno con i problemi che esistono già: profili da ricollegare (dal modulo `accounts`) e file non riusciti (dal modulo `media`), letti con le loro funzioni pubbliche. Le righe dei post non usciti si aggiungono nella tappa 7.
- **Test prima del codice:** unità del caso d'uso (periodo, fuso, ordinamento, Viewer senza miniature come D-72); integrazione con Postgres; le rotte nuove in `cross-organization.int.test.ts` e `access-matrix.int.test.ts`; un Editor assegnato a un solo cliente non vede né conta i post degli altri.

**PR 2 · La pagina**
- `pages/[org]/index.vue`: titolo «Oggi» con la data accanto; «Da sistemare» con il conteggio, una riga per problema e il pulsante che lo risolve («Ricollega» porta alle integrazioni, «Riprova» usa `media/{id}/retry`); se non c'è niente, la sola riga «Niente da sistemare.» (`03`). «In uscita»: la settimana in una striscia (un trattino per post, colorato per stato, oggi sottolineato in arancio; un clic sul giorno mostra quel giorno) e sotto l'elenco di oggi e domani. A destra «Bozze da finire» con il conteggio e «Tutte», e «Clienti recenti» con «N in programma». Sul telefono una colonna, la striscia a sette giorni con i puntini.
- Con un cliente scelto nel selettore la pagina mostra solo quel cliente.
- Stati: vuoto (nessun post in programma: una riga con «Nuovo post» con contorno), caricamento (scheletri con le misure delle righe), errore.

**Test:** E2E nuovo `today.spec.ts` (sezioni, vuoto, filtro del cliente, «Riprova», telefono); quello vecchio della Home sostituito; misure; confronti `02` e `03`.

**Fine:** `pnpm verify` verde; confronti allegati; il conteggio nella barra laterale e il pallino del selettore usano la stessa lettura.

## Task R4 · Clienti e pagina del cliente

**Schermate:** `14` (Clienti), `15` (Nuovo cliente), `16` (Panoramica), `17` (Post del cliente), `18` (Impostazioni dei contenuti).

**PR 1 · Elenco e nuovo cliente**
- Lettura: `nextPostAt` e `scheduledCount` per ogni cliente dell'elenco, da una funzione pubblica di `posts` (`getScheduleSummary(tx, workspaceIds)`, una query), aggiunti al contratto dell'elenco dei clienti. Test d'integrazione e isolamento.
- `spazi/index.vue`: scheda «Attivi · Archiviati» con i conteggi, ricerca e «Nuovo cliente» con contorno nella stessa riga; tabella Cliente (avatar quadrato) · Profili (icona e nome, «+1») · Prossimo post («oggi, 18:00») · In programma · Collegamento (solo quando c'è da agire: «Da ricollegare»; «1 post non uscito» arriva con la tappa 7) · «⋯». Sotto, la riga dei profili non abbinati con «Sistemali». Telefono come `telefono/14`.
- `NewClientDialog.vue` come `15`: finestra al computer, foglio dal basso sul telefono.

**PR 2 · Pagina del cliente**
- Testata con avatar quadrato, nome, profili su una riga e «Nuovo post»; schede come la schermata.
- Panoramica (`16`): prossimi post, profili con lo stato, ultimi file, chi ci lavora.
- Post (`17`): filtro «Tutti · Bozze · Programmati · Annullati» (più «Pubblicati» dalla tappa 7), ricerca; righe con miniatura, testo, tipo e numero di file, quando, profili, stato, autore, «⋯» (senza «Duplica»).
- Impostazioni dei contenuti (`18`): orario, etichette, modelli e gruppi con `SettingsRow` e `ListSurface`.
- Libreria del cliente e Membri prendono i componenti nuovi (stessa grammatica del Task R6 e R8; se R6 non è ancora fuso, solo i componenti di R1).

**Test:** `clients.spec.ts`, `new-client.spec.ts`, `client-page.spec.ts`, `client-posts.spec.ts`, `post-content-settings.spec.ts` aggiornati e verdi; misure; confronti `14`–`18`.

## Task R5 · Editor (1): pagina, Tipo, File, Testo

**Obiettivo:** la parte alta dell'editor come `08` e `09`. Il comportamento di `usePostEditor.ts` non cambia.

**Cosa fa:**
- **Pagina senza barra laterale:** layout nuovo per `spazi/[slug]/post/[postId].vue` e `post/nuovo.vue`; riga in alto con indietro, cliente (avatar quadrato), «Nuovo post» o il titolo, stato del salvataggio, e a destra «Salva ed esci» e «Programma su N account» (il pulsante della barra di oggi, `PostActionBar.vue`, che si sposta in alto al computer con tutte le sue varianti: programmato, annullato, Editor). Corpo con il modulo a sinistra e la colonna destra (che il Task R7 riempie; qui resta l'anteprima di oggi, spostata).
- **Righe «etichetta a sinistra, contenuto a destra»** separate da un filetto (`PostEditorForm.vue`): Tipo, File, Testo, Dove, Quando, Etichette, Note interne; il conteggio sotto l'etichetta («2 di 10»).
- **Tipo** (`PostTypePicker.vue`): filtro a quattro voci su una riga; il motivo delle voci spente in una frase sola sotto, scritta per il caso («Con 2 file si può fare solo un carosello.»), dai messaggi di `rules`.
- **File** (`PostMediaList.vue`): miniature 96×120 con numero e maniglia, «Aggiungi» come ultima casella, «Carica», «Dalla libreria» e «oppure trascina qui» sotto; riordino, ritaglio e stati di caricamento come oggi.
- **Copertina del reel** (`CoverPicker.vue`) e la scelta da fare di `09` nella stessa grammatica: finché manca, «Programma» è spento e accanto c'è scritto perché.
- **Testo** (`CaptionEditor.vue`): bordo normale, in fondo «Inserisci» e i contatori con l'icona della piattaforma; l'interruttore «Testo diverso per Instagram e Facebook» sotto.

**Test:** `post-editor.spec.ts` e `post-preview.spec.ts` verdi (selettori aggiornati); il test di tastiera del riordino; misure; confronti della parte alta di `08` e `09`.

## Task R6 · Libreria e dettaglio del file

**Schermate:** `19`, `20`.

**Cosa fa:** `MediaLibrary.vue`, `MediaTile.vue`, `MediaDetail.vue`: file raggruppati per giorno; sotto il nome, in blu, dove è usato («Nel post di oggi, 18:00», «In una bozza»); filtri per cliente e per uso accanto alla ricerca, «Carica» con contorno nella riga degli strumenti; dettaglio in un pannello a destra con dove è usato e, per un file di un post programmato, «Elimina» spento con il motivo **prima** di provarci. Griglia e elenco, cartelle, caricamenti nell'angolo e selezione multipla restano.

**Due difetti della prova della 0.12.0 da chiudere qui** (D-80 punti 4 e 7, spostati da Matteo il 19/11, D-85). Vanno corretti alla radice: un difetto che dipende dall'ordine delle righe o dal pannello che «non sa» una regola del server torna in un'altra pagina se si mette una pezza nel componente. **PR a parte, prima di quella dell'aspetto**, con i test che falliscono scritti per primi.

1. **L'etichetta d'uso cambia con il filtro (D-80.7).** IMG_0389.png era «In una bozza» con «Tutti i file» e «In un post annullato» con «Nei post».
   - *Causa:* `usingMedia` in `infrastructure/src/db/posts/repositories.ts` ordina solo «programmati prima»; tra bozze e annullati l'ordine è quello in cui Postgres restituisce le righe, che cambia con il piano della query (e il filtro `inPosts` di `media/repositories.ts` lo cambia). `usesOf` in `application/src/media/library.ts` prende poi il primo. In più `MediaTile.vue` scrive la data con `Intl` nel fuso del browser, ignorando `timezone` del post che il repository legge già.
   - *Correzione:* l'uso «che conta» si decide in un solo punto, una funzione pura del dominio (`domain/src/media/usage.ts`, per esempio `primaryUse(uses)`), con un ordine totale e scritto: programmato con la data più vicina, poi bozza modificata più di recente, poi annullato, a parità l'id del post. Il repository ordina in SQL con lo stesso criterio (`ORDER BY` esplicito) e la funzione lo garantisce comunque. Il DTO porta anche `timezone` e il numero di post (`useCount`), così l'etichetta può dire «Nel post di ven 20 nov, 18:00» o «In 2 post» con le date di R1, senza ricalcoli nel pannello.
   - *Test prima del codice:* unità di `primaryUse` con tutte le combinazioni (programmato + bozza + annullato, due programmati, due bozze); integrazione: lo stesso file letto con «Tutti i file», «Nei post», per cartella e per etichetta dà sempre lo stesso `usedIn`; E2E: l'etichetta non cambia cambiando filtro.
2. **Eliminare il file di un post programmato chiede «Non si può annullare» e solo dopo rifiuta (D-80.4).**
   - *Causa:* la regola «un file in un post programmato non si elimina» (D-18) vive solo nel server (`application/src/media/…` e `folders.ts`, 409 `media_in_scheduled_post`); il pannello ha `usedIn` ma `fileActions` e `MediaDetail.vue` aprono sempre la conferma.
   - *Correzione:* la regola diventa una funzione pura del dominio (`domain/src/media/deletion.ts`, per esempio `deletionBlock(uses): { reason: 'in_scheduled_post', postAt, timezone, count } | null`) usata **sia** dal caso d'uso, che resta la difesa vera e risponde 409 come oggi, **sia** dal DTO, che espone `deleteBlockedBy`. Il pannello non ricalcola niente: se `deleteBlockedBy` c'è, «Elimina» è spento nel menu «⋯», nel dettaglio e nella selezione multipla, con il motivo scritto accanto («Nel post di ven 20 nov, 18:00: toglilo dal post o annulla il post per eliminarlo») e un link al post. Una cartella con file bloccati dice prima quanti sono, con la stessa funzione. Se il post viene programmato tra la lettura e il clic, il 409 mostra lo stesso testo e aggiorna il file, senza la conferma «Non si può annullare».
   - *Test prima del codice:* unità di `deletionBlock`; integrazione: DTO e caso d'uso danno lo stesso esito sugli stessi dati (un test solo che li confronta), cartella con file bloccati; E2E: voce spenta con il motivo, nessuna finestra di conferma, gara programmazione-eliminazione con il 409 tradotto.
3. **Da controllare nello stesso giro:** ogni altro punto del pannello che mostra lo stato d'uso di un file (editor, «Dalla libreria», libreria del cliente) legge lo stesso `usedIn`; nessun componente formatta date d'uso per conto suo.

**Test:** `library.spec.ts`, `upload.spec.ts` verdi; i test dei due difetti sopra; misure; confronti `19` e `20`.

## Task R7 · Editor (2): Dove, Quando, anteprima, Controlli, telefono, dopo «Programma»

**Schermate:** `08` (parte bassa e colonna destra), `09`, `10` (anteprima sul telefono), `12` (dopo «Programma»), telefono `08`, `09`, `11` (solo la barra).

**Cosa fa:**
- **Dove** (`DestinationPicker.vue`): solo l'elenco degli account con casella, icona, nome e tipo a destra («Pagina Facebook», «Da ricollegare» in ambra con la casella spenta); ricerca, gruppi e «Seleziona tutti» solo da sei account in su.
- **Quando** (`WhenPicker.vue`): segmento «Programma» · «Pubblica subito» («Presto»), giorno e ora all'italiana con selettori propri (niente campi del browser), «Orario abituale di Forno Luce» quando l'ora è quella predefinita; la frase «Esce…» sparisce.
- **Colonna destra:** anteprima senza cornice da telefono (`preview/Frame.vue`) con le schede Feed · Griglia · Facebook, e subito sotto i **Controlli** (`DestinationSummary.vue`): stato complessivo («Tutto pronto»), una riga per destinazione con cosa esce e lo stato, avvisi da scegliere e blocchi nella stessa superficie, «N correzioni fatte da Feedway. Dettagli». A 1280 le misure si riducono come oggi (l'anteprima resta sempre).
- **Telefono:** una riga in alto (indietro, titolo, «Anteprima»); in basso una riga con «Bozza salvata alle 11:53» e «Programma su N account»; «Salva bozza» sparisce (la bozza si salva da sola); i Controlli in fondo al modulo. `10`: anteprima a tutta pagina con «← Modifica». Con la tastiera aperta la riga resta sopra la tastiera.
- **Dopo «Programma»** (`12`, richiesta della prova 0.12.0 §3.4): si torna ai post del cliente con la conferma «Programmato per ven 20 nov alle 8:00 · Apri» (`Toast` di R1).
- Etichette e note nella grammatica nuova (`LabelsAndNotes.vue`).

**Test:** tutto `post-editor.spec.ts`, `post-preview.spec.ts`, `post-content-settings.spec.ts` verdi; nuovi: ritorno alla lista con la conferma, ricerca e gruppi solo da sei account, data e ora senza campi del browser, telefono con la tastiera (riga mai coperta); misure; confronti `08`–`10`, `12`.

**Se supera 400 righe di codice:** due PR, (1) Dove, Quando e colonna destra; (2) telefono e ritorno dopo «Programma».

## Task R8 · Utenti, Impostazioni e accesso

**PR 1 · Utenti e Impostazioni** (`21`–`26`)
- Utenti (`21`): colonne Persona · Ruolo · Clienti (su quali lavora) · Ultimo accesso; lo stato solo se c'è un problema («Senza secondo fattore»); «Invita» con contorno nella riga degli strumenti; `22` finestra al computer, foglio sul telefono.
- **Impostazioni in un solo posto** (`SettingsShell.vue`): menu a sinistra con «Il tuo account» (Profilo e preferenze, Sicurezza, Dispositivi, Privacy) e l'agenzia (Generali, Integrazioni, Registro attività); sul telefono il menu diventa una tendina. Le pagine di `/account/*` e `/[org]/impostazioni/*` usano lo stesso guscio; Registro e Privacy dell'agenzia entrano qui, con un rinvio dagli indirizzi vecchi. Righe `SettingsRow` dentro una superficie per gruppo, niente nome ed email sotto il titolo.
- Test: `settings.spec.ts`, `security.spec.ts`, `profile.spec.ts`, `passkey.spec.ts`, `meta-integration.spec.ts`, `privacy.spec.ts`, `agency.spec.ts` verdi; rinvii degli indirizzi vecchi; misure; confronti `21`–`26`.

**PR 2 · Accesso** (`01`, versione corretta: logo grande al centro, «Accedi» centrato)
- `layouts/auth.vue` e `pages/accedi/*`: passkey per prima, poi email e password, come `?p=accedi`. Le altre pagine fuori dal pannello (password dimenticata, secondo fattore, verifica, reimposta, attiva, conferma email, account eliminato, `agenzie`, errore) prendono la stessa grammatica, senza schermata propria: si mostrano a Matteo.
- Test: `login.spec.ts`, `passkey-localhost.spec.ts`, `first-setup.spec.ts`, `error-page.spec.ts` verdi; confronto `01`.

## Task R9 · Tema scuro, palette e stati

**Obiettivo:** quello che le schermate non mostrano, rifinito e visto da Matteo.

**Cosa fa:** passa ogni pagina in scuro e nelle quattro palette e corregge quello che non regge (contrasto, carbone delle selezioni che nello scuro diventa chiaro, fondi, immagini con il contorno); toglie gli alias dello stile unione; controlla vuoto, caricamento ed errore di ogni pagina e li rende coerenti; prova tastiera e zoom al 200% su Oggi, Clienti, editor e Libreria.

**Test:** `palette.spec.ts` e `logo.spec.ts` aggiornati; axe nei quattro progetti su tutte le pagine; contrasto di ogni palette in `contrast.test.ts`.

**Fine:** una tavola per Matteo con ogni pagina principale in scuro e una per palette, più gli stati, in `/mnt/project-files/design-revisione/ridisegno/scuro-e-stati/`.

## Revisione di fedeltà (thread separato)

Come la revisione di fine tappa (istruzioni del progetto): thread sul modello più capace con effort alto, nessuna modifica al codice. Rigira `design:shots` su tutte le schermate, confronta ogni coppia con il riferimento e con la revisione del 19/11, controlla codice, test, accessibilità e comportamento rimasto, e scrive `/mnt/project-files/handoff/ridisegno/REVISIONE-fedelta.md` per Matteo: ogni differenza con la schermata accanto, pro e contro delle correzioni possibili.

## Task R10 · Correzioni della revisione, `DESIGN.md`, rilascio e guida della prova

- Le correzioni che Matteo sceglie dalla revisione.
- `DESIGN.md`: le scelte nuove al posto di quelle sostituite (tabella «Scelte già prese che il ridisegno cambia»), la sezione «Struttura delle pagine» con le misure nuove; `design/reviews/2026-11-19-nuova-direzione.md` segnata «fatta nel codice».
- Rilascio **0.12.1** (D-83, decisa da Matteo il 19/11) e guida della prova completa per Matteo (VPS: prerequisiti, aggiornamento, controlli; poi ogni pagina da telefono e computer), in `/mnt/project-files/handoff/ridisegno/GUIDA-prova-<versione>.md`.
- `docs/decisioni-aperte.md`: chiude D-81, D-83, D-84, D-85 per quello che è fatto.

## Fuori dal ridisegno

- Calendario e duplicazione (tappa 9), esiti, «Riprova» del post, pagina del post uscito, «Pubblica subito» e i difetti D-80 punti 1, 2, 3, 5 e 6 (tappa 7), notifiche e campanella (tappa 8).
- La landing: si rivede dopo, sulla stessa grammatica (con `taste-skill` ed eventualmente GSAP), in un piano suo.
- Nuove funzioni non disegnate: nessuna. Se un thread ne trova bisogno, la scrive in `docs/decisioni-aperte.md` invece di farla.
