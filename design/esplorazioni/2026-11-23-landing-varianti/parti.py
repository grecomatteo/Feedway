"""Builds a.html, b.html and c.html from shared parts.

Run: python3 parti.py  (from this folder). The variants differ in the hero,
in the product section and in the motion; header, copy and footer are shared.
"""

from pathlib import Path

HERE = Path(__file__).parent

HEAD = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedway · variante {letter}: {name}</title>
<script>document.documentElement.classList.add('js')</script>
<link rel="icon" href="img/favicon.svg">
<link rel="preload" href="img/Sora-Variable.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="comune.css">
<link rel="stylesheet" href="{css}">
</head>
<body class="v-{letter}">
<header class="site-header">
  <div class="wrap bar">
    <a class="logo" href="#" aria-label="Feedway, pagina iniziale"><img src="img/feedway-horizontal-carbone.svg" alt="" width="124" height="36"></a>
    <nav aria-label="Sezioni">
      <a href="#prodotto">Prodotto</a>
      <a href="#pubblicazione">Pubblicazione</a>
      <a href="#cliente">Clienti</a>
      <a href="#domande">Domande</a>
    </nav>
    <div class="actions"><a class="btn btn-primary" href="#demo">Richiedi una demo</a></div>
  </div>
</header>
<main>
"""

FOOT = """
<section class="section closing" id="demo" aria-labelledby="closing-title">
  <div class="wrap">
    <div class="section-head reveal">
      <h2 id="closing-title">Vediamo Feedway con i tuoi clienti.</h2>
      <p class="lead">Mezz'ora in videochiamata: ci racconti come lavorate oggi e ti mostriamo il pannello con i tuoi profili.</p>
      <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
    </div>
  </div>
</section>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>© 2026 Feedway · Questo sito non usa cookie.</span>
    <span><a href="#">Privacy</a><a href="#">Cancellazione dei dati</a><a href="#">Termini</a></span>
  </div>
  <div class="wrap"><img class="giant" src="img/feedway-wordmark-arancio.svg" alt="" width="444" height="128"></div>
</footer>
<nav class="variant-switch" aria-label="Varianti">
  <a href="a.html"{cur_a}>A · 3D</a><a href="b.html"{cur_b}>B · Prospettiva</a><a href="c.html"{cur_c}>C · Editoriale</a>
</nav>
<script src="icone.js"></script>
<script src="vendor/gsap.min.js"></script>
<script src="vendor/ScrollTrigger.min.js"></script>
<script src="vendor/SplitText.min.js"></script>
<script src="comune.js"></script>
{script}
</body>
</html>
"""

HERO_COPY = """
      <h1 id="hero-title">Tutta la tua agenzia, in un solo posto.</h1>
      <p class="lead">Prepari i post di tutti i clienti, li programmi su Instagram e Facebook e sai se sono usciti davvero.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
        <a class="btn btn-outline btn-lg" href="#prodotto">Guarda il prodotto</a>
      </div>
"""

FEATURES = """
<section class="section" id="prodotto" aria-labelledby="product-title">
  <div class="wrap">
    <div class="section-head reveal">
      <h2 id="product-title">Dal piano del mese al post pubblicato.</h2>
    </div>
    <div class="bento">
      <article class="tile tile-wide reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="notebook-pen"></i>Piano editoriale <span class="soon">In arrivo</span></h3>
          <p>Il mese scritto come su un'agenda: il 10 il reel, il 12 il carosello del menu. Con un clic il contenuto diventa un post già compilato.</p>
        </div>
        <div class="window"><img src="img/piano.webp" alt="Il piano editoriale di dicembre per Forno Luce." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="send"></i>Un post, più profili</h3>
          <p>Scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. L'anteprima è quella che vedrà chi segue.</p>
        </div>
        <div class="window"><img src="img/editor.webp" alt="L'editor con un carosello di Forno Luce e l'anteprima del feed." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="images"></i>Libreria per cliente</h3>
          <p>Foto e video in cartelle. Carichi anche uno zip: Feedway prepara le copie giuste e toglie la posizione dalle foto.</p>
        </div>
        <div class="window"><img src="img/libreria.webp" alt="La libreria con le foto dei clienti divise per cartelle." loading="lazy" width="2000" height="1250"></div>
      </article>
      <article class="tile tile-wide reveal tilt">
        <div class="tile-text">
          <h3><i data-icon="calendar-days"></i>Tutti i clienti in un calendario <span class="soon">In arrivo</span></h3>
          <p>Mese, settimana o elenco. Ogni post ha il suo stato, e i contenuti ancora da preparare diventano gialli quando mancano meno di 36 ore.</p>
        </div>
        <div class="window"><img src="img/calendario.webp" alt="Il calendario di novembre con i post di cinque clienti." loading="lazy" width="2000" height="1250"></div>
      </article>
    </div>
    <ul class="mini reveal-list">
      <li><i data-icon="bell"></i><div><strong>Avvisi a chi deve sistemare</strong> <span class="soon">In arrivo</span><p>Nel pannello, per email o su Telegram, con le ore di silenzio.</p></div></li>
      <li><i data-icon="list-checks"></i><div><strong>Attività accanto ai post</strong> <span class="soon">In arrivo</span><p>Shooting, testi, report: con scadenza e persone assegnate.</p></div></li>
      <li><i data-icon="users"></i><div><strong>Ruoli per ogni persona</strong><p>Ognuno vede solo i clienti che segue.</p></div></li>
      <li><i data-icon="lock"></i><div><strong>Dati sotto il tuo controllo</strong><p>Il pannello gira sul tuo server, dietro Tailscale.</p></div></li>
    </ul>
  </div>
