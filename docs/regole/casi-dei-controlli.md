# Casi dei controlli prima di programmare

> Documento generato da `pnpm rules:table` (tappa 5, Task 2): non modificarlo a mano. Ogni riga è un caso dei test (`packages/domain/src/rules/cases.ts`), con gli esiti veri del motore e i messaggi esatti che il pannello mostrerà (`apps/web/i18n/locales/it.json`, sezione `rules`). Se cambia un caso, un limite o un testo, `apps/web/tests/rules-table.test.ts` fallisce finché il documento non si rigenera.

Livelli: **Blocco** (il post non si può programmare finché non si sistema), **Avviso** (serve una scelta), **Correzione** (Feedway la fa da solo e la dice).

## Limiti di Meta

Letti sulla documentazione pubblica di Meta; nessuno è ancora provato su un account vero (tappa 7).

| Limite | Valore | Fonte | Controllato il | Verificato su Meta |
|---|---|---|---|---|
| Caption di Instagram | 2.200 caratteri | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «Maximum 2200 characters, 30 hashtags, and 20 @ tags». Come si contano i caratteri: D-46. | 2026-11-17 | non verificato |
| Hashtag nella caption di Instagram | 30 | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) | 2026-11-17 | non verificato |
| Menzioni nella caption di Instagram | 20 | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) | 2026-11-17 | non verificato |
| Elementi minimi di un carosello | 2 | Specifica §9.1: la documentazione non dice un minimo | 2026-11-17 | non verificato |
| Elementi massimi di un carosello di Instagram | 10 | Instagram Platform, «Content Publishing» (developers.facebook.com/docs/instagram-platform/content-publishing): «Carousels are limited to 10 images, videos, or a mix of the two». «IG User Media» dice invece fino a 20: resta 10, come in Meta Business Suite (D-51, deciso). | 2026-11-17 | non verificato |
| Peso di una foto per Instagram | 8 MB | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «8 MB maximum», letto in megabyte decimali | 2026-11-17 | non verificato |
| Proporzioni minime di una foto del feed di Instagram (4:5) | 0,8 | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «within a 4:5 to 1.91:1 range» | 2026-11-17 | non verificato |
| Proporzioni massime di una foto del feed di Instagram (1,91:1) | 1,91 | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) | 2026-11-17 | non verificato |
| Larghezza di una foto per Instagram | 1.440 px | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): oltre 1440 px Instagram la riduce (PHOTO_MAX_WIDTH in media/check-file.ts) | 2026-11-17 | non verificato |
| Durata minima di un reel | 3 s | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) («3 seconds minimum») e Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing) («3 to 90 seconds») | 2026-11-17 | non verificato |
| Durata massima di un reel di Instagram | 15 min | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «15 minutes maximum» | 2026-11-17 | non verificato |
| Durata massima di un reel di Facebook | 90 s | Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing): «3 to 90 seconds» | 2026-11-17 | non verificato |
| Lato corto minimo di un reel di Facebook | 540 px | Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing): «Minimum is 540 x 960 pixels» | 2026-11-17 | non verificato |
| Lato lungo minimo di un reel di Facebook | 960 px | Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing) | 2026-11-17 | non verificato |
| Reel di Facebook pubblicati con l’API in 24 ore, per Pagina | 30 | Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing): «limited to 30 API-published posts within a 24-hour moving period» | 2026-11-17 | non verificato |
| Durata minima di una storia video | 3 s | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) («3 seconds minimum») e Video API, «Page Stories API» (developers.facebook.com/documentation/video-api/page-stories-api) («3 to 90 seconds») | 2026-11-17 | non verificato |
| Durata massima di una storia video | 60 s | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) («60 seconds maximum») e Video API, «Page Stories API» (developers.facebook.com/documentation/video-api/page-stories-api) («A video story can not exceed 60 seconds»). La stessa pagina di Facebook dice anche «3 to 90 seconds»: vale il limite più basso. | 2026-11-17 | non verificato |
| Peso di una storia video | 100 MB | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «100 MB maximum» | 2026-11-17 | non verificato |
| Peso della copertina di un reel | 8 MB | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) (cover_url): JPEG, «8 MB maximum», sRGB, 9:16 consigliato | 2026-11-17 | non verificato |
| Fotogrammi al secondo minimi di un video | 23 fps | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «23-60 FPS»; Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing): «24 to 60» (il controllo dei file usa 23) | 2026-11-17 | non verificato |
| Fotogrammi al secondo massimi di un video | 60 fps | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media), Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing) (REEL_MAX_FPS in media/reel.ts) | 2026-11-17 | non verificato |
| Lato lungo della copia per le Reels | 1.920 px | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «1920 columns maximum» (REEL_MAX_LONG_SIDE in media/reel.ts, D-40) | 2026-11-17 | non verificato |
| Lato corto della copia per le Reels | 1.080 px | Video API, «Reels Publishing API» (developers.facebook.com/documentation/video-api/guides/reels-publishing): 1080 × 1920 consigliato (REEL_MAX_SHORT_SIDE in media/reel.ts, D-40) | 2026-11-17 | non verificato |
| Bitrate massimo di un reel | 25 Mbit/s | Instagram Graph API, «IG User Media» (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media): «VBR, 25 Mbps maximum» (REEL_MAX_BITRATE in media/reel.ts, D-40) | 2026-11-17 | non verificato |
| Post rimasti nella quota di Instagram sotto cui Feedway avvisa | 5 | Specifica §9.2; la quota è letta da Meta (Instagram Platform, «Content Publishing» (developers.facebook.com/docs/instagram-platform/content-publishing): 100 post in 24 ore, 50 nella sezione dei caroselli) | 2026-11-17 | non verificato |
| Caption di Facebook | 63.206 caratteri | Non scritto nella documentazione per sviluppatori: il valore noto dei post delle Pagine (D-47) | 2026-11-17 | non verificato |
| Foto di un post multi-foto di Facebook | 10 | Non scritto nella documentazione: come il carosello di Instagram (D-48) | 2026-11-17 | non verificato |
| Peso di una foto per Facebook | 4 MB | Specifica §9.2; Graph API, «Album Photos» (developers.facebook.com/docs/graph-api/reference/album/photos) dice «less than 10MB». Vale solo per la copia di Facebook: la copia di Instagram resta com’è fino a 8 MB (D-51, «prima Instagram»). | 2026-11-17 | non verificato |

