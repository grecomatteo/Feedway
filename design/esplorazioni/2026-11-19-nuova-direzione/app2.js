/* Secondo giro: pagina del cliente, calendario, stati dell'editor, esito, menu, finestre, impostazioni, accesso. */
const FL = { ctx: 'Forno Luce', ctxAv: av('FL', 'sm') }
const W = '<span class="plat">' + I + F + '</span>'

/* ------------------------------------------------ Cliente · Panoramica */
const panoramica = () => shell(`
  ${clientHead('Panoramica')}
  <div class="two-col">
    <div class="gap-sec">
      <section>
        <div class="sec-h"><h2>Prossimi post</h2><span class="sp"></span><a class="link small" href="?p=cliente">Tutti i post</a></div>
        <div class="card tbl" style="--cols: minmax(0, 1fr) 150px 60px 130px">
          ${[[img('impasto'), 'Dietro il banco: come nasce la sfoglia', 'Reel · 0:42', 'oggi, 18:00', I], [img('pane', '50% 30%'), 'Le brioche di Natale si prenotano da oggi', 'Carosello · 3 file', 'ven 20 nov, 8:00', I + F], [img('banco', '50% 80%'), 'Sabato siamo aperti fino alle 20', 'Foto', 'sab 21 nov, 9:00', I + F]].map(([t, x, ty, w, p]) => `
          <div class="tr"><span class="name"><span class="thumb">${t}</span><span class="two"><a class="trunc" href="?p=editor" style="font-weight:500">${x}</a><span class="muted small trunc"><span class="hide-sm">${ty}</span><span class="only-sm">${w}</span></span></span></span><span class="hide-sm">${w}</span><span class="plat hide-sm">${p}</span><span class="dot info">Programmato</span></div>`).join('')}
        </div>
      </section>
      <section>
        <div class="sec-h"><h2>Profili <span class="n">3</span></h2><span class="sp"></span><button class="btn sm">${ic('plus')}Aggiungi profilo</button></div>
        <div class="card tbl" style="--cols: minmax(0, 1fr) 150px 170px 150px 30px">
          <div class="tr th hide-sm"><span>Profilo</span><span>Pubblicati in 24 ore</span><span>Ultima sincronizzazione</span><span>Collegamento</span><span></span></div>
          <div class="tr"><span class="name">${ic('instagram')}<span class="two"><b>@fornoluce</b><span class="muted small">Instagram</span></span></span><span class="hide-sm">2 di 25</span><span class="hide-sm muted">oggi, 12:04</span><span></span><a class="more hide-sm" href="#">${ic('ellipsis')}</a></div>
          <div class="tr"><span class="name">${ic('facebook')}<span class="two"><b>Forno Luce</b><span class="muted small">Pagina Facebook</span></span></span><span class="hide-sm">1</span><span class="hide-sm muted">oggi, 12:04</span><span></span><a class="more hide-sm" href="#">${ic('ellipsis')}</a></div>
          <div class="tr"><span class="name">${ic('facebook')}<span class="two"><b>Forno Luce Bistrot</b><span class="muted small">Pagina Facebook</span></span></span><span class="hide-sm muted">—</span><span class="hide-sm muted">3 nov</span><span class="end" style="justify-self:start"><a class="btn sm" href="?p=integrazioni">Ricollega</a></span><a class="more hide-sm" href="#">${ic('ellipsis')}</a></div>
        </div>
      </section>
    </div>
    <div class="gap-sec">
      <section>
        <div class="sec-h"><h2>Ultimi file</h2><span class="sp"></span><a class="link small" href="?p=libreria">Libreria</a></div>
        <div class="mini-grid">${[['pane', 'center'], ['pane', '50% 20%'], ['impasto', 'center'], ['impasto', '85% 50%'], ['banco', '50% 75%'], ['pane', '30% 50%']].map(([k, p]) => `<span class="thumb">${img(k, p)}</span>`).join('')}</div>
      </section>
      <section>
        <div class="sec-h"><h2>Chi ci lavora</h2><span class="sp"></span><a class="link small" href="#">Persone</a></div>
        <div class="card tbl side-list">
          <div class="tr"><span class="name">${av('GF', 'person')}<b style="font-weight:500">Giulia Ferri</b></span><span class="muted small">Owner</span></div>
          <div class="tr"><span class="name">${av('MB', 'person')}<b style="font-weight:500">Marco Bassi</b></span><span class="muted small">Admin</span></div>
          <div class="tr"><span class="name">${av('SL', 'person')}<b style="font-weight:500">Sara Leoni</b></span><span class="muted small">Editor</span></div>
        </div>
      </section>
    </div>
  </div>`, FL)