</section>
"""

PUBLISH = """
<section class="section carbon" id="pubblicazione" aria-labelledby="publish-title">
  <div class="wrap publish">
    <div class="section-head reveal">
      <h2 id="publish-title">Sai sempre se un post è uscito.</h2>
      <p class="lead">Dopo l'ora programmata Feedway chiede a Meta se il post c'è. Se manca, lo scrive con il motivo e ti dice cosa fare.</p>
    </div>
    <ol class="timeline" aria-label="Il percorso di un post">
      <li><span class="t num">11:58</span><div><strong>Programmato</strong><p>Copie pronte per @fornoluce e la Pagina Forno Luce.</p></div></li>
      <li><span class="t num">12:00</span><div><strong>In pubblicazione</strong><p>Feedway manda il post a Instagram e a Facebook.</p></div></li>
      <li><span class="t num">12:01</span><div><strong>Verifica</strong><p>Chiede a Meta se il post è davvero sul profilo.</p></div></li>
      <li class="done"><span class="t num">12:01</span><div><strong><i data-icon="circle-check"></i>Pubblicato su 2 profili</strong><p>Con il link al post su Instagram e su Facebook.</p></div></li>
    </ol>
  </div>
</section>
"""

CLIENT = """
<section class="section client" id="cliente" aria-labelledby="client-title">
  <div class="wrap client-grid">
    <div class="section-head reveal">
      <h2 id="client-title">Il cliente vede il suo calendario e approva dal telefono.</h2>
      <p class="lead">Basta rincorrere il cliente in chat per sapere se un post va bene. Gli mandi un link e da lì trova tutto quello che esce.</p>
      <ul class="feat">
        <li>Un link, nessun account <span class="soon">In arrivo</span></li>
        <li>«Approva» o «Chiedi una modifica» <span class="soon">In arrivo</span></li>
        <li>Caricamento di foto e video dal cliente <span class="soon">In arrivo</span></li>
      </ul>
    </div>
    <div class="phone-stage">
      <div class="phone"><img src="img/tel-condiviso.webp" alt="Il calendario condiviso con il cliente, aperto sul telefono." loading="lazy" width="780" height="1688"></div>
    </div>
  </div>
</section>
"""

FAQ = """
<section class="section faq" id="domande" aria-labelledby="faq-title">
  <div class="wrap narrow">
    <h2 id="faq-title" class="reveal">Domande frequenti</h2>
    <details class="reveal"><summary>Funziona con TikTok e LinkedIn? <i data-icon="chevron-down"></i></summary><p>Oggi Instagram e Facebook. TikTok e LinkedIn sono previsti dopo.</p></details>
    <details class="reveal"><summary>Il cliente deve registrarsi? <i data-icon="chevron-down"></i></summary><p>No. Riceve un link suo e vede solo il suo calendario.</p></details>
    <details class="reveal"><summary>Dove stanno i dati? <i data-icon="chevron-down"></i></summary><p>Sul server dell'agenzia. Il pannello si apre solo da chi è nella vostra rete Tailscale.</p></details>
  </div>
