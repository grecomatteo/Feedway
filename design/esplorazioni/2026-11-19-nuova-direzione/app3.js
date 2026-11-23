/* Terzo giro (23/11): le funzioni previste, disegnate per la landing come se fossero già fatte.
   Piano editoriale (§11.12), attività (§18.4), link del cliente con approvazione (§11.10, §18.7),
   statistiche (§18.2, 1.3). Con ?vetrina=1 il menu mostra le voci future senza «Presto». */
Object.assign(ICONS, {
  'list-checks': '<g stroke-width="2"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></g>',
  'chart-column': '<g stroke-width="2"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></g>',
  'notebook-pen': '<g stroke-width="2"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></g>',
  'printer': '<g stroke-width="2"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></g>',
})

if (q.get('vetrina')) {
  NAV.splice(0, NAV.length,
    ['oggi', 'Oggi', 'sun', '<span class="count">3</span>'],
    ['calendario', 'Calendario', 'calendar-days', ''],
    ['piano', 'Piano editoriale', 'notebook-pen', ''],
    ['clienti', 'Clienti', 'briefcase-business', ''],
    ['libreria', 'Libreria', 'images', ''],
    ['attivita', 'Attività', 'list-checks', '<span class="count n">2</span>'],
    ['statistiche', 'Statistiche', 'chart-column', ''],
  )
}

/* ------------------------------------------------------- Piano editoriale */
const T = { reel: ['clapperboard', 'Reel'], car: ['gallery-horizontal-end', 'Carosello'], foto: ['image', 'Foto'], storia: ['circle-dashed', 'Storia'] }
const pl = (type, title, time = '', done = false) =>
  `<span class="pl ${done ? 'done' : ''}">${ic(T[type][0])}<span><b>${title}</b><small>${T[type][1]}${time ? ' · ' + time : ''}${done ? ' · Preparato' : ''}</small></span></span>`
const PIANO = {
  1: [pl('reel', 'Il panettone, dall’impasto al forno', '18:00', true)],
  3: [pl('car', 'Le brioche di Natale', '8:00', true)],
  5: [pl('foto', 'Gli orari delle feste', '9:00')],
  8: [pl('storia', 'Pandoro o panettone?')],
  10: [pl('reel', 'Una notte in laboratorio', '19:00')],
  12: [pl('car', 'Il menu della vigilia', '12:00')],
  15: [pl('foto', 'Il banco di Natale', '8:00')],
  17: [pl('reel', 'Auguri dal forno', '18:00')],
  19: [pl('car', 'Regali golosi', '11:00')],
  22: [pl('storia', 'Ultimi ordini')],
  24: [pl('foto', 'Buona vigilia', '9:00')],
  29: [pl('reel', 'Un anno di pane', '18:00')],
}
const piano = () => shell(`
  <header class="page-h"><h1>Piano editoriale</h1><span class="aside">Forno Luce</span><span class="sp"></span><button class="btn hide-sm">${ic('printer')}Stampa o salva PDF</button></header>
  <div class="cal-h">
    <button class="btn icon" aria-label="Mese precedente">${ic('chevron-left')}</button><button class="btn icon" aria-label="Mese successivo">${ic('chevron-right')}</button>
    <span class="mo">Dicembre 2026</span><span class="muted">12 contenuti · 2 preparati</span>
  </div>
  <div class="card"><div class="cal plan">
    ${['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((d) => `<div class="dow">${d}</div>`).join('')}
    <div class="c out"><span class="dn">30</span></div>
    ${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<div class="c ${d === 11 ? 'pick-day' : ''}"><span class="dn">${d}</span>${(PIANO[d] || []).join('')}</div>`).join('')}
    ${[1, 2, 3].map((d) => `<div class="c out"><span class="dn">${d}</span></div>`).join('')}
  </div></div>`, { ctx: 'Forno Luce', ctxAv: av('FL', 'sm'), toast: `
  <div class="pop plan-form" style="left:760px;top:300px;width:360px;padding:16px">
    <h3 style="margin-bottom:12px">Venerdì 11 dicembre</h3>
    <div class="seg wide" style="margin-bottom:12px"><button aria-pressed="true">Reel</button><button>Carosello</button><button>Foto</button><button>Storia</button></div>
    <label class="lbl">Titolo<span class="field">La ricetta del pandoro, in 30 secondi</span></label>
    <p class="muted small" style="margin:6px 0 12px">Il titolo può comparire nel calendario del cliente; la nota no.</p>
    <div class="row-gap" style="gap:8px;margin-bottom:12px"><label class="lbl" style="flex:1">Ora<span class="field">${ic('clock')}18:00</span></label></div>
    <label class="lbl">Nota per chi prepara<span class="field">Girare al mattino, luce dalla vetrina</span></label>
    <div class="row-gap" style="justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn">Annulla</button><button class="btn primary">Aggiungi al piano</button></div>
  </div>` })

/* --------------------------------------------------------------- Attività */
const task = (title, client, meta, due, cls = '', people = 'SL') => `
  <div class="tr task">
    <span class="check"></span>
    <span class="two"><b style="font-weight:500">${title}</b><span class="muted small">${client} · ${meta}</span></span>
    <span class="people hide-sm">${people.split(' ').map((p) => av(p, 'person sm')).join('')}</span>
    <span class="due ${cls}">${due}</span>
  </div>`
const attivita = () => shell(`
  <header class="page-h"><h1>Attività</h1><span class="sp"></span><button class="btn">${ic('plus')}Nuova attività</button></header>
  <div class="tools" style="margin-bottom:16px"><div class="seg"><button aria-pressed="true">Le mie</button><button>Agenzia</button><button>Per cliente</button></div><span class="sp"></span><div class="seg hide-sm"><button aria-pressed="true">${ic('layout-list')}Lista</button><button>${ic('layout-grid')}Colonne</button></div></div>
  <section><div class="sec-h"><h2>In ritardo <span class="n">1</span></h2></div>
    <div class="card tbl">${task('Rifare la copertina del reel', 'Osteria Bruna', 'dal post «Il pranzo del giovedì»', 'ieri', 'bad')}</div></section>
  <section style="margin-top:20px"><div class="sec-h"><h2>Oggi <span class="n">3</span></h2></div>
    <div class="card tbl">
      ${task('Shooting dei panettoni', 'Forno Luce', '2 di 4 fatte', 'oggi, 15:00', 'warn', 'GF SL')}
      ${task('Mandare il piano di dicembre al cliente', 'Gelateria Polo', 'collegata al piano editoriale', 'oggi', 'warn', 'GF')}
      ${task('Scrivere i testi dei caroselli', 'Ottica Venti', '3 commenti', 'oggi', 'warn', 'ML')}
    </div></section>
  <section style="margin-top:20px"><div class="sec-h"><h2>Prossimi giorni <span class="n">2</span></h2></div>
    <div class="card tbl">
      ${task('Report di novembre', 'Forno Luce', 'ogni mese', 'lun 30', '', 'GF')}
      ${task('Rinnovo del contratto', 'Palestra Arco', 'Studio Riva', 'mar 1', '', 'GF')}
    </div></section>`, { ctx: 'Tutti i clienti' })

/* ------------------------------------------------- Link per il cliente */
const share = (day, items) => `<div class="sh-day"><div class="day-h">${day}</div>${items}</div>`
const shPost = (time, th, kind, text, state) => `
  <article class="sh-post card">
    <div class="sh-top"><span class="thumb">${th}</span><div class="two"><b>${time} · ${kind}</b><span class="muted small">${I}${F}</span></div></div>
    <p>${text}</p>${state}
  </article>`
const condiviso = () => `
<div class="share">
  <header class="sh-h">
    <img src="../../assets/feedway-horizontal-carbone.svg" alt="Feedway" height="22">
    <span class="sp"></span>
    <span class="sh-who">${av('FL', 'sm')}<span><b>Forno Luce</b><small>gestito da Studio Riva</small></span></span>
  </header>
  <main class="sh-main">
    <h1>Dicembre 2026</h1>
    <p class="muted" style="margin:4px 0 16px">1 post da approvare</p>
    ${share('Martedì 1', shPost('18:00', img('impasto'), 'Reel', 'Il panettone, dall’impasto al forno. Ventiquattro ore di lievitazione per una fetta che profuma di casa.', `
      <div class="sh-state"><span class="dot warn">Da approvare</span></div>
      <div class="sh-act"><button class="btn">Chiedi una modifica</button><button class="btn primary">${ic('check')}Approva</button></div>`))}
    ${share('Giovedì 3', shPost('8:00', img('pane', '50% 30%'), 'Carosello', 'Le brioche di Natale si prenotano da oggi: cinque gusti, tutti fatti a mano.', `
      <div class="sh-state"><span class="dot ok">Approvato</span><span class="muted small">da Laura, ieri alle 21:14</span></div>`))}
    ${share('Sabato 5', `<div class="sh-plan">${ic('image')}<span><b>Gli orari delle feste</b><small>Foto · 9:00 · In preparazione</small></span></div>`)}
  </main>
