# Anteprima dell'editor: revisione e riquadro senza telefono

18 novembre 2026, tappa 6, Task 6 (PR della copertina e del ritaglio). Richiesta di Matteo: «revisiona correttamente anche le guide di sicurezza» (le zone coperte) e «non un telefono ma un rettangolo squadrato con l'interfaccia del social». Grafica accettata da Matteo sulle schermate, prima del commit.

## Come si è controllato

- Codice: `components/post/preview/` (`PostPreview`, `Frame`, `InstagramFeed`, `FacebookPost`, `VerticalPost`, `PreviewMedia`, `PreviewCaption`), `CropBox.vue`, `CoverPicker.vue`, `utils/post-preview.ts`.
- Rilevatore Impeccable (`impeccable detect`) sugli stessi file: nessuna segnalazione.
- Browser: foto vere (dalla landing) e un video 9:16 di 18 s, le sei schede a 1440×1000 in chiaro e in scuro, e a tutto schermo da telefono; prove e2e dell'anteprima nei quattro progetti Playwright.

## Problemi trovati

| Priorità | Dove | Cosa succedeva | Correzione |
|---|---|---|---|
| Alta | Colonna dell'anteprima, reel e storie | A 1440×1000 il telefono era più alto della colonna: nome, testo e pulsanti del reel finivano sotto la barra «Salva bozza / Programma». | Riquadro 9:16 largo al massimo `(100dvh − 20rem) · 9/16`: sta sempre sopra la barra. Prova e2e sul rapporto e sulla posizione. |
| Alta | Zone coperte | Le percentuali erano calcolate sullo schermo del telefono (circa 9:18,5), non sul 9:16 del video su cui Meta le dà; il velo copriva anche i nomi e i pulsanti dell'app, che non si leggevano. | Riquadro 9:16 esatto; zone sotto l'interfaccia. Valori rivisti (D-75): reel 14% in alto, 35% in basso, 6% per lato; storie 14% in alto e in basso. |
| Media | Feed di Instagram | La data sotto il testo finiva sotto l'angolo arrotondato del telefono. | Niente angoli arrotondati: il riquadro ha bordo da 1 px. |
| Media | Carosello del feed | «Sposta prima/dopo» stavano dentro l'interfaccia di Instagram, come se fossero sue. | Spostati sotto il riquadro, pulsanti del pannello da 44 px; la posizione del carosello è condivisa. Prova e2e. |
| Rifinitura | Reel | «♫» come icona dell'audio. | Icona `i-lucide-music`. |

## Resta

- Le zone coperte e i tagli del testo non sono misurati sulle app vere (D-75): si verificano alla tappa 7 con un post pubblicato davvero. I valori vengono da guide terze che citano la guida di Meta per i formati verticali.
- Nel feed di Instagram il testo chiuso può occupare più di due righe a video (il taglio conta le righe del testo, non quelle mostrate). Rientra in D-75.
- Zoom al 200% e tastiera sull'anteprima non provati in questo giro, se non dalle prove e2e esistenti (pulsanti e interruttore raggiungibili, axe senza violazioni).
- La tela Pencil (tavola E4) mostra ancora il telefono: la riallinea il thread della tela.

## Schermate

`schermate/tappa-6/anteprime/` nella cartella del progetto: `pagina-*` (pagina intera a 1440×1000), `colonna-*` (solo l'anteprima), `telefono-*` (anteprima a tutto schermo), anche `-scuro`.