</section>
"""


PROBLEM = """
<section class="section problem" aria-labelledby="problem-title">
  <div class="wrap problem-grid">
    <div class="problem-copy">
      <h2 id="problem-title">Sei app aperte, nessuna che sappia cosa fanno le altre.</h2>
      <p class="lead">I messaggi dei clienti in chat, i file su Drive, le ore su un foglio, i post su Meta. Il cliente scrive alle 23, il file giusto è in una conversazione di tre settimane fa e nessuno sa se il post di ieri è uscito davvero.</p>
    </div>
    <div class="converge" aria-hidden="true">
      <span class="tool" style="--x:-34%;--y:-38%;--r:-4deg"><i data-icon="message-square"></i>Chat dei clienti</span>
      <span class="tool" style="--x:30%;--y:-42%;--r:3deg"><i data-icon="folder-open"></i>Cartelle dei file</span>
      <span class="tool" style="--x:-42%;--y:-2%;--r:2deg"><i data-icon="sheet"></i>Foglio delle ore</span>
      <span class="tool" style="--x:40%;--y:2%;--r:-3deg"><i data-icon="mail"></i>Email</span>
      <span class="tool" style="--x:-30%;--y:38%;--r:-2deg"><i data-icon="sticky-note"></i>Note sul telefono</span>
      <span class="tool" style="--x:32%;--y:40%;--r:4deg"><i data-icon="send"></i>Un post alla volta su Meta</span>
      <div class="hub">
        <img src="img/feedway-horizontal-carbone.svg" alt="" width="124" height="36">
        <ul>
          <li><i data-icon="check"></i>Clienti e messaggi</li>
          <li><i data-icon="check"></i>File e materiali</li>
          <li><i data-icon="check"></i>Ore e attività</li>
          <li><i data-icon="check"></i>Pubblicazione verificata</li>
        </ul>
      </div>
    </div>
  </div>
</section>
"""

TABS = [
    ('pianifica', 'Pianifica', 'Il mese, scritto come su un\'agenda', "Decidi cosa esce e quando: il 10 il reel, il 12 il carosello del menu. Chi carica i file vede cosa manca e per quando, e con un clic il contenuto diventa un post già compilato.", 'piano', 'Il piano editoriale di dicembre per Forno Luce.',
     [('Piano editoriale', False), ('Calendario di tutti i clienti', False), ('Calendario su Google o Apple', False)]),
    ('produci', 'Produci', 'La libreria di ogni cliente', 'Foto e video in cartelle, con i tag. Carichi anche una cartella intera o uno zip: Feedway prepara le copie giuste e toglie la posizione dalle foto.', 'libreria', 'La libreria con le foto dei clienti divise per cartelle.',
     [('Libreria per cliente, con cartelle e tag', True), ('Shooting con invito e promemoria', False), ('Materiali caricati dal cliente', False)]),
    ('pubblica', 'Pubblica e verifica', "Un post per più profili, con l'anteprima vera", "Scrivi il testo una volta e cambialo per Instagram o Facebook solo se serve. I controlli dicono cosa manca prima di programmare.", 'editor', "L'editor con un carosello di Forno Luce e l'anteprima del feed.",
     [('Feed, caroselli, reel e storie', True), ('Controlli prima di programmare', True), ("Verifica dopo l'uscita", True)]),
    ('coordina', 'Coordina il team', "Le attività dell'agenzia, accanto ai post", 'Lo shooting di giovedì, i testi da scrivere, il report da mandare. Ogni attività ha una scadenza, le persone assegnate e il cliente a cui si riferisce.', 'attivita', "L'elenco delle attività: una in ritardo, tre per oggi.",
     [('Ruoli per cliente', True), ('Attività e to-do', False), ('Note, guide interne e scheda del cliente', False)]),
    ('avvisi', 'Resta avvisato', 'Se qualcosa non va, lo sai subito', 'Un post non uscito o un profilo da ricollegare arrivano a chi deve sistemarli. Scegli tu cosa ricevere e le ore di silenzio; gli errori passano sempre.', 'notifiche', 'Le notifiche: un reel non uscito, una Pagina da ricollegare.',
     [('Nel pannello, per email e su Telegram', False), ('Riepilogo della giornata alle 8', False), ('Notifiche sul telefono', False)]),
    ('misura', 'Misura', 'Il report del mese, pronto da mandare', 'Per ogni cliente i post pubblicati, le persone raggiunte, le interazioni e i post andati meglio. Lo scarichi con il tuo logo.', 'statistiche', 'Le statistiche di novembre per Forno Luce.',
     [('Statistiche per cliente', False), ('Report con il tuo logo', False), ('Orario migliore per pubblicare', False)]),
]


def feat(items):
    return '<ul class="feat">' + ''.join(
        f'<li>{n}{"" if ok else " <span class=\"soon\">In arrivo</span>"}</li>' for n, ok in items) + '</ul>'


def tabs():
    btns = ''.join(
        f'<button type="button" role="tab" id="tab-{i}" aria-controls="pan-{i}" aria-selected="{"true" if k == 0 else "false"}" tabindex="{0 if k == 0 else -1}">{label}</button>'
        for k, (i, label, *_) in enumerate(TABS))
    pans = ''.join(f"""
      <div class="tab-panel" role="tabpanel" id="pan-{i}" aria-labelledby="tab-{i}"{'' if k == 0 else ' hidden'}>
        <div class="tab-copy">
          <h3>{title}</h3>
          <p>{text}</p>
          {feat(items)}
        </div>
        <figure class="shot"><img src="img/{img}.webp" alt="{alt}" {'' if k == 0 else 'loading="lazy" '}width="2000" height="1250"></figure>
      </div>""" for k, (i, label, title, text, img, alt, items) in enumerate(TABS))
    return f'<div class="tabs" role="tablist" aria-label="Cosa fai con Feedway">{btns}</div>{pans}'


PRODUCT_A = f"""
<section class="section peach" id="prodotto" aria-labelledby="product-title">
  <div class="wrap">
    <div class="section-head">
      <h2 id="product-title">Ogni cosa al suo posto. Ogni persona sa cosa fare.</h2>
      <p class="lead">Feedway non serve solo a pubblicare. Tiene insieme il piano, i file, le attività del team e i numeri di ogni cliente.</p>
    </div>
    {tabs()}
  </div>