/* -------------------------------------------------- Cliente · Contenuti */
const contenuti = () => shell(`
  ${clientHead('Contenuti')}
  <div style="max-width:760px">
    <section class="set-sec"><h2>Orario abituale</h2>
      <div class="card"><div class="set-row"><span class="k">I nuovi post partono da</span><span class="v"><span class="field" style="max-width:120px">${ic('clock')}18:00<span class="sp"></span>${ic('chevron-down')}</span></span></div></div></section>
    <section class="set-sec"><div class="sec-h" style="margin-bottom:10px"><h2>Etichette <span class="n">3</span></h2><span class="sp"></span><button class="btn sm">${ic('plus')}Nuova etichetta</button></div>
      <div class="card tbl keep" style="--cols: minmax(0, 1fr) 100px 30px; --k: minmax(0, 1fr) auto 30px">
        ${[['#d98a00', 'Prodotto', '12 post'], ['#1f5aa6', 'Natale', '4 post'], ['#17693f', 'Dietro le quinte', '7 post']].map(([c, n, k]) => `<div class="tr"><span><span class="chip"><i style="background:${c}"></i>${n}</span></span><span class="muted">${k}</span><a class="more" href="#">${ic('ellipsis')}</a></div>`).join('')}
      </div></section>
    <section class="set-sec"><div class="sec-h" style="margin-bottom:10px"><h2>Modelli <span class="n">3</span></h2><span class="sp"></span><button class="btn sm">${ic('plus')}Nuovo modello</button></div>
      <div class="card tbl keep" style="--cols: 110px minmax(0, 1fr) 30px; --k: 64px minmax(0, 1fr) 30px">
        <div class="tr"><span class="muted">Firma</span><span class="trunc">Forno Luce · via Roma 12 · aperti dalle 7 alle 19:30</span><a class="more" href="#">${ic('ellipsis')}</a></div>
        <div class="tr"><span class="muted">Hashtag</span><span class="trunc">#fornoluce #panefresco #lievitomadre #colazione</span><a class="more" href="#">${ic('ellipsis')}</a></div>
        <div class="tr"><span class="muted">Testo</span><span class="trunc">Prenota entro le 18 al numero 051 555 0142</span><a class="more" href="#">${ic('ellipsis')}</a></div>
      </div></section>
    <section class="set-sec"><div class="sec-h" style="margin-bottom:10px"><h2>Gruppi di account <span class="n">1</span></h2><span class="sp"></span><button class="btn sm">${ic('plus')}Nuovo gruppo</button></div>
      <div class="card tbl keep" style="--cols: minmax(0, 1fr) auto 30px; --k: minmax(0, 1fr) auto 30px">
        <div class="tr"><b style="font-weight:500">Solo Instagram</b>${ig('@fornoluce')}<a class="more" href="#">${ic('ellipsis')}</a></div>
      </div></section>
  </div>`, FL)