## Cosa diventa ogni tipo di post

| Tipo | File | Instagram | Facebook | Avviso |
|---|---|---|---|---|
| Post con una foto | — | Post con foto | Post con foto | — |
| Carosello | solo foto | Carosello | Post con più foto | — |
| Carosello | foto e video | Carosello | Post con più foto | Foto e video insieme non vanno su Facebook |
| Reel | 3–90 s | Reel | Reel | — |
| Reel | 90 s–15 min | Reel | Reel | Reel troppo lungo per Facebook |
| Storia | foto | Storia con foto | Storia con foto | — |
| Storia | video | Storia con video | Storia con video | — |

## File

| Caso | Esiti e messaggi | Scelte |
|---|---|---|
| File non riuscito (oltre i limiti di caricamento) | **Blocco**: **File non riuscito**. Il file pesa troppo. Toglilo dal post, oppure caricalo di nuovo. | — |
| File che non è una foto né un video (tipo letto dai byte, non dal nome) | **Blocco**: **File non riuscito**. Tipo di file non ammesso: carica foto JPEG, PNG, HEIC, WEBP o video MP4 e MOV. Toglilo dal post, oppure caricalo di nuovo. | — |
| Foto oltre 50 megapixel | **Blocco**: **File non riuscito**. La foto ha troppi pixel. Toglilo dal post, oppure caricalo di nuovo. | — |
| Video oltre 300 MB | **Blocco**: **File non riuscito**. Il file pesa troppo. Toglilo dal post, oppure caricalo di nuovo. | — |
| Video oltre la durata massima di caricamento | **Blocco**: **File non riuscito**. Il video è troppo lungo. Toglilo dal post, oppure caricalo di nuovo. | — |
| File rovinato, che non si legge | **Blocco**: **File non riuscito**. Il file non si legge: forse è rovinato. Toglilo dal post, oppure caricalo di nuovo. | — |
| Video 4K a 60 fps la cui preparazione è durata troppo | **Blocco**: **File non riuscito**. La preparazione ha richiesto troppo tempo. Se è un video in 4K o a 60 fps, esportalo in 1080p o a 30 fps e caricalo di nuovo. Toglilo dal post, oppure caricalo di nuovo. | — |
| Spazio del cliente pieno durante la preparazione | **Blocco**: **File non riuscito**. Lo spazio del cliente o dell'agenzia è pieno. Toglilo dal post, oppure caricalo di nuovo. | — |
| Preparazione non riuscita dopo vari tentativi | **Blocco**: **File non riuscito**. La preparazione non è riuscita dopo vari tentativi. Toglilo dal post, oppure caricalo di nuovo. | — |
| File ancora in elaborazione | **Blocco**: **File ancora in preparazione**. Feedway sta ancora preparando questo file. Quando nella libreria è «Pronto», controlla di nuovo. | — |
| File eliminato dalla libreria | **Blocco**: **File non disponibile**. Questo file non è nella libreria di questo cliente, oppure è stato eliminato. Toglilo dal post o scegline un altro. | — |
| Foto HEIC con profilo colore non sRGB, metadati e 6000 px di larghezza | **Correzione**: **Foto convertita in JPEG**. La foto viene convertita in JPEG, il formato che Instagram e Facebook accettano.<br>**Correzione**: **Colori convertiti**. I colori della foto vengono convertiti nel profilo standard (sRGB), così appaiono uguali su ogni telefono.<br>**Correzione**: **Dati nascosti tolti**. Dalla foto vengono tolti i dati nascosti, come il luogo dello scatto.<br>**Correzione**: **Foto ridimensionata**. La foto viene ridotta a 1440 pixel di larghezza, la misura più grande che serve. | — |
| Foto di 9 MB su Instagram e Facebook | **Correzione** · Instagram: **Foto alleggerita per Instagram**. La foto pesa più di 8 MB, il massimo che Instagram accetta: per Instagram esce una copia alleggerita.<br>**Correzione** · Facebook: **Foto alleggerita per Facebook**. La foto pesa più di 4 MB, il massimo che Facebook accetta: per Facebook esce una copia alleggerita. | — |
| Foto di 5 MB solo su Instagram: la ricompressione per Facebook non si dice | Nessun esito: si può programmare. | — |
| Video in VP9 a 120 fps, con i dati non all’inizio del file | **Correzione**: **Video sistemato per partire subito**. Il video viene sistemato perché parta subito, senza aspettare che sia scaricato tutto.<br>**Avviso**: **Video da convertire**. Il video è in un formato che Instagram e Facebook potrebbero rifiutare. Feedway può convertirlo, oppure puoi provarlo così com'è.<br>**Avviso**: **Fotogrammi da convertire**. Il video ha un numero di fotogrammi al secondo che Instagram e Facebook non accettano. Feedway può convertirlo a 30 fotogrammi al secondo, oppure puoi provarlo così com'è. | Converti (consigliata) · Usa così<br>Converti (consigliata) · Usa così |
| Video 4K a 25 Mbit/s con audio a 44,1 kHz mono per un reel | **Correzione**: **Video convertito nei limiti di Instagram e Facebook**. Il video supera i limiti di Instagram e Facebook: la copia da pubblicare viene convertita a 1080 pixel di larghezza. | — |
| Video di un reel con l’audio a 44,1 kHz mono e il video già nei limiti | **Correzione**: **Audio convertito nei limiti di Instagram e Facebook**. L'audio del video viene convertito nel formato che Instagram e Facebook accettano; le immagini restano come sono. | — |