</section>
"""

TEAM = """
<section class="section" id="team" aria-labelledby="team-title">
  <div class="wrap">
    <div class="section-head">
      <h2 id="team-title">Ognuno vede quello che gli serve. Niente di più.</h2>
    </div>
    <dl class="roles">
      <div><dt>Titolare</dt><dd>«Come stanno i clienti, e cosa non è uscito oggi?»</dd><dd class="where">Tutti i clienti e il team</dd></div>
      <div><dt>Account manager</dt><dd>«Cosa aspetta il cliente da noi, e cosa aspettiamo da lui?»</dd><dd class="where">I clienti che segue</dd></div>
      <div><dt>Social media manager</dt><dd>«Cosa esce oggi, e cosa manca per domani?»</dd><dd class="where">Oggi e il calendario</dd></div>
      <div><dt>Copywriter</dt><dd>«Quali testi devo scrivere, e per quando?»</dd><dd class="where">Le bozze e le sue attività</dd></div>
      <div><dt>Grafico</dt><dd>«Cosa devo produrre, con quali materiali?»</dd><dd class="where">La libreria e le sue attività</dd></div>
      <div><dt>Collaboratore esterno</dt><dd>«Cosa mi tocca, e niente altro.»</dd><dd class="where">Solo il cliente per cui è invitato</dd></div>
    </dl>
  </div>
</section>
"""

CLIENT_A = """
<section class="section client" id="cliente" aria-labelledby="client-title">
  <div class="wrap client-grid">
    <div class="section-head">
      <h2 id="client-title">Il tuo cliente ha il suo spazio. Con il tuo marchio.</h2>
      <p class="lead">Vede il calendario, approva, carica le foto e legge il report del mese. Le vostre conversazioni interne non le vede mai.</p>
      <ul class="checks">
        <li><i data-icon="link"></i>Un link al suo calendario, con password e scadenza <span class="soon">In arrivo</span></li>
        <li><i data-icon="thumbs-up"></i>Approvazioni dal telefono, attivabili per cliente <span class="soon">In arrivo</span></li>
        <li><i data-icon="upload"></i>Materiali caricati dal cliente nella sua libreria <span class="soon">In arrivo</span></li>
      </ul>
    </div>
    <div class="phone-stage">
      <div class="notice"><i data-icon="bell"></i><div><small>Adesso</small>Paola di Orto Vivo ha approvato il carosello del 19 ottobre.</div></div>
      <div class="phone"><img src="img/tel-condiviso.webp" alt="Il calendario condiviso con il cliente, aperto sul telefono." loading="lazy" width="780" height="1688"></div>
    </div>
  </div>