/* ------------------------------------------------------------ Calendario */
const E = (t, c, cl = '') => `<a class="ev ${cl}" href="?p=post"><b>${t}</b><span>${c}</span></a>`
const CAL = {
  2: [E('9:00', 'Forno Luce', 'ok')], 3: [E('12:30', 'Osteria Bruna', 'ok'), E('18:00', 'Ottica Venti', 'ok')], 5: [E('8:00', 'Forno Luce', 'ok')], 6: [E('19:00', 'Gelateria Polo', 'ok')],
  9: [E('9:00', 'Forno Luce', 'ok'), E('13:00', 'Osteria Bruna', 'ok')], 11: [E('18:00', 'Forno Luce', 'ok')], 12: [E('12:00', 'Palestra Arco', 'ok')], 13: [E('8:00', 'Forno Luce', 'ok'), E('18:30', 'Gelateria Polo', 'ok')],
  16: [E('7:30', 'Forno Luce', 'ok'), E('12:00', 'Osteria Bruna', 'ok'), E('18:00', 'Ottica Venti', 'ok'), '<span class="ev more">+1</span>'], 17: [E('7:30', 'Forno Luce', 'ok'), E('18:00', 'Gelateria Polo', 'ok')], 18: [E('13:00', 'Osteria Bruna', 'ok'), E('18:00', 'Forno Luce', 'ok'), E('19:00', 'Palestra Arco', 'ok')],
  19: [E('9:30', 'Osteria Bruna', 'bad'), E('12:00', 'Forno Luce', 'ok'), E('18:00', 'Forno Luce'), E('19:30', 'Gelateria Polo')],
  20: [E('8:00', 'Forno Luce'), E('13:00', 'Osteria Bruna'), E('18:00', 'Ottica Venti')], 21: [E('9:00', 'Forno Luce')], 24: [E('18:00', 'Gelateria Polo'), E('', 'Ottica Venti · bozza', 'draft')], 26: [E('8:00', 'Forno Luce')], 28: [E('', 'Osteria Bruna · bozza', 'draft')],
}
const calendario = () => shell(`
  <header class="page-h"><h1>Calendario</h1></header>
  <div class="cal-h">
    <button class="btn icon" aria-label="Mese precedente">${ic('chevron-left')}</button><button class="btn icon" aria-label="Mese successivo">${ic('chevron-right')}</button>
    <span class="mo">Novembre 2026</span><button class="btn hide-sm">Oggi</button>
    <span class="sp"></span>
    <div class="seg"><button aria-pressed="true" class="hide-sm">Mese</button><button class="hide-sm">Settimana</button><button class="hide-sm">Elenco</button><button class="only-sm">Mese</button><button class="only-sm" aria-pressed="true">Elenco</button></div>
  </div>
  <div class="card hide-sm"><div class="cal">
    ${['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((d) => `<div class="dow">${d}</div>`).join('')}
    ${[26, 27, 28, 29, 30, 31].map((d) => `<div class="c out"><span class="dn">${d}</span></div>`).join('')}
    ${Array.from({ length: 30 }, (_, i) => i + 1).map((d) => `<div class="c ${d === 19 ? 'today' : ''}"><span class="dn">${d}</span>${(CAL[d] || []).join('')}</div>`).join('')}
    ${[1, 2, 3, 4, 5, 6].map((d) => `<div class="c out"><span class="dn">${d}</span></div>`).join('')}
  </div></div>
  <div class="m-block">
    <div class="card"><div class="week">
      ${[['lun', 16, 4, 'done'], ['mar', 17, 2, 'done'], ['mer', 18, 3, 'done'], ['oggi', 19, 4, ''], ['ven', 20, 3, ''], ['sab', 21, 1, ''], ['dom', 22, 0, '']].map(([d, n, k, c]) => `<div class="${d === 'oggi' ? 'today' : c ? 'past' : ''}"><div class="d">${d}</div><div class="num">${n}</div><div class="bars">${('<i class="' + c + '"></i>').repeat(k)}</div></div>`).join('')}
    </div>
    <div class="tbl sched">
      <div class="day-h">Oggi, giovedì 19</div>
      ${post('9:30', img('banco', '50% 70%'), 'Il pranzo del giovedì: tagliatelle al ragù bianco', 'Osteria Bruna', I + F, '<span class="dot bad">1 non uscito</span>')}
      ${post('12:00', img('pane'), 'Il pane del lunedì è appena uscito dal forno', 'Forno Luce', I + F, '<span class="dot ok">Pubblicato</span>')}
      ${post('18:00', img('impasto'), 'Dietro il banco: come nasce la sfoglia', 'Forno Luce', I, '<span class="dot info">Programmato</span>')}
      ${post('19:30', img('banco', '50% 20%'), 'Nuovi gusti d’autunno: castagna e cachi', 'Gelateria Polo', I + F, '<span class="dot info">Programmato</span>')}
      <div class="day-h">Venerdì 20</div>
      ${post('8:00', img('pane', '50% 30%'), 'Le brioche di Natale si prenotano da oggi', 'Forno Luce', I + F, '<span class="dot info">Programmato</span>')}
      ${post('13:00', img('banco', '30% 60%'), 'Menu del fine settimana', 'Osteria Bruna', F, '<span class="dot info">Programmato</span>')}
    </div></div>
  </div>`)

/* -------------------------------------------------------- Editor · Reel */
const edBar = (title, right, saved = 'Bozza salvata alle 11:53') => `
<div class="ed-bar">
  <a class="btn ghost icon" href="?p=cliente" aria-label="Torna ai post di Forno Luce">${ic('arrow-left')}</a>
  <span class="row-gap hide-sm">${av('FL', 'sm')}<span class="muted">Forno Luce</span></span><span class="sep hide-sm"></span>
  <span class="title">${title}</span>
  <span class="saved hide-sm" style="margin-left:8px">${ic('cloud-check')}${saved}</span>
  <span class="sp"></span>${right}
</div>`
const askBox = `
  <div class="ask">
    <div class="t">${ic('alert-triangle')}Il video è orizzontale (16:9)</div>
    <div>Un reel è verticale. Scegli come pubblicarlo su @fornoluce.</div>
    <label class="opt on"><span class="radio on"></span>Ritagliato al centro, a tutto schermo</label>
    <label class="opt"><span class="radio"></span>Intero, con le bande sopra e sotto</label>
  </div>`