## Proporzioni e durata

| Caso | Esiti e messaggi | Scelte |
|---|---|---|
| Foto verticale 9:16 nel feed di Instagram (fuori da 4:5–1,91:1) | **Avviso** · Instagram: **Foto troppo alta o troppo larga per il feed**. Nel feed di Instagram una foto va dalla verticale 4:5 all'orizzontale 1,91:1, e questa è 1080×1920. Scegli se ritagliarla al centro o aggiungere delle bande. | Ritaglia al centro (consigliata) · Aggiungi le bande |
| Foto esattamente 4:5 e 1,91:1: nessun avviso | Nessun esito: si può programmare. | — |
| Carosello con una foto 4:5 e una quadrata | **Avviso** · Instagram: **File di forme diverse nel carosello**. Instagram taglia tutti i file del carosello sulla forma del primo: le parti che escono non si vedranno. | Va bene (consigliata) |
| Reel quadrato | **Avviso**: **Video non verticale per un reel**. Un reel è verticale (9:16), e questo video è 1080×1080. Puoi pubblicarlo così, con delle bande o ritagliato al centro. | Usa così (consigliata) · Aggiungi le bande · Ritaglia al centro |
| Reel di 2,9 secondi | **Blocco**: **Video troppo corto per un reel**. Un reel dura almeno 3 secondi, e questo video ne dura 2,9. Scegli un video più lungo. | — |
| Reel di 2,96 secondi: il testo dice 2,9, non 3 | **Blocco**: **Video troppo corto per un reel**. Un reel dura almeno 3 secondi, e questo video ne dura 2,9. Scegli un video più lungo. | — |
| Reel di esattamente 3 secondi | Nessun esito: si può programmare. | — |
| Reel di esattamente 15 minuti, solo su Instagram | Nessun esito: si può programmare. | — |
| Reel di 15 minuti e 1 secondo | **Blocco**: **Video troppo lungo per un reel**. Un reel dura al massimo 15 minuti, e questo video è più lungo (901 secondi). Taglialo, o scegli un altro video. | — |
| Reel di esattamente 90 secondi con Facebook | Nessun esito: si può programmare. | — |
| Reel di 91 secondi con Facebook | **Avviso** · Facebook: **Reel troppo lungo per Facebook**. Su Facebook un reel dura al massimo 90 secondi, e questo ne dura 91. Puoi pubblicarlo su Facebook come video normale, o non pubblicarlo su Facebook. | Come video normale su Facebook (consigliata) · Non pubblicare su Facebook |
| Storia video di 2,9 secondi | **Blocco**: **Video troppo corto per una storia**. Un video nelle storie dura almeno 3 secondi, e questo ne dura 2,9. Scegli un video più lungo, o una foto. | — |
| Storia video di esattamente 3 secondi | Nessun esito: si può programmare. | — |
| Storia video di 61 secondi | **Avviso**: **Video troppo lungo per una storia**. Una storia dura al massimo 60 secondi, e questo video ne dura 61. Feedway può tagliarlo ai primi 60 secondi. | Taglia ai primi 60 secondi (consigliata) |
| Storia video di 30 secondi e 120 MB | **Correzione**: **Video alleggerito per la storia**. Il video pesa più di 100 MB, il massimo di una storia: esce una copia alleggerita. | — |
| Reel 480×854 con Facebook (sotto 540×960) | **Avviso** · Facebook: **Video piccolo per un reel di Facebook**. Facebook chiede almeno 540×960 pixel per un reel, e questo video è 480×854. Puoi provarlo così, o non pubblicarlo su Facebook. | Usa così (consigliata) · Non pubblicare su Facebook |
| Copertina del reel quadrata, solo Instagram | **Avviso** · Instagram: **Copertina non verticale**. La copertina di un reel è verticale (9:16), e questa foto è 1080×1080. Puoi ritagliarla al centro o usarla così. | Ritaglia al centro (consigliata) · Usa così |
| Copertina del reel in PNG 9:16 di 9 MB, solo Instagram | **Correzione** · Instagram: **Copertina convertita**. La copertina viene convertita in JPEG, con i colori standard e un peso entro 8 MB. | — |
| Copertina del reel caricata, ma è un video, solo Instagram | **Blocco**: **La copertina deve essere una foto**. Per la copertina del reel hai scelto un video. Scegli una foto, o un fotogramma del video. | — |
| Fotogramma della copertina all’ultimo istante di un reel di 20 secondi, solo Instagram | Nessun esito: si può programmare. | — |
| Fotogramma della copertina a 25 secondi in un reel di 20, solo Instagram | **Blocco**: **Il fotogramma scelto è oltre la fine del video**. Il fotogramma della copertina è a 25 secondi, e il video ne dura 20. Scegli un fotogramma dentro il video. | — |
| Reel con un fotogramma scelto come copertina, anche su Facebook | **Avviso** · Facebook: **Copertina non ancora provata su Facebook**. Non abbiamo ancora verificato che Facebook usi la copertina scelta per i reel: potrebbe mostrarne un'altra. | Va bene (consigliata) |