</section>
"""


PUBLISH_A = """
<section class="section carbon" id="pubblicazione" aria-labelledby="publish-title">
  <div class="wrap publish">
    <div class="section-head">
      <h2 id="publish-title">Lo sai quando un post è uscito. Davvero.</h2>
      <p class="lead">Dopo l'ora programmata Feedway chiede a Meta se il post c'è. Se manca, lo scrive con il motivo e ti dice cosa fare. Con «Riprova» pubblica solo dove non è uscito.</p>
      <p class="platforms"><span><i data-icon="instagram"></i>Instagram</span><span><i data-icon="facebook"></i>Facebook</span><span class="later">TikTok <span class="soon">In arrivo</span></span><span class="later">LinkedIn <span class="soon">In arrivo</span></span></p>
    </div>
    <ol class="timeline" aria-label="Il percorso di un post">
      <li><span class="t num">11:58</span><div><strong>Programmato</strong><p>Copie pronte per @fornoluce e la Pagina Forno Luce.</p></div></li>
      <li><span class="t num">12:00</span><div><strong>In pubblicazione</strong><p>Feedway manda il post a Instagram e a Facebook.</p></div></li>
      <li><span class="t num">12:01</span><div><strong>Verifica</strong><p>Chiede a Meta se il post è davvero sul profilo.</p></div></li>
      <li class="done"><span class="t num">12:01</span><div><strong><i data-icon="circle-check"></i>Pubblicato su 2 profili</strong><p>Con il link al post su Instagram e su Facebook.</p></div></li>
    </ol>
  </div>
  <div class="wrap outcomes">
    <article class="outcome">
      <header><strong>Reel, mer 14 ottobre, 18:00</strong><span class="pill bad">4 confermate · 1 con problema</span></header>
      <ul>
        <li><i data-icon="instagram"></i>Forno Luce Centro<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="facebook"></i>Forno Luce Centro<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="instagram"></i>Forno Luce Nord<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="facebook"></i>Forno Luce Nord<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li class="row-bad"><i data-icon="instagram"></i>Forno Luce Lab<span class="st bad"><i data-icon="circle-alert"></i>Con problema</span></li>
      </ul>
      <p>Permesso revocato su Forno Luce Lab. Ricolleghi l'account e riprovi solo lì: le altre quattro destinazioni non ricevono il post due volte.</p>
    </article>
    <article class="outcome">
      <header><strong>Foto, mar 13 ottobre, 18:00</strong><span class="pill warn">4 confermate · 1 da accertare</span></header>
      <ul>
        <li><i data-icon="instagram"></i>Forno Luce Centro<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="facebook"></i>Forno Luce Centro<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="instagram"></i>Forno Luce Nord<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li><i data-icon="facebook"></i>Forno Luce Nord<span class="st ok"><i data-icon="circle-check"></i>Confermato</span></li>
        <li class="row-warn"><i data-icon="instagram"></i>Forno Luce Lab<span class="st warn"><i data-icon="clock"></i>Da accertare</span></li>
      </ul>
      <p>Meta non ha ancora risposto per Forno Luce Lab. Feedway lo scrive come «da accertare» e blocca un nuovo invio finché non è chiaro.</p>
    </article>
  </div>
</section>
"""

COSTS = """
<section class="section" id="numeri" aria-labelledby="costs-title">
  <div class="wrap">
    <div class="section-head">
      <h2 id="costs-title">Sai quanto ti costa ogni cliente. <span class="soon">In arrivo</span></h2>
      <p class="lead">Ore lavorate, contratti, rinnovi e pacchetto del mese per ogni cliente.</p>
    </div>
    <div class="table-wrap">
      <table class="costs">
        <thead><tr><th>Cliente</th><th>Pacchetto di ottobre</th><th>Ore</th><th>Rinnovo</th><th>Stato</th></tr></thead>
        <tbody>
          <tr><th>Forno Luce</th><td class="num">10 di 12 post</td><td class="num">18 h</td><td>31 gennaio</td><td>In regola</td></tr>
          <tr><th>Studio Forma</th><td class="num">6 di 8 post</td><td class="num">9 h</td><td>15 novembre</td><td>Rinnovo vicino</td></tr>
          <tr><th>Orto Vivo</th><td class="num">4 di 8 post</td><td class="num">12 h</td><td>30 marzo</td><td>In ritardo sul pacchetto</td></tr>
        </tbody>
      </table>
    </div>
    <p class="foot-note">Esempio con dati inventati.</p>
  </div>
