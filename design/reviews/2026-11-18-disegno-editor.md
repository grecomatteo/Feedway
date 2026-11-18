# Disegno dell'editor dei post · revisione (18 novembre 2026)

Tappa 6, Task 2. Disegno in Pencil dell'editor, dell'anteprima e del ritaglio, approvato da Matteo il 18/11. Scelte e domande in `DESIGN.md` «Editor dei post (tappa 6, Task 2) · da approvare»; domande anche in `docs/decisioni-aperte.md` D-68.

## Fonti lette

- Piano `docs/superpowers/plans/2026-10-15-06-post.md`: «Aggiornamenti rispetto alla specifica» (P1–P8), «Scelte di questa tappa» (1–11), Task 2, Task 6 e Task 7.
- Brief `design/brief-feedway/03-BRIEF-APP.md`: §2, F02, F04, F05, §5.
- Specifica: §9.1, §11.2, §11.3, §11.5.
- `DESIGN.md` di main e «Struttura delle pagine» (D-63) del ramo `fix/06-ritocchi-pannello`.
- Testi degli avvisi e dei blocchi da `apps/web/i18n/locales/it.json` (`rules.*`) e opzioni da `packages/domain/src/platforms/meta/rules/instagram.ts`: le spiegazioni sulla tela sono quelle del codice, con i valori dell'esempio.

## Tavole

Sezione «Editor dei post · tappa 6 · approvata (18/11)» della tela, PNG a scala 1× in `design/tavole/2026-11-18-editor/`.

| Tavola | Cosa mostra |
|---|---|
| E0 | Componenti nuovi: cornici dell'anteprima (IG feed, Reel, Storia, FB post), con le zone coperte già pronte da accendere |
| E1 | Nuovo post a 1440: carosello di 3 foto su 3 account, testo diverso per piattaforma, 1 avviso da scegliere, «Programma» spento con il motivo |
| E1b, E1c, E3d | «Pubblica subito» (tappa 7): editor a 1440 con il segmento attivo, conferma «Pubblicare adesso?», telefono |
| E2 | Nuovo post a 1280: editor 600, anteprima 320 sempre presente (scelta di Matteo, 18/11), testo comune con i contatori di entrambe le piattaforme |
| E3, E3b, E3c | Telefono 390: pagina intera, anteprima a tutta pagina, tastiera aperta con la barra sopra |
| E4 | Le sei schede dell'anteprima, i controlli sopra la cornice, le zone coperte e la copertina in 9:16 e nella griglia 3:4 |
| E5a–E5e | Ritaglio di una foto più alta (4:5), di una più larga (1,91:1), della copertina (9:16), con il dito sul telefono; copertina del reel e video non verticale senza riquadro |
| E6a–E6k | Stati: bozza vuota da «Tutti i clienti», file in caricamento, file non riuscito, blocchi, tutto pronto, avvisi da scegliere, Editor, conflitto di versione, salvataggio non riuscito, programmato in modifica, annullato |
| E7, E7b | Scheda «Post» del cliente, computer e telefono |
| E8, E8c | Impostazioni dei contenuti del cliente (orario, etichette, modelli, gruppi); «Inserisci» e «Gruppi» aperti nell'editor |
| E9, E9b | Editor a 1440 e anteprima da telefono nel tema scuro (istanze delle tavole chiare) |

## Osservazioni sulla tela

- **Regole D-63 rispettate:** margine 32 e 32 sopra il titolo, 24 dalla testata al contenuto, 40 tra le sezioni (32 sul telefono), 16 dentro una sezione; pagina a tutta larghezza accanto alla barra da 256; nomi dei file su due righe. Le variabili nuove sono sulla tela e nel Leggimi.
- **Brief rispettato:** pagina dedicata, editor 600–720 e anteprima 320–380, account come righe con nome, handle, icona e stato (mai solo al passaggio del mouse), «Seleziona tutti» solo del cliente, «Programma su 3 account» esplicito, fuso sempre accanto all'ora, «Salvata» solo dopo il server, Editor senza un falso «Programma», nessuna schermata tutta verde con una destinazione bloccata.
- **Colore:** arancio solo per l'azione principale, la scheda attiva e l'anello di focus del riquadro; ambra per gli avvisi, cremisi per blocchi ed errori, blu per «Programmato», verde solo sul pallino di «Pronto» e sulla nuvola del salvataggio. Nessun testo arancio su fondo chiaro.
- **Componenti riusati:** Pulsante (Principale, Contorno, Testo), Campo (Ricerca, Tendina), Filtro / Scanalatura, Identità / Avatar, Stato / Pallino, Navigazione (Barra laterale, Telefono), Testata del cliente. Il filtro a quattro voci della scheda «Post» è un frame a parte, perché il componente ha tre segmenti: se lo approvi, conviene dare al componente un numero di voci variabile.
- **Pencil:** Sora a 600 invece di 650 e Inter al posto di `system-ui`, come nel resto della tela. Le tavole lunghe (E1, E2, E3, E9) mostrano la pagina intera con la barra delle azioni in fondo: nel browser la barra resta fissa in fondo alla finestra.

## Cose da verificare nel browser (Task 5 e 6)

- La barra delle azioni sopra la tastiera sul telefono (`visualViewport`), senza coprire il campo con il fuoco.
- Il riquadro del ritaglio con mouse, tocco e tastiera; il fuoco torna su «Ritaglia a 4:5» alla chiusura; axe sulla finestra.
- Le zone coperte di reel e storie confrontate con l'interfaccia di oggi su un telefono vero (F04: non sono costanti da copiare); la griglia 3:4 resta un'approssimazione (D-62).
- Contrasto del pulsante «Programma» spento (metà opacità): è spento, quindi fuori da WCAG 1.4.3, ma l'etichetta accanto dice sempre cosa manca.
- 200% di zoom e 320 px di larghezza: le schede dell'anteprima e il filtro a quattro voci devono andare a capo o scorrere, non tagliarsi.

## Fuori da questo disegno

- P1: «Prossima fascia libera» resta della tappa 9. «Pubblica subito» invece è disegnato (richiesta di Matteo del 18/11): selettore «Pubblica subito» · «Programma» in cima a «Quando», tavole E1b, E1c ed E3d; nella 0.12 il segmento è spento con «Presto» e si accende con la tappa 7. Solo per chi ha `post.publish`; il post aspetta da solo la fine della conversione.
- Il trascinamento di un file sull'anteprima e il riordino dall'anteprima (§11.2 punto 3) sono comportamenti: non hanno una tavola, si provano nel Task 6.
- Un post annullato ha solo «Elimina post», come nel piano; «Duplica come bozza» non è previsto e andrebbe chiesto a parte.

## Esito

Matteo ha approvato tutto il disegno il 18 novembre 2026, con le risposte alle cinque domande («Foto»; riepilogo in fondo; anteprima sempre presente; «Tutti» nel filtro della scheda «Post»; scheda «Impostazioni dei contenuti») e con «Pubblica subito» (E1b, E1c, E3d). Le tavole sono `[Approvata · da costruire]`; il Task 5 parte da E1–E3 ed E6, il Task 6 da E4 ed E5, il Task 7 da E8.