const editorReel = () => `
${edBar('Nuovo post', `<button class="btn ghost only-sm">${ic('eye')}Anteprima</button><span class="need hide-sm">${ic('alert-triangle')}Manca 1 scelta</span><button class="btn hide-sm">Salva ed esci</button><button class="btn primary hide-sm" disabled>${ic('calendar-check')}Programma su 1 account</button>`)}
<div class="ed">
  <div>
    <div class="fs"><div class="l">Tipo</div><div>
      <div class="seg wide"><button>${ic('image')}Foto</button><button disabled>${ic('gallery-horizontal-end')}Carosello</button><button aria-pressed="true">${ic('clapperboard')}Reel</button><button>${ic('circle-dashed')}Storia</button></div>
    </div></div>
    <div class="fs"><div class="l">File <small>1 video</small></div><div>
      <div class="files">
        <div class="file"><div class="ph">${img('impasto')}<span class="dur">${ic('clapperboard')}0:42</span></div><div class="nm trunc">sfoglia-dietro-il-banco.mov</div></div>
      </div>
      <div class="row-gap" style="margin-top:10px"><button class="btn sm">${ic('refresh-cw')}Sostituisci</button><span class="muted small">Convertito in MP4, 38,8 MB</span></div>
    </div></div>
    <div class="fs"><div class="l">Copertina</div><div>
      <div class="cover">
        <div class="fr">${img('impasto', '40% 50%')}</div>
        <div class="strip-w">
          <div style="position:relative"><div class="strip">${['10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%'].map((p) => img('impasto', p + ' 50%')).join('')}</div><span class="knob"></span></div>
          <div class="row-gap" style="margin-top:12px"><span class="muted small">Fotogramma a 0:16</span><span class="sp" style="flex:1"></span><button class="btn sm">${ic('upload')}Carica un’immagine</button></div>
        </div>
      </div>
    </div></div>
    <div class="fs"><div class="l">Testo</div><div>
      <div class="txt"><div class="body" style="min-height:88px">Dietro il banco: come nasce la sfoglia.<br>Ogni mattina, dalle 5.</div>
        <div class="foot"><button class="btn ghost sm">${ic('text-cursor-input')}Inserisci</button><span class="sp"></span><span class="cnt">${ic('instagram')}63 / 2.200</span><span class="cnt hide-sm">${ic('hash')}0 / 30</span></div></div>
    </div></div>
    <div class="fs"><div class="l">Dove <small>1 di 3</small></div><div>
      <div class="acc">
        <div class="r"><span class="check on">${ic('check')}</span>${ic('instagram', 'pl')}<b style="font-weight:500">@fornoluce</b><span class="sp"></span><span class="muted small">Instagram</span></div>
        <div class="r"><span class="check"></span>${ic('facebook', 'pl')}<span>Forno Luce</span><span class="sp"></span><span class="muted small">Pagina Facebook</span></div>
        <div class="r off"><span class="check"></span>${ic('facebook', 'pl')}<span>Forno Luce Bistrot</span><span class="sp"></span><span class="dot warn">Da ricollegare</span></div>
      </div>
    </div></div>
    <div class="fs"><div class="l">Quando</div><div class="stack">
      <div><div class="seg"><button aria-pressed="true">${ic('calendar-days')}Programma</button><button>${ic('send')}Pubblica subito</button></div></div>
      <div class="when"><span class="field" style="width:220px">${ic('calendar')}giovedì 19 novembre<span class="sp"></span>${ic('chevron-down')}</span><span class="field" style="width:112px">${ic('clock')}18:00<span class="sp"></span>${ic('chevron-down')}</span></div>
    </div></div>
    <div class="fs sub-sm"><div class="l">Controlli</div><div>${askBox}</div></div>
  </div>
  <aside class="pv">
    <div class="pv-tools"><h2>Anteprima</h2><span class="sp"></span><div class="seg"><button aria-pressed="true">Reel</button><button>Griglia</button></div></div>
    <div class="reel" style="width:236px">${img('impasto', '40% 50%')}<div class="who"><b><i></i>fornoluce</b>Dietro il banco: come nasce la sfoglia. Ogni mattina…</div><div class="acts">${ic('heart')}${ic('message-circle')}${ic('send')}${ic('ellipsis')}</div></div>
    <div class="checks"><div class="sec-h"><h2>Controlli</h2><span class="sp"></span><span class="dot warn small">1 scelta da fare</span></div>${askBox}</div>
  </aside>
</div>
<div class="m-act"><span class="need" style="flex:1">${ic('alert-triangle')}Manca 1 scelta</span><button class="btn primary" disabled>${ic('calendar-check')}Programma</button></div>`

/* ------------------------------------------- Editor · anteprima (telefono) */
const editorAnteprima = () => `
<div class="ed-bar"><a class="btn ghost" href="?p=editor">${ic('arrow-left')}Modifica</a><span class="sp"></span><span class="title" style="margin-right:12px">Anteprima</span></div>
<div class="pvpage" style="max-width:420px;margin:0 auto;padding:16px">
  <div class="seg" style="display:flex;margin-bottom:14px"><button aria-pressed="true" style="flex:1;justify-content:center">${ic('instagram')}Feed</button><button style="flex:1;justify-content:center">${ic('layout-grid')}Griglia</button><button style="flex:1;justify-content:center">${ic('facebook')}Facebook</button></div>
  <div class="ig">
    <div class="ig-h"><span class="a">${img('pane', '50% 40%')}</span>fornoluce${ic('ellipsis')}</div>
    <div class="ig-m">${img('pane')}<span class="pg">1/2</span></div>
    <div class="ig-a">${ic('heart')}${ic('message-circle')}${ic('send')}<span class="dots"><i></i><i></i></span>${ic('bookmark')}</div>
    <div class="ig-c"><b>fornoluce</b> Il pane del lunedì è appena uscito dal forno. Vi aspettiamo in via Roma 12, dalle 7.</div>
  </div>
  <p class="muted small" style="margin-top:12px">Anteprima indicativa: Instagram cambia spesso l’aspetto.</p>
</div>`