</section>
"""

START = """
<section class="section sunken" aria-labelledby="start-title">
  <div class="wrap">
    <div class="section-head"><h2 id="start-title">Come si comincia.</h2></div>
    <ol class="start">
      <li><h3>Ci sentiamo per la demo</h3><p>Mezz'ora in videochiamata: ci racconti come lavora l'agenzia e ti mostriamo Feedway.</p></li>
      <li><h3>Prepariamo la tua agenzia</h3><p>Creiamo lo spazio per l'agenzia e i clienti. Tu inviti il team, ognuno con il suo ruolo.</p></li>
      <li><h3>Colleghi i profili</h3><p>Instagram e Facebook dei clienti si collegano da Meta. Il primo collegamento lo facciamo insieme.</p></li>
    </ol>
  </div>
</section>
"""

TRUST = """
<section class="section" aria-labelledby="trust-title">
  <div class="wrap split">
    <h2 id="trust-title">I dati dei tuoi clienti restano tuoi.</h2>
    <ul class="trust">
      <li><i data-icon="plug"></i>Solo le API ufficiali di Meta, senza trucchi per aggirarle</li>
      <li><i data-icon="key-round"></i>Accesso con passkey o con password e secondo fattore</li>
      <li><i data-icon="scroll-text"></i>Ogni azione registrata: chi ha fatto cosa e quando</li>
      <li><i data-icon="shield"></i>Agenzie separate: nessuna vede i clienti delle altre</li>
      <li><i data-icon="lock"></i>Nessuna password dei clienti, e i codici di Meta sono cifrati</li>
    </ul>
  </div>
</section>
"""

FAQ_ITEMS = [
    ('Posso usarlo dal telefono?', "Sì. Feedway è pensato prima per il computer, ma da telefono vedi Oggi, prepari un post, programmi e controlli l'esito."),
    ('Serve una Pagina Facebook?', 'Solo per pubblicare su Facebook. Per Instagram basta un account professionale, anche senza Pagina.'),
    ('Il cliente deve registrarsi?', 'No. Riceve un link al suo calendario, con password e scadenza se vuoi. Il link per il cliente è tra le funzioni in arrivo.'),
    ('Quanti clienti e quante persone posso aggiungere?', 'Lo vediamo insieme durante la demo, in base a quanti clienti segui e a come lavora il team.'),
    ('Che succede se un post non esce?', 'Feedway te lo dice in Oggi, con il motivo e cosa fare. Con «Riprova» pubblica solo dove non è uscito.'),
    ('Funziona con TikTok e LinkedIn?', 'Non ancora. Oggi Instagram e Facebook; gli altri arrivano uno alla volta.'),
    ('Dove stanno i dati?', "Su un server dedicato, con le agenzie separate tra loro. Cosa teniamo è scritto nell'informativa privacy."),
]

FAQ_A = '<section class="section sunken faq" id="domande" aria-labelledby="faq-title"><div class="wrap split"><h2 id="faq-title">Domande frequenti</h2><div>' + ''.join(
    f'<details{" open" if k == 0 else ""}><summary>{q} <i data-icon="chevron-down"></i></summary><p>{a}</p></details>' for k, (q, a) in enumerate(FAQ_ITEMS)) + '</div></div></section>'


OLD_FOOTER = """<footer class="site-footer">
  <div class="wrap">
    <span>© 2026 Feedway · Questo sito non usa cookie.</span>
    <span><a href="#">Privacy</a><a href="#">Cancellazione dei dati</a><a href="#">Termini</a></span>
  </div>
  <div class="wrap"><img class="giant" src="img/feedway-wordmark-arancio.svg" alt="" width="444" height="128"></div>
</footer>"""

BIG_FOOTER = """<footer class="site-footer big">
  <div class="wrap foot-row">
    <img src="img/feedway-horizontal-bianco.svg" alt="Feedway" width="124" height="36">
    <nav aria-label="Pagine"><a href="#prodotto">Prodotto</a><a href="#pubblicazione">Pubblicazione</a><a href="#cliente">Clienti</a><a href="#domande">Domande</a></nav>
    <nav aria-label="Note legali" class="legal"><a href="#">Privacy</a><a href="#">Cancellazione dei dati</a><a href="#">Termini</a><span>Nessun cookie</span></nav>
  </div>
  <div class="wordmark" aria-hidden="true"><img src="img/feedway-wordmark-arancio.svg" alt="" width="444" height="128"></div>
