# ADR 023 · Animazioni della landing con GSAP e three.js

| | |
|---|---|
| **Stato** | Proposta |
| **Data** | 2026-11-23 |
| **Specifica** | §14.5 |

## Contesto
Il 23/11 Matteo ha scelto la landing con la prima schermata in 3D: un post che si apre nelle sue quattro destinazioni (feed e storia di Instagram, feed e storia di Facebook), guidato dallo scorrimento. Ha scelto anche le animazioni della versione rivista: gli strumenti sparsi che entrano nel pannello, la linea della pubblicazione che si riempie e il telefono del cliente che si raddrizza. Le prove stanno in `design/esplorazioni/2026-11-23-landing-varianti/`. Con CSS e JavaScript senza librerie servirebbero un motore 3D e un sistema di animazioni legate allo scorrimento scritti a mano.

Il sito ha una politica dei contenuti che non permette script di altri siti (ADR 013, `scripts/postgenerate.mjs`). Non usa cookie e non fa richieste ad altri host, e lo controlla un test.

## Decisione
- **`three` 0.187.0** (licenza MIT) disegna la scena della prima schermata: quattro piani con le immagini preparate in un `canvas` e nessun modello esterno.
- **`gsap` 3.15.1** con **ScrollTrigger** (licenza «Standard no charge» di GSAP: gratuita anche per uso commerciale, compresi i plugin) lega le animazioni allo scorrimento. SplitText e gli altri plugin non si usano.
- Le due librerie sono dipendenze di `apps/site` e le impacchetta Nuxt: si servono da `/_nuxt/` come il resto del sito, senza CDN. La politica dei contenuti non cambia.
- Si caricano **solo sulla pagina iniziale**, con un `import()` dopo il primo disegno. Il testo e le immagini ci sono già nell'HTML generato: senza JavaScript, o se le librerie non arrivano, la pagina è completa.
- Con **«riduci movimento»** del sistema non parte nessuna animazione: le sezioni si vedono nello stato finale e la scena 3D è ferma. Senza WebGL, al posto della scena c'è un'immagine.
- Le animazioni muovono solo `transform` e `opacity`. La scena si ferma quando esce dallo schermo.

## Alternative scartate
- **Solo CSS** (animazioni legate allo scorrimento con `animation-timeline`): Safari non le supporta ancora tutte, e la scena 3D con le carte che si aprono non si fa con CSS senza perdere la prospettiva vera.
- **Motion One o Lenis**: coprono solo una parte (animazioni o scorrimento), e ScrollTrigger serve comunque per fissare la prima schermata mentre si scorre.
- **Un video al posto della scena 3D:** più pesante da scaricare, non segue lo scorrimento e non si adatta alla larghezza dello schermo.
- **Librerie da CDN:** vietate dalla politica dei contenuti e dal test «nessun altro host».

## Conseguenze
- La pagina iniziale scarica circa 175 KB in più compressi (three.js circa 130, GSAP con ScrollTrigger circa 45), solo dopo il primo disegno. Le altre pagine non cambiano.
- Due dipendenze in più da aggiornare con Renovate. La licenza di GSAP non è una licenza open source approvata dall'OSI: se un giorno non fosse più gratuita, la versione fissata resta usabile con le condizioni con cui è stata presa.
- I test del sito girano con «riduci movimento» e controllano che la pagina funzioni anche senza JavaScript.