/* ------------------------------------------------ Conferma «Pubblica subito» */
const conferma = () => editor().replace('Programma su 2 account</button>\n</div>\n<div class="ed">', 'Pubblica su 2 account</button>\n</div>\n<div class="ed">') + `
<div class="veil"><div class="dialog" role="dialog" aria-labelledby="cf">
  <header><h3 id="cf">Pubblicare adesso?</h3></header>
  <div class="b">
    <div class="pick">
      <div class="r">${ic('instagram')}<b style="font-weight:500">@fornoluce</b><span class="sp"></span><span class="muted small">Carosello, 2 foto</span></div>
      <div class="r">${ic('facebook')}<b style="font-weight:500">Forno Luce</b><span class="sp"></span><span class="muted small">Post con 2 foto</span></div>
    </div>
    <p class="muted">Dopo non si può annullare: il post si può solo togliere dal profilo.</p>
  </div>
  <footer><button class="btn">Annulla</button><button class="btn primary">${ic('send')}Pubblica adesso</button></footer>
</div></div>`

/* ------------------------------------------------------- Post pubblicato */
const postEsito = () => shell(`
  <a class="crumb" href="?p=cliente">${ic('arrow-left')}Post di Osteria Bruna</a>
  <header class="page-h"><h1>Il pranzo del giovedì</h1><span class="dot bad">1 non uscito</span><span class="sp"></span><button class="btn hide-sm">${ic('copy')}Duplica</button></header>
  <div class="pd">
    <div>
      <div class="media"><div class="m">${img('banco', '50% 70%')}</div><div class="m">${img('banco', '30% 60%')}</div><div class="m">${img('impasto')}</div></div>
      <p class="cap">Il pranzo del giovedì: tagliatelle al ragù bianco, fatte stamattina. Prenota entro le 12 al numero 051 555 0142.</p>
      <div class="row-gap" style="margin-top:14px"><span class="chip"><i style="background:#d98a00"></i>Menu</span><span class="muted small">Carosello · 3 file · di Marco Bassi</span></div>
    </div>
    <div class="gap-sec">
      <section>
        <div class="sec-h"><h2>Esito</h2><span class="sp"></span><span class="muted small">oggi, 9:30</span></div>
        <div class="card out">
          <div class="r">${ic('instagram')}<b style="font-weight:500">@osteriabruna</b><span class="dot ok">Pubblicato</span><span class="why"><a class="link small" href="#">Apri su Instagram</a></span></div>
          <div class="r">${ic('facebook')}<b style="font-weight:500">Osteria Bruna</b><span class="dot bad">Non uscito</span>
            <span class="why small">Facebook ha rifiutato il terzo file: il video supera i 90 secondi. Accorcialo o toglilo, poi riprova: su Instagram non esce due volte.</span>
            <span class="why row-gap" style="margin-top:8px"><button class="btn sm">${ic('pencil')}Modifica per Facebook</button><button class="btn sm ghost">${ic('rotate-cw')}Riprova</button></span></div>
        </div>
      </section>
      <section>
        <div class="sec-h"><h2>Attività</h2></div>
        <div class="tl small">
          <div><span class="muted">oggi, 9:31</span><span>Facebook non ha pubblicato il post</span></div>
          <div><span class="muted">oggi, 9:30</span><span>Pubblicato su @osteriabruna</span></div>
          <div><span class="muted">ieri, 17:12</span><span>Marco Bassi l’ha programmato</span></div>
          <div><span class="muted">ieri, 16:50</span><span>Marco Bassi ha creato la bozza</span></div>
        </div>
      </section>
    </div>
  </div>`, { ctx: 'Osteria Bruna', ctxAv: av('OB', 'sm') })

/* ------------------------------------------------- Menu e pannelli aperti */
const selettore = () => shell(oggiBody(), { toast: `
  <div class="veil m-only"></div>
  <div class="pop" style="left:12px;top:106px;width:300px">
    <div class="field">${ic('search')}<span class="ph">Cerca un cliente</span></div>
    <a class="it on">${av('SR', 'dark sm')}Tutti i clienti<span class="sp"></span>${ic('check')}</a>
    <hr>
    ${[['FL', 'Forno Luce', '<span class="dot warn"></span>'], ['OB', 'Osteria Bruna', '<span class="dot bad"></span>'], ['GP', 'Gelateria Polo', ''], ['OV', 'Ottica Venti', ''], ['PA', 'Palestra Arco', '']].map(([i, n, d]) => `<a class="it">${av(i, 'sm')}${n}<span class="sp"></span>${d}</a>`).join('')}
    <hr><a class="it">${ic('plus')}Nuovo cliente</a>
  </div>` })