</footer>"""


def page(letter, name, hero, product, script, extra_css, middle=None, foot=None):
    cur = {k: (' aria-current="page"' if k == letter else '') for k in 'abc'}
    html = HEAD.format(letter=letter, name=name, css=extra_css)
    html += hero + (middle or product + PUBLISH + CLIENT + FAQ)
    html += (foot or FOOT).format(script=script, cur_a=cur['a'], cur_b=cur['b'], cur_c=cur['c'])
    (HERE / f'{letter}.html').write_text(html)
    if letter == 'a':
        # page for the shared preview link: no document wrapper, no variant switch
        body = html[html.index('<header class="site-header">'):html.index('</body>')]
        body = body[:body.index('<nav class="variant-switch"')] + body[body.index('</nav>', body.index('<nav class="variant-switch"')) + 6:]
        top = ('<title>Landing Feedway</title>\n'
               '<script>document.documentElement.classList.add(\'js\')</script>\n'
               '<link rel="icon" href="img/favicon.svg">\n'
               '<link rel="stylesheet" href="comune.css">\n<link rel="stylesheet" href="a.css">\n')
        (HERE / 'landing-a.html').write_text(top + body)


HERO_A = f"""
<section class="hero hero-a" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div class="hero-copy">
{HERO_COPY.replace("Prepari i post di tutti i clienti, li programmi su Instagram e Facebook e sai se sono usciti davvero.", "Clienti, team, piano editoriale, attività e pubblicazioni. Feedway mette in ordine il lavoro di ogni giorno e controlla che ogni post sia uscito.")}
      <ol class="steps" aria-label="Come esce un post">
        <li data-i="0"><span class="num">1</span><div><strong>Scrivi il post una volta</strong><p>File, testo e profili, con l'anteprima vera.</p></div></li>
        <li data-i="1"><span class="num">2</span><div><strong>Feedway lo prepara per ogni profilo</strong><p>Misure e formato giusti per feed e storie.</p></div></li>
        <li data-i="2"><span class="num">3</span><div><strong>Controlla che sia uscito</strong><p>Se Meta non lo pubblica, sai subito perché.</p></div></li>
      </ol>
    </div>
    <div class="stage" aria-hidden="true">
      <canvas id="scene"></canvas>
      <img class="stage-fallback" src="img/oggi.webp" alt="">
    </div>
  </div>
</section>
"""

HERO_B = f"""
<section class="hero hero-b" aria-labelledby="hero-title">
  <div class="wrap hero-copy centered">
{HERO_COPY}
  </div>
  <div class="persp wrap" aria-hidden="true">
    <div class="tilt-scene">
      <div class="window main-window"><div class="chrome"><i></i><i></i><i></i></div><img src="img/oggi.webp" alt="" width="1680" height="992"></div>
      <div class="chip float f1"><span class="dot" style="background:var(--ok)"></span><span>Pubblicato su 2 profili<small>Forno Luce · 12:01</small></span></div>
      <div class="chip float f2"><i data-icon="circle-x" class="bad"></i><span>Reel non uscito su Facebook<small>il video supera i 90 secondi</small></span></div>
      <div class="chip float f3"><i data-icon="calendar-days"></i><span>Dicembre, 18 contenuti<small>Piano editoriale · Forno Luce</small></span></div>
    </div>
  </div>
</section>
"""

PRODUCT_B = """
<section class="section sticky-tour" id="prodotto" aria-labelledby="product-title">
  <div class="wrap tour">
    <div class="tour-text">
      <div class="section-head">
        <h2 id="product-title">Dal piano del mese al post pubblicato.</h2>
      </div>
      <article class="tour-step" data-shot="0"><h3><i data-icon="notebook-pen"></i>Pianifica <span class="soon">In arrivo</span></h3><p>Il piano del mese scritto come su un'agenda. Chi carica i file vede subito cosa manca e per quando.</p></article>
      <article class="tour-step" data-shot="1"><h3><i data-icon="send"></i>Prepara</h3><p>Un post per più profili, con l'anteprima vera e i controlli che dicono cosa manca prima di programmare.</p></article>
      <article class="tour-step" data-shot="2"><h3><i data-icon="images"></i>Libreria</h3><p>Le foto e i video di ogni cliente in cartelle. Uno zip dal computer diventa una cartella.</p></article>
      <article class="tour-step" data-shot="3"><h3><i data-icon="calendar-days"></i>Calendario <span class="soon">In arrivo</span></h3><p>Tutti i clienti in un calendario, con lo stato di ogni post.</p></article>
      <article class="tour-step" data-shot="4"><h3><i data-icon="bell"></i>Avvisi <span class="soon">In arrivo</span></h3><p>Un post non uscito arriva a chi deve sistemarlo, nel pannello, per email o su Telegram.</p></article>
    </div>
    <div class="tour-shots" aria-hidden="true">
      <div class="tour-frame window">
        <div class="chrome"><i></i><i></i><i></i></div>
        <div class="shots">
          <img src="img/piano.webp" alt="" width="2000" height="1250">
          <img src="img/editor.webp" alt="" width="2000" height="1250">
          <img src="img/libreria.webp" alt="" width="2000" height="1250">
          <img src="img/calendario.webp" alt="" width="2000" height="1250">
          <img src="img/notifiche.webp" alt="" width="2000" height="1250">
        </div>
      </div>
    </div>
  </div>