## Post

| Caso | Esiti e messaggi | Scelte |
|---|---|---|
| Foto 4:5 su Instagram e Facebook, tutto in regola | Nessun esito: si può programmare. | — |
| Caption di 2.200 caratteri su Instagram | Nessun esito: si può programmare. | — |
| Caption di 2.201 caratteri: blocca Instagram, non Facebook | **Blocco** · Instagram: **Testo troppo lungo per Instagram**. Su Instagram il testo ha al massimo 2.200 caratteri, e questo ne ha 2.201. Accorcialo, o scrivi un testo diverso solo per Instagram. | — |
| Testo solo per Instagram di 2.300 caratteri, testo comune corto | **Blocco** · Instagram: **Testo troppo lungo per Instagram**. Su Instagram il testo ha al massimo 2.200 caratteri, e questo ne ha 2.300. Accorcialo, o scrivi un testo diverso solo per Instagram. | — |
| Testo per Instagram lasciato vuoto: vale il testo comune, e si controlla quello | **Blocco** · Instagram: **Testo troppo lungo per Instagram**. Su Instagram il testo ha al massimo 2.200 caratteri, e questo ne ha 2.201. Accorcialo, o scrivi un testo diverso solo per Instagram. | — |
| Caption con 31 hashtag | **Blocco** · Instagram: **Troppi hashtag per Instagram**. Instagram accetta al massimo 30 hashtag, e qui ce ne sono 31. Togline qualcuno. | — |
| Caption con 30 hashtag | Nessun esito: si può programmare. | — |
| Caption con 21 menzioni | **Blocco** · Instagram: **Troppe menzioni per Instagram**. Instagram accetta al massimo 20 menzioni di altri account, e qui ce ne sono 21. Togline qualcuna. | — |
| Testo solo per Facebook di 63.207 caratteri | **Blocco** · Facebook: **Testo troppo lungo per Facebook**. Su Facebook il testo ha al massimo 63.206 caratteri, e questo ne ha 63.207. Accorcialo, o scrivi un testo diverso solo per Facebook. | — |
| Carosello con una foto sola | **Blocco**: **Carosello con un file solo**. Un carosello ha almeno 2 file e qui ce n'è 1. Aggiungi altri file, o pubblicalo come post con una foto. | — |
| Carosello di 11 foto solo su Instagram | **Blocco** · Instagram: **Troppi file nel carosello**. Un carosello di Instagram ha al massimo 10 file, e qui ce ne sono 11. Togli quelli in più, o dividili in due post. | — |
| Carosello di 10 foto su Instagram e Facebook | Nessun esito: si può programmare. | — |
| Carosello con foto e video, anche su Facebook | **Avviso** · Facebook: **Foto e video insieme non vanno su Facebook**. Su Facebook un post con più file può avere solo foto. Puoi pubblicare su Facebook solo le foto (1), o non pubblicarlo su Facebook. | Solo le foto su Facebook (consigliata) · Non pubblicare su Facebook |
| Carosello con foto e video solo su Instagram | Nessun esito: si può programmare. | — |
| Post di 12 foto solo su Facebook | **Avviso** · Facebook: **Troppe foto per Facebook**. Un post di Facebook ha al massimo 10 foto, e qui ce ne sono 12. Puoi pubblicare su Facebook solo le prime 10, o non pubblicarlo su Facebook. | Solo le prime 10 foto su Facebook (consigliata) · Non pubblicare su Facebook |
| Tipo «foto» con un video | **Blocco**: **I file non vanno bene per «Post con una foto»**. Un post con una foto ha una foto sola, un reel un video solo, una storia un file solo. Cambia i file o il tipo di post. | — |
| Post senza file | **Blocco**: **Nessun file**. Aggiungi almeno una foto o un video. | — |
| Nessun account scelto | **Blocco**: **Nessun account scelto**. Scegli almeno un account su cui pubblicare il post. | — |
| Account di un altro cliente | **Blocco**: **Account non disponibile in questo cliente**. L'account non è collegato a questo cliente, o non esiste più. Toglilo dalle destinazioni o scegline un altro. | — |
| Account che non esiste o di un’altra agenzia: lo stesso esito | **Blocco**: **Account non disponibile in questo cliente**. L'account non è collegato a questo cliente, o non esiste più. Toglilo dalle destinazioni o scegline un altro. | — |
| Account di una piattaforma di cui l’installazione non ha le regole (qui Facebook) | **Blocco**: **Facebook non è ancora gestito**. Feedway non sa ancora pubblicare su Facebook. Togli questo account dalle destinazioni. | — |
| Account Instagram da ricollegare (salute in rosso) | **Blocco**: **Account da sistemare**. L'account ha un problema di collegamento. Finché non è a posto il post non può uscire qui: controllalo in «Account social» o toglilo dalle destinazioni. | — |
| Account Facebook disattivato | **Blocco**: **Account da sistemare**. L'account non risulta più tra quelli collegati a Feedway. Finché non è a posto il post non può uscire qui: controllalo in «Account social» o toglilo dalle destinazioni. | — |
| Data nel passato (ieri alle 18:00) | **Blocco**: **Data già passata**. Il giorno e l'ora scelti sono già passati. Scegli un momento futuro, oppure usa «Pubblica ora». | — |
| Programmato per il minuto in corso (11:00 a Roma alle 11:00:30) | **Blocco**: **Data già passata**. Il giorno e l'ora scelti sono già passati. Scegli un momento futuro, oppure usa «Pubblica ora». | — |
| «Pubblica ora»: la regola della data non vale | Nessun esito: si può programmare. | — |
| Alle 02:30 del 28 marzo 2027, ora che non esiste | **Avviso**: **Ora che quel giorno non esiste**. Quella notte alle 2 gli orologi vanno avanti di un'ora, quindi l'ora scelta non esiste. Il post uscirà alle 03:30 (ora legale). Va bene, oppure scegli un'altra ora. | Va bene (consigliata) |
| Alle 02:30 del 25 ottobre 2026, ora che c’è due volte | **Avviso**: **Ora che quel giorno capita due volte**. Quella notte alle 3 gli orologi tornano indietro di un'ora, quindi l'ora scelta capita due volte. Il post uscirà la prima volta, alle 02:30 (ora legale). Va bene, oppure scegli un'altra ora. | Va bene (consigliata) |
| Quota di Instagram: 96 post su 100 nelle 24 ore | **Avviso** · Instagram: **Pochi post rimasti su Instagram**. A quell'ora questo account potrà pubblicare ancora 4 post dei 100 che Instagram permette in 24 ore. Puoi programmarlo, ma evita di programmarne altri nelle stesse ore. | Va bene (consigliata) |
| Quota di Instagram: 90 usati e 6 già programmati in quelle 24 ore | **Avviso** · Instagram: **Pochi post rimasti su Instagram**. A quell'ora questo account potrà pubblicare ancora 4 post dei 100 che Instagram permette in 24 ore. Puoi programmarlo, ma evita di programmarne altri nelle stesse ore. | Va bene (consigliata) |
| Quota di Instagram esaurita: 100 su 100 | **Blocco** · Instagram: **Post esauriti su Instagram**. A quell'ora questo account ha già usato tutti i 100 post che Instagram permette in 24 ore. Scegli un'ora più tardi. | — |
| Pagina Facebook con già 30 reel nelle 24 ore | **Blocco** · Facebook: **Troppi reel su Facebook**. Una Pagina Facebook pubblica al massimo 30 reel in 24 ore, e a quell'ora questa li ha già raggiunti. Scegli un'ora più tardi. | — |
| Pagina Facebook con 29 reel nelle 24 ore | Nessun esito: si può programmare. | — |
| Storia con una caption | **Avviso**: **Le storie non hanno testo**. Instagram e Facebook non pubblicano il testo nelle storie: quello che hai scritto non uscirà. Ignoralo, oppure toglilo. | Ignora il testo (consigliata) |
| Storia con una caption di 3.000 caratteri: i caratteri non si contano | **Avviso**: **Le storie non hanno testo**. Instagram e Facebook non pubblicano il testo nelle storie: quello che hai scritto non uscirà. Ignoralo, oppure toglilo. | Ignora il testo (consigliata) |
| Stessa foto e stesso testo sulla stessa Pagina negli ultimi 7 giorni | **Avviso** · Facebook: **Post uguale a uno recente**. Negli ultimi 7 giorni questo account ha già un post con gli stessi file e lo stesso testo, e Facebook potrebbe rifiutarlo o mostrarlo meno. Va bene, oppure cambia qualcosa. | Va bene (consigliata) |
| Quota di Instagram piena oggi, post fra 3 giorni: quei post non contano più | Nessun esito: si può programmare. | — |
| Carosello di soli video, anche su Facebook | **Avviso** · Facebook: **Un carosello di soli video non va su Facebook**. Facebook non ha post con più video: il carosello può uscire solo sugli altri account. | Non pubblicare su Facebook (consigliata) |
| Carosello con foto e video: «solo le foto» su Facebook<br>Esce: Instagram: Carosello, file 1, 2, 3; Facebook: Post con più foto, file 1, 3. | **Avviso** · Facebook: **Foto e video insieme non vanno su Facebook**. Su Facebook un post con più file può avere solo foto. Puoi pubblicare su Facebook solo le foto (2), o non pubblicarlo su Facebook. | Solo le foto su Facebook (consigliata, scelta nel caso) · Non pubblicare su Facebook |
| Carosello con foto e video: «salta Facebook»<br>Esce: Instagram: Carosello, file 1, 2. | **Avviso** · Facebook: **Foto e video insieme non vanno su Facebook**. Su Facebook un post con più file può avere solo foto. Puoi pubblicare su Facebook solo le foto (1), o non pubblicarlo su Facebook. | Solo le foto su Facebook (consigliata) · Non pubblicare su Facebook (scelta nel caso) |
| Post di 12 foto su Facebook: «solo le prime 10»<br>Esce: Facebook: Post con più foto, file 1, 2, 3, 4, 5, 6, 7, 8, 9, 10. | **Avviso** · Facebook: **Troppe foto per Facebook**. Un post di Facebook ha al massimo 10 foto, e qui ce ne sono 12. Puoi pubblicare su Facebook solo le prime 10, o non pubblicarlo su Facebook. | Solo le prime 10 foto su Facebook (consigliata, scelta nel caso) · Non pubblicare su Facebook |
| Reel di 2 minuti: su Facebook «come video normale»<br>Esce: Instagram: Reel, file 1; Facebook: Video, file 1. | **Avviso** · Facebook: **Reel troppo lungo per Facebook**. Su Facebook un reel dura al massimo 90 secondi, e questo ne dura 120. Puoi pubblicarlo su Facebook come video normale, o non pubblicarlo su Facebook. | Come video normale su Facebook (consigliata, scelta nel caso) · Non pubblicare su Facebook |

## Esiti senza un caso

Con Instagram e Facebook non capitano; il testo è pronto per quando servirà.

| Esito | Perché non c’è un caso | Messaggio (con valori d’esempio) |
|---|---|---|
| `type_not_supported` | Instagram e Facebook hanno tutti e quattro i tipi di post: capita solo con una piattaforma futura che non ne ha uno (provato in `evaluate-post.test.ts` con regole finte). | **Blocco** · Facebook: **Facebook non ha questo tipo di post**. Su Facebook non si può pubblicare «Storia». Togli gli account di Facebook, o cambia il tipo di post. |