const tu = () => shell(oggiBody(), { toast: `
  <div class="veil m-only"></div>
  <div class="pop" style="left:12px;bottom:64px;width:264px">
    <div class="hd row-gap">${av('GF', 'person')}<div style="line-height:18px"><b style="font-weight:600;display:block">Giulia Ferri</b><span class="muted small">giulia@studioriva.example</span></div></div>
    <hr>
    <a class="it m-it">${ic('images')}Libreria</a>
    <a class="it m-it">${ic('users')}Utenti</a>
    <a class="it">${ic('settings')}Impostazioni</a>
    <a class="it">${ic('building')}Cambia agenzia</a>
    <hr>
    <div class="row-gap" style="justify-content:space-between"><a class="it" style="flex:1">${ic('log-out')}Esci</a><button class="btn ghost icon" aria-label="Passa al tema scuro">${ic('moon')}</button></div>
  </div>` })

const notifiche = () => shell(oggiBody(), { toast: `
  <div class="veil m-only"></div>
  <div class="pop" style="left:248px;top:12px;width:400px;padding:8px">
    <div class="row-gap" style="justify-content:space-between;padding:6px 8px 8px"><h3>Notifiche</h3><a class="link small" href="#">Segna tutte come lette</a></div>
    <div class="note new">${ic('circle-x', 'bad-i')}<div><b style="font-weight:500">Il reel di Osteria Bruna non è uscito su Facebook</b><div class="muted small">Il video supera i 90 secondi</div></div><span class="muted xs">9:31</span></div>
    <div class="note new">${ic('unplug', 'warn-i')}<div><b style="font-weight:500">Forno Luce Bistrot va ricollegata</b><div class="muted small">2 post in programma su questa Pagina</div></div><span class="muted xs">8:02</span></div>
    <div class="note">${ic('circle-check')}<div><span>Pubblicato «Il pane del lunedì» su 2 account</span><div class="muted small">Forno Luce</div></div><span class="muted xs">ieri</span></div>
    <div class="note">${ic('user-plus')}<div><span>Sara Leoni ha accettato l’invito</span><div class="muted small">Editor · Forno Luce, Gelateria Polo</div></div><span class="muted xs">lun</span></div>
  </div>` })

/* ---------------------------------------------------------------- Finestre */
const nuovoCliente = () => shell(clientiBody(), { toast: `
  <div class="veil"><div class="dialog" role="dialog" aria-labelledby="nc">
    <header><h3 id="nc">Nuovo cliente</h3></header>
    <div class="b">
      <label class="lbl">Nome<span class="field">Bar Centrale</span></label>
      <div class="lbl">Profili<div class="pick">
        <label class="r"><span class="check on">${ic('check')}</span>${ic('instagram')}@barcentrale.bo<span class="sp"></span><span class="muted small">Instagram</span></label>
        <label class="r"><span class="check on">${ic('check')}</span>${ic('facebook')}Bar Centrale Bologna<span class="sp"></span><span class="muted small">Pagina Facebook</span></label>
      </div><span class="muted small" style="font-weight:400">Sono i profili trovati su Meta che non hanno ancora un cliente.</span></div>
    </div>
    <footer><button class="btn">Annulla</button><button class="btn primary">Crea cliente</button></footer>
  </div></div>` })

const invita = () => shell(utentiBody(), { toast: `
  <div class="veil"><div class="dialog" role="dialog" aria-labelledby="iv">
    <header><h3 id="iv">Invita una persona</h3></header>
    <div class="b">
      <label class="lbl">Email<span class="field">luca@studioriva.example</span></label>
      <div class="lbl">Ruolo<div class="pick">
        <label class="r"><span class="radio"></span>Admin<span class="sp"></span><span class="muted small">Gestisce clienti, persone e collegamenti</span></label>
        <label class="r"><span class="radio on"></span>Editor<span class="sp"></span><span class="muted small">Prepara le bozze, non programma</span></label>
        <label class="r"><span class="radio"></span>Viewer<span class="sp"></span><span class="muted small">Può solo guardare</span></label>
      </div></div>
      <div class="lbl">Clienti<div class="row-gap"><span class="chip">${av('FL', 'sm')}Forno Luce</span><span class="chip">${av('OB', 'sm')}Osteria Bruna</span><button class="btn ghost sm">${ic('plus')}Aggiungi</button></div></div>
    </div>
    <footer><button class="btn">Annulla</button><button class="btn primary">${ic('mail')}Manda l’invito</button></footer>
  </div></div>` })