</section>
"""

HERO_C = f"""
<section class="hero hero-c" aria-labelledby="hero-title">
  <div class="wrap">
    <h1 id="hero-title" class="split">Tutta la tua agenzia,<br>in un solo posto.</h1>
    <div class="hero-foot">
      <p class="lead">Prepari i post di tutti i clienti, li programmi su Instagram e Facebook e sai se sono usciti davvero.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="#demo">Richiedi una demo <i data-icon="arrow-right" class="icon-arrow"></i></a>
        <a class="btn btn-outline btn-lg" href="#prodotto">Guarda il prodotto</a>
      </div>
    </div>
  </div>
  <div class="cards3d" aria-hidden="true">
    <figure class="card3d" style="--i:0"><img src="img/editor.webp" alt=""></figure>
    <figure class="card3d" style="--i:1"><img src="img/oggi.webp" alt=""></figure>
    <figure class="card3d" style="--i:2"><img src="img/calendario.webp" alt=""></figure>
  </div>
</section>
"""

PRODUCT_C = """
<section class="hscroll" id="prodotto" aria-labelledby="product-title">
  <div class="hs-pin">
    <div class="wrap hs-head">
      <h2 id="product-title">Dal piano al report, in cinque passi.</h2>
      <div class="hs-progress" aria-hidden="true"><span></span></div>
    </div>
    <div class="hs-track">
      <article class="hs-card"><span class="hs-n num">01</span><h3>Pianifica <span class="soon">In arrivo</span></h3><p>Il mese scritto come su un'agenda. Il contenuto diventa un post con un clic.</p><div class="window"><img src="img/piano.webp" alt="Il piano editoriale di dicembre." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">02</span><h3>Prepara</h3><p>Un post per più profili, con l'anteprima vera e i controlli prima di programmare.</p><div class="window"><img src="img/editor.webp" alt="L'editor con l'anteprima del feed." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">03</span><h3>Pubblica</h3><p>All'ora giusta su Instagram e Facebook, feed e storie, dal tuo server.</p><div class="window"><img src="img/oggi.webp" alt="La pagina Oggi con i post in uscita." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">04</span><h3>Verifica</h3><p>Feedway controlla che il post sia uscito. Se no, ti dice perché.</p><div class="window"><img src="img/notifiche.webp" alt="Le notifiche: un reel non uscito." loading="lazy"></div></article>
      <article class="hs-card"><span class="hs-n num">05</span><h3>Racconta <span class="soon">In arrivo</span></h3><p>Le statistiche del mese per ogni cliente, pronte da mandare.</p><div class="window"><img src="img/statistiche.webp" alt="Le statistiche del mese di un cliente." loading="lazy"></div></article>
    </div>
  </div>
</section>
"""

page('a', '3D', HERO_A, '', '<script type="module" src="a.js"></script>', 'a.css',
     middle=PROBLEM + PRODUCT_A + TEAM + CLIENT_A + PUBLISH_A + COSTS + START + TRUST + FAQ_A,
     foot=FOOT.replace('Vediamo Feedway con i tuoi clienti.', 'Smetti di cercare. Inizia a lavorare.').replace("Mezz'ora in videochiamata: ci racconti come lavorate oggi e ti mostriamo il pannello con i tuoi profili.", 'Tutta la tua agenzia, in un solo posto.').replace(OLD_FOOTER, BIG_FOOTER))
page('b', 'Prospettiva', HERO_B, PRODUCT_B, '<script src="b.js"></script>', 'b.css')
page('c', 'Editoriale', HERO_C, PRODUCT_C, '<script src="c.js"></script>', 'c.css')
print('ok')