</div>`

/* ------------------------------------------------------------ Statistiche */
const kpi = (label, value, delta) => `<div class="kpi card"><span class="muted small">${label}</span><b>${value}</b><span class="small up">${delta}</span></div>`
const WEEKS = [['2–8 nov', 52], ['9–15 nov', 64], ['16–22 nov', 88], ['23–29 nov', 71]]
const topPost = (th, text, reach) => `<div class="tr top-post"><span class="thumb">${th}</span><span class="trunc" style="font-weight:500">${text}</span><span class="muted tnum">${reach}</span></div>`
const statistiche = () => shell(`
  <header class="page-h"><h1>Statistiche</h1><span class="aside">Forno Luce · novembre 2026</span><span class="sp"></span><button class="btn">${ic('download')}Report del mese</button></header>
  <div class="kpis">
    ${kpi('Post pubblicati', '18', '+4 su ottobre')}
    ${kpi('Persone raggiunte', '24.310', '+18%')}
    ${kpi('Interazioni', '1.982', '+11%')}
    ${kpi('Nuovi follower', '312', '+96 su ottobre')}
  </div>
  <div class="two-col" style="margin-top:20px">
    <section><div class="sec-h"><h2>Persone raggiunte, per settimana</h2></div>
      <div class="card bars-card">${WEEKS.map(([w, v]) => `<div class="bar"><i style="height:${v * 2}px"></i><span class="muted small">${w}</span></div>`).join('')}</div></section>
    <section><div class="sec-h"><h2>I post che sono andati meglio</h2></div>
      <div class="card tbl">
        ${topPost(img('pane'), 'Il pane del lunedì', '6.120')}
        ${topPost(img('impasto'), 'Dietro il banco: la sfoglia', '4.870')}
        ${topPost(img('banco', '50% 20%'), 'Le brioche di Natale', '3.940')}
      </div></section>
  </div>`, { ctx: 'Forno Luce', ctxAv: av('FL', 'sm') })

Object.assign(PAGES2, { piano, attivita, condiviso, statistiche })