const file = () => shell(libreriaBody(), { toast: `
  <aside class="drawer">
    <header><h3 class="trunc">sfoglia-dietro-il-banco.mov</h3><span class="sp"></span><button class="btn ghost icon" aria-label="Chiudi">${ic('x')}</button></header>
    <div class="b">
      <div class="big">${img('impasto')}</div>
      <dl class="kv"><dt>Cliente</dt><dd>Forno Luce</dd><dt>Video</dt><dd>1920 × 1080 · 0:42 · 38,8 MB</dd><dt>Caricato</dt><dd>oggi alle 10:14, da Marco Bassi</dd><dt>Usato in</dt><dd><a class="link" href="?p=editor-reel">Post di oggi, 18:00</a></dd><dt>Tag</dt><dd class="row-gap"><span class="chip">sfoglia</span><span class="chip">laboratorio</span><button class="btn ghost sm">${ic('plus')}Tag</button></dd></dl>
      <div class="row-gap"><button class="btn">${ic('file-plus')}Usa in un nuovo post</button><button class="btn">${ic('download')}Scarica</button></div>
      <p class="muted small">Non si può eliminare: è in un post programmato per oggi alle 18:00.</p>
    </div>
  </aside>` })

/* ----------------------------------------------------- Impostazioni (altre) */
const SET = [['', 'Il tuo account'], ['profilo', 'Profilo e preferenze', 'user'], ['sicurezza', 'Sicurezza', 'shield'], ['dispositivi', 'Dispositivi', 'monitor-smartphone'], ['privacy', 'Privacy', 'lock'], ['', 'Studio Riva'], ['generali', 'Generali', 'building'], ['integrazioni', 'Integrazioni', 'plug'], ['registro', 'Registro attività', 'scroll-text']]
const setShell = (act, body, wide = false) => shell(`
  <header class="page-h"><h1>Impostazioni</h1></header>
  <div class="set" ${wide ? 'style="grid-template-columns:208px minmax(0,1fr)"' : ''}>
    <nav class="set-nav">${SET.map(([k, l, i]) => (i ? `<a href="#" ${k === act ? 'aria-current="page"' : ''}>${ic(i)}${l}</a>` : `<div class="nav-h">${l}</div>`)).join('')}</nav>
    <div><div class="field only-sm" style="margin-bottom:20px">${ic(SET.find((s) => s[0] === act)[2])}${SET.find((s) => s[0] === act)[1]}<span class="sp"></span>${ic('chevron-down')}</div>${body}</div>
  </div>`)

const sicurezza = () => setShell('sicurezza', `
  <section class="set-sec"><h2>Accesso</h2><div class="card">
    <div class="set-row inline"><span class="k">Password<div class="muted small" style="font-weight:400">Cambiata il 3 ottobre</div></span><span class="v"><button class="btn sm">Cambia</button></span></div>
    <div class="set-row inline"><span class="k">Passkey<div class="muted small" style="font-weight:400">MacBook di Giulia, iPhone</div></span><span class="v"><button class="btn sm">Gestisci</button></span></div>
  </div></section>
  <section class="set-sec"><h2>Secondo fattore</h2><div class="card">
    <div class="set-row inline"><span class="k">App di autenticazione<div class="muted small" style="font-weight:400">Attiva dal 12 settembre</div></span><span class="v"><span class="dot ok hide-sm">Attiva</span><button class="btn sm">Gestisci</button></span></div>
    <div class="set-row inline"><span class="k">Codici di riserva<div class="muted small" style="font-weight:400">8 su 10 ancora da usare</div></span><span class="v"><button class="btn sm">Nuovi codici</button></span></div>
  </div></section>
  <section class="set-sec"><h2>Account</h2><div class="card">
    <div class="set-row inline"><span class="k">Elimina il tuo account<div class="muted small" style="font-weight:400">Prima passa l’agenzia a un altro Owner</div></span><span class="v"><button class="btn sm danger-text">Elimina</button></span></div>
  </div></section>`)

const integrazioni = () => setShell('integrazioni', `
  <a class="crumb" href="#">${ic('arrow-left')}Integrazioni</a>
  <div class="sec-h" style="margin-bottom:16px;height:36px"><h1 style="font-size:18px">Meta</h1><span class="dot ok" style="margin-left:8px">Funziona</span><span class="sp"></span><button class="btn">${ic('plus')}Aggiungi account</button></div>
  <section class="set-sec"><h2>Collegamenti</h2>
    <div class="card tbl" style="--cols: minmax(0, 1.4fr) 110px 170px 150px auto">
      <div class="tr th hide-sm"><span>Account Meta</span><span>Profili</span><span>Ultima sincronizzazione</span><span>Stato</span><span></span></div>
      <div class="tr"><span class="name">${ic('facebook')}<span class="two"><b>Studio Riva Business</b><span class="muted small trunc">Collegato da Giulia Ferri</span></span></span><span class="hide-sm">8</span><span class="hide-sm muted">oggi, 12:04</span><span class="hide-sm"></span><span class="end"><button class="btn sm ghost">${ic('refresh-cw')}<span class="hide-sm">Sincronizza</span></button></span></div>
      <div class="tr"><span class="name">${ic('facebook')}<span class="two"><b>Forno Luce Bistrot</b><span class="muted small trunc">Collegato da Marco Bassi</span></span></span><span class="hide-sm">1</span><span class="hide-sm muted">3 nov</span><span class="hide-sm"><span class="dot warn">Scaduto</span></span><span class="end"><button class="btn sm">Ricollega</button></span></div>
    </div></section>
  <section class="set-sec"><h2>App Meta</h2><div class="card">
    <div class="set-row"><span class="k">ID dell’app</span><span class="v">8421 0937 5516 204</span></div>
    <div class="set-row"><span class="k">Chiave segreta</span><span class="v"><span class="muted">Salvata il 2 novembre</span><button class="btn sm">Sostituisci</button></span></div>
  </div></section>`, true)

const registro = () => setShell('registro', `
  <div class="tools"><div class="seg"><button aria-pressed="true">Tutto</button><button>Post</button><button>Persone</button><button>Collegamenti</button></div><div class="field search">${ic('search')}<span class="ph">Cerca</span></div></div>
  <div class="card tbl" style="--cols: 120px 150px minmax(0, 1fr) 150px">
    <div class="tr th hide-sm"><span>Quando</span><span>Chi</span><span>Cosa</span><span>Cliente</span></div>
    ${[['oggi, 11:53', 'Giulia Ferri', 'ha programmato un post per ven 20 nov, 8:00', 'Forno Luce'], ['oggi, 9:31', 'Feedway', 'non ha potuto pubblicare un post su Facebook', 'Osteria Bruna'], ['oggi, 9:12', 'Marco Bassi', 'ha fatto l’accesso da un nuovo dispositivo', '—'], ['ieri, 17:12', 'Marco Bassi', 'ha programmato un post per oggi, 9:30', 'Osteria Bruna'], ['ieri, 16:02', 'Sara Leoni', 'ha caricato 4 file in libreria', 'Gelateria Polo'], ['lun 16 nov', 'Giulia Ferri', 'ha invitato Sara Leoni come Editor', '—'], ['lun 16 nov', 'Giulia Ferri', 'ha cambiato le etichette dei contenuti', 'Forno Luce']].map(([w, c, x, k]) => `
    <div class="tr"><span class="muted hide-sm">${w}</span><span class="hide-sm" style="font-weight:500">${c}</span><span class="two"><span><span class="only-sm" style="font-weight:600">${c} </span>${x}</span><span class="sub-sm muted small">${w}${k === '—' ? '' : ' · ' + k}</span></span><span class="muted hide-sm">${k}</span></div>`).join('')}
  </div>`, true)

/* ---------------------------------------------------------------- Accesso */
const accedi = () => `
<main class="login"><div class="box">
  <img src="../../assets/feedway-horizontal-carbone.svg" alt="Feedway">
  <h1>Accedi</h1>
  <button class="btn" style="height:44px">${ic('key-round')}Accedi con una passkey</button>
  <div class="or">oppure</div>
  <label class="lbl">Email<span class="field" style="height:44px">giulia@studioriva.example</span></label>
  <label class="lbl"><span style="display:flex;justify-content:space-between">Password<a class="link small" style="font-weight:400" href="#">Dimenticata?</a></span><span class="field" style="height:44px">••••••••••••</span></label>
  <button class="btn primary" style="height:44px">Accedi</button>
</div></main>`

/* Corpi delle pagine del primo giro, riusati sotto menu e finestre. */
const inner = (fn) => { const d = document.createElement('div'); d.innerHTML = fn(); return d.querySelector('main.page').innerHTML }
const oggiBody = () => inner(oggi), clientiBody = () => inner(clienti), utentiBody = () => inner(utenti), libreriaBody = () => inner(libreria)
const tranquillo = () => oggi().replace(/<section>\s*<div class="sec-h"><h2>Da sistemare[\s\S]*?<\/section>/, `<p class="calm">${ic('circle-check')}Niente da sistemare.</p>`).replace('<span class="count">3</span>', '').replace('<span class="dot bad">1 non uscito</span>', '<span class="dot ok">Pubblicato</span>').replace('<span class="dot bad">1 non uscito</span>', '<span class="dot ok">Pubblicato</span>').replace('<i class="bad"></i>', '<i class="done"></i>')

const PAGES2 = { panoramica, contenuti, calendario, 'editor-reel': editorReel, 'editor-anteprima': editorAnteprima, conferma, post: postEsito, selettore, tu, notifiche, 'nuovo-cliente': nuovoCliente, invita, file, sicurezza, integrazioni, registro, accedi, 'oggi-tranquillo': tranquillo }
