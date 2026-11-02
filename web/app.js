(function () {
  'use strict';
  const HOST = 'leerlingen.ichthuscollege.nl';
  const P_CIJFERS = '/portaal/mijn_info/cijfers_en_examendossier';
  const P_HUISWERK = '/Portaal/Mijn_info/Huiswerk';
  const P_ROOSTER = '/Portaal/Roosters_en_toetsen/Lesrooster';
  const P_ABSENTIE = '/Portaal/Mijn_info/Absentie';
  const DEMO = window.__cpDemo || null; /* alleen voor de preview met voorbeelddata */
  if (location.hostname !== HOST && !DEMO) return;
  if (window.__cpApp) { window.__cpApp.refresh(); return; }

  const Native = window.CijferApp || (DEMO && DEMO.native) || null;
  /* plaatjes en lettertypes uit de app zelf; de iPhone-app kan /__ichthusplus/ niet onderscheppen en geeft ze als data-URL mee */
  const ASSETS = window.__cpAssets || null;
  const assetUrl = p => (ASSETS && ASSETS[p]) || (DEMO ? '/app/assets/' : '/__ichthusplus/') + p;
  /* iPhone-app: andere uitleg voor de widget, geen "trillen" */
  const IOS = window.__cpPlatform === 'ios';
  const IOS_WIDGET = '<p class="small"><b>Zo zet je hem neer:</b> houd een leeg plekje op je beginscherm ingedrukt → tik linksboven op <b>+</b> (of <b>Wijzig</b> → <b>Voeg widget toe</b>) → zoek <b>W.S.P</b> → kies een maat → <b>Voeg widget toe</b>. Ook op je toegangsscherm kan hij erbij.</p>';

  /* ---------- opslag ---------- */
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let store = ls.get('cijferpacks:v1', { init: false, seen: {} });
  const saveStore = () => ls.set('cijferpacks:v1', store);
  let done = ls.get('cp:hwdone', {});

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const toNum = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
  const LETTERS = { ZG: 9, G: 8, RV: 6, V: 6.5, M: 5.5, O: 4.5, ZO: 3.5 };
  const score = g => g.num != null ? g.num : (LETTERS[String(g.val).toUpperCase()] != null ? LETTERS[String(g.val).toUpperCase()] : 6);
  const TIERS = [
    { k: 'rood', label: 'Onvoldoende', min: -1 },
    { k: 'brons', label: 'Brons', min: 5.5 },
    { k: 'zilver', label: 'Zilver', min: 6.5 },
    { k: 'goud', label: 'Goud', min: 7.5 },
    { k: 'held', label: 'Held', min: 8.5 },
    { k: 'icoon', label: 'Icoon', min: 9.5 }
  ];
  const tierIdx = g => { const s = score(g); let i = 0; TIERS.forEach((t, j) => { if (s >= t.min) i = j; }); return i; };
  const tier = g => TIERS[tierIdx(g)];
  /* vakcode als gekleurd label; elke afkorting krijgt een vaste kleur */
  const emoji = afk => {
    const code = String(afk || '?').toLowerCase().replace(/^\d+/, '').split(/[ ,]/)[0].slice(0, 4) || '?';
    let h = 0;
    for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="vk-chip" style="--vh:${(h * 7) % 360}">${esc(code)}</span>`;
  };
  /* volledige vaknaam bij een afkorting (uit je cijferlijst), anders de afkorting zelf */
  const vakName = afk => {
    const code = String(afk || '').toLowerCase().split(/[ ,]/)[0];
    const subs = (window.__cpApp && window.__cpApp.subjects && window.__cpApp.subjects()) || [];
    const s = subs.find(x => x.afk.toLowerCase() === code);
    if (s) return s.name;
    const dv = window.__cpApp && window.__cpApp.docVak && window.__cpApp.docVak(code);
    return dv ? cap(dv) : String(afk || '').toUpperCase();
  };
  /* Nederlandse komma in cijfers: 7.4 wordt 7,4 */
  const dec = v => String(v == null ? '' : v).replace(/(\d)\.(\d)/, '$1,$2');
  const SOORT = { 'schriftelijke overhoring': 'SO', 'praktische opdracht': 'PO', 'theoretische toets': 'TOETS', 'repetitie': 'REP', 'mondeling': 'MO', 'proefwerk': 'PW' };
  const soortKort = g => SOORT[g.soort.toLowerCase()] || g.soort.split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 4) || '–';
  const shortDate = d => d ? d.split('-').slice(0, 2).join('-') : '–';
  const buzz = ms => { try { if (Native) Native.vibrate(Array.isArray(ms) ? ms.reduce((a, b) => a + b, 0) : ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };
  /* datum en tijd van de telefoon (die via netwerk/wifi gelijk wordt gezet); wijkt die meer dan 2 minuten af
     van de klok van de schoolserver, dan nemen we de servertijd */
  let clockOffset = 0;
  /* ontwikkelaar: doen alsof het een andere dag en tijd is. Alleen in de app; meldingen en wekkers volgen de echte tijd */
  const realNow = Date.now.bind(Date);
  const simOff = (ls.get('cp:simNow', null) || {}).off || 0;
  if (simOff) Date.now = () => realNow() + simOff;
  const now = () => new Date(Date.now() + clockOffset);
  function syncClock(res) {
    const d = Date.parse(res.headers.get('Date') || '');
    if (!isNaN(d)) clockOffset = Math.abs(d - realNow()) > 120000 ? d - realNow() : 0;
  }

  const pad = n => String(n).padStart(2, '0');
  const fmt = d => pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => { const x = dayStart(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const MONTHS = { jan: 0, feb: 1, mrt: 2, maa: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11 };
  const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const DAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const parseNlDate = s => {
    const m = clean(s).toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/);
    return m && MONTHS[m[2]] != null ? new Date(+m[3], MONTHS[m[2]], +m[1]) : null;
  };
  const niceDay = d => {
    const t = dayStart(now());
    if (sameDay(d, t)) return 'Vandaag';
    if (sameDay(d, addDays(t, 1))) return 'Morgen';
    if (sameDay(d, addDays(t, -1))) return 'Gisteren';
    return cap(DAYS[d.getDay()]) + ' ' + d.getDate() + ' ' + Object.keys(MONTHS).find(k => MONTHS[k] === d.getMonth() && k !== 'maa');
  };
  /* in het weekend toon je liever de komende week */
  const defaultMonday = () => { const t = now(); return mondayOf(t.getDay() === 6 || t.getDay() === 0 ? addDays(t, 2) : t); };

  /* ---------- ophalen ---------- */
  async function fetchDoc(url, mustHave) {
    let r;
    try { r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); }
    catch (e) { throw new Error('login'); }
    if (!r.ok || new URL(r.url).hostname !== HOST) throw new Error('login');
    syncClock(r);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    if (mustHave && !doc.querySelector(mustHave)) {
      if (!doc.querySelector('.wp3-portal-main, .main-content')) throw new Error('login');
      throw new Error('Deze pagina van het portaal ziet er anders uit dan verwacht.');
    }
    return doc;
  }

  function details(a) {
    const out = {};
    const d = new DOMParser().parseFromString(a.getAttribute('rel') || '', 'text/html');
    d.querySelectorAll('tr').forEach(tr => { if (tr.cells.length >= 3) out[tr.cells[0].textContent.trim()] = tr.cells[2].textContent.trim(); });
    return out;
  }

  function parsePeriod(doc, p, subjects, grades, ids) {
    const table = doc.querySelector('.som_cijfers table');
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map(th => (th.getAttribute('title') || th.textContent).trim().toLowerCase());
    const cT = heads.indexOf('toets'), cG = heads.indexOf('berekend rapportcijfer'), cR = heads.indexOf('rapportcijfer');
    table.querySelectorAll('tbody tr').forEach(tr => {
      const vs = tr.querySelector('td.vak span');
      if (!vs) return;
      const afk = vs.textContent.trim();
      const name = cap(vs.getAttribute('title') || afk);
      let s = subjects.get(afk);
      if (!s) subjects.set(afk, s = { afk, name, periods: {} });
      const per = s.periods[p] = { gem: null, rapport: null, items: [] };
      const anchors = c => c >= 0 && tr.cells[c] ? [...tr.cells[c].querySelectorAll('.wp3-cijfer > a.result__figure')] : [];
      anchors(cT).forEach(a => {
        const wrap = a.closest('.wp3-cijfer');
        const d = details(a);
        if (/^rapportcijfer van/i.test(d.Beschrijving || '')) return;
        const nested = !!wrap.parentElement.closest('.bubble');
        /* voor "wat moet ik halen": alleen de cijfers die zelf meetellen (een SO-blok telt als geheel) */
        const v = toNum(a.textContent.trim()), w = toNum(d.Weging);
        if (!nested && v != null && w) per.items.push({ v, w });
        if (wrap.classList.contains('triggerBubble')) return; /* samengevoegd SO-cijfer: de deelcijfers tellen los */
        const val = a.textContent.trim();
        const kind = nested ? 'deel' : 'toets';
        const g = {
          vak: name, afk, p, kind, val, num: toNum(val),
          oms: d.Beschrijving || d.Toetscode || 'Toets',
          code: d.Toetscode || '', soort: d.Toetssoort || '', weging: d.Weging || '',
          datum: d['Laatst gewijzigd op'] || '', herk: d.Herkansing || ''
        };
        let id = [afk, p, kind, g.code, g.oms].join('|');
        while (ids.has(id)) id += '+';
        ids.add(id);
        g.id = id;
        grades.push(g);
      });
      /* rapportcijfers worden live herberekend: alleen in het overzicht, geen pack */
      const ga = anchors(cG)[0];
      if (ga) per.gem = ga.textContent.trim();
      const ra = anchors(cR)[0];
      if (ra) per.rapport = ra.textContent.trim();
    });
  }

  /* full: alle perioden opnieuw (bij vernieuwen, of als het laatste volledige ophalen 6 uur geleden is).
     Anders data sparen: de actieve periode staat al op de eerste pagina, alleen "Eind" erbij, en oudere perioden uit het geheugen */
  async function loadGrades(full) {
    if (DEMO) return DEMO.grades;
    const base = await fetchDoc(P_CIJFERS, '.som_cijfers');
    const links = [...base.querySelectorAll('.som_cijfers .wp3-group-period-btns a.period-btn')];
    const periods = links.map(a => ({
      p: (a.getAttribute('rel') || a.textContent).trim(),
      url: new URL(a.getAttribute('href'), location.origin + P_CIJFERS).href,
      active: a.classList.contains('active')
    }));
    /* alleen de vorige keer hergebruiken als het dezelfde leerling is */
    const who = clean((base.querySelector('.wp3-portal-detail-user .hidden-xs') || {}).textContent || '');
    const prev = S.grades && S.grades.grades && S.grades.fullT && (!who || S.grades.student === who) ? S.grades : null;
    const light = !full && prev && Date.now() - prev.fullT < 6 * 3600000 && periods.some(x => x.active);
    const last = periods.length ? periods[periods.length - 1].p : null;
    const fetchP = x => light && !x.active && x.p !== last ? null : x.active && light ? base : fetchDoc(x.url, '.som_cijfers');
    const docs = periods.length ? await Promise.all(periods.map(fetchP)) : [base];
    if (!periods.length) periods.push({ p: '1', active: true });
    const yearEl = [...base.querySelectorAll('.som_cijfers .wp3-portlet-navigation-btns li')].find(li => /Leerjaar/.test(li.textContent));
    const subjects = new Map(), grades = [], ids = new Set();
    docs.forEach((d, i) => {
      if (d) return parsePeriod(d, periods[i].p, subjects, grades, ids);
      /* niet opgehaald: deze periode uit de vorige keer overnemen */
      const p = periods[i].p;
      prev.subjects.forEach(s => {
        if (!s.periods[p]) return;
        let t = subjects.get(s.afk);
        if (!t) subjects.set(s.afk, t = { afk: s.afk, name: s.name, periods: {} });
        t.periods[p] = s.periods[p];
      });
      prev.grades.filter(g => g.p === p).forEach(g => { ids.add(g.id); grades.push(g); });
    });
    const nameEl = base.querySelector('.wp3-portal-detail-user .hidden-xs');
    /* huidige periode: wat het portaal als actief aangeeft, of later als daar al cijfers in staan
       (zodra het eerste cijfer van periode 2 binnen is, opent Cijfers op periode 2). "Eind" telt niet mee */
    const realP = periods.length > 2 ? periods.slice(0, -1) : periods;
    const iActive = Math.max(0, realP.findIndex(x => x.active));
    let iGraded = -1;
    realP.forEach((x, i) => { if (grades.some(g => g.p === x.p && g.kind === 'toets')) iGraded = i; });
    const current = realP[Math.max(iActive, iGraded)].p;
    return {
      year: yearEl ? clean(yearEl.textContent.replace('Leerjaar:', '')) : '',
      student: nameEl ? clean(nameEl.textContent) : '',
      periods: periods.map(x => x.p),
      current,
      last: periods[periods.length - 1].p,
      subjects: [...subjects.values()],
      grades,
      fullT: light ? prev.fullT : Date.now()
    };
  }

  /* ---------- huiswerkherinneringen ---------- */
  /* regel: m = off | once | daily | every, d = dagen, t = "HH:MM"; de meest specifieke regel wint (item > vak > standaard) */
  let hwRules = ls.get('cp:hwrules', { def: { m: 'once', d: 1, t: '18:00' }, vak: {}, item: {} });
  function saveRules() {
    ls.set('cp:hwrules', hwRules);
    try { if (Native && Native.setHwRules) Native.setHwRules(JSON.stringify(Object.assign({}, hwRules, { done: Object.keys(done) }))); } catch (e) {}
  }
  const ruleFor = (id, vak) => (hwRules.item || {})[id] || (hwRules.vak || {})[String(vak).toLowerCase()] || hwRules.def;
  function ruleLabel(r) {
    if (!r || r.m === 'off') return 'Uit';
    const at = ' · ' + (r.t || '18:00');
    if (r.m === 'once') return (r.d === 1 ? 'De dag ervoor' : r.d + ' dagen ervoor') + at;
    if (r.m === 'daily') return 'Elke dag, vanaf ' + r.d + (r.d === 1 ? ' dag' : ' dagen') + ' ervoor' + at;
    return 'Om de ' + r.d + ' dagen' + at;
  }
  /* blad om een regel te kiezen; allowDefault: ook "Standaard" (= de regel erboven volgen) */
  function ruleSheet(title, current, allowDefault, onSave) {
    let r = current ? Object.assign({}, current) : null;
    const m = document.createElement('div');
    m.className = 'modal';
    const draw = () => {
      const mode = r ? r.m : 'std';
      const dOpts = mode === 'every' ? [2, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 7];
      m.innerHTML = `<div class="sheet"><h3>${title}</h3>
        <div class="lbl">Herinnering</div>
        <div class="seg" style="flex-wrap:wrap">${(allowDefault ? [['std', 'Standaard']] : []).concat([['off', 'Uit'], ['once', '1×'], ['daily', 'Elke dag'], ['every', 'Om de … dagen']])
          .map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-rm="${k}">${l}</button>`).join('')}</div>
        ${r && r.m !== 'off' ? `<div class="lbl">${r.m === 'once' ? 'Hoeveel dagen van tevoren' : r.m === 'daily' ? 'Vanaf hoeveel dagen ervoor' : 'Om de hoeveel dagen'}</div>
          <div class="seg">${dOpts.map(d => `<button class="${r.d === d ? 'on' : ''}" data-rd="${d}">${d}</button>`).join('')}</div>
          <div class="lbl">Tijd</div><input type="time" id="rule-time" value="${esc(r.t || '18:00')}" style="width:100%;background:var(--surface2);color:var(--fg);border:1px solid var(--line);border-radius:12px;padding:11px 12px;font:600 15px var(--f-body)">` : ''}
        <p class="small muted">${r ? ruleLabel(r) : 'Volgt de regel erboven.'}</p>
        <div class="row"><button class="btn" data-a="save">Opslaan</button><button class="btn ghost" data-a="close">Annuleren</button></div></div>`;
      m.querySelectorAll('[data-rm]').forEach(b => {
        b.onclick = () => {
          const k = b.dataset.rm;
          if (k === 'std') r = null;
          else r = Object.assign({ d: k === 'every' ? 2 : 1, t: (r && r.t) || '18:00' }, r || {}, { m: k });
          if (r && r.m === 'every' && r.d < 2) r.d = 2;
          draw();
        };
      });
      m.querySelectorAll('[data-rd]').forEach(b => { b.onclick = () => { r.d = +b.dataset.rd; draw(); }; });
      const ti = m.querySelector('#rule-time');
      if (ti) ti.onchange = () => { r.t = ti.value || '18:00'; };
      m.querySelector('[data-a=save]').onclick = () => { if (ti && r) r.t = ti.value || '18:00'; m.remove(); onSave(r); };
      m.querySelector('[data-a=close]').onclick = () => m.remove();
    };
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    draw();
    app.appendChild(m);
  }
  function openReminders(onClose) {
    const p = document.createElement('div');
    p.className = 'panel';
    const vakken = () => {
      const set = new Map();
      Object.values(S.hw).flat().forEach(it => set.set(it.vak.toLowerCase(), vakName(it.vak)));
      (S.grades ? S.grades.subjects : []).forEach(s => set.set(s.afk.toLowerCase(), s.name));
      return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    };
    const draw = () => {
      let next = [];
      try { next = Native && Native.nextReminders ? JSON.parse(Native.nextReminders()) : []; } catch (e) {}
      p.innerHTML = `<div class="panel-h"><h2>Herinneringen</h2><button class="btn" data-a="done">Klaar</button></div>
        <p class="small muted">Herinneringen voor huiswerk en toetsen. Huiswerk dat je hebt afgevinkt krijgt geen herinnering meer. Per huiswerkitem stel je het in met het belletje bij Huiswerk.</p>
        <div class="card-box"><button class="setrow" data-a="def" style="border-bottom:0;padding-bottom:4px"><span class="sr-t"><b>Standaard</b><small>${esc(ruleLabel(hwRules.def))}</small></span><span class="go">›</span></button></div>
        <div class="card-box"><div class="setting-h">Per vak</div>
          ${vakken().map(([k, name]) => `<button class="setrow" data-vak="${esc(k)}"><span>${emoji(k)}</span><span class="sr-t"><b>${esc(name)}</b><small>${hwRules.vak[k] ? esc(ruleLabel(hwRules.vak[k])) : 'Standaard'}</small></span><span class="go">›</span></button>`).join('') || '<p class="small muted">Nog geen vakken geladen.</p>'}
        </div>
        ${next.length ? `<div class="card-box"><div class="setting-h">Komende herinneringen</div>${next.map(n => { const d = new Date(n.at); return `<div class="listrow"><span>${emoji(n.vak)} ${esc(n.ond || vakName(n.vak))}</span><b>${esc(niceDay(dayStart(d)))} ${pad(d.getHours())}:${pad(d.getMinutes())}</b></div>`; }).join('')}</div>` : ''}`;
      p.querySelector('[data-a=done]').onclick = close;
      p.querySelector('[data-a=def]').onclick = () => ruleSheet('Standaard herinnering', hwRules.def, false, r => { hwRules.def = r || { m: 'off', d: 1, t: '18:00' }; saveRules(); draw(); });
      p.querySelectorAll('[data-vak]').forEach(b => {
        b.onclick = () => ruleSheet('Herinnering voor ' + vakName(b.dataset.vak), hwRules.vak[b.dataset.vak], true, r => {
          if (r) hwRules.vak[b.dataset.vak] = r; else delete hwRules.vak[b.dataset.vak];
          saveRules();
          draw();
        });
      });
    };
    function close() { p.remove(); if (onClose) onClose(); }
    p.closePanel = close;
    draw();
    app.appendChild(p);
    tip('hwremind', () => p.isConnected);
  }

  /* eigen reminders: zelf typen waaraan, welke dag en hoe laat. Android bewaart ze en geeft de melding (in de preview: localStorage) */
  const REP = [['none', 'Eenmalig'], ['daily', 'Elke dag'], ['days', 'Om de … dagen'], ['weekly', 'Om de … weken']];
  const ownRem = {
    get() {
      let l = [];
      try { l = Native && Native.getOwnReminders ? JSON.parse(Native.getOwnReminders()) : ls.get('cp:ownRem', []) || []; } catch (e) {}
      /* eenmalige die al geweest zijn blijven nog 2 weken in het rooster staan (doorgestreept), ook na de melding */
      const from = dayStart(now()).getTime() - 14 * 864e5;
      return l.filter(r => r.rep !== 'none' || r.at >= from).sort((a, b) => a.at - b.at);
    },
    /* voor Meer: alleen wat nog moet komen */
    upcoming() { return this.get().filter(r => !r.fired && (r.rep !== 'none' || r.at > Date.now())); },
    set(l) { if (Native && Native.setOwnReminders) Native.setOwnReminders(JSON.stringify(l)); else ls.set('cp:ownRem', l); },
    /* welke reminders er op een bepaalde dag afgaan, met het tijdstip op die dag */
    on(date) {
      const d = dayStart(new Date(date)), out = [];
      this.get().forEach(r => {
        const at = new Date(r.at), base = dayStart(at);
        if (r.rep === 'none') { if (sameDay(at, d)) out.push({ r, t: at }); return; }
        const step = r.rep === 'weekly' ? 7 * (r.n || 1) : r.rep === 'days' ? r.n || 1 : 1;
        const diff = Math.round((d - base) / 86400000);
        if (d < dayStart(new Date(r.start || r.at)) || ((diff % step) + step) % step) return;
        out.push({ r, t: new Date(d.getFullYear(), d.getMonth(), d.getDate(), at.getHours(), at.getMinutes()) });
      });
      return out.sort((a, b) => a.t - b.t);
    }
  };
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function ownRemLabel(r) {
    const d = new Date(r.at), t = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (r.rep === 'daily' || (r.rep === 'days' && r.n === 1)) return 'Elke dag · ' + t;
    if (r.rep === 'days') return 'Om de ' + r.n + ' dagen · ' + t;
    if (r.rep === 'weekly') return (r.n > 1 ? 'Om de ' + r.n + ' weken op ' : 'Elke ') + ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][d.getDay()] + ' · ' + t;
    return niceDay(dayStart(d)) + ' · ' + t;
  }
  /* blad om een reminder te zetten of aan te passen; zonder 'cur' een nieuwe */
  function ownRemSheet(cur, onSave) {
    const start = cur ? new Date(cur.at) : new Date(Date.now() + 3600000);
    if (!cur) start.setMinutes(0);
    let rep = cur ? cur.rep : 'none';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>${cur ? 'Reminder aanpassen' : 'Zet reminder'}</h3>
      <div class="lbl">Waaraan moet je denken?</div>
      <input class="inp" id="or-text" maxlength="140" placeholder="Bijv. gymspullen meenemen" value="${esc(cur ? cur.text : '')}">
      <div class="two"><div><div class="lbl">Dag</div><input class="inp" type="date" id="or-date" value="${ymd(start)}"></div>
        <div><div class="lbl">Tijd</div><input class="inp" type="time" id="or-time" value="${pad(start.getHours())}:${pad(start.getMinutes())}"></div></div>
      <div class="lbl">Herhalen</div>
      <div class="seg" style="flex-wrap:wrap">${REP.map(([k, l]) => `<button class="${rep === k ? 'on' : ''}" data-rep="${k}">${l}</button>`).join('')}</div>
      <div id="or-every" class="every"${rep === 'days' || rep === 'weekly' ? '' : ' hidden'}><span>Om de</span>
        <input class="inp" type="number" inputmode="numeric" min="1" max="99" id="or-n" value="${cur && cur.n ? cur.n : rep === 'days' ? 2 : 1}"><span id="or-unit">${rep === 'days' ? 'dagen' : 'weken'}</span></div>
      <p class="small muted" id="or-msg"></p>
      <div class="row">${cur ? '<button class="btn ghost" data-a="del" style="color:var(--red)">Verwijderen</button>' : '<button class="btn ghost" data-a="close">Annuleren</button>'}<button class="btn" data-a="save">Opslaan</button></div></div>`;
    const $ = s => m.querySelector(s);
    m.querySelectorAll('[data-rep]').forEach(b => {
      b.onclick = () => {
        rep = b.dataset.rep;
        m.querySelectorAll('[data-rep]').forEach(x => x.classList.toggle('on', x === b));
        $('#or-every').hidden = rep !== 'days' && rep !== 'weekly';
        $('#or-unit').textContent = rep === 'days' ? 'dagen' : 'weken';
      };
    });
    $('[data-a=save]').onclick = () => {
      const text = $('#or-text').value.trim(), dv = $('#or-date').value, tv = $('#or-time').value;
      const msg = t => { $('#or-msg').textContent = t; $('#or-msg').style.color = 'var(--red)'; };
      if (!text) return msg('Typ eerst waaraan je moet denken.');
      if (!dv || !tv) return msg('Kies een dag en een tijd.');
      const [y, mo, d] = dv.split('-').map(Number), [h, mi] = tv.split(':').map(Number);
      const at = new Date(y, mo - 1, d, h, mi);
      /* herhalend en het tijdstip is al voorbij: vanaf de eerstvolgende keer */
      const n = rep === 'days' || rep === 'weekly' ? Math.round(+$('#or-n').value) : 1;
      if (!(n >= 1 && n <= 99)) return msg('Vul bij "om de" een getal van 1 t/m 99 in.');
      const step = rep === 'weekly' ? 7 * n : n;
      while (rep !== 'none' && at.getTime() <= Date.now()) at.setDate(at.getDate() + step);
      if (at.getTime() <= Date.now()) return msg('Dat tijdstip is al voorbij.');
      m.remove();
      onSave({ id: cur ? cur.id : Date.now().toString(36), text, at: at.getTime(), start: at.getTime(), rep, n });
    };
    if (cur) $('[data-a=del]').onclick = () => { m.remove(); onSave(null); };
    else $('[data-a=close]').onclick = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    app.appendChild(m);
    if (!cur) setTimeout(() => $('#or-text').focus(), 250);
  }

  /* ---------- eigen huiswerk: zelf invullen (bijv. uit je agenda) als de docent het niet online zet ----------
     bewaard op deze telefoon onder je account: { id, vak, date (dag), onderwerp, huiswerk, toets } */
  const ownHwList = () => ls.get('cp:ownHw', []) || [];
  const ownHwItem = x => ({ id: 'own-' + x.id, vak: x.vak, onderwerp: x.onderwerp, huiswerk: x.huiswerk, date: x.date, datum: niceDay(new Date(x.date)),
    toets: !!x.toets, uur: '', docent: '', gemaakt: false, own: true });
  function ownHwWeek(mon) {
    const from = mon.getTime(), to = addDays(mon, 7).getTime();
    return ownHwList().filter(x => x.date >= from && x.date < to).map(ownHwItem);
  }
  /* de herinneringen op Android ook voor je eigen huiswerk (verwijderd = als gemaakt, dan komt er geen herinnering meer) */
  const ownHwToNative = (list, removed) => {
    try {
      if (Native && Native.setHwItems) Native.setHwItems(JSON.stringify(list.map(x => ({ id: 'own-' + x.id, vak: x.vak, ond: x.onderwerp, date: x.date, toets: !!x.toets, gemaakt: false }))
        .concat(removed ? [{ id: 'own-' + removed.id, vak: removed.vak, ond: removed.onderwerp, date: removed.date, toets: !!removed.toets, gemaakt: true }] : [])));
    } catch (e) {}
  };
  function ownHwSheet(cur) {
    const subs = new Map();
    (S.grades ? S.grades.subjects : []).forEach(s => subs.set(s.afk.toLowerCase(), s.name));
    Object.values(S.rooster).flat().filter(Boolean).forEach(d => d.lessons.forEach(l => { const k = String(l.vak || '').toLowerCase(); if (k && !subs.has(k)) subs.set(k, vakName(k)); }));
    const vakken = [...subs.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const start = cur ? new Date(cur.date) : dayStart(addDays(now(), 1));
    let toets = cur ? !!cur.toets : false;
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>${cur ? 'Huiswerk aanpassen' : 'Zelf huiswerk toevoegen'}</h3>
      <p class="small muted">Voor huiswerk dat de docent niet online heeft gezet. Alleen jij ziet het.</p>
      <div class="two"><div><div class="lbl">Vak</div><select class="inp" id="oh-vak">${vakken.map(([k, n]) => `<option value="${esc(k)}"${cur && cur.vak === k ? ' selected' : ''}>${esc(n)}</option>`).join('') || '<option value="">Vak</option>'}</select></div>
        <div><div class="lbl">Inleveren / toets op</div><input class="inp" type="date" id="oh-date" value="${ymd(start)}"></div></div>
      <div class="lbl">Wat moet je doen?</div>
      <input class="inp" id="oh-ond" maxlength="80" placeholder="Bijv. Opdracht 4 t/m 9" value="${esc(cur ? cur.onderwerp : '')}">
      <textarea class="inp" id="oh-txt" rows="3" maxlength="400" placeholder="Meer uitleg (mag leeg)" style="margin-top:8px;resize:vertical">${esc(cur ? cur.huiswerk : '')}</textarea>
      <div class="seg" style="margin-top:8px">${[[false, 'Huiswerk'], [true, 'Toets']].map(([k, l]) => `<button class="${toets === k ? 'on' : ''}" data-oht="${k}">${l}</button>`).join('')}</div>
      <p class="small" id="oh-msg" style="color:var(--red)"></p>
      <div class="row">${cur ? '<button class="btn ghost" data-a="del" style="color:var(--red)">Verwijderen</button>' : '<button class="btn ghost" data-a="close">Annuleren</button>'}<button class="btn" data-a="save">Opslaan</button></div></div>`;
    const $ = s => m.querySelector(s);
    m.querySelectorAll('[data-oht]').forEach(b => { b.onclick = () => { toets = b.dataset.oht === 'true'; m.querySelectorAll('[data-oht]').forEach(x => x.classList.toggle('on', x === b)); }; });
    const finish = () => { m.remove(); renderHomework(); };
    $('[data-a=save]').onclick = () => {
      const ond = $('#oh-ond').value.trim(), dv = $('#oh-date').value;
      if (!ond) { $('#oh-msg').textContent = 'Typ eerst wat je moet doen.'; return; }
      if (!dv) { $('#oh-msg').textContent = 'Kies een dag.'; return; }
      const [y, mo, d] = dv.split('-').map(Number);
      const item = { id: cur ? cur.id : Date.now().toString(36), vak: $('#oh-vak').value, date: new Date(y, mo - 1, d).getTime(), onderwerp: ond, huiswerk: $('#oh-txt').value.trim(), toets };
      const list = ownHwList().filter(x => x.id !== item.id).concat(item);
      ls.set('cp:ownHw', list);
      ownHwToNative(list);
      /* naar de week van dat huiswerk, zodat je het meteen ziet */
      S.hwMonday = mondayOf(new Date(item.date));
      toast(cur ? 'Aangepast' : 'Toegevoegd voor ' + niceDay(new Date(item.date)).toLowerCase());
      finish();
    };
    if (cur) $('[data-a=del]').onclick = () => { const list = ownHwList().filter(x => x.id !== cur.id); ls.set('cp:ownHw', list); ownHwToNative(list, cur); toast('Verwijderd'); finish(); };
    else $('[data-a=close]').onclick = () => m.remove();
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    app.appendChild(m);
  }

  /* onthoudt per huiswerkitem de tekst, zodat nieuwe items en nieuwe aantekeningen een label krijgen */
  async function loadHomework(monday) {
    const items = DEMO ? DEMO.homework(monday) : await loadHomeworkRaw(monday);
    const seen = ls.get('cp:hwseen', null);
    const next = seen || {};
    /* nieuw of aangepast: onthouden voor het rode getalletje bij Huiswerk, tot je het tabblad bekijkt */
    const pending = new Set(ls.get('cp:hwNew', []) || []);
    items.forEach(it => {
      if (seen) it.badge = !(it.id in seen) ? 'NIEUW' : seen[it.id] !== it.huiswerk ? 'AANGEPAST' : '';
      if (!it.badge && pending.has(it.id)) it.badge = 'NIEUW'; /* nog niet bekeken: label blijft staan */
      if (it.badge) pending.add(it.id);
      next[it.id] = it.huiswerk;
    });
    ls.set('cp:hwseen', next);
    ls.set('cp:hwNew', [...pending].slice(-50));
    /* de herinneringen op Android kennen zo meteen het nieuwste huiswerk */
    try {
      if (Native && Native.setHwItems) Native.setHwItems(JSON.stringify(items.filter(it => it.date).map(it => ({ id: it.id, vak: it.vak, ond: it.onderwerp, date: it.date, toets: !!it.toets, gemaakt: !!it.gemaakt }))));
    } catch (e) {}
    return items;
  }
  async function loadHomeworkRaw(monday) {
    const doc = await fetchDoc(P_HUISWERK + '?startdate=' + fmt(monday) + '&done=all', '.som_huiswerk');
    const table = doc.querySelector('.som_huiswerk table.wp3-portlet-table-data');
    const items = [];
    if (table) {
      const heads = [...table.querySelectorAll('thead th')].map(th => clean(th.textContent).toLowerCase());
      const col = n => heads.indexOf(n);
      const c = { vak: col('vak'), ond: col('onderwerp'), dat: col('datum'), hw: col('huiswerk'), doc: col('docent'), uur: col('lesuur'), gem: col('gemaakt'), toets: col('toets') };
      table.querySelectorAll('tbody tr').forEach(tr => {
        const cell = i => i >= 0 && tr.cells[i] ? tr.cells[i] : null;
        const txt = i => cell(i) ? clean(cell(i).textContent) : '';
        if (tr.cells.length < 3) return;
        const date = parseNlDate(txt(c.dat));
        const it = {
          vak: txt(c.vak), onderwerp: txt(c.ond), date: date ? date.getTime() : null, datum: txt(c.dat),
          huiswerk: cell(c.hw) ? clean(cell(c.hw).innerText || cell(c.hw).textContent) : '',
          docent: txt(c.doc), uur: txt(c.uur), gemaakt: /ja|✓|x/i.test(txt(c.gem)), toets: /ja/i.test(txt(c.toets))
        };
        it.id = [it.vak, it.datum, it.onderwerp].join('|');
        items.push(it);
      });
    }
    return items;
  }

  /* ---------- Zermelo (actueel rooster met uitval) ---------- */
  let zm = ls.get('cp:zermelo', null); /* { school, token, sso } */
  /* de app-kant kan de toegang op de achtergrond vernieuwd hebben: die is leidend */
  try {
    const nz = Native && Native.getZermelo ? JSON.parse(Native.getZermelo()) : null;
    if (nz && nz.token) { zm = { school: nz.school, token: nz.token, sso: !!nz.sso }; ls.set('cp:zermelo', zm); }
  } catch (e) {}
  const zmBase = () => 'https://' + zm.school + '.zportal.nl/api/v3';
  async function zermeloLink(school, code) {
    school = school.trim().toLowerCase().replace(/\.zportal\.nl.*$/, '').replace(/^https?:\/\//, '');
    code = code.replace(/\s+/g, '');
    if (!/^[a-z0-9-]+$/.test(school)) throw new Error('Die schoolnaam klopt niet. Je ziet hem in Zermelo bij "Koppel App".');
    if (!/^\d{8,16}$/.test(code)) throw new Error('De koppelcode bestaat uit cijfers (meestal 12).');
    let r;
    try {
      r = await fetch('https://' + school + '.zportal.nl/api/v3/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=' + encodeURIComponent(code)
      });
    } catch (e) { throw new Error('Geen verbinding met Zermelo. Klopt de schoolnaam?'); }
    if (!r.ok) throw new Error(r.status === 400 || r.status === 401 ? 'Deze koppelcode werkt niet (meer). Maak in Zermelo een nieuwe aan.' : 'Zermelo gaf een fout (' + r.status + ').');
    const j = await r.json();
    if (!j.access_token) throw new Error('Zermelo gaf geen toegang terug.');
    zm = { school, token: j.access_token };
    ls.set('cp:zermelo', zm);
    if (Native && Native.setZermelo) Native.setZermelo(school, j.access_token);
  }
  /* inloggen via je schoolaccount: de app opent Zermelo zoals de link op het portaal dat doet */
  async function zmSsoUrl() {
    let u = ls.get('cp:zmurl2', null);
    if (u) return u;
    try {
      const doc = await fetchDoc('/portaal/home');
      const a = doc.querySelector('a[href*="zportal.nl"]');
      if (a) u = new URL(a.getAttribute('href'), location.origin).href;
    } catch (e) {}
    u = u || 'https://ichthus.zportal.nl/';
    ls.set('cp:zmurl2', u);
    return u;
  }
  async function zermeloSso(silent) {
    if (!Native || !Native.zermeloSso) throw new Error('Inloggen via je schoolaccount werkt alleen in de app.');
    Native.zermeloSso(await zmSsoUrl(), !!silent);
  }
  window.__cpZmLinked = (school, token, mode) => {
    zm = { school, token, sso: mode === 'sso' };
    ls.set('cp:zermelo', zm);
    S.rooster = {}; S.fresh = {}; try { localStorage.removeItem('cp:wk:r'); } catch (e) {}
    S.rDay = null;
    S.zmRenewing = false;
    sh.querySelectorAll('.modal.zm').forEach(x => x.remove());
    if (S.tab === 'rooster') renderRooster(); else if (S.tab === 'meer') renderMore();
  };
  window.__cpZmFailed = msg => {
    S.zmRenewing = false;
    const e = sh.querySelector('.modal.zm .zerr');
    if (e) { e.innerHTML = errBox(msg); return; }
    if (zm && zm.sso) { zermeloUnlink(); S.rooster = {}; S.fresh = {}; try { localStorage.removeItem('cp:wk:r'); } catch (e) {} if (S.tab === 'rooster') renderRooster(); }
  };
  function zermeloUnlink() {
    zm = null;
    ls.set('cp:zermelo', null);
    if (Native && Native.setZermelo) Native.setZermelo('', '');
  }
  /* ---------- rooster van iemand anders (Zermelo, als je school dat toestaat) ---------- */
  function otherRooster(code, name) {
    const p = document.createElement('div');
    p.className = 'panel';
    let mon = defaultMonday();
    const close = () => p.remove();
    p.closePanel = close;
    const draw = async () => {
      const fri = addDays(mon, 4);
      p.innerHTML = `<div class="panel-h"><h2 style="font-size:22px">${esc(name)}</h2><button class="btn" data-a="done">Klaar</button></div>
        <div class="weeknav"><button class="ibtn" data-d="-7">‹</button><div class="lbl">Week ${isoWeek(mon)}<small>${mon.getDate()}/${mon.getMonth() + 1} t/m ${fri.getDate()}/${fri.getMonth() + 1}</small></div><button class="ibtn" data-d="7">›</button></div>
        <div data-body>${skeleton('rooster')}</div>`;
      p.querySelector('[data-a=done]').onclick = close;
      p.querySelectorAll('[data-d]').forEach(b => { b.onclick = () => { mon = addDays(mon, +b.dataset.d); draw(); }; });
      const body = p.querySelector('[data-body]'), want = mon.getTime();
      try {
        const days = DEMO ? DEMO.rooster(mon) : await loadZermelo(mon, code);
        if (mon.getTime() !== want || !p.isConnected) return;
        const html = days.map(d => {
          const ls2 = d.lessons.filter(l => l.vak);
          return `<div class="day-h">${esc(niceDay(new Date(d.date)))}</div>` + (ls2.length ? ls2.map(l => `<div class="card-box les${l.uitval ? ' vervallen' : ''}">
            <div class="uur"><b>${esc(l.uur || '–')}</b><span>${esc((l.tijd || '').split('-')[0].trim())}</span></div>
            <div class="wat"><b>${esc(vakName(l.vak))} ${l.uitval ? '<span class="tag red">UITVAL</span>' : ''}</b><span>${esc(l.tijd)}${l.docent ? ' · ' + esc(l.docent) : ''}</span></div>
            <div class="lok">${esc(l.lokaal || '–')}</div></div>`).join('') : `<div class="free small-free"><b>Vrij</b></div>`);
        }).join('');
        body.innerHTML = html || emptyHtml('rooster', 'Geen lessen deze week', '');
      } catch (e) { if (p.isConnected) body.innerHTML = errBox(e); }
    };
    draw();
    app.appendChild(p);
  }
  /* user: ~me (jezelf) of de leerlingcode van iemand anders (als je school dat toestaat) */
  async function loadZermelo(monday, user = '~me') {
    const start = Math.floor(monday.getTime() / 1000), end = Math.floor(addDays(monday, 7).getTime() / 1000);
    /* zonder valid=true: dan komen ook de oude versies van gewijzigde lessen mee (valid: false), zodat we bij een
       lokaalwijziging kunnen laten zien waar het eerst was. Die oude versies tonen we verder niet */
    const r = await fetch(zmBase() + '/appointments?user=' + encodeURIComponent(user) + '&start=' + start + '&end=' + end + '&access_token=' + encodeURIComponent(zm.token));
    /* rooster van iemand anders: geen toegang betekent niet dat jouw koppeling verlopen is */
    if (user !== '~me' && (r.status === 403 || r.status === 404)) throw new Error(r.status === 404 ? 'Deze leerling is niet gevonden.' : 'Je school staat niet toe dat je dit rooster bekijkt.');
    if (r.status === 401 || r.status === 403) {
      if (zm.sso && Native && Native.zermeloSso) {
        /* een login via je schoolaccount verloopt na ongeveer 16 uur: stil opnieuw inloggen */
        if (!S.zmRenewing) { S.zmRenewing = true; zermeloSso(true); }
        throw new Error('Opnieuw verbinden met Zermelo… Even geduld.');
      }
      zermeloUnlink();
      throw new Error('De koppeling met Zermelo is verlopen. Koppel opnieuw in Meer.');
    }
    if (!r.ok) throw new Error('Zermelo gaf een fout (' + r.status + ').');
    const all = ((await r.json()).response || {}).data || [];
    /* oude versie per les (zelfde appointmentInstance), de laatst gewijzigde */
    const old = new Map();
    all.filter(a => a.valid === false && a.appointmentInstance != null).forEach(a => {
      const o = old.get(a.appointmentInstance);
      if (!o || (a.lastModified || 0) > (o.lastModified || 0)) old.set(a.appointmentInstance, a);
    });
    const data = all.filter(a => a.valid !== false);
    const hm = t => { const d = new Date(t * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    const byDay = new Map();
    data.filter(a => a.type !== 'choice').sort((a, b) => a.start - b.start).forEach(a => {
      const lok = (a.locations || []).join(', ');
      /* waar was het eerst: de oude versie van deze les, anders uit de omschrijving ("van a138 naar b065") */
      const o = old.get(a.appointmentInstance), oLok = o ? (o.locations || []).join(', ') : '';
      const fromText = (/van\s+([a-z]?\d{2,3}[a-z]?)\s+naar/i.exec(a.changeDescription || '') || [])[1] || '';
      const was = oLok && oLok !== lok ? oLok : fromText && fromText.toLowerCase() !== lok.toLowerCase() ? fromText : '';
      const k = dayStart(new Date(a.start * 1000)).getTime();
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push({
        tijd: hm(a.start) + ' - ' + hm(a.end),
        uur: (() => { const s = a.startTimeSlotName != null ? String(a.startTimeSlotName) : a.startTimeSlot != null ? String(a.startTimeSlot) : ''; const n = parseInt(s.replace(/^\D+/, ''), 10); return isNaN(n) ? '' : String(n); })(),
        lokaal: lok, wasLokaal: was, vak: (a.subjects || []).join(', ') || (a.type === 'exam' ? 'toets' : a.type || ''),
        docent: (a.teachers || []).map(cap).join(', '), groep: (a.groups || []).join(', '),
        uitval: !!a.cancelled, wijziging: a.cancelled && /vervalt/i.test(a.changeDescription || '') ? '' : clean(a.changeDescription || ''), opmerking: clean(a.remark || ''),
        lokaalAnders: !!a.locationChanged || !!was || /lokaal/i.test(a.changeDescription || ''), tijdAnders: !!(a.timeChanged || a.moved), nieuw: !!a.new, type: a.type || 'lesson'
      });
    });
    const days = [];
    for (let i = 0; i < 5; i++) { const k = addDays(monday, i).getTime(); days.push({ date: k, lessons: byDay.get(k) || [] }); }
    return days;
  }

  let roosterKey = ls.get('cp:roosterKey', null);
  /* het portaal geeft soms een lege week terug; dan nog één keer proberen */
  async function loadRooster(monday) {
    if (DEMO) return DEMO.rooster(monday);
    if (zm) return rememberRooms(await loadZermelo(monday));
    const days = await loadRoosterOnce(monday);
    return rememberRooms(days.length ? days : await loadRoosterOnce(monday));
  }
  /* het gewone lokaal per les onthouden (dag + tijd + vak); is het later anders, dan weten we waar het eerst was */
  function rememberRooms(days) {
    const seen = ls.get('cp:lokSeen', {}) || {}, cutoff = Date.now() - 21 * 864e5;
    days.forEach(d => d.lessons.forEach(l => {
      if (!l.lokaal || !l.vak) return;
      const k = d.date + '|' + (l.tijd || '').split('-')[0].trim() + '|' + l.vak.toLowerCase();
      if (l.lokaalAnders) { if (!l.wasLokaal && seen[k] && seen[k] !== l.lokaal) l.wasLokaal = seen[k]; }
      else seen[k] = l.lokaal;
    }));
    Object.keys(seen).forEach(k => { if (+k.split('|')[0] < cutoff) delete seen[k]; });
    ls.set('cp:lokSeen', seen);
    return days;
  }
  async function loadRoosterOnce(monday) {
    if (!roosterKey) {
      const base = await fetchDoc(P_ROOSTER, '.som_rooster');
      const a = base.querySelector('.som_rooster .wp3-portlet-navigation a[href*="startdate"]');
      const m = a && a.getAttribute('href').match(/(startdate\d*)=/);
      roosterKey = m ? m[1] : 'startdate';
      ls.set('cp:roosterKey', roosterKey);
    }
    const doc = await fetchDoc(P_ROOSTER + '?' + roosterKey + '=' + fmt(monday), '.som_rooster');
    const days = [];
    doc.querySelectorAll('.som_rooster .wp3-portlet-content .wp3-portlet-table-wrapper').forEach(w => {
      const h = w.querySelector('.wp3-portlet-table-data-currday');
      const date = h ? parseNlDate(h.textContent) : null;
      if (!date) return;
      const lessons = [];
      w.querySelectorAll(':scope > table > tbody > tr').forEach(tr => {
        const q = cls => { const td = tr.querySelector('td.' + cls); return td ? clean(td.textContent) : ''; };
        if (!q('time') && !q('course')) return;
        lessons.push({ tijd: q('time'), uur: q('hour'), lokaal: q('classroom'), vak: q('course'), groep: q('group'), docent: q('teacher'), status: clean(tr.className) });
      });
      days.push({ date: date.getTime(), lessons });
    });
    return days;
  }

  /* docenten: code (= begin van het e-mailadres) -> naam, e-mail, vakken. Een week bewaard. */
  let docenten = ls.get('cp:docenten', null);
  async function loadDocenten(force) {
    if (DEMO) return (docenten = DEMO.docenten || { list: {}, vakken: {}, t: Date.now() });
    if (!force && docenten && Date.now() - docenten.t < 7 * 864e5) return docenten;
    const base = await fetchDoc('/Portaal/Mijn_info/Docenten', '.som_docenten');
    const w = base.querySelector('.som_docenten');
    const id = w.getAttribute('rel') || (w.id || '').replace(/\D/g, '');
    const r = await fetch('/Portaal/Mijn_info/Docenten?wis_ajax&ajax_object=' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' });
    const d = new DOMParser().parseFromString(await r.text(), 'text/html');
    const list = {}, vakken = {};
    d.querySelectorAll('li').forEach(li => {
      const name = clean((li.querySelector('.wp3-header') || {}).textContent);
      const mail = (li.querySelector('a[href^="mailto:"]') || { getAttribute: () => '' }).getAttribute('href').replace(/^mailto:/i, '');
      if (!name || !mail) return;
      const code = mail.split('@')[0].toLowerCase();
      const vk = [...li.querySelectorAll('.wp3-course span[title]')].map(s => { vakken[clean(s.textContent).toLowerCase()] = s.getAttribute('title'); return s.getAttribute('title'); });
      list[code] = { name, mail, vakken: vk };
    });
    docenten = { list, vakken, t: Date.now() };
    ls.set('cp:docenten', docenten);
    return docenten;
  }
  const docent = code => docenten && docenten.list[String(code || '').toLowerCase().split(/[ ,]/)[0]];
  function showDocent(code) {
    const dc = docent(code);
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>${esc(dc ? dc.name : String(code).toUpperCase())}</h3>
      ${dc ? `<div class="listrow"><span class="muted">Code</span><b>${esc(String(code).toUpperCase())}</b></div>
        <div class="listrow"><span class="muted">E-mail</span><b style="user-select:text">${esc(dc.mail)}</b></div>
        ${dc.vakken.length ? `<div class="listrow"><span class="muted">Vakken</span><b>${esc(dc.vakken.join(', '))}</b></div>` : ''}
        <div class="row"><button class="btn" data-a="mail">Mail sturen</button><button class="btn ghost" data-a="copy">Kopieer e-mail</button></div>`
        : '<p class="small muted">Deze docent staat niet in je docentenlijst op het portaal.</p>'}
      <button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    const mb = m.querySelector('[data-a=mail]');
    if (mb) mb.onclick = () => { if (Native && Native.open) Native.open('mailto:' + dc.mail); else location.href = 'mailto:' + dc.mail; };
    const cb = m.querySelector('[data-a=copy]');
    if (cb) cb.onclick = async () => { try { await navigator.clipboard.writeText(dc.mail); cb.textContent = 'Gekopieerd ✓'; } catch (e) { cb.textContent = dc.mail; } };
    app.appendChild(m);
  }

  /* docentcode als tikbare knop; volledige naam als die bekend is (full: hele naam, anders achternaam) */
  function docBtn(code, full) {
    const dc = docent(code);
    const label = dc ? (full ? dc.name : dc.name.replace(/^([A-Z]\.)+\s*/, '').split(' - ')[0]) : cap(String(code));
    return `<button class="doc" data-doc="${esc(String(code).split(/[ ,]/)[0])}">${esc(label)}</button>`;
  }

  async function loadAbsence() {
    if (DEMO) return DEMO.absence;
    let doc = await fetchDoc(P_ABSENTIE, '.som_absentie');
    /* het portaal laadt de absentie vaak pas na via ajax (net als de docentenlijst): dan staat er bij de eerste keer niks.
       Haal in dat geval zelf het ajax-deel op, en probeer het zo nodig nog één keer */
    const hasTotals = d => d.querySelector('.wp3-absence_stats_overview .totals');
    for (let i = 0; i < 2 && !hasTotals(doc); i++) {
      const w = doc.querySelector('.som_absentie');
      const id = w && (w.getAttribute('rel') || (w.id || '').replace(/\D/g, ''));
      if (id) {
        const r = await fetch(P_ABSENTIE + '?wis_ajax&ajax_object=' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' });
        const d = new DOMParser().parseFromString('<div class="som_absentie">' + await r.text() + '</div>', 'text/html');
        if (hasTotals(d)) { doc = d; break; }
      }
      await new Promise(res => setTimeout(res, 1200));
      doc = await fetchDoc(P_ABSENTIE, '.som_absentie');
    }
    const totals = [...doc.querySelectorAll('.som_absentie .wp3-absence_stats_overview .totals')].map(t => ({
      label: clean((t.querySelector('.wp3-small-header') || t).textContent).replace(/:$/, '').replace(/\s+,/g, ','),
      value: clean((t.querySelector('.wp3-absence-stats-result') || t).textContent).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    }));
    const items = [];
    doc.querySelectorAll('.som_absentie .wp3-portlet-content .wp3-portlet-table-wrapper').forEach(w => {
      const h = w.querySelector('.wp3-portlet-table-data-currday');
      const date = h ? parseNlDate(h.textContent) : null;
      w.querySelectorAll(':scope > table > tbody > tr').forEach(tr => {
        const q = cls => { const td = tr.querySelector('td.' + cls); return td ? clean(td.textContent) : ''; };
        const abs = q('absentie');
        if (abs) items.push({ date: date ? date.getTime() : null, uur: q('hour'), vak: q('course'), absentie: abs, afgehandeld: q('handled') });
      });
    });
    return { totals, items };
  }

  /* ---------- stijl ---------- */
  const CSS = `
  /* Ontwerp: een lesrooster-bord. Grote dagtitel, rustige lijsten met haarlijnen; kaarten alleen voor wat los staat.
     Display: Bricolage Grotesque (titels en cijfers) · tekst: Figtree · data: JetBrains Mono (tijden, lokalen, vakcodes). */
  :host { all: initial; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  .app {
    --bg: #0d0c0a; --surface: #161512; --surface2: #201e1a; --line: #2b2924; --fg: #f3f1ec; --fg2: #c9c5bb; --muted: #8d887d; --nav: #0d0c0a;
    --accent: #ffd34d; --ink: #000; --accent-text: var(--accent);
    --red: #ff6b5e; --red-bg: #2b1311; --red-line: #5e2822; --red-fg: #ffd9d4; --good: #4fd98a; --good-bg: #10261a; --gold: #ffc83d; --gold-bg: #2b2310;
    --vk-l: 74%; --vk-bg: .16;
    --f-display: 'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif;
    --f-body: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --f-mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
    --card: var(--surface); --card2: var(--surface2);
    position: fixed; inset: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 var(--f-body);
    display: flex; flex-direction: column; overflow: hidden; user-select: none; color-scheme: dark;
    touch-action: manipulation; /* tikken reageert meteen (geen wachten op een eventuele dubbeltik) */
  }
  .app.light {
    --bg: #f6f5f2; --surface: #ffffff; --surface2: #efede8; --line: #e2dfd7; --fg: #17160f; --fg2: #45423a; --muted: #6f6b61; --nav: #ffffff;
    --red: #d6382b; --red-bg: #fdecea; --red-line: #f2bdb7; --red-fg: #7d1d15; --good: #138a4a; --good-bg: #e5f5ec; --gold: #a86f00; --gold-bg: #fdf3dc;
    --vk-l: 36%; --vk-bg: .13; color-scheme: light; --accent-text: color-mix(in srgb, var(--accent) 55%, #000);
  }
  /* thema met achtergrondfoto: foto onder een donkere (of lichte) waas, vlakken half doorzichtig */
  .app.photo { background: linear-gradient(180deg, rgb(var(--shade) / .25) 0%, rgb(var(--shade) / .55) 35%, rgb(var(--shade) / .82) 100%), var(--photo) center / cover no-repeat, var(--bg);
    --shade: 13 12 10; --surface: rgb(22 21 18 / .82); --surface2: rgb(40 38 33 / .78); --line: rgb(255 255 255 / .12); --nav: rgb(13 12 10 / .9); }
  .app.photo.light { --shade: 246 245 242; --surface: rgb(255 255 255 / .86); --surface2: rgb(239 237 232 / .86); --line: rgb(0 0 0 / .1); --nav: rgb(255 255 255 / .92); }
  .app.photo header h1, .app.photo .hdate { text-shadow: 0 1px 12px rgb(var(--shade) / .7); }
  .app.photo .card-box.les:not(.now):not(.vervallen) { background: rgb(var(--shade) / .62); border-radius: 12px; border-bottom: 0; margin-bottom: 4px; padding-inline: 10px; }
  .panel { position: absolute; inset: 0; z-index: 45; background: var(--bg); overflow-y: auto; padding: 18px 20px 28px; display: flex; flex-direction: column; gap: 14px; }
  .panel > * { flex-shrink: 0; } /* anders worden bij een lang scherm de knoppenrijen platgedrukt tot niks */
  .app.photo .panel { background: rgb(var(--shade) / .94); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
  .panel-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .panel-h h2 { font-size: 28px; }
  .panel-h .btn { padding: 9px 16px; font-size: 15px; }
  .setrow { appearance: none; display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); padding: 4px 0 12px; color: var(--fg); }
  .setrow .sr-pic { width: 46px; height: 46px; border-radius: 12px; background: var(--pic) var(--pos, 50% 50%) / cover no-repeat; box-shadow: 0 0 0 1px var(--line); flex-shrink: 0; }
  .setrow .sr-t { flex: 1; min-width: 0; }
  .setrow .sr-t b { display: block; font: 700 16px var(--f-display); }
  .setrow .sr-t small { color: var(--muted); font-size: 13px; }
  .setrow .go { color: var(--muted); font: 700 20px var(--f-display); }
  .themes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .theme { appearance: none; border: 2px solid transparent; border-radius: 14px; padding: 0; overflow: hidden; background: var(--surface2); color: var(--fg); text-align: left; }
  .theme .tpic { display: block; aspect-ratio: 16 / 11; background: var(--pic) var(--pos, 50% 50%) / cover no-repeat, linear-gradient(160deg, #222, #000); position: relative; }
  .theme .tpic i { position: absolute; left: 6px; bottom: 6px; width: 14px; height: 14px; border-radius: 50%; background: var(--dot); box-shadow: 0 0 0 2px rgb(0 0 0 / .4); }
  .theme span.tn { display: block; padding: 6px 8px 7px; font: 600 12px var(--f-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .theme.on { border-color: var(--accent); }
  .photo-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .photo-row .btn { padding: 9px 14px; font-size: 14px; }
  .photo-row input[type=file] { display: none; }
  /* logo's */
  .logos { display: flex; align-items: center; justify-content: center; gap: 22px; padding: 14px; border-radius: 14px; background: #fff; }
  .logos img { height: 38px; width: auto; }
  .zm-mark { display: inline-flex; align-items: center; gap: 6px; }
  .zm-mark img { height: 12px; width: auto; }
  /* voorwaarden bij de eerste start */
  .terms { position: absolute; inset: 0; z-index: 90; background: var(--bg); overflow-y: auto; padding: 24px 22px 28px; display: flex; flex-direction: column; gap: 14px; }
  .terms h2 { font-size: 28px; }
  .terms ul { margin: 0; padding-left: 18px; display: grid; gap: 8px; color: var(--fg2); font-size: 14px; }
  .terms ul b { color: var(--fg); }
  .terms label.agree { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); font-size: 14px; }
  .terms label.agree input { width: 22px; height: 22px; accent-color: var(--accent); flex-shrink: 0; margin: 0; }
  .terms .btn[disabled] { opacity: .4; }
  button { font-family: inherit; cursor: pointer; }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* kop en tabbalk */
  header { display: flex; align-items: flex-end; gap: 12px; padding: 16px 20px 10px; flex-shrink: 0; }
  .hmark { width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0; align-self: center; }
  .hd { flex: 1; min-width: 0; }
  .hdate { margin: 0 0 2px; font: 600 11px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  header h1 { margin: 0; font: 800 30px/1.05 var(--f-display); letter-spacing: -.025em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  header h1 i { font-style: normal; color: var(--accent-text); }
  .ibtn { appearance: none; border: 1px solid var(--line); background: var(--surface); color: var(--fg); width: 40px; height: 40px; border-radius: 12px;
    font-size: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ibtn svg { width: 18px; height: 18px; }
  .ibtn.spin svg { animation: rot .8s linear infinite; }
  .pageghost { position: absolute; left: 0; right: 0; overflow: hidden; pointer-events: none; z-index: 4; transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .2s; }
  main { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; position: relative; overscroll-behavior: contain; }
  .pad { padding: 4px 20px 28px; display: flex; flex-direction: column; gap: 12px; }
  nav.tabs { flex-shrink: 0; display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--line); background: var(--nav); padding: 6px 6px 10px; position: relative; }
  /* het gekleurde vlakje achter het actieve icoon schuift mee naar het tabblad waar je heen gaat */
  nav.tabs .tabpill { position: absolute; left: 0; top: 0; height: 28px; width: 46px; border-radius: 14px; background: color-mix(in srgb, var(--accent) 22%, transparent); pointer-events: none;
    transition: transform .32s cubic-bezier(.3, 1.3, .5, 1), width .32s; }
  nav.tabs .tabpill.instant { transition: none; }
  nav.tabs button { z-index: 1; }
  nav.tabs button { appearance: none; border: 0; background: none; color: var(--muted); font: 600 11px var(--f-body); display: flex; flex-direction: column;
    align-items: center; gap: 3px; padding: 4px 0; position: relative; }
  nav.tabs button .ico { width: 46px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; transition: background .2s; }
  nav.tabs button svg { width: 22px; height: 22px; }
  nav.tabs button.on { color: var(--fg); }
  nav.tabs button.on .ico { color: var(--accent-text); }
  nav.tabs .dot { position: absolute; top: 0; left: calc(50% + 7px); min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--red);
    color: #fff; font: 700 10px/17px var(--f-mono); text-align: center; box-shadow: 0 0 0 2px var(--nav); }

  /* basis */
  .card-box { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 14px 16px; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  .center { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 24px; text-align: center; gap: 14px; }
  .center p { max-width: 34ch; }
  h2 { margin: 0; font: 800 24px/1.15 var(--f-display); letter-spacing: -.02em; text-wrap: balance; }
  p { margin: 0; }
  .btn { appearance: none; border: 0; font: 700 16px var(--f-display); padding: 13px 22px; border-radius: 14px; background: var(--accent); color: var(--ink); }
  .btn:active { transform: scale(.97); }
  .btn.ghost { background: var(--surface2); color: var(--fg); border: 1px solid var(--line); font-weight: 600; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: rot .8s linear infinite; }
  @keyframes rot { to { transform: rotate(360deg); } }
  .seg { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .seg.wrap { flex-wrap: wrap; overflow: visible; }
  .inp { width: 100%; box-sizing: border-box; background: var(--surface2); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px; font: 600 15px var(--f-body); }
  .inp:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .every { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-weight: 600; }
  .every span { white-space: nowrap; }
  .every input.inp { flex: 0 0 80px; width: 80px; text-align: center; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .absx { appearance: none; border: 0; background: var(--surface2); color: var(--muted); width: 26px; height: 26px; border-radius: 13px; font: 700 16px/1 var(--f-body); flex-shrink: 0; margin-left: 8px; }
  .listrow.gone-out { transition: opacity .2s, transform .2s; opacity: 0; transform: translateX(30px); }
  .seg::-webkit-scrollbar { display: none; }
  .seg button { appearance: none; border: 1px solid var(--line); background: transparent; color: var(--fg2); font: 600 14px var(--f-body); padding: 7px 14px;
    border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
  .seg button.on { background: var(--fg); border-color: var(--fg); color: var(--bg); }
  /* schuivend blokje achter de gekozen knop (zie animSegs) */
  .has-pill { position: relative; }
  .has-pill > button { position: relative; z-index: 1; transition: color .22s, border-color .22s; }
  .seg.has-pill > button.on { background: transparent; border-color: transparent; }
  .modes.has-pill > button.on { background: transparent; box-shadow: none; }
  .segpill { position: absolute; z-index: 0; pointer-events: none; transition: left .3s cubic-bezier(.2,.8,.2,1), top .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1), height .3s; }
  .seg > .segpill { background: var(--fg); border-radius: 999px; }
  .modes > .segpill { background: var(--surface); border-radius: 9px; box-shadow: 0 1px 0 var(--line), 0 0 0 1px var(--line); }
  @media (prefers-reduced-motion: reduce) { .segpill { transition: none; } }
  .weeknav { display: flex; align-items: center; gap: 8px; }
  .weeknav .lbl { flex: 1; text-align: center; font: 700 16px var(--f-display); color: var(--fg); text-transform: none; letter-spacing: -.01em; }
  .weeknav .lbl small { display: block; font: 500 11px var(--f-mono); color: var(--muted); letter-spacing: .06em; margin-top: 2px; }
  .err { background: var(--red-bg); border: 1px solid var(--red-line); color: var(--red-fg); border-radius: 14px; padding: 12px 14px; font-size: 14px; }
  .empty { color: var(--muted); text-align: center; padding: 30px 10px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .empty b { color: var(--fg); font: 700 16px var(--f-display); }
  .skel { display: grid; gap: 10px; }
  .sk { display: block; border-radius: 7px; background: linear-gradient(90deg, var(--surface2) 0%, color-mix(in srgb, var(--fg) 9%, var(--surface2)) 50%, var(--surface2) 100%); background-size: 200% 100%; animation: skmove 1.3s ease-in-out infinite; }
  .sk-les { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; padding: 12px 4px; border-bottom: 1px solid var(--line); }
  .sk-les > div, .sk-card > div { display: grid; gap: 7px; }
  .sk-card { display: grid; grid-template-columns: 40px 1fr; gap: 12px; }
  @keyframes skmove { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  .empty span { font-size: 13px; }
  .empty-ic { width: 46px; height: 46px; color: var(--accent-text); padding: 12px; border-radius: 18px; background: color-mix(in srgb, var(--accent) 14%, var(--surface)); margin-bottom: 4px; }
  .free .empty-ic { width: 38px; height: 38px; padding: 9px; margin-bottom: 2px; }
  .remc { appearance: none; display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; color: var(--fg); font: inherit; padding: 12px 16px; }
  .remc .rt { font: 700 14px var(--f-mono); color: var(--accent-ink, var(--fg)); background: color-mix(in srgb, var(--accent) 22%, transparent); border-radius: 8px; padding: 5px 8px; flex-shrink: 0; }
  .remc + .remc { margin-top: 10px; }
  .day-h + .remc { margin-top: 10px; }
  .remc .rx { flex: 1; min-width: 0; }
  .remc .rx b { display: block; font: 700 15px var(--f-display); overflow-wrap: anywhere; }
  .remc .rx small { color: var(--muted); font-size: 12px; }
  .remc.gone { opacity: .5; }
  .remc.gone .rx b { text-decoration: line-through; }
  .day-h { font: 600 11px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin: 10px 2px -2px; }
  .day-h.today { color: var(--accent-text); }
  .setting-h { font: 700 17px var(--f-display); letter-spacing: -.01em; margin-bottom: 10px; }
  .lbl { font: 600 11px var(--f-mono); color: var(--muted); text-transform: uppercase; letter-spacing: .1em; }
  .tag { display: inline-block; font: 700 10px var(--f-mono); padding: 3px 7px; border-radius: 6px; background: var(--accent); color: var(--ink); letter-spacing: .06em; vertical-align: middle; }
  .tag.dim { background: var(--surface2); color: var(--muted); }
  .tag.red { background: var(--red); color: #fff; }

  /* vakcode als gekleurd label (kleur per vak) */
  .vk-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 24px; padding: 0 6px; border-radius: 7px;
    font: 700 11px var(--f-mono); letter-spacing: .04em; text-transform: uppercase; vertical-align: middle;
    /* alle vakken één stijl: witte letters op een licht doorzichtig vakje in de accentkleur */
    color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .35); background: color-mix(in srgb, var(--accent) 42%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 70%, rgb(255 255 255 / .3)); }
  /* (geen blur achter elk vakje: dat kost op telefoons veel bij het scrollen en je ziet het nauwelijks) */
  /* licht thema: zachte, warme schaduwen in plaats van harde randen, zodat vlakken van de achtergrond loskomen */
  .app.light { --bg: #f3f1ec; --line: #e7e3da; --sh: 0 1px 2px rgb(60 45 10 / .06), 0 4px 16px rgb(60 45 10 / .07); --sh-sm: 0 1px 2px rgb(60 45 10 / .07), 0 2px 6px rgb(60 45 10 / .05); }
  .app.light .card-box, .app.light .stats, .app.light .sheet { border-color: transparent; box-shadow: var(--sh); }
  .app.light .nowcard { box-shadow: var(--sh); }
  .app.light .ibtn, .app.light .wkc:not(.empty), .app.light .seg button:not(.on) { border-color: transparent; box-shadow: var(--sh-sm); background-color: var(--surface); }
  .app.light .wkc.now { background: color-mix(in srgb, var(--accent) 26%, var(--surface)); }
  .app.light .wkc.uit { box-shadow: var(--sh-sm); }
  .app.light .les.now { border-color: transparent; box-shadow: var(--sh), inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent); }
  .app.light .stat + .stat { border-left-color: var(--line); }
  .app.light nav.tabs { border-top-color: transparent; box-shadow: 0 -6px 20px rgb(60 45 10 / .07); }
  .app.light .modal { background: rgb(40 32 15 / .35); }
  .app.light .nowline, .app.light .nowline::before { background: var(--accent-text); box-shadow: none; }
  .app.light .todaycol { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .app.light .calc-entry { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
  .app.light .card-box.hw + .card-box.hw { margin-top: 8px; } /* met schaduwen hebben losse kaarten wat lucht nodig */
  .app.light .check { border-color: #d9d4c8; }
  .app.light .vk-chip { color: var(--fg); background: color-mix(in srgb, var(--accent) 30%, rgb(255 255 255 / .5)); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .08); }

  /* cijfers */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
  .stat { padding: 12px 14px; background: var(--surface); }
  .stat + .stat { border-left: 1px solid var(--line); }
  .stat b { display: block; font: 800 28px/1.05 var(--f-display); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 12px; color: var(--muted); }
  .stat.acc b { color: var(--accent-text); }
  .vak-h { display: flex; align-items: center; gap: 12px; }
  .vak-h .em { flex-shrink: 0; }
  .vak-h .nm { flex: 1; min-width: 0; }
  .vak-h .nm b { display: block; font: 700 16px var(--f-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vak-h .nm span { font-size: 12px; color: var(--muted); }
  .rap { text-align: center; }
  .rap span { display: block; font: 600 9px var(--f-mono); color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-top: 3px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .chip, .badge { --face: var(--surface2); --cink: var(--fg); }
  .t-rood { --face: var(--red-bg); --cink: var(--red); }
  .t-goud, .t-zilver { --face: var(--good-bg); --cink: var(--good); }
  .t-held, .t-icoon { --face: var(--gold-bg); --cink: var(--gold); }
  .chip { appearance: none; border: 0; min-width: 48px; height: 38px; padding: 0 10px; border-radius: 11px; font: 800 16px var(--f-display);
    background: var(--face); color: var(--cink); position: relative; font-variant-numeric: tabular-nums; }
  .chip small { font: 600 10px var(--f-mono); opacity: .75; margin-left: 4px; }
  /* cijfer in gewone tekstkleur (wit of zwart) op een rustig grijs vakje */
  .chip.gc, .badge.gc { color: var(--fg); background: var(--surface2); box-shadow: inset 0 0 0 1px var(--line); }
  .hdate { display: flex; white-space: nowrap; overflow: hidden; }
  .hdate .hg { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .hdate .hdd { flex-shrink: 0; }
  .chip.locked { position: relative; overflow: hidden; background: color-mix(in srgb, var(--accent) 16%, var(--surface2)); border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
  .chip.locked .blur { filter: blur(5px); user-select: none; }
  .chip.locked::after { content: ''; position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.6s ease-in-out infinite; }
  .hide-new { filter: blur(5px); user-select: none; }
  .rap.hide-new .badge { background: var(--surface2) !important; color: var(--fg2) !important; border-color: var(--line) !important; box-shadow: none !important; }
  .chip.locked .blur { color: var(--fg); }
  .chip.locked i { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 800 10px var(--f-mono); letter-spacing: .12em; color: var(--accent-text); font-style: normal; animation: pulse 1.6s ease-in-out infinite; }
  .bn.first { display: block; }
  .bn.first .row .btn { flex: 1; }
  .chip.isnew::after { content: ''; position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--surface); }
  .chip.dev { outline: 2px dashed var(--accent); outline-offset: 1px; }
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 46px; height: 38px; padding: 0 8px; border-radius: 11px;
    font: 800 19px var(--f-display); background: var(--face); color: var(--cink); }
  .calc-entry { appearance: none; display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: 1px dashed color-mix(in srgb, var(--accent) 60%, var(--line));
    background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--fg); border-radius: 18px; padding: 14px 16px; }
  .calc-entry b { display: block; font: 700 16px var(--f-display); }
  .calc-entry span { font-size: 12px; color: var(--muted); }
  /* pijltje in een eigen rondje, zodat het op elke achtergrond goed te zien is */
  .calc-entry .go { margin-left: auto; flex-shrink: 0; width: 30px; height: 30px; border-radius: 15px; display: grid; place-items: center; background: var(--accent); color: var(--ink); font: 700 18px/1 var(--f-display); }

  /* huiswerk */
  .hw { display: flex; gap: 12px; align-items: flex-start; }
  .hw + .hw { margin-top: 10px; }
  .hw .em { flex-shrink: 0; padding-top: 1px; }
  .hw .body { flex: 1; min-width: 0; }
  .hw .t { font-weight: 700; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .hw .t .vk { display: none; }
  .hw .txt { color: var(--fg2); font-size: 14px; margin-top: 6px; white-space: pre-line; word-wrap: break-word; user-select: text; }
  .hw .meta { color: var(--muted); font: 500 11px var(--f-mono); margin-top: 6px; letter-spacing: .04em; }
  .doc { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: inherit; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
  .bell { appearance: none; border: 0; background: none; color: var(--muted); font: 500 11px var(--f-mono); padding: 0; display: inline-flex; align-items: center; gap: 4px; letter-spacing: .02em; }
  .bell svg { width: 12px; height: 12px; }
  .bell.own { color: var(--accent-text); }
  .check { appearance: none; flex-shrink: 0; width: 28px; height: 28px; border-radius: 9px; border: 2px solid var(--line); background: none; color: var(--ink);
    font: 900 15px var(--f-body); display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .check.on { background: var(--accent); border-color: var(--accent); }
  .check.pop { position: relative; animation: chk .42s cubic-bezier(.3, 1.6, .5, 1); }
  .check.pop::after { content: ''; position: absolute; inset: -2px; border-radius: 11px; border: 2px solid var(--accent); animation: ring .5s ease-out forwards; }
  .card-box.hw.justdone { animation: dimin .4s ease; }
  @keyframes chk { 0% { transform: scale(.6); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
  @keyframes ring { from { transform: scale(1); opacity: .9; } to { transform: scale(1.9); opacity: 0; } }
  @keyframes dimin { from { opacity: 1; } }
  .wprev { background: #111114; border: 1px solid #262629; border-radius: 22px; padding: 14px 16px; margin: 10px 0 12px; color: #f4f4f6; display: grid; gap: 2px; }
  .wprev small { font: 700 11px var(--f-mono); letter-spacing: .08em; color: var(--accent); }
  .wprev div { display: flex; align-items: center; justify-content: space-between; }
  .wprev b { font: 800 22px var(--f-display); }
  .wprev span { background: #26262b; border-radius: 10px; padding: 3px 9px; font: 700 15px var(--f-body); }
  .wprev em { font-style: normal; color: #b4b4bc; font-size: 13px; }
  .wprev.sq { width: 150px; height: 150px; margin-inline: auto; align-content: center; box-sizing: border-box; }
  .wprev.sq div { flex-direction: column; align-items: flex-start; gap: 4px; }
  .wprev.sq b { font-size: 30px; }
  .wprev.wd { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 18px; }
  .wprev.wd div { order: -1; gap: 8px; }
  .wprev.wd small, .wprev.wd em { font-size: 11px; }
  .wprev.wd > small { display: none; }
  /* themakeuze bij de eerste keer: twee mini-schermpjes */
  input.secret { -webkit-text-security: disc; }
  .tpick { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
  .tpick button { appearance: none; border: 0; background: none; padding: 6px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--fg2); font: 700 14px var(--f-body); }
  .tp-rec { font: 700 11px var(--f-mono); font-style: normal; letter-spacing: .06em; text-transform: uppercase; color: var(--ink); background: #ffd34d; padding: 3px 8px; border-radius: 8px; margin-top: -4px; }
  .tp-rec.none { visibility: hidden; }
  .tpick button.on { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .tmini { width: 100%; aspect-ratio: 9 / 15; border-radius: 14px; padding: 8px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 0 0 1px var(--line); }
  .tpick button.on .tmini { box-shadow: 0 0 0 2px #ffd34d; }
  .tmini.light { background: #f3f1ec; } .tmini.dark { background: #0d0c0a; }
  .tmini i { display: block; border-radius: 6px; }
  .tm-h { height: 14%; background: #ffd34d; }
  .tmini.light .tm-c { background: #fff; box-shadow: 0 1px 4px rgb(60 45 10 / .12); } .tmini.dark .tm-c { background: #201e1a; }
  .tm-c { flex: 1; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .tm-c b, .tm-c s { display: block; height: 6px; border-radius: 3px; text-decoration: none; }
  .tm-c b { width: 70%; background: #ffd34d; } .tmini.light .tm-c s { width: 45%; background: #d9d4c8; } .tmini.dark .tm-c s { width: 45%; background: #3a3732; }
  .tm-n { height: 10%; display: flex; align-items: center; justify-content: center; } .tmini.light .tm-n { background: #fff; } .tmini.dark .tm-n { background: #161512; }
  .tm-n b { width: 22%; height: 40%; border-radius: 4px; background: color-mix(in srgb, #ffd34d 60%, transparent); }
  .icgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 10px; margin: 12px 0; }
  .icpick { appearance: none; background: none; border: 0; padding: 6px 2px; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--fg2); font: 600 12px var(--f-body); }
  .icpick img { width: 60px; height: 60px; border-radius: 16px; box-shadow: 0 0 0 1px var(--line); transition: transform .15s; }
  .icpick.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--fg); }
  .icpick.on img { box-shadow: 0 0 0 2px var(--accent); transform: scale(1.04); }
  .vol { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  .vol input { flex: 1; min-width: 0; accent-color: var(--accent); height: 28px; }
  .vol b { font: 700 13px var(--f-mono); min-width: 40px; text-align: right; color: var(--fg2); }
  .tabrow { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .tabrow .ico { width: 36px; height: 36px; border-radius: 11px; background: var(--surface2); display: flex; align-items: center; justify-content: center; color: var(--accent-text); flex-shrink: 0; }
  .tabrow .ico svg { width: 20px; height: 20px; }
  .tabrow b { flex: 1; min-width: 0; font: 700 16px var(--f-display); }
  .tabrow small { color: var(--muted); font-size: 13px; }
  .tabrow.off .ico, .tabrow.off b { opacity: .45; }
  .tabrow.fixed { border-bottom: 0; }
  .tabrow .toggle-row { flex: 0 0 auto; margin-left: 4px; }
  .ibtn.sm { width: 34px; height: 34px; border-radius: 10px; font: 700 16px var(--f-body); }
  .ibtn:disabled { opacity: .3; }
  .hw.isdone .t, .hw.isdone .txt { opacity: .45; text-decoration: line-through; }

  /* rooster: dag als lijst met tijdkolom, week als bord */
  .card-box.les { display: grid; grid-template-columns: 50px 1fr auto; gap: 12px; align-items: center; background: none; border: 0; border-bottom: 1px solid var(--line);
    border-radius: 0; padding: 12px 4px; }
  .les .uur { text-align: left; }
  .les .uur b { display: block; font: 800 22px/1 var(--f-display); font-variant-numeric: tabular-nums; }
  .les .uur span { font: 500 11px var(--f-mono); color: var(--muted); }
  .les .wat { min-width: 0; }
  .les .wat b { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font: 700 16px var(--f-display); overflow-wrap: anywhere; }
  .les .lok { white-space: nowrap; }
  .les .wat > span { display: block; font: 500 12px var(--f-mono); color: var(--muted); margin-top: 3px; letter-spacing: .02em; }
  .les .lok { font: 700 14px var(--f-mono); color: var(--fg); padding: 5px 9px; border-radius: 9px; background: color-mix(in srgb, var(--accent) 14%, var(--surface2)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent); }
  .les .lok.changed { background: var(--accent); color: var(--ink); box-shadow: none; }
  .les .lok small { display: block; font: 600 9.5px var(--f-mono); text-decoration: line-through; opacity: .75; text-align: center; margin-top: 1px; }
  .les.now { background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent); border-radius: 14px; padding: 12px 10px; }
  .les.now .uur b { color: var(--accent-text); }
  .les.gone { opacity: .45; }
  .les.vervallen { background: var(--red-bg); border: 1px solid var(--red-line); border-radius: 14px; padding: 12px 10px; }
  .les.vervallen .wat b { color: var(--red-fg); }
  .les.vervallen .wat b .vk-chip { text-decoration: line-through; }
  .les .note { grid-column: 2 / 4; font-size: 12px; color: var(--fg2); margin-top: -6px; }
  .count { font-size: 13px; color: var(--fg2); text-align: center; }
  .count b { color: var(--accent-text); }
  .nowcard { display: grid; gap: 10px; padding: 14px 16px; border-radius: 18px; background: var(--surface); border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .nowcard.mini { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-color: var(--line); }
  .nc-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex-shrink: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted) 18%, transparent); }
  .nc-mini { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .nc-mini b { font: 700 15px var(--f-display); }
  .nc-mini span { font: 500 12px var(--f-mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nc-part { display: flex; flex-direction: column; gap: 3px; }
  .nc-part + .nc-part { border-top: 1px solid var(--line); padding-top: 10px; }
  .nc-part small { font: 600 10px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--accent-text); }
  .nc-part b { display: flex; align-items: center; gap: 8px; font: 800 19px var(--f-display); }
  .nc-part span { font: 500 12px var(--f-mono); color: var(--muted); }
  .nc-bar { height: 5px; border-radius: 3px; background: var(--surface2); overflow: hidden; margin-top: -2px; }
  .nc-bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .4s; }
  .free { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 28px 16px; border-radius: 18px;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface)); border: 1px dashed color-mix(in srgb, var(--accent) 50%, var(--line)); }
  .free b { font: 800 30px var(--f-display); letter-spacing: -.02em; color: var(--accent-text); }
  .free span { color: var(--fg2); font-size: 15px; }
  .free.small-free { flex-direction: row; justify-content: space-between; padding: 12px 14px; margin-top: 8px; text-align: left; }
  .free.small-free b { font-size: 15px; }
  .free.small-free span { font-size: 13px; }
  .wkh .wfree { display: block; font: 700 9px var(--f-mono); font-style: normal; color: var(--accent-text); letter-spacing: .08em; margin-top: 1px; }
  .les.compact { padding: 9px 4px; grid-template-columns: 40px 1fr auto; }
  .gap { text-align: center; color: var(--muted); font: 500 11px var(--f-mono); padding: 6px 0; letter-spacing: .06em; }
  .wk { display: grid; gap: 3px; align-items: stretch; }
  .wkh { text-align: center; font: 600 10px var(--f-mono); color: var(--muted); text-transform: uppercase; letter-spacing: .08em; padding-bottom: 4px; }
  .wkh b { display: block; font: 800 17px var(--f-display); color: var(--fg); letter-spacing: 0; }
  .wkh.today, .wkh.today b { color: var(--accent-text); }
  .wku { font: 700 11px var(--f-mono); color: var(--muted); display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; padding-left: 2px; line-height: 1; }
  .wku b { font: 800 13px var(--f-display); color: var(--fg); }
  .wku small { font: 600 8.5px var(--f-mono); color: var(--fg2); letter-spacing: -.02em; }
  .wku small.end { color: var(--muted); }
  .wkc { appearance: none; min-height: 48px; border-radius: 9px; border: 0; background: var(--surface); color: var(--fg); padding: 4px 2px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; position: relative; overflow: hidden; }
  .wkc b { font: 700 12px/1.1 var(--f-mono); text-transform: uppercase; }
  .wkc span { font: 700 9px/1.1 var(--f-mono); color: var(--accent-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .wkc i { position: absolute; top: 2px; right: 3px; font: 600 8px var(--f-mono); font-style: normal; color: var(--muted); }
  /* vrije uren: een rustig, licht vlakje in plaats van een stippellijn */
  .wkc[data-kort] { padding: 1px 2px; gap: 0; line-height: 1.05; }
  .wkc[data-kort] b { font-size: 10.5px; }
  .wkc[data-kort] span { font-size: 8px; }
  .wkc .wkt { font: 600 7px/1.1 var(--f-mono); font-style: normal; color: var(--muted); letter-spacing: -.04em; white-space: nowrap; }
  .wkh .wfree.vk { cursor: pointer; text-decoration: underline dotted; white-space: nowrap; letter-spacing: 0; }
  .vkbtn { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: var(--accent-text); text-decoration: underline dotted; }
  table.lt { width: 100%; border-collapse: collapse; margin: 10px 0; font: 500 14px var(--f-mono); }
  table.lt th { text-align: left; font: 700 11px var(--f-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); padding: 4px 0; }
  table.lt td { padding: 6px 0; border-top: 1px solid var(--line); }
  table.lt td:first-child { color: var(--fg2); }
  .wkend { display: grid; gap: 5px; padding: 8px 10px; margin-block: 8px; border-radius: 14px; }
  .wkend-h { display: flex; align-items: center; gap: 6px; font: 600 10.5px var(--f-mono); color: var(--muted); }
  .wkend-h .tag { font-size: 9px; padding: 2px 6px; }
  .wkend-r { appearance: none; border: 0; border-radius: 8px; background: color-mix(in srgb, var(--accent) 14%, var(--surface2)); color: var(--fg); display: flex; align-items: center; gap: 8px; padding: 5px 8px; text-align: left; font: inherit; }
  .wkend-r b { font: 700 11px var(--f-mono); color: var(--accent-text); flex-shrink: 0; }
  .wkend-r span { font: 700 12.5px var(--f-display); min-width: 0; overflow-wrap: break-word; }
  .wkend-r.gone { opacity: .5; }
  .wkend-r.gone span { text-decoration: line-through; }
  .wkr-l, .wkr { margin-top: 10px; }
  .wkr-l { display: flex; justify-content: center; padding-top: 6px; color: var(--muted); }
  .wkr-l svg { width: 16px; height: 16px; }
  .wkr { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .wkr.none { background: color-mix(in srgb, var(--surface) 40%, transparent); border-radius: 9px; min-height: 30px; }
  .wkri { appearance: none; border: 0; border-radius: 9px; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--fg); padding: 5px 4px; text-align: left; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .wkri b { font: 700 9px var(--f-mono); color: var(--accent-text); }
  .wkri span { font: 600 10px/1.15 var(--f-body); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: break-word; hyphens: auto; }
  .wkri.gone { opacity: .5; }
  .wkri.gone span { text-decoration: line-through; }
  .wkc.empty { background: color-mix(in srgb, var(--surface) 40%, transparent); border: 0; border-radius: 9px; }
  /* donker: lessen iets grijzer en met een heel dun randje, zodat ze los van elkaar en van de achtergrond staan */
  .app:not(.light) .wkc:not(.empty) { background: var(--surface2); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .06); }
  .app:not(.light) .wkc.now { background: color-mix(in srgb, var(--accent) 24%, var(--surface2)); }
  .app:not(.light) .wkc.empty { background: color-mix(in srgb, var(--surface) 70%, transparent); }
  /* uitval: schuine streepjes, ook zonder kleur herkenbaar */
  .wkc.uit, .les.vervallen { background: repeating-linear-gradient(135deg, var(--red-bg) 0 7px, color-mix(in srgb, var(--red) 16%, var(--red-bg)) 7px 10px); }
  /* vandaag in de weekweergave en het streepje van "nu" */
  .todaycol { position: absolute; z-index: 0; border-radius: 12px; background: color-mix(in srgb, var(--accent) 8%, transparent); pointer-events: none; }
  .wk > :not(.todaycol):not(.nowline) { position: relative; z-index: 1; }
  /* zwart thema: vandaag duidelijker dan de vakjes zelf (anders bijna dezelfde kleur) */
  .app:not(.light) .todaycol { background: color-mix(in srgb, var(--accent) 17%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent); }
  .app:not(.light) .wkc[data-today]:not(.uit):not(.now) { background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
  .nowline { position: absolute; left: 0; right: 0; height: 2px; margin-top: -1px; background: var(--accent); z-index: 3; pointer-events: none; border-radius: 1px; box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 60%, transparent); }
  .nowline::before { content: ''; position: absolute; left: var(--dot, 0px); top: -4px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--accent); }
  .swipe-area > .nowline { left: -6px; right: -6px; }
  /* cijfers: een klein beetje ruimte tussen de vakken */
  .swipe-area.grades { display: flex; flex-direction: column; gap: 8px; }
  /* lange lijsten: kaarten buiten beeld pas tekenen als je ernaartoe scrolt (sneller openen en soepeler scrollen) */
  .swipe-area.grades > .card-box, .card-box.hw { content-visibility: auto; contain-intrinsic-size: auto 130px; }
  .wkc.uit b { text-decoration: line-through; color: var(--red); }
  .wkc.exam { box-shadow: 0 0 0 1px var(--accent) inset; }
  .wkc.chg::after { content: ''; position: absolute; top: 4px; left: 4px; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
  .wkc.now { background: color-mix(in srgb, var(--accent) 22%, var(--surface)); }

  /* meer */
  .swatches { display: flex; flex-wrap: wrap; gap: 10px; }
  .sw { appearance: none; width: 40px; height: 40px; border-radius: 50%; border: 3px solid transparent; background: var(--c); box-shadow: 0 0 0 1px var(--line) inset; }
  .sw.on { border-color: var(--fg); }
  .sw.custom { background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); position: relative; overflow: hidden; }
  .sw.custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; }
  .listrow { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .listrow:last-child { border-bottom: 0; }
  .listrow b { font-variant-numeric: tabular-nums; text-align: right; }
  .linkbtn { appearance: none; width: 100%; text-align: left; border: 0; background: none; color: var(--fg); font: 600 15px var(--f-body); padding: 13px 0; border-bottom: 1px solid var(--line); }
  .linkbtn:last-child { border-bottom: 0; }
  .linkbtn.red { color: var(--red); }
  .toggle-row { display: flex; align-items: center; gap: 12px; }
  .toggle-row span { flex: 1; min-width: 0; }
  .toggle-row small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
  .toggle-row input { position: absolute; opacity: 0; pointer-events: none; }
  .toggle { flex-shrink: 0; width: 50px; height: 30px; border-radius: 15px; background: var(--surface2); border: 1px solid var(--line); position: relative; transition: background .2s; }
  .toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--muted); transition: transform .2s, background .2s; }
  .toggle-row input:checked + .toggle { background: var(--accent); border-color: var(--accent); }
  .toggle-row input:checked + .toggle::after { transform: translateX(20px); background: var(--ink); }
  .modes { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; margin-top: 8px; padding: 3px; background: var(--surface2); border-radius: 12px; }
  .modes button { appearance: none; border: 0; background: none; color: var(--fg2); border-radius: 9px; padding: 7px 2px; font: 600 12px var(--f-body); }
  .modes button.on { background: var(--surface); color: var(--fg); box-shadow: 0 1px 0 var(--line), 0 0 0 1px var(--line); }
  .modes button.on[data-mode$=":uit"] { color: var(--red); }
  .nrow { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .nrow > b { font: 700 15px var(--f-display); }
  .dev-box { border-style: dashed; border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
  .btn .aanb { display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 16%, transparent); font: 700 9.5px var(--f-mono); letter-spacing: .06em; text-transform: uppercase; vertical-align: middle; }
  .tour { position: absolute; inset: 0; z-index: 75; overflow: hidden; animation: tipfade .25s ease both; }
  .tour.out { animation: tipfade .25s ease reverse both; }
  .tour-hole { position: absolute; border-radius: 18px; box-shadow: 0 0 0 9999px rgba(0,0,0,.66); outline: 2px solid var(--accent); outline-offset: 2px; transition: left .35s ease, top .35s ease, width .35s ease, height .35s ease; pointer-events: none; }
  .tour-ring { position: absolute; border-radius: 16px; box-shadow: 0 0 0 2px var(--accent); background: color-mix(in srgb, var(--accent) 22%, transparent); transition: left .35s ease, top .35s ease; pointer-events: none; animation: tourpulse 1.4s ease-in-out infinite; }
  @keyframes tourpulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 35%, transparent); } }
  .tour-card { position: absolute; left: 12px; right: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 14px 16px; box-shadow: 0 18px 50px rgba(0,0,0,.4); display: grid; gap: 10px; opacity: 0; transform: translateY(10px); transition: opacity .25s, transform .25s; }
  .tour-card.in { opacity: 1; transform: none; }
  .tour-card .tip-h small { margin-left: auto; font: 600 11px var(--f-mono); color: var(--muted); }
  .tour-card p { margin: 0; color: var(--fg2, var(--fg)); font-size: 14.5px; line-height: 1.45; }
  .tour-btns { display: flex; justify-content: flex-end; gap: 10px; }
  .ptr { position: absolute; left: 50%; top: calc(86px + env(safe-area-inset-top, 0px)); z-index: 30; width: 38px; height: 38px; border-radius: 19px; background: var(--surface); box-shadow: 0 4px 16px rgba(0,0,0,.25), 0 0 0 1px var(--line); display: grid; place-items: center; color: var(--muted); transform: translate(-50%, -50px); opacity: 0; transition: transform .3s ease, opacity .3s; pointer-events: none; }
  .ptr svg { width: 20px; height: 20px; }
  .ptr.ready, .ptr.spin { color: var(--accent-text); }
  .ptr.spin svg { animation: ptrspin .8s linear infinite; }
  @keyframes ptrspin { to { transform: rotate(360deg); } }
  .updnotes { max-height: 170px; overflow-y: auto; background: var(--surface2); border-radius: 12px; padding: 10px 12px; font-size: 13px; line-height: 1.45; color: var(--fg2, var(--fg)); }
  .simpill { position: absolute; top: calc(4px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 90; border: 0; border-radius: 999px; background: var(--red); color: #fff; font: 700 10px var(--f-mono); letter-spacing: .06em; padding: 4px 10px; }
  .tipwrap { position: absolute; inset: 0; z-index: 70; background: rgba(0,0,0,.32); display: flex; align-items: flex-end; padding: 12px 12px calc(84px + env(safe-area-inset-bottom, 0px)); animation: tipfade .2s ease both; }
  .tipcard { width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 16px 18px 14px; box-shadow: 0 18px 50px rgba(0,0,0,.35); display: grid; gap: 10px; animation: tipup .32s cubic-bezier(.2,.9,.3,1.15) both; }
  .tip-h { display: flex; align-items: center; gap: 10px; }
  .tip-h b { font: 700 17px var(--f-display); }
  .tip-i { width: 26px; height: 26px; border-radius: 13px; background: var(--accent); color: var(--ink); display: grid; place-items: center; font: 700 14px/1 var(--f-mono); flex-shrink: 0; }
  .tipcard p { margin: 0; color: var(--fg2, var(--fg)); font-size: 14.5px; line-height: 1.45; }
  .tipcard .btn { justify-self: end; padding-inline: 22px; }
  .tipwrap.out { animation: tipfade .2s ease reverse both; }
  .tipwrap.out .tipcard { animation: tipup .2s ease reverse both; }
  @keyframes tipup { from { transform: translateY(110%); } to { transform: none; } }
  @keyframes tipfade { from { opacity: 0; } to { opacity: 1; } }
  .toast { position: absolute; left: 50%; bottom: 88px; transform: translateX(-50%); z-index: 80; background: var(--fg); color: var(--bg); padding: 10px 16px;
    border-radius: 12px; font-weight: 700; font-size: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.4); animation: pop .3s both; max-width: 90%; text-align: center; }
  .calc-row { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; }
  select, .card-box input[type=text], .card-box input[type=number], .sheet input[type=text], .sheet input[type=number], .sheet input[type=password] {
    width: 100%; background: var(--surface2); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px; font: 600 15px var(--f-body); }
  .calc-out { border-radius: 14px; padding: 12px 14px; font-size: 13px; background: var(--surface2); }
  .calc-out b { display: block; font: 800 40px/1.05 var(--f-display); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .calc-out.safe { background: var(--good-bg); color: var(--good); }
  .calc-out.need { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--fg); }
  .calc-out.need b { color: var(--accent-text); }
  .calc-out.imp { background: var(--red-bg); color: var(--red); }

  /* bladen en vensters */
  .modal { position: absolute; inset: 0; background: rgba(0,0,0,.72); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; z-index: 50; padding: 16px; }
  .sheet { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 20px; width: min(100%, 420px); max-height: 100%; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px; }
  .sheet h3 { margin: 0; font: 800 20px var(--f-display); display: flex; align-items: center; gap: 10px; }
  .sheet .lbl { margin-top: 4px; }
  @keyframes pop { from { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.06); } }
  @keyframes pulse { 50% { opacity: .4; } }
  @keyframes bob { 50% { transform: translateY(-6px); } }

  /* nieuw: sloten en lijst */
  .bn { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-radius: 18px; background: var(--accent); color: var(--ink); }
  .bn b { font: 800 18px var(--f-display); letter-spacing: -.01em; }
  .bn small { display: block; opacity: .75; font-size: 12px; margin-top: 2px; }
  .bn .btn { background: var(--ink); color: var(--accent); padding: 11px 16px; }
  .glist { display: flex; flex-direction: column; }

  /* cijferkaart (bekijken / opnieuw afspelen) */
  .rbox { border-radius: 22px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: 10px;
    padding: 22px 18px; text-align: center; }
  .rb-vak { font: 700 18px var(--f-display); display: flex; align-items: center; gap: 10px; }
  .rb-oms { color: var(--fg2); font-size: 14px; }
  .rb-grade { font: 800 96px/1 var(--f-display); letter-spacing: -.04em; font-variant-numeric: tabular-nums; animation: pop .5s both; }
  .rbox.good .rb-grade { color: var(--good); }
  .rbox.bad .rb-grade { color: var(--red); }
  .rv-stats { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .rv-stats div { padding: 9px 4px; }
  .rv-stats div + div { border-left: 1px solid var(--line); }
  .rv-stats b { display: block; font: 700 15px var(--f-mono); }
  .rv-stats span { font-size: 11px; color: var(--muted); }
  .sheet.rbox { width: min(100%, 360px); }

  /* unboxen (stijl van de Cijferbox-extensie) */
  .ov { position: absolute; inset: 0; z-index: 50; background: color-mix(in srgb, var(--bg) 96%, transparent); display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; overflow: hidden; padding: 20px; }
  .ov.fail { box-shadow: inset 0 0 200px 40px rgba(255, 77, 77, .55); }
  .ov .skip { position: absolute; right: 16px; bottom: 16px; appearance: none; border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: 600 13px var(--f-body); padding: 8px 14px; border-radius: 999px; }
  .ov .tap { color: var(--muted); font-size: 13px; animation: pulse 1.4s ease-in-out infinite; }
  .ub-count { font: 600 11px var(--f-mono); color: var(--muted); letter-spacing: .14em; text-transform: uppercase; min-height: 14px; }
  .ub-pack { width: 170px; height: 240px; border: 2px solid var(--accent); border-radius: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--accent) 14%, transparent) 0 6px, transparent 6px 14px), var(--surface);
    color: var(--accent-text); font: 800 15px var(--f-display); letter-spacing: 6px; box-shadow: 0 0 60px var(--accent); animation: charge .25s infinite; cursor: pointer; }
  .ub-pack .vk-chip { transform: scale(1.6); }
  .ub-card { width: min(84vw, 320px); border: 2px solid var(--accent); border-radius: 22px; background: var(--surface); padding: 22px; text-align: center; box-shadow: 0 0 60px var(--accent); }
  .ub-card h2 { display: flex; align-items: center; justify-content: center; gap: 10px; text-transform: uppercase; font-size: 20px; animation: pop .4s both; }
  .ub-oms { font-size: 13px; color: var(--muted); margin-top: 4px; }
  .ub-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 12px 0 4px; min-height: 28px; }
  .ub-pill { border: 1px solid var(--accent); color: var(--accent-text); border-radius: 20px; padding: 3px 12px; font: 700 12px var(--f-mono); animation: pop .4s both; }
  .ub-n { font: 800 88px/1.1 var(--f-display); color: var(--muted); font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .ub-n.fin { animation: slam .4s both; text-shadow: 0 0 30px currentColor; }
  .ub-n.fin.soft { animation: bump .45s cubic-bezier(.3, 1.6, .5, 1) both; }
  @keyframes bump { 0% { transform: scale(1); } 45% { transform: scale(1.18); } 100% { transform: scale(1); } }
  .reel { overflow: hidden; width: 100%; -webkit-mask-image: linear-gradient(90deg, transparent, #000 28%, #000 72%, transparent); mask-image: linear-gradient(90deg, transparent, #000 28%, #000 72%, transparent); }
  .reel-strip { display: flex; width: max-content; will-change: transform; }
  .reel-strip span { flex-shrink: 0; text-align: center; color: var(--fg2); }
  .ub-lbl { min-height: 24px; font: 700 14px var(--f-mono); letter-spacing: .14em; }
  .ub-next { min-width: 160px; }
  .flash { position: absolute; inset: 0; background: #fff; pointer-events: none; animation: flash .6s ease-out forwards; z-index: 51; }
  @keyframes flash { from { opacity: .95; } to { opacity: 0; } }
  .sp { position: absolute; bottom: -6px; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: rise 1.5s linear infinite; }
  .cf { position: absolute; top: -20px; width: 8px; height: 14px; animation: cffall 2.4s ease-in forwards; }
  .app.shaking { animation: shakeit .12s infinite; }
  @keyframes charge { 25% { transform: rotate(-2deg) scale(1.02); } 75% { transform: rotate(3deg) scale(1.04); } }
  @keyframes slam { from { transform: scale(3); opacity: 0; } 60% { transform: scale(.9); opacity: 1; } }
  @keyframes shakeit { 20% { transform: translate(-8px, 5px); } 40% { transform: translate(7px, -6px); } 60% { transform: translate(-5px, -3px); } 80% { transform: translate(5px, 6px); } }
  @keyframes rise { to { transform: translateY(-110vh); opacity: 0; } }
  @keyframes cffall { to { transform: translateY(110vh) rotate(720deg); } }
  @media (prefers-reduced-motion: reduce) {
    .ub-pack, .app.shaking, .sp, .lock i { animation: none; }
  }
  `;

  /* ---------- opbouw ---------- */
  const host = document.createElement('div');
  host.id = 'cijferpacks-app';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;';
  const sh = host.attachShadow({ mode: 'open' });
  /* lettertypes (Google Fonts); zonder internet valt de app terug op de systeemletters */
  if (!document.getElementById('ip-fonts')) {
    /* lettertypes zitten in de app zelf (sneller, en ook zonder internet); @font-face moet in het document staan, niet in de shadow root */
    const F = n => assetUrl('fonts/' + n);
    const l = document.createElement('style');
    l.id = 'ip-fonts';
    l.textContent = `@font-face{font-family:'Bricolage Grotesque';font-weight:600 800;font-display:swap;src:url(${F('bricolage.woff2')}) format('woff2')}`
      + `@font-face{font-family:'Figtree';font-weight:400 700;font-display:swap;src:url(${F('figtree.woff2')}) format('woff2')}`
      + `@font-face{font-family:'JetBrains Mono';font-weight:500 700;font-display:swap;src:url(${F('jetbrains.woff2')}) format('woff2')}`;
    (document.head || document.documentElement).appendChild(l);
  }
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    rooster: svg('<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h3M13.5 13.5h3M7.5 17h3"/>'),
    huiswerk: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6"/>'),
    cijfers: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    packs: svg('<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13M12 8c-1.5-3-5.5-4-5.5-1.5S10 8 12 8zM12 8c1.5-3 5.5-4 5.5-1.5S14 8 12 8z"/>'),
    meer: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>'),
    bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>')
  };
  const TABS = [
    { k: 'rooster', label: 'Rooster' },
    { k: 'huiswerk', label: 'Huiswerk' },
    { k: 'cijfers', label: 'Cijfers' },
    { k: 'meer', label: 'Meer' }
  ];
  sh.innerHTML = `<style>${CSS}</style><div class="app"><header><img class="hmark" alt="W.S.P" width="40" height="40"><div class="hd"><p class="hdate"></p><h1></h1></div>
    <button class="ibtn" data-a="refresh" aria-label="Vernieuwen">${ICONS.refresh}</button></header><main></main>
    <nav class="tabs"></nav></div>`;
  const app = sh.querySelector('.app');
  /* gesimuleerde tijd: een labeltje bovenin, zodat je niet vergeet dat het niet de echte tijd is (tik = terug naar echt) */
  if (simOff) {
    const pill = document.createElement('button');
    pill.className = 'simpill';
    const d = now();
    pill.textContent = 'SIM · ' + ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ×';
    pill.onclick = () => { try { localStorage.removeItem('cp:simNow'); } catch (e) {} location.reload(); };
    app.appendChild(pill);
  }
  const main = sh.querySelector('main');
  const title = sh.querySelector('header h1');
  const refreshBtn = sh.querySelector('[data-a=refresh]');
  (document.body || document.documentElement).appendChild(host);
  /* de portaalpagina zelf uitzetten: die scrolde mee (waardoor de tabbalk wegschoof) en kostte geheugen */
  function hidePortal() {
    const st = document.createElement('style');
    st.textContent = 'html,body{overflow:hidden!important;height:100%!important;margin:0!important;overscroll-behavior:none!important;background:#000!important}'
      + 'body>*:not(#cijferpacks-app){display:none!important}'
      /* ook losse tekst van het portaal onzichtbaar (die valt niet onder de regel hierboven) */
      + 'body{visibility:hidden!important}#cijferpacks-app{visibility:visible!important}';
    (document.head || document.documentElement).appendChild(st);
    document.querySelectorAll('body > img, body > iframe, body > video').forEach(el => el.remove());
    window.scrollTo(0, 0);
  }
  if (!DEMO) hidePortal(); else document.documentElement.style.overflow = 'hidden';

  /* accentkleur */
  function applyAccent(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    const hex = m ? '#' + m[1] : '#ffd34d';
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    app.style.setProperty('--accent', hex);
    app.style.setProperty('--ink', lum > 0.55 ? '#000' : '#fff');
    return hex;
  }
  let accent = applyAccent(ls.get('cp:accent', '#ffd34d'));

  /* thema: zwart (standaard) of licht */
  function applyTheme(t) {
    app.classList.toggle('light', t === 'light');
    host.style.background = t === 'light' ? '#f2f2f5' : '#000';
    try { if (Native && Native.setTheme) Native.setTheme(t); } catch (e) {}
    /* het logo bovenin: zwart vierkant in het witte thema, wit vierkant in het zwarte thema */
    const mk = sh.querySelector('.hmark');
    if (mk) mk.src = assetUrl('themes/' + (t === 'light' ? 'mark.png' : 'mark-wit.png'));
    return t;
  }
  let theme = applyTheme(ls.get('cp:theme', 'light')); /* standaard: wit met geel */
  let soundOn = ls.get('cp:sound', true);

  /* weergave: wit of zwart, met een eigen accentkleur (geen achtergrondfoto's: die kostten veel geheugen) */
  const ASSET = n => assetUrl('themes/' + n);
  sh.querySelector('.hmark').src = ASSET(theme === 'light' ? 'mark.png' : 'mark-wit.png');
  /* van een oudere versie: een gekozen foto-thema of eigen foto opruimen */
  if (ls.get('cp:themeSet', 'custom') !== 'custom' || ls.get('cp:ownPhoto', null)) {
    try { localStorage.removeItem('cp:ownPhoto'); localStorage.removeItem('cp:themeSet'); } catch (e) {}
  }
  function applyLook() {
    applyTheme(theme);
    applyAccent(accent);
    app.classList.remove('photo');
  }
  applyLook();
  const S = { tab: 'rooster', rView: ls.get('cp:rview', 'dag'), dev: [], devSeen: new Set(), devOn: false, grades: ls.get('cp:cache:grades', null), gradesErr: null, loadingGrades: false, ovPeriod: null,
    hwMonday: defaultMonday(), hw: {}, rMonday: defaultMonday(), rooster: {}, rDay: null, abs: null, packBusy: false, fresh: {} };

  /* overal in de app: tik op een docent */
  sh.querySelector('.app').addEventListener('click', e => {
    const b = e.target.closest('[data-doc]');
    if (!b) return;
    e.stopPropagation();
    showDocent(b.dataset.doc);
  }, true);
  /* tabbalk zelf indelen: volgorde en zichtbaarheid (Meer staat altijd achteraan) */
  function tabLayout() {
    const saved = ls.get('cp:tabs', null);
    const keys = TABS.filter(t => t.k !== 'meer').map(t => t.k);
    const list = Array.isArray(saved) ? saved.filter(t => keys.includes(t.k)) : [];
    keys.forEach(k => { if (!list.some(t => t.k === k)) list.push({ k, on: true }); });
    return list;
  }
  const visibleTabs = () => tabLayout().filter(t => t.on).map(t => t.k).concat('meer');
  function drawNav() {
    const nav = sh.querySelector('nav.tabs'), vis = visibleTabs();
    nav.style.gridTemplateColumns = `repeat(${vis.length}, 1fr)`;
    nav.innerHTML = '<span class="tabpill instant"></span>' + vis.map(k => { const t = TABS.find(x => x.k === k); return `<button data-tab="${t.k}"><span class="ico">${ICONS[t.k]}</span>${t.label}</button>`; }).join('');
  }
  drawNav();
  /* ---------- datagebruik: hoe vaak op wifi en op 4G/5G, wat er op 4G/5G mag, en een schatting ---------- */
  /* op 4G/5G per onderdeel: elke 60/150/240 minuten, "open" (alleen bij openen/vernieuwen) of "off" (alleen op wifi) */
  const DATA_DEF = { wifi: '30', r: '150', c: '150', h: 'off' }; /* huiswerk standaard alleen op wifi */
  const MOB_KEY = t => 'n_mob_' + t + '_mode';
  /* gemeten op een telefoon (november 2026, versie 2.6.3): app openen ~265 KB (inclusief huiswerk voor het getalletje);
     één controle ~96 KB (cijfers ~45, huiswerk ~35, rooster ~16), en eens per 6 uur alle perioden van de cijfers (~140 KB extra) */
  const KB = { open: 265, c: 45, h: 35, r: 16, full: 140 };
  function dataEstimate(st, opens) {
    const checks = t => /^\d+$/.test(st[t]) ? 17 * 60 / +st[t] : 0; /* alleen tussen 6 en 23 uur */
    const bg = ['r', 'c', 'h'].reduce((a, t) => a + checks(t) * KB[t], 0) + Math.min(checks('c'), 17 / 6) * KB.full;
    const morning = ['r', 'c', 'h'].reduce((a, t) => a + (checks(t) ? KB[t] : 0), 0); /* de ochtendcontrole op een schooldag */
    const open = KB.open - (st.h === 'off' ? KB.h : 0); /* huiswerk "nooit": bij openen ook niet op de achtergrond voor het getalletje */
    const school = bg + morning + opens * open;
    const free = bg + Math.max(1, Math.round(opens / 2)) * open;
    const month = 21 * school + 9 * free;
    const mb = kb => kb < 1024 ? '<1 MB' : '~' + dec((kb / 1024).toFixed(kb < 10240 ? 1 : 0)) + ' MB';
    return { school: mb(school), free: mb(free), month: mb(month), pct: Math.max(1, Math.round(month / 1024 / 2048 * 100)) };
  }
  function openData(onClose) {
    let ns = {};
    try { ns = JSON.parse(Native.getSettings()); } catch (e) {}
    const st = { wifi: ns.n_wifi_mode || DATA_DEF.wifi };
    ['r', 'c', 'h'].forEach(t => { st[t] = ns[MOB_KEY(t)] || DATA_DEF[t]; });
    let tab = 'mobile', opens = ls.get('cp:opens', 6);
    const save = (k, v) => { st[k] = v; try { Native.setSetting(k === 'wifi' ? 'n_wifi_mode' : MOB_KEY(k), v); } catch (e) {} };
    const p = document.createElement('div');
    p.className = 'panel';
    const opt = (k, list) => `<div class="modes">${list.map(([v, l]) => `<button class="${st[k] === v ? 'on' : ''}" data-set="${k}:${v}">${l}</button>`).join('')}</div>`;
    const TYPES = [['r', 'Rooster', 'uitval en lokaalwijzigingen'], ['c', 'Cijfers', 'nieuwe cijfers'], ['h', 'Huiswerk', 'nieuw huiswerk en aantekeningen']];
    const MOB_OPTS = [['60', '1 uur'], ['150', '2,5 uur'], ['240', '4 uur'], ['open', 'Openen'], ['off', 'Nooit']];
    const draw = () => {
      const e = dataEstimate(st, opens);
      p.innerHTML = `<div class="panel-h"><h2>Datagebruik</h2><button class="btn" data-a="done">Klaar</button></div>
        <p class="small muted">Hoe vaak W.S.P op de achtergrond naar nieuwe cijfers, huiswerk en roosterwijzigingen kijkt. 's Nachts (23:00–06:00) kijkt hij niet. Als je de app opent of op vernieuwen tikt, haalt hij altijd alles op.${IOS ? ' Op iPhone bepaalt iOS zelf wanneer de app mag kijken (meestal een paar keer per dag): wat je hier kiest is hoe vaak hij hooguit kijkt, de schatting is dus het maximum.' : ''}</p>
        <div class="seg">${[['wifi', 'Wifi'], ['mobile', '4G/5G']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-tab2="${k}">${l}</button>`).join('')}</div>
        ${tab === 'wifi' ? `<div class="card-box"><div class="setting-h">Op wifi kijken</div>
            ${opt('wifi', [['30', 'Elk half uur'], ['60', 'Elk uur'], ['120', 'Elke 2 uur']])}
            <p class="small muted" style="margin-top:8px">Aanbevolen: elk half uur. Wifi telt niet mee voor je databundel.</p></div>
          <div class="card-box"><div class="setting-h">Updates</div>
            <p class="small muted">Op wifi kijkt de app elke keer dat je hem opent of er een nieuwe versie is. Op 4G/5G niet, om je databundel te sparen.</p></div>`
        : `<div class="card-box"><div class="setting-h">Op 4G/5G kijken</div>
            <p class="small muted">Kies per onderdeel hoe vaak. <b>Openen</b>: alleen als je de app opent of op vernieuwen tikt. <b>Nooit</b>: alleen op wifi.</p>
            ${TYPES.map(([t, l, sub]) => `<div class="nrow"><b>${l}</b><div class="small muted">${sub}</div>${opt(t, MOB_OPTS)}</div>`).join('')}
            <div class="toggle-row" style="padding:8px 0;border-bottom:0"><span><b>Zoeken naar updates</b><small>alleen op wifi. Via Meer → Zoek naar updates kan het altijd</small></span></div></div>
          <div class="card-box"><div class="setting-h">Schatting op 4G/5G</div>
            <div class="vol"><span>Ik open de app</span><input type="range" min="1" max="20" step="1" value="${opens}" data-opens aria-label="Hoe vaak per dag"><b data-e="opens">${opens}× per dag</b></div>
            <div class="listrow"><span class="muted">Schooldag</span><b data-e="school">${e.school}</b></div>
            <div class="listrow"><span class="muted">Vrije dag</span><b data-e="free">${e.free}</b></div>
            <div class="listrow" style="border-bottom:0"><span class="muted">Per maand</span><b data-e="month">${e.month} · ${e.pct}% van 2 GB</b></div>
            <p class="small muted">Alleen als je de hele dag op 4G/5G zit. Thuis en op school op wifi telt het niet. Op een vrije dag gaan we uit van half zo vaak openen.</p></div>
          <button class="btn ghost" data-a="reset">Standaard herstellen</button>
          <p class="small muted" style="text-align:center;margin-top:-6px">4G/5G: rooster en cijfers elke 2,5 uur, huiswerk en updates alleen op wifi · wifi elk half uur</p>`}`;
      p.querySelector('[data-a=done]').onclick = close;
      p.querySelectorAll('[data-tab2]').forEach(b => { b.onclick = () => { tab = b.dataset.tab2; draw(); }; });
      p.querySelectorAll('[data-set]').forEach(b => { b.onclick = () => { const [k, v] = b.dataset.set.split(':'); save(k, v); buzz(8); draw(); }; });
      const r = p.querySelector('[data-opens]');
      /* schuiven: alleen de getallen bijwerken (opnieuw tekenen zou het schuifje onder je vinger weghalen) */
      if (r) r.oninput = () => {
        opens = +r.value;
        ls.set('cp:opens', opens);
        const x = dataEstimate(st, opens), set = (k, v) => { p.querySelector(`[data-e=${k}]`).textContent = v; };
        set('opens', opens + '× per dag'); set('school', x.school); set('free', x.free); set('month', x.month + ' · ' + x.pct + '% van 2 GB');
      };
      const rs = p.querySelector('[data-a=reset]');
      if (rs) rs.onclick = () => { Object.keys(DATA_DEF).forEach(k => save(k, DATA_DEF[k])); toast('Standaard hersteld'); draw(); };
    };
    function close() { p.remove(); if (onClose) onClose(); }
    p.closePanel = close;
    draw();
    app.appendChild(p);
  }

  function openTabs(onClose) {
    const p = document.createElement('div');
    p.className = 'panel';
    let list = tabLayout();
    const save = () => { ls.set('cp:tabs', list); drawNav(); updateNav(); };
    const draw = () => {
      p.innerHTML = `<div class="panel-h"><h2>Tabbalk</h2><button class="btn" data-a="done">Klaar</button></div>
        <p class="small muted">Kies welke tabbladen je onderin ziet en in welke volgorde. Het eerste tabblad opent als je de app start. Meer staat altijd achteraan.</p>
        <div class="card-box">${list.map((t, i) => { const d = TABS.find(x => x.k === t.k); return `<div class="tabrow${t.on ? '' : ' off'}">
          <span class="ico">${ICONS[t.k]}</span><b>${d.label}</b>
          <button class="ibtn sm" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Omhoog">↑</button><button class="ibtn sm" data-dn="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Omlaag">↓</button>
          <label class="toggle-row"><input type="checkbox" data-on="${i}" ${t.on ? 'checked' : ''}><i class="toggle"></i></label></div>`; }).join('')}
          <div class="tabrow fixed"><span class="ico">${ICONS.meer}</span><b>Meer</b><small>altijd zichtbaar</small></div></div>
        <button class="linkbtn" data-a="reset">Standaard herstellen</button>`;
      p.querySelector('[data-a=done]').onclick = close;
      p.querySelector('[data-a=reset]').onclick = () => { list = TABS.filter(t => t.k !== 'meer').map(t => ({ k: t.k, on: true })); save(); draw(); };
      const move = (i, j) => { const [t] = list.splice(i, 1); list.splice(j, 0, t); save(); buzz(10); draw(); };
      p.querySelectorAll('[data-up]').forEach(b => { b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1); });
      p.querySelectorAll('[data-dn]').forEach(b => { b.onclick = () => move(+b.dataset.dn, +b.dataset.dn + 1); });
      p.querySelectorAll('[data-on]').forEach(c => { c.onchange = () => { list[+c.dataset.on].on = c.checked; save(); draw(); }; });
    };
    function close() { p.remove(); if (onClose) onClose(); }
    p.closePanel = close;
    draw();
    app.appendChild(p);
  }
  sh.querySelector('nav.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  refreshBtn.addEventListener('click', () => refreshCurrent(true));

  const MONTH_FULL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  function setHeader(t) {
    title.innerHTML = t;
    const d = now();
    /* welkom met je voornaam (uit het portaal), anders alleen de datum */
    const first = S.grades && S.grades.student ? S.grades.student.trim().split(/\s+/)[0] : '';
    const h = d.getHours(), groet = h < 6 ? 'Goedenacht' : h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
    const k = klas();
    /* klas en datum altijd laten zien: past het niet, dan wordt de groet met je naam ingekort (met …) */
    sh.querySelector('.hdate').innerHTML = first ? `<span class="hg">${esc(groet + ', ' + first)}</span><span class="hdd">&nbsp;· ${esc((k ? k + ' · ' : '') + DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_FULL[d.getMonth()].slice(0, 3))}</span>`
      : `<span class="hg">${esc(DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_FULL[d.getMonth()])}</span>`;
  }
  /* je klas (bijv. H3B): de groep die het vaakst bij je lessen staat (bij vakken als "h3b.ne2" telt het stuk voor de punt) */
  function klas() {
    const count = {};
    Object.values(S.rooster).flat().filter(Boolean).forEach(d => d.lessons.forEach(l => {
      new Set(String(l.groep || '').split(/[\s,]+/).map(g => g.split('.')[0].toLowerCase()).filter(g => /^[a-z]{1,4}\d{1,2}[a-z]{0,2}\d?$/.test(g)))
        .forEach(g => { count[g] = (count[g] || 0) + 1; });
    }));
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (best && count[best] >= 3) { if (ls.get('cp:klas', '') !== best) ls.set('cp:klas', best); return best.toUpperCase(); }
    return (ls.get('cp:klas', '') || '').toUpperCase();
  }
  /* vlakje achter het actieve icoon op zijn plek zetten (met animatie, behalve de eerste keer) */
  function movePill() {
    const pill = sh.querySelector('nav.tabs .tabpill'), on = sh.querySelector('nav.tabs button.on .ico');
    if (!pill) return;
    if (!on || !on.offsetWidth) { pill.style.opacity = '0'; return; }
    pill.style.opacity = '';
    const nav = pill.parentElement.getBoundingClientRect(), r = on.getBoundingClientRect();
    pill.style.transform = `translate(${r.left - nav.left}px, ${r.top - nav.top}px)`;
    pill.style.width = r.width + 'px';
    if (pill.classList.contains('instant')) requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.remove('instant')));
  }
  window.addEventListener('resize', () => { const p = sh.querySelector('nav.tabs .tabpill'); if (p) p.classList.add('instant'); movePill(); });
  function updateNav() {
    sh.querySelectorAll('nav.tabs button').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === S.tab);
      const old = b.querySelector('.dot');
      if (old) old.remove();
      /* rood getalletje: nieuwe cijfers bij Cijfers, nieuw/aangepast huiswerk bij Huiswerk, nieuwe absentie-aantekeningen bij Meer */
      const t = b.dataset.tab;
      const n = t === 'cijfers' ? ((S.grades || S.dev.length) && store.init ? newGrades().length : 0)
        : t === 'huiswerk' ? (S.tab === 'huiswerk' ? 0 : (ls.get('cp:hwNew', []) || []).length + (S.devHwNew || 0))
        : t === 'meer' ? absNewCount() : 0;
      if (n) b.insertAdjacentHTML('beforeend', `<span class="dot">${n > 9 ? '9+' : n}</span>`);
    });
    movePill();
  }
  /* nieuwe absentie-aantekeningen: wat er nog niet stond toen je de vorige keer bij Meer keek */
  const absKey = i => [i.date, i.uur, i.vak, i.absentie].join('|');
  const absItemsAll = () => { const hidden = ls.get('cp:absHidden', []) || []; return (S.devAbs || []).concat(S.abs && S.abs.items ? S.abs.items : []).filter(i => !hidden.includes(absKey(i))); };
  const absIsNew = i => { const seen = ls.get('cp:absSeen', null); return !!seen && !seen.includes(absKey(i)); };
  const absNewCount = () => absItemsAll().filter(i => i.dev ? !i.seen : absIsNew(i)).length;
  /* totalen van het portaal, met de testaantekeningen erbij opgeteld (alleen in het geheugen; echte aantekeningen
     zitten al in de totalen van het portaal, die tellen we dus niet dubbel) */
  function absTotals() {
    const totals = (S.abs.totals || []).map(t => ({ ...t }));
    (S.devAbs || []).forEach(i => {
      const norm = s => s.toLowerCase().replace(/[\s,]+/g, '');
      const t = totals.find(x => norm(x.label) === norm(i.absentie));
      const n = t ? (parseInt(t.value, 10) || 0) + 1 : 1;
      /* te laat en absent tellen in lesuren, de rest (materiaal vergeten, eruit gestuurd…) in aantal keer */
      const uren = /^(te laat|absent)/i.test(i.absentie);
      const value = t ? t.value.replace(/\d+/g, n).replace(/\blesuur\b(?!en)/, n === 1 ? 'lesuur' : 'lesuren') : uren ? n + (n === 1 ? ' lesuur' : ' lesuren') : n + 'x';
      if (t) t.value = value; else totals.push({ label: i.absentie, value });
    });
    return totals;
  }
  function absMarkSeen() {
    const all = absItemsAll();
    all.forEach(i => { if (i.dev) i.seen = true; });
    const seen = new Set(ls.get('cp:absSeen', []) || []);
    all.filter(i => !i.dev).forEach(i => seen.add(absKey(i)));
    ls.set('cp:absSeen', [...seen].slice(-300));
    updateNav();
  }
  /* absentie op de achtergrond ophalen (voor het getalletje bij Meer); de eerste keer telt alles als gezien */
  async function loadAbsenceBg() {
    if (!S.abs) { const cached = ls.get('cp:abs', null); if (cached) S.abs = cached; }
    try { const a = await loadAbsence(); S.abs = a; if (a.totals.length) { ls.set('cp:abs', a); ls.set('cp:absT', Date.now()); } } catch (e) { if (!S.abs) S.abs = { error: e }; }
    if (ls.get('cp:absSeen', null) == null && S.abs && S.abs.items) ls.set('cp:absSeen', S.abs.items.map(absKey));
    updateNav();
    if (S.tab === 'meer' && !sh.querySelector('.modal, .panel, .ov')) renderMore();
  }
  function go(tab) {
    if (tab === 'packs') tab = 'cijfers'; /* oude naam (meldingen): nieuwe cijfers staan nu bij Cijfers */
    app.classList.remove('immersive');
    if (tab === 'cijfers') S.ovPeriod = null; /* Cijfers opent altijd op de huidige periode */
    /* schuifovergang: het oude scherm schuift weg, het nieuwe komt van de kant van het tabblad binnen */
    const vis = visibleTabs(), from = vis.indexOf(S.tab), to = vis.indexOf(tab);
    const slide = S.tab !== tab && from >= 0 && to >= 0 && main.firstElementChild && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ghost = null;
    if (slide) {
      ghost = document.createElement('div');
      ghost.className = 'pageghost';
      ghost.style.cssText = `top:${main.offsetTop}px;height:${main.clientHeight}px`;
      const old = main.firstElementChild.cloneNode(true);
      old.style.transform = `translateY(${-main.scrollTop}px)`;
      ghost.appendChild(old);
      app.appendChild(ghost);
    }
    S.tab = tab;
    main.scrollTop = 0;
    render();
    if (slide) {
      const dir = to > from ? 1 : -1, ease = 'cubic-bezier(.2, .8, .2, 1)', el = main; /* main zelf, want de inhoud kan tijdens het schuiven nog ververst worden */
      if (el) {
        el.style.transition = 'none';
        el.style.transform = `translateX(${dir * 34}%)`;
        el.style.opacity = '0';
        void el.offsetWidth;
        el.style.transition = `transform .3s ${ease}, opacity .25s`;
        el.style.transform = '';
        el.style.opacity = '';
      }
      requestAnimationFrame(() => { ghost.style.transform = `translateX(${-dir * 28}%)`; ghost.style.opacity = '0'; });
      setTimeout(() => ghost.remove(), 340);
    }
  }
  function render() {
    updateNav();
    const f = { cijfers: renderGrades, huiswerk: renderHomework, rooster: renderRooster, meer: renderMore }[S.tab];
    f();
    const t = S.tab;
    if (TIPS[t]) tip(t, () => S.tab === t && !main.querySelector('[data-a=login]'));
  }
  function spinning(on) { refreshBtn.classList.toggle('spin', !!on); }

  function loginScreen() {
    /* snelstart (lege pagina): de sessie bleek verlopen. Dan één keer zelf het echte portaal laden; Microsoft
       logt je daar meestal stil opnieuw in, net als vroeger bij het opstarten */
    if (window.__cpShell && !S.autoRelogin && navigator.onLine !== false && Native) {
      S.autoRelogin = true;
      main.innerHTML = loading('Opnieuw verbinden…');
      return relogin();
    }
    app.classList.remove('immersive');
    main.innerHTML = `<div class="center"><h2>Je bent uitgelogd</h2>
      <p class="muted">Log opnieuw in met je schoolaccount. De app slaat je wachtwoord niet op.</p>
      <button class="btn" data-a="login">Opnieuw inloggen</button></div>`;
    main.querySelector('[data-a=login]').onclick = relogin;
  }
  function relogin() { if (Native) Native.relogin(); else location.href = P_CIJFERS; }
  function errBox(e) { return `<div class="err">${esc(e && e.message ? e.message : e)}</div>`; }
  /* lege toestand met een rustig lijn-icoontje (geen emoji) */
  const EMPTY_ICON = {
    hw: '<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v3h3"/><path d="m9 13 2 2 4-4"/>',
    rooster: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    cijfers: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    vrij: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };
  const emptyIcon = k => `<svg class="empty-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EMPTY_ICON[k] || EMPTY_ICON.rooster}</svg>`;
  const emptyHtml = (k, title, sub) => `<div class="empty">${emptyIcon(k)}<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  /* laden: grijze vakjes in de vorm van wat er komt (voelt sneller dan een draaiend rondje) */
  const skeleton = kind => {
    const line = (w, h = 10) => `<i class="sk" style="width:${w};height:${h}px"></i>`;
    if (kind === 'hw') return `<div class="skel" aria-label="Laden">${[0, 1, 2].map(() => `<div class="card-box sk-card">${line('34px', 22)}<div>${line('55%', 14)}${line('85%')}${line('40%')}</div></div>`).join('')}</div>`;
    return `<div class="skel" aria-label="Laden">${[0, 1, 2, 3, 4].map(() => `<div class="sk-les">${line('26px', 22)}<div>${line('60%', 14)}${line('40%')}</div>${line('44px', 26)}</div>`).join('')}</div>`;
  };
  const loading = (txt) => `<div class="center"><div class="spinner"></div><p class="muted">${esc(txt || 'Laden…')}</p></div>`;

  /* ---------- per account bewaren: bij uitloggen apart zetten, bij weer inloggen terug ----------
     (geopende cijfers, afgevinkt huiswerk, herinneringsregels, geziene en weggeklikte aantekeningen) */
  const ACCT_KEYS = ['cijferpacks:v1', 'cp:hwdone', 'cp:hwrules', 'cp:absSeen', 'cp:absHidden', 'cp:tourDone', 'cp:ownHw'];
  const acctKey = name => 'cp:acct:' + name.trim().toLowerCase();
  function stashAccount() {
    const name = S.grades && S.grades.student;
    if (!name) return;
    const b = {};
    ACCT_KEYS.forEach(k => { try { const v = localStorage.getItem(k); if (v != null) b[k] = v; } catch (e) {} });
    ls.set(acctKey(name), b);
  }
  /* true als er iets terugkwam (dan opnieuw tekenen) */
  function restoreAccount(name) {
    const b = ls.get(acctKey(name), null);
    if (!b) return false;
    try { localStorage.removeItem(acctKey(name)); } catch (e) {}
    const parse = v => { try { return JSON.parse(v); } catch (e) { return null; } };
    const old = parse(b['cijferpacks:v1']);
    /* geopende cijfers samenvoegen met wat je sinds het inloggen al hebt geopend */
    if (old) { store = { init: old.init || store.init, seen: Object.assign({}, old.seen, store.seen) }; saveStore(); }
    const d = parse(b['cp:hwdone']);
    if (d) { done = Object.assign({}, d, done); ls.set('cp:hwdone', done); }
    const r = parse(b['cp:hwrules']);
    if (r && !ls.get('cp:hwrules', null)) { hwRules = r; saveRules(); }
    ['cp:absSeen', 'cp:absHidden', 'cp:tourDone', 'cp:ownHw'].forEach(k => { if (b[k] != null && ls.get(k, null) == null) try { localStorage.setItem(k, b[k]); } catch (e) {} });
    return true;
  }

  /* ---------- cijfers laden ---------- */
  async function refreshGrades(full) {
    if (S.loadingGrades) return;
    S.loadingGrades = true;
    spinning(true);
    try {
      S.grades = await loadGrades(full);
      S.gradesErr = null;
      ls.set('cp:cache:grades', S.grades);
      /* weer ingelogd: je geopende cijfers enz. van de vorige keer terugzetten */
      if (S.grades.student && restoreAccount(S.grades.student)) S.remChanged = true;
      /* reminders horen bij je account: andere leerling ingelogd, dan diens reminders */
      try {
        if (S.grades.student && Native && Native.setRemOwner && Native.setRemOwner(S.grades.student) && (S.tab === 'rooster' || S.tab === 'meer')) S.remChanged = true;
      } catch (e) {}
    } catch (e) {
      S.gradesErr = e;
    }
    S.loadingGrades = false;
    spinning(false);
    /* de servertijd is nu bekend: klopt de dag van de telefoon niet, dan meteen naar de echte dag */
    if (S.dayKey && checkDay(true)) return updateNav();
    if ((S.tab === 'cijfers' && !S.packBusy) || S.remChanged) { S.remChanged = false; render(); }
    else updateNav();
  }

  /* vernieuwen: rooster, huiswerk en cijfers (en op wifi ook updates), niet alleen het tabblad waar je bent.
     Op 4G/5G alleen wat daar mag (Meer → Datagebruik) plus het tabblad waar je nu bent */
  function refreshCurrent(force) {
    let mobile = false, types = 'rch';
    try {
      mobile = !!(Native && Native.onMobile && Native.onMobile());
      if (mobile) { const ns = JSON.parse(Native.getSettings()); types = 'rch'.split('').filter(x => (ns['n_mob_' + x + '_mode'] || DATA_DEF[x]) !== 'off').join(''); } /* op 4G/5G alles behalve wat op nooit staat */
    } catch (e) {}
    const want = (t, tab) => S.tab === tab || types.includes(t);
    /* het tabblad waar je bent: opnieuw laden met laadscherm; de andere stil op de achtergrond */
    if (want('r', 'rooster')) {
      if (S.tab === 'rooster') { delete S.rooster[S.rMonday.getTime()]; renderRooster(); }
      else refreshWeek('r', S.rMonday.getTime(), S.rMonday);
    }
    if (want('h', 'huiswerk')) {
      if (S.tab === 'huiswerk') { delete S.hw[S.hwMonday.getTime()]; renderHomework(); }
      else refreshWeek('hw', S.hwMonday.getTime(), S.hwMonday);
    }
    if (want('c', 'cijfers')) refreshGrades(true); /* vernieuwen = alle perioden opnieuw */
    if (S.tab === 'meer') { S.abs = null; renderMore(); }
    if (!mobile) checkUpdate(false, false, true); /* updates alleen op wifi */
    const what = ['rooster', 'huiswerk', 'cijfers'].filter((tab, i) => want('rhc'[i], tab));
    toast('Vernieuwen: ' + what.join(', ') + (mobile ? ' (4G/5G)' : ' en updates'));
  }

  /* testcijfers uit het ontwikkelaarsscherm leven alleen in het geheugen: na het sluiten van de app zijn ze weg */
  const allGrades = () => (S.grades ? S.grades.grades : []).concat(S.dev);
  const isNew = g => g.dev ? !S.devSeen.has(g.id) : store.seen[g.id] !== g.val;
  const newGrades = () => S.grades || S.dev.length ? allGrades().filter(isNew).sort((a, b) => score(a) - score(b)) : [];
  const markSeen = g => { if (g.dev) S.devSeen.add(g.id); else { store.seen[g.id] = g.val; saveStore(); } };
  const findGrade = id => allGrades().find(g => g.id === id);

  const pass = g => score(g) >= 5.5;
  const gradeClass = g => g.num == null && LETTERS[String(g.val).toUpperCase()] == null ? 'neutral' : pass(g) ? 'good' : 'bad';
  const unboxTier = g => g.num == null ? (pass(g) ? 'pass' : 'fail') : g.num >= 8.5 ? 'gold' : g.num < 5.5 ? 'fail' : 'pass';

  const statsHTML = g => `<div class="rv-stats"><div><b>${esc(g.weging || '–')}x</b><span>Weging</span></div><div><b>${esc(soortKort(g))}</b><span>Type</span></div><div><b>${esc(shortDate(g.datum))}</b><span>Datum</span></div></div>`;
  function showModal(g) {
    if (!g) return;
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet rbox shown ${gradeClass(g)}"><div class="rb-vak">${emoji(g.afk)} ${esc(g.vak)}</div><div class="rb-grade">${esc(dec(g.val))}</div>
      <div class="rb-oms">${esc(g.oms)}</div>${statsHTML(g)}
      <div class="muted small" style="text-align:center">Periode ${esc(g.p)}${g.kind === 'deel' ? ' · deelcijfer' : ''}${g.herk && g.herk !== 'Geen' ? ' · herkansing' : ''}${g.dev ? ' · testcijfer' : ''}</div>
      <button class="btn" data-a="replay">▶ Opnieuw afspelen</button><button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-a=close]')) m.remove();
      else if (e.target.closest('[data-a=replay]')) { m.remove(); unbox(g); }
    });
    app.appendChild(m);
  }

  /* ---------- geluid (Web Audio, geen bestanden nodig) ---------- */
  let actx = null;
  function audio() {
    if (!ls.get('cp:sound', true)) return null;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  /* alle geluiden lopen via één volumeknop (Instellingen → Geluid bij cijfers) */
  let master = null, volume = ls.get('cp:vol', 0.8);
  function out(c) {
    if (!master) { master = c.createGain(); master.connect(c.destination); }
    master.gain.value = volume;
    return master;
  }
  /* "bo-womp" bij een onvoldoende: echt geluidsbestand, via fetch zodat de app het uit de APK kan leveren */
  let wompBuf = null;
  function loadWomp(c) {
    if (wompBuf) return wompBuf;
    wompBuf = fetch(ASSET('bo-womp.mp3')).then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => c.decodeAudioData(b, ok, no)));
    wompBuf.catch(() => { wompBuf = null; });
    return wompBuf;
  }
  function note(c, o) {
    const osc = c.createOscillator(), g = c.createGain(), t = c.currentTime + (o.t || 0);
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    let node = osc;
    if (o.filter) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.filter; osc.connect(fl); node = fl; }
    if (o.vib) {
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 6; lg.gain.value = 6;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t + o.dur * .3); lfo.stop(t + o.dur + .05);
    }
    const v = o.vol || .15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + .02);
    if (o.hold) g.gain.setValueAtTime(v, t + o.dur * .75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    node.connect(g).connect(out(c));
    osc.start(t); osc.stop(t + o.dur + .05);
    return osc;
  }
  function noise(c, dur, vol, from, to) {
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), x = buf.getChannelData(0);
    for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
    s.buffer = buf; f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out(c)); s.start();
  }
  const SND = {
    woosh() { const c = audio(); if (c) noise(c, .5, .25, 600, 5000); },
    build() { const c = audio(); if (!c) return () => {}; const o = note(c, { type: 'sawtooth', f: 80, f2: 600, dur: 5, vol: .05 }); return () => { try { o.stop(); } catch (e) {} }; },
    boom() { const c = audio(); if (!c) return; noise(c, 1.2, .6, 3000, 60); note(c, { type: 'sine', f: 90, f2: 30, dur: .8, vol: .5 }); },
    tick() { const c = audio(); if (c) note(c, { type: 'square', f: 1200, dur: .04, vol: .04 }); },
    /* vrolijk loopje omhoog */
    happy() { const c = audio(); if (!c) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => note(c, { type: 'triangle', f, t: k * .11, dur: .45, vol: .17 })); },
    /* topcijfer: langer en hoger */
    gold() { const c = audio(); if (!c) return; [523, 659, 784, 1047, 1319, 2093].forEach((f, k) => note(c, { type: 'triangle', f, t: k * .09, dur: .7, vol: .15 })); },
    /* "whomp whomp whomp whoooomp": dalende trombone */
    sad() {
      const c = audio(); if (!c) return;
      loadWomp(c).then(buf => { const s = c.createBufferSource(); s.buffer = buf; s.connect(out(c)); s.start(); }).catch(() => SND.trombone());
    },
    /* reserve als het geluidsbestand niet laadt */
    trombone() {
      const c = audio(); if (!c) return;
      [233.1, 220, 207.7].forEach((f, k) => note(c, { type: 'sawtooth', f, f2: f * .96, t: k * .38, dur: .34, vol: .16, filter: 850, hold: true }));
      note(c, { type: 'sawtooth', f: 196, f2: 182, t: 3 * .38, dur: 1.2, vol: .16, filter: 850, vib: true, hold: true });
    }
  };
  /* oude namen, gebruikt door de geluidsknop in Meer */
  const playHappy = () => SND.happy();

  /* ---------- unboxen (in de stijl van de Cijferbox-extensie) ---------- */
  function unbox(g, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const tier = unboxTier(g);
      const PILLS = [[g.weging ? g.weging + '× weging' : 'telt niet mee'], [soortKort(g)], [shortDate(g.datum)]];
      const ov = document.createElement('div');
      ov.className = 'ov';
      let sparks = '';
      for (let i = 0; i < 16; i++) sparks += `<i class="sp" style="left:${i * 37 % 100}%;animation-delay:${(i % 10) * .2}s"></i>`;
      ov.innerHTML = sparks + `<div class="ub-count">${esc(opts.label || '')}</div><div class="ub-pack"><b>${emoji(g.afk)}</b><span>CIJFER</span></div>
        <div class="tap">Tik om te openen</div>${opts.onSkip ? '<button class="skip">Alles overslaan »</button>' : ''}`;
      app.appendChild(ov);
      SND.woosh();
      const stopBuild = SND.build();
      let stage = 0;
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));
      later(open, 4500);
      /* doortikken: pakje dicht = openen, tijdens het onthullen = meteen het cijfer, cijfer zichtbaar = volgende */
      ov.addEventListener('click', e => {
        if (e.target.closest('.skip')) return;
        if (stage === 0) open();
        else if (stage === 1) finishNow();
        else if (stage === 2) next();
      });
      const sk = ov.querySelector('.skip');
      if (sk) sk.onclick = e => { e.stopPropagation(); stopBuild(); timers.forEach(clearTimeout); ov.remove(); opts.onSkip(); resolve('skip'); };
      function shake(ms) { app.classList.add('shaking'); setTimeout(() => app.classList.remove('shaking'), ms); }
      function open() {
        if (stage) return;
        stage = 1;
        timers.forEach(clearTimeout);
        stopBuild();
        SND.boom();
        shake(500);
        buzz(250);
        ov.innerHTML = `<div class="flash"></div><div class="ub-card"><h2>${emoji(g.afk)} ${esc(g.vak)}</h2><div class="ub-oms">${esc(g.oms)}</div>
          <div class="ub-pills"></div><div class="ub-n">?</div><div class="ub-lbl"></div></div><button class="btn ub-next" hidden>Verder</button><div class="tap ub-hint">Tik om door te gaan</div>`;
        const pills = ov.querySelector('.ub-pills');
        PILLS.forEach(([t], k) => later(() => {
          pills.insertAdjacentHTML('beforeend', `<span class="ub-pill">${esc(t)}</span>`);
          SND.tick();
        }, 700 + k * 550));
        later(spinReel, 2500);
      }
      /* cijfers rollen van links naar rechts voorbij, steeds langzamer, tot het echte cijfer in het midden stopt */
      function spinReel() {
        if (stage !== 1) return;
        const n = ov.querySelector('.ub-n');
        const N = 26, W = 172, DUR = 2100;
        const vals = [dec(g.val)];
        for (let i = 1; i < N; i++) vals.push(dec((1 + Math.random() * 9).toFixed(1)));
        /* het echte cijfer staat links in de strook; de strook schuift naar rechts tot dat cijfer in het midden staat */
        n.innerHTML = `<div class="reel"><div class="reel-strip">${vals.map(v => `<span style="width:${W}px">${esc(v)}</span>`).join('')}</div></div>`;
        const reel = n.firstElementChild, strip = reel.firstElementChild;
        const center = (reel.clientWidth - W) / 2, from = center - (N - 1) * W;
        strip.style.transform = `translateX(${from}px)`;
        void strip.offsetWidth;
        strip.style.transition = `transform ${DUR}ms cubic-bezier(.08, .7, .2, 1)`;
        strip.style.transform = `translateX(${center}px)`;
        /* tikje bij elk cijfer dat het midden passeert */
        let last = null;
        const tick = () => {
          if (stage !== 1) return;
          const x = new DOMMatrix(getComputedStyle(strip).transform).m41;
          const idx = Math.round((center - x) / W);
          if (idx !== last) { if (last != null) SND.tick(); last = idx; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        strip.addEventListener('transitionend', () => later(final, 120), { once: true });
      }
      function finishNow() {
        timers.forEach(t => { clearTimeout(t); clearInterval(t); });
        ov.querySelector('.ub-pills').innerHTML = PILLS.map(([t]) => `<span class="ub-pill">${esc(t)}</span>`).join('');
        final();
      }
      function next() { if (stage === 3) return; stage = 3; ov.remove(); resolve('done'); }
      function final() {
        if (stage >= 2) return;
        stage = 2;
        const n = ov.querySelector('.ub-n');
        const col = tier === 'gold' ? 'var(--gold)' : tier === 'fail' ? 'var(--red)' : 'var(--good)';
        const rolled = !!n.querySelector('.reel'); /* na het rollen staat het cijfer al in het midden: alleen even opveren */
        n.textContent = dec(g.val);
        n.className = 'ub-n fin' + (rolled ? ' soft' : '');
        n.style.color = col;
        shake(450);
        ov.querySelector('.ub-lbl').innerHTML = `<b style="color:${col}">${tier === 'gold' ? 'TOPCIJFER!' : tier === 'fail' ? 'ONVOLDOENDE' : 'VOLDOENDE'}</b>`;
        if (tier === 'fail') { SND.sad(); ov.classList.add('fail'); buzz(400); }
        else {
          tier === 'gold' ? SND.gold() : SND.happy();
          for (let i = 0; i < 40; i++) {
            const c = document.createElement('i');
            c.className = 'cf';
            c.style.left = (i * 53 % 100) + '%';
            c.style.background = i % 3 ? col : '#fff';
            c.style.animationDelay = (i % 12) * .05 + 's';
            ov.appendChild(c);
          }
        }
        if (opts.onReveal) opts.onReveal();
        const b = ov.querySelector('.ub-next');
        b.hidden = false;
        b.onclick = e => { e.stopPropagation(); next(); };
      }
    });
  }


  async function openQueue(list) {
    S.packBusy = true;
    let skipped = false;
    for (let i = 0; i < list.length && !skipped; i++) {
      const g = list[i];
      await unbox(g, {
        label: list.length > 1 ? `Cijfer ${i + 1} van ${list.length}` : '',
        onReveal: () => markSeen(g),
        onSkip: list.length > 1 ? () => { skipped = true; list.forEach(markSeen); } : null
      });
      markSeen(g);
      updateNav();
    }
    S.packBusy = false;
    if (S.tab === 'cijfers') renderGrades();
  }

  /* ---------- tab: cijfers ---------- */
  const calcEntry = () => `<button class="calc-entry" data-a="calc"><span><b>Wat moet ik halen?</b><span>Reken uit welk cijfer je nodig hebt voor een 5,5 of hoger</span></span><span class="go">›</span></button>`;
  function renderGrades() {
    setHeader('Cijfers');
    const data = S.grades;
    if (!data) {
      const msg = S.gradesErr ? errBox(S.gradesErr.message === 'login' ? 'Je bent uitgelogd. Log opnieuw in om je cijfers te zien.' : S.gradesErr) : `<div class="center" style="min-height:auto"><div class="spinner"></div><p class="muted">Cijfers ophalen…</p></div>`;
      main.innerHTML = `<div class="pad">${msg}${calcEntry()}</div>`;
      main.querySelector('[data-a=calc]').onclick = openCalc;
      return;
    }
    if (!S.ovPeriod || data.periods.indexOf(S.ovPeriod) < 0) S.ovPeriod = data.current;
    const p = S.ovPeriod;
    const inP = allGrades().filter(g => g.p === p);
    const gems = data.subjects.map(s => toNum((s.periods[p] || {}).gem)).filter(n => n != null);
    const avg = gems.length ? (gems.reduce((a, b) => a + b, 0) / gems.length).toFixed(1) : '–';
    const nums = inP.filter(g => g.num != null && !(store.init && isNew(g)));
    const best = nums.length ? nums.reduce((a, b) => b.num > a.num ? b : a) : null;
    const pLabel = x => x === data.last && data.periods.length > 2 ? 'Eind' : 'Periode ' + x;
    const withGrades = [], without = [];
    data.subjects.forEach(s => {
      const gs = inP.filter(g => g.afk === s.afk);
      const per = s.periods[p] || {};
      (gs.length || per.gem || per.rapport ? withGrades : without).push({ s, gs, per });
    });
    main.innerHTML = `<div class="pad">
      ${newBanner()}
      <div class="muted small">Leerjaar ${esc(data.year)}</div>
      <div class="seg">${data.periods.map(x => `<button class="${x === p ? 'on' : ''}" data-p="${esc(x)}">${esc(pLabel(x))}</button>`).join('')}</div>
      <div class="swipe-area grades"><div class="stats">
        <div class="stat acc"><b>${dec(avg)}</b><span>Gem. rapport</span></div>
        <div class="stat"><b>${inP.length}</b><span>Cijfers</span></div>
        <div class="stat"><b>${best ? esc(dec(best.val)) : '–'}</b><span>${best ? esc(best.afk.toUpperCase()) + ' · beste' : 'Beste'}</span></div>
      </div>
      ${calcEntry()}
      ${S.gradesErr ? errBox(S.gradesErr.message === 'login' ? 'Je bent uitgelogd. Dit zijn de laatst opgehaalde cijfers.' : S.gradesErr) : ''}
      ${withGrades.map(({ s, gs, per }) => {
        const rg = per.rapport ? { val: per.rapport, num: toNum(per.rapport) } : null;
        const hid = store.init && gs.some(isNew) ? ' hide-new' : ''; /* gemiddelde en rapport verraden een nog niet geopend cijfer */
        return `<div class="card-box"><div class="vak-h"><div class="em">${emoji(s.afk)}</div>
          <div class="nm"><b>${esc(s.name)}</b><span class="${hid}">${per.gem ? 'Gemiddeld ' + esc(dec(per.gem)) : 'Nog geen gemiddelde'}</span></div>
          ${rg ? `<div class="rap${hid}"><div class="badge gc">${esc(dec(rg.val))}</div><span>Rapport</span></div>` : ''}</div>
          ${gs.length ? `<div class="chips">${gs.map(g => isNew(g) && store.init ? `<button class="chip locked" data-new="${esc(g.id)}" aria-label="Nieuw cijfer, tik om te openen"><span class="blur">${esc(dec(g.val))}</span></button>` : `<button class="chip gc${g.dev ? ' dev' : ''}" data-id="${esc(g.id)}">${esc(dec(g.val))}${g.weging && g.weging !== '1' ? `<small>${esc(g.weging)}x</small>` : ''}</button>`).join('')}</div>` : ''}
        </div>`;
      }).join('') || emptyHtml('cijfers', 'Nog geen cijfers in deze periode', 'Zodra er een cijfer is, kun je het hier unboxen.')}
      ${without.length ? `<p class="small muted">Nog niks voor: ${without.map(x => esc(x.s.name)).join(', ')}</p>` : ''}
    </div></div>`;
    main.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => { S.ovPeriod = b.dataset.p; renderGrades(); }; });
    main.querySelectorAll('.chip[data-id]').forEach(b => { b.onclick = () => showModal(findGrade(b.dataset.id)); });
    main.querySelectorAll('[data-new]').forEach(b => { b.onclick = () => openQueue([findGrade(b.dataset.new)]); });
    const oa = main.querySelector('[data-a=openall]');
    if (oa) oa.onclick = () => openQueue(newGrades());
    const ia = main.querySelector('[data-a=all]');
    if (ia) ia.onclick = () => { store.init = true; saveStore(); render(); };
    const ini = main.querySelector('[data-a=now]');
    if (ini) ini.onclick = () => { store.init = true; S.grades.grades.forEach(g => { store.seen[g.id] = g.val; }); saveStore(); render(); };
    main.querySelector('[data-a=calc]').onclick = openCalc;
  }
  /* bovenaan Cijfers: nieuwe cijfers openen (of bij de eerste keer: alles unboxen of alleen nieuwe) */
  function newBanner() {
    if (!store.init && S.grades) return `<div class="bn first"><div><b>Welkom${S.grades.student ? ', ' + esc(S.grades.student.split(' ')[0]) : ''}!</b>
      <small>Er staan al ${S.grades.grades.length} cijfers in het portaal. Allemaal unboxen, of alleen nieuwe vanaf nu?</small>
      <div class="row" style="margin-top:10px"><button class="btn" data-a="all">Alles unboxen</button><button class="btn" data-a="now">Alleen nieuwe</button></div></div></div>`;
    const n = newGrades().length;
    if (!n) return '';
    return `<div class="bn"><div><b>${n} ${n === 1 ? 'nieuw cijfer' : 'nieuwe cijfers'}!</b><small>Tik op een wazig cijfer of open ze allemaal.</small></div><button class="btn" data-a="openall">Nu openen</button></div>`;
  }

  /* "wat moet ik halen": voor iedereen, in Cijfers en Meer. Met je cijfers uit het portaal, of zelf ingevuld
     (handig als de cijfers nog niet geladen zijn of als je wilt rekenen met een ander gemiddelde). */
  function calcBody() {
    const data = S.grades;
    const c = S.calc || (S.calc = { p: data ? data.current : '1', afk: null, target: ls.get('cp:calcTarget', 5.5), weight: 1, manual: !data, mAvg: '6,0', mW: '3' });
    /* alleen vakken met cijfers die meetellen (weging 0 telt niet, anders deel je door nul) */
    const subs = data ? data.subjects.filter(s => ((s.periods[c.p] || {}).items || []).some(x => x.w > 0)) : [];
    if (!data) c.manual = true;
    if (!subs.some(s => s.afk === c.afk)) c.afk = subs.length ? subs[0].afk : null;
    let W, Sum, info, none = false;
    /* "Mijn cijfers" blijft altijd te kiezen, ook als de gekozen periode nog leeg is (anders kon je niet meer terug) */
    let top = data ? `<div class="seg" style="margin-bottom:10px">${[[false, 'Mijn cijfers'], [true, 'Zelf invullen']].map(([k, l]) => `<button class="${c.manual === k ? 'on' : ''}" data-cm="${k}">${l}</button>`).join('')}</div>` : '';
    if (!c.manual) {
      const pLabel = x => x === data.last && data.periods.length > 2 ? 'Eind' : 'Periode ' + x;
      top += `<div class="calc-row"${subs.length ? '' : ' style="grid-template-columns:1fr"'}><select data-calc="p" aria-label="Periode">${data.periods.map(x => `<option value="${esc(x)}"${x === c.p ? ' selected' : ''}>${esc(pLabel(x))}</option>`).join('')}</select>
        ${subs.length ? `<select data-calc="afk" aria-label="Vak">${subs.map(s => `<option value="${esc(s.afk)}"${s.afk === c.afk ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}</div>`;
    }
    if (!c.manual && !subs.length) {
      none = true;
      W = 0; Sum = 0;
      info = `Nog geen cijfers in ${data.last === c.p && data.periods.length > 2 ? 'Eind' : 'periode ' + esc(c.p)}. Kies een andere periode, of tik op Zelf invullen.`;
    } else if (!c.manual) {
      const s = subs.find(x => x.afk === c.afk), per = s.periods[c.p], items = per.items;
      W = items.reduce((a, x) => a + x.w, 0);
      Sum = items.reduce((a, x) => a + x.v * x.w, 0);
      info = `Nu gemiddeld <b style="color:var(--fg)">${dec((Sum / W).toFixed(2))}</b> over ${items.length} ${items.length === 1 ? 'cijfer' : 'cijfers'} (weging ${W})${per.gem ? ' · portaal: ' + esc(dec(per.gem)) : ''}`;
    } else {
      top += `<div class="calc-row" style="grid-template-columns:1fr 1fr"><label class="lbl">Huidig gemiddelde<input type="text" inputmode="decimal" id="calc-avg" data-cmf="mAvg" value="${esc(c.mAvg)}" style="margin-top:6px"></label>
        <label class="lbl">Totale weging tot nu<input type="text" inputmode="numeric" id="calc-w" data-cmf="mW" value="${esc(c.mW)}" style="margin-top:6px"></label></div>`;
      const a = toNum(c.mAvg), w = toNum(c.mW);
      W = w != null && w >= 0 ? w : 0;
      Sum = a != null ? a * W : 0;
      info = data ? 'Vul je eigen gemiddelde en weging in.' : 'Je cijfers zijn nog niet geladen, dus vul ze zelf in.';
    }
    const need = (c.target * (W + c.weight) - Sum) / c.weight;
    let big, verdict, cls;
    if (none) { big = '–'; cls = 'need'; verdict = 'Geen cijfers om mee te rekenen in deze periode.'; }
    else if (need <= 1) { big = '✓'; cls = 'safe'; verdict = `Je staat safe: zelfs met een 1 blijf je op ${dec(c.target.toFixed(1))} of hoger.`; }
    else if (need > 10) { big = '✗'; cls = 'imp'; verdict = `Niet meer haalbaar met één toets (je zou een ${dec(need.toFixed(1))} nodig hebben).`; }
    else { big = dec((Math.ceil(need * 10 - 1e-9) / 10).toFixed(1)); cls = 'need'; verdict = `minimaal nodig voor gemiddeld een ${dec(c.target.toFixed(1))}`; }
    return `${top}
      <div class="muted small" style="margin:10px 0">${info}</div>
      <label class="lbl">Doel</label>
      <div class="seg" style="margin:6px 0 12px">${[5.5, 6, 6.5, 7, 7.5, 8].map(t => `<button class="${t === c.target ? 'on' : ''}" data-ct="${t}">${dec(t.toFixed(1))}</button>`).join('')}</div>
      <label class="lbl">Weging volgende toets</label>
      <div class="seg" style="margin:6px 0 12px">${[1, 2, 3, 4, 5].map(w => `<button class="${w === c.weight ? 'on' : ''}" data-cw="${w}">${w}×</button>`).join('')}</div>
      <div class="calc-out ${cls}" data-calcout><b>${big}</b>${verdict}</div>`;
  }
  function calcCard() {
    return `<div class="card-box" data-calcbox><div class="setting-h">Wat moet ik halen?</div><div data-calcbody>${calcBody()}</div></div>`;
  }
  /* alleen het rekenblok opnieuw tekenen, zodat een invoerveld de focus houdt */
  function bindCalc(root) {
    const box = root.querySelector('[data-calcbody]');
    if (!box) return;
    const redraw = () => { box.innerHTML = calcBody(); bindCalc(root); };
    box.querySelectorAll('[data-calc]').forEach(el => { el.onchange = () => { S.calc[el.dataset.calc] = el.value; redraw(); }; });
    box.querySelectorAll('[data-cm]').forEach(b => { b.onclick = () => { S.calc.manual = b.dataset.cm === 'true'; redraw(); }; });
    box.querySelectorAll('[data-ct]').forEach(b => { b.onclick = () => { S.calc.target = +b.dataset.ct; ls.set('cp:calcTarget', S.calc.target); redraw(); }; });
    box.querySelectorAll('[data-cw]').forEach(b => { b.onclick = () => { S.calc.weight = +b.dataset.cw; redraw(); }; });
    box.querySelectorAll('[data-cmf]').forEach(inp => {
      inp.oninput = () => {
        S.calc[inp.dataset.cmf] = inp.value;
        const tmp = document.createElement('div');
        tmp.innerHTML = calcBody();
        const out = box.querySelector('[data-calcout]'), fresh = tmp.querySelector('[data-calcout]');
        if (out && fresh) { out.className = fresh.className; out.innerHTML = fresh.innerHTML; }
      };
    });
  }
  function openCalc() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Wat moet ik halen?</h3><div data-calcbody>${calcBody()}</div><button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    app.appendChild(m);
    bindCalc(m);
    tip('calc', () => m.isConnected, true);
  }

  /* ---------- tab: huiswerk ---------- */
  /* weeknummer zoals op school en in de agenda (ISO: week 1 is de week met de eerste donderdag van het jaar) */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }
  function weekNav(monday, which) {
    const fri = addDays(monday, 4);
    const thisMon = mondayOf(now());
    const diff = Math.round((monday - thisMon) / 6048e5);
    const rel = diff === 0 ? 'Deze week' : diff === 1 ? 'Volgende week' : diff === -1 ? 'Vorige week' : 'Week van ' + monday.getDate() + '/' + (monday.getMonth() + 1);
    const t = now(), atToday = monday.getTime() === defaultMonday().getTime() && (which !== 'r' || S.rView === 'week' || !S.rDay || sameDay(new Date(S.rDay), t) || t.getDay() % 6 === 0);
    return `<div class="weeknav"><button class="ibtn" data-w="${which}" data-d="-7">‹</button>
      <div class="lbl">${rel}<small>${monday.getDate()}/${monday.getMonth() + 1} t/m ${fri.getDate()}/${fri.getMonth() + 1} · week ${isoWeek(monday)}</small></div>
      ${atToday ? '' : `<button class="ibtn" data-today="${which}" style="width:auto;padding:0 10px;font-size:13px;font-weight:700">Vandaag</button>`}
      <button class="ibtn" data-w="${which}" data-d="7">›</button></div>`;
  }
  function bindWeekNav(key, rerender) {
    main.querySelectorAll('[data-w]').forEach(b => {
      b.onclick = () => { S[key] = addDays(S[key], +b.dataset.d); if (key === 'rMonday') S.rDay = null; rerender(); };
    });
    main.querySelectorAll('[data-today]').forEach(b => {
      b.onclick = () => { S[key] = defaultMonday(); if (key === 'rMonday') S.rDay = null; rerender(); };
    });
  }

  /* laatst opgehaalde weken bewaren (rooster en huiswerk), zodat ze bij het openen meteen klaarstaan.
     Daarna haalt de app op de achtergrond de nieuwste versie op en tekent opnieuw als er iets veranderd is */
  const weekCache = {
    get: (name, key) => (ls.get('cp:wk:' + name, {}) || {})[key] || null,
    set(name, key, v) {
      const c = ls.get('cp:wk:' + name, {}) || {};
      c[key] = v;
      const out = {};
      Object.keys(c).map(Number).sort((a, b) => b - a).slice(0, 3).forEach(k => { out[k] = c[k]; });
      ls.set('cp:wk:' + name, out);
    }
  };
  async function refreshWeek(name, key, mon) {
    S.fresh[name + key] = 1;
    const isR = name === 'r', tab = isR ? 'rooster' : 'huiswerk';
    try {
      const v = isR ? await loadRooster(mon) : await loadHomework(mon);
      const same = JSON.stringify(v) === JSON.stringify((isR ? S.rooster : S.hw)[key]);
      (isR ? S.rooster : S.hw)[key] = v;
      weekCache.set(name, key, v);
      if (isR) pushWidget();
      const onIt = S.tab === tab && (isR ? S.rMonday : S.hwMonday).getTime() === key;
      if (!same && onIt && !sh.querySelector('.modal, .panel, .ov')) (isR ? renderRooster : renderHomework)();
    } catch (e) { S.fresh[name + key] = 0; }
  }
  async function renderHomework() {
    setHeader('Huiswerk');
    const mon = S.hwMonday, key = mon.getTime();
    const shell = body => { main.innerHTML = `<div class="pad">${weekNav(mon, 'hw')}<div class="swipe-area">${body}</div></div>`; bindWeekNav('hwMonday', renderHomework); };
    if (!S.hw[key] && !S.fresh['hw' + key]) { const c = weekCache.get('hw', key); if (c) { S.hw[key] = c; refreshWeek('hw', key, mon); } }
    const cached = S.hw[key];
    if (!cached) {
      shell(skeleton('hw'));
      spinning(true);
      try { S.hw[key] = await loadHomework(mon); S.fresh['hw' + key] = 1; weekCache.set('hw', key, S.hw[key]); }
      catch (e) { spinning(false); if (S.tab !== 'huiswerk' || S.hwMonday.getTime() !== key) return; return e.message === 'login' ? loginScreen() : shell(errBox(e)); }
      spinning(false);
      if (S.tab !== 'huiswerk' || S.hwMonday.getTime() !== key) return;
    }
    /* je eigen huiswerk (zelf ingevuld, bijv. uit je agenda) komt erbij in deze week */
    const items = S.hw[key].concat(ownHwWeek(mon));
    /* je ziet het nu: niet meer meetellen voor het getalletje (de labels NIEUW blijven deze keer nog staan) */
    const pend = ls.get('cp:hwNew', []) || [];
    if (pend.length) { const here = new Set(items.map(i => i.id)); ls.set('cp:hwNew', pend.filter(id => !here.has(id))); updateNav(); }
    if (S.devHwNew && items.some(i => i.dev)) { S.devHwNew = 0; updateNav(); }
    const addBtn = '<button class="linkbtn" data-a="ownhw" style="text-align:center;border-bottom:0">+ Zelf huiswerk toevoegen</button>';
    if (!items.length) {
      shell(emptyHtml('hw', 'Geen huiswerk deze week', 'Lekker, niks om te doen.') + addBtn);
      main.querySelector('[data-a=ownhw]').onclick = () => ownHwSheet(null);
      return;
    }
    const byDay = new Map();
    items.slice().sort((a, b) => (a.date || 0) - (b.date || 0) || (+a.uur || 0) - (+b.uur || 0)).forEach(it => {
      const k = it.date || 0;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(it);
    });
    const today = dayStart(now());
    let html = '';
    byDay.forEach((list, k) => {
      const d = k ? new Date(k) : null;
      html += `<div class="day-h${d && sameDay(d, today) ? ' today' : ''}">${d ? esc(niceDay(d)) : 'Zonder datum'}</div>`;
      list.forEach(it => {
        const isDone = it.gemaakt || done[it.id];
        html += `<div class="card-box hw${isDone ? ' isdone' : ''}"><div class="em">${emoji(it.vak)}</div><div class="body">
          <div class="t"><span class="vk">${esc(it.vak)}</span>${it.own ? '<span class="tag dim">EIGEN</span>' : ''}${it.badge ? `<span class="tag red">${it.badge}</span>` : ''}${it.toets ? '<span class="tag">TOETS</span>' : ''}${it.uur ? `<span class="tag dim">${esc(it.uur)}e uur</span>` : ''}</div>
          <div class="t" style="margin-top:2px">${esc(it.onderwerp || 'Huiswerk')}</div>
          ${it.huiswerk ? `<div class="txt">${esc(it.huiswerk)}</div>` : ''}
          <div class="meta">${it.own ? `<button class="bell" data-ownedit="${esc(it.id)}">Aanpassen</button> · ` : ''}${it.docent ? docBtn(it.docent) + ' · ' : ''}<button class="bell${(hwRules.item || {})[it.id] ? ' own' : ''}" data-bell="${esc(it.id)}" data-vak="${esc(it.vak)}">${ICONS.bell} ${isDone ? 'Gemaakt' : esc(ruleLabel(ruleFor(it.id, it.vak)))}</button></div>
        </div><button class="check${isDone ? ' on' : ''}" data-id="${esc(it.id)}" aria-label="Gemaakt">${isDone ? '✓' : ''}</button></div>`;
      });
    });
    shell(html + addBtn);
    main.querySelector('[data-a=ownhw]').onclick = () => ownHwSheet(null);
    main.querySelectorAll('[data-ownedit]').forEach(b => { b.onclick = () => ownHwSheet((ls.get('cp:ownHw', []) || []).find(x => 'own-' + x.id === b.dataset.ownedit)); });
    main.querySelectorAll('.check').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.id;
        const nu = !done[id];
        if (done[id]) delete done[id]; else done[id] = 1;
        ls.set('cp:hwdone', done);
        saveRules();
        buzz(15);
        renderHomework();
        if (nu) {
          const nb = [...main.querySelectorAll('.check')].find(x => x.dataset.id === id);
          if (nb) { nb.classList.add('pop'); nb.closest('.card-box').classList.add('justdone'); }
        }
      };
    });
    main.querySelectorAll('[data-bell]').forEach(b => {
      b.onclick = () => ruleSheet('Herinnering voor dit huiswerk', (hwRules.item || {})[b.dataset.bell], true, r => {
        hwRules.item = hwRules.item || {};
        if (r) hwRules.item[b.dataset.bell] = r; else delete hwRules.item[b.dataset.bell];
        saveRules();
        renderHomework();
      });
    });
  }

  /* ---------- jaaragenda: waarom ben je vrij? (Dankdag, Biddag, vakanties…) ---------- */
  /* vakanties en lesvrije dagen 2026-2027, overgenomen van ichthuscollege.nl → Lestijden en vakanties.
     Staan altijd in de app, ook als de online schoolagenda iets mist (4 januari en 13-15 juli stonden daar niet in) */
  const SCHOOL_VRIJ = [
    ['2026-08-31', '2026-08-31', 'Lesvrije dag'],
    ['2026-10-19', '2026-10-23', 'Herfstvakantie'],
    ['2026-11-04', '2026-11-04', 'Dankdag'],
    ['2026-12-21', '2027-01-01', 'Kerstvakantie'],
    ['2027-01-04', '2027-01-04', 'Lesvrij (inhalen toetsen en opdrachten)'],
    ['2027-02-19', '2027-02-26', 'Voorjaarsvakantie'],
    ['2027-03-10', '2027-03-10', 'Biddag'],
    ['2027-03-26', '2027-03-29', 'Goede Vrijdag en Tweede Paasdag'],
    ['2027-04-26', '2027-05-07', 'Meivakantie'],
    ['2027-05-17', '2027-05-17', 'Tweede Pinksterdag'],
    ['2027-07-13', '2027-07-15', 'Lesvrij (inhalen toetsen en opdrachten)'],
    ['2027-07-19', '2027-08-28', 'Zomervakantie']
  ].map(([a, b, t]) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return { s: new Date(y1, m1 - 1, d1).getTime(), e: new Date(y2, m2 - 1, d2 + 1).getTime() - 60000, t, school: true }; });
  function agenda() {
    if (S.agenda) return S.agenda;
    let online = [];
    try { online = DEMO ? (DEMO.agenda || []) : Native && Native.getAgenda ? JSON.parse(Native.getAgenda()) : []; } catch (e) { online = []; }
    /* de vaste schoollijst heeft voorrang; dezelfde vakantie uit de online agenda niet dubbel tonen */
    /* (vrije dagen die binnen een vrije periode van school vallen, zoals Koningsdag in de meivakantie, ook niet) */
    const dup = a => !NOT_FREE.test(a.t) && SCHOOL_VRIJ.some(v => a.s >= v.s - 864e5 && a.e <= v.e + 864e5);
    S.agenda = SCHOOL_VRIJ.concat(online.filter(a => !dup(a)));
    return S.agenda;
  }
  window.__cpAgenda = () => { S.agenda = null; if (S.tab === 'rooster' && !sh.querySelector('.modal, .ov, .panel')) renderRooster(); };
  /* activiteiten die geen reden zijn om vrij te zijn */
  const NOT_FREE = /^periode\s*\d|avond|open dag|uitslag|centraal examen|stille week|activiteitendag|activiteitenweek|prinsjesdag|concert/i;
  function dayReason(ms) {
    const s = ms, e = ms + 86400000;
    return agenda().filter(a => a.s < e && a.e > s && !NOT_FREE.test(a.t))
      .map(a => a.t.replace(/\s*\((leerlingen\s*)?(les)?vrij\)\s*$/i, '').trim())
      .filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
  }

  /* aftellen naar de eerstvolgende vakantie (uit de jaaragenda), in schooldagen */
  function countdownHtml() {
    const t = dayStart(now()).getTime();
    const vac = agenda().filter(a => /vakantie/i.test(a.t) && a.s > t).sort((a, b) => a.s - b.s)[0];
    if (!vac) return '';
    let start = dayStart(new Date(vac.s + 3600000)); /* +1 uur: start ligt soms om 23:00 de avond ervoor (UTC) */
    /* de school zet alleen schooldagen in de agenda (maandag); het weekend ervoor is ook al vakantie */
    while ([0, 6].includes(addDays(start, -1).getDay())) start = addDays(start, -1);
    /* gewone dagen (kalenderdagen) tot de eerste vrije dag */
    const n = Math.round((start.getTime() - t) / 864e5);
    if (n < 0) return '';
    const name = vac.t.replace(/\s*\(.*\)\s*$/, '');
    if (n === 0) return `<div class="count"><b>${esc(name)}</b> begint vandaag!</div>`;
    if (n === 1) return `<div class="count"><b>Morgen</b> begint de ${esc(name.toLowerCase())}</div>`;
    return `<div class="count">Nog <b>${n} dagen</b> tot de ${esc(name.toLowerCase())}</div>`;
  }
  /* "Nu en straks": de les van nu met de minuten die nog over zijn, en de volgende les (alleen vandaag) */
  function nowCardHtml() {
    const n = now(), t0 = dayStart(n).getTime();
    /* vandaag en de komende dagen uit alle geladen weken (ook als je naar een andere week kijkt) */
    const allDays = Object.values(S.rooster).flat().filter(Boolean);
    const today = allDays.find(d => sameDay(new Date(d.date), n));
    const mins = n.getHours() * 60 + n.getMinutes();
    const hm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    const timed = d => d.lessons.filter(l => !l.uitval).map(l => { const [a, b] = (l.tijd || '').split('-').map(toMin); return Object.assign({ a, b }, l); }).filter(l => l.a != null && l.b != null);
    const ls2 = today ? timed(today) : [];
    const cur = ls2.find(l => mins >= l.a && mins < l.b), next = ls2.find(l => l.a > mins);
    if (!cur && !next) {
      /* niks aan de gang: klein kaartje met waarom (weekend, vrij, klaar) en de eerstvolgende les als die bekend is */
      const wd = n.getDay();
      const why = dayReason(t0);
      const head = why ? 'Vrij · ' + why : wd === 0 || wd === 6 ? 'Weekend' : ls2.length ? 'Klaar voor vandaag' : today ? 'Vrij vandaag' : 'Niks aan de gang';
      const nd = allDays.filter(d => d.date > t0).sort((a, b) => a.date - b.date).find(d => timed(d).length);
      const first = nd && timed(nd)[0];
      const when = nd && (sameDay(new Date(nd.date), new Date(t0 + 864e5)) ? 'morgen' : DAYS_SHORT[new Date(nd.date).getDay()]);
      return `<div class="nowcard mini"><span class="nc-dot"></span><div class="nc-mini"><b>${esc(head)}</b>${first ? `<span>Volgende les: ${first.lokaal ? esc(first.lokaal) + ' · ' : ''}${esc(String(first.vak).toUpperCase())} · ${esc(when)} ${hm(first.a)}</span>` : '<span>Geen les op dit moment</span>'}</div></div>`;
    }
    const left = cur ? cur.b - mins : 0;
    const part = (label, l, sub) => `<div class="nc-part"><small>${label}</small><b>${emoji(l.vak)} ${esc(vakName(l.vak))}</b><span>${esc(l.lokaal || '–')} · ${sub}</span></div>`;
    return `<div class="nowcard">
      ${cur ? part(`Nu · nog ${left} min`, cur, 'tot ' + hm(cur.b)) + `<div class="nc-bar"><i style="width:${Math.round((mins - cur.a) / (cur.b - cur.a) * 100)}%"></i></div>`
        : part(`${ls2.some(l => l.b <= mins) ? 'Volgende les' : 'Eerste les'} over ${next.a - mins >= 60 ? Math.floor((next.a - mins) / 60) + ' u ' : ''}${(next.a - mins) % 60} min`, next, 'om ' + hm(next.a))}
      ${cur && next ? part('Straks · ' + hm(next.a), next, (next.a - cur.b > 5 ? 'na een pauze' : 'direct erna')) : ''}
    </div>`;
  }

  /* komende lessen uit alle geladen weken naar de widget op het startscherm */
  function pushWidget() {
    setHeader(title.innerHTML); /* rooster geladen: nu is ook je klas bekend (bovenin naast je naam) */
    if (!Native || !Native.setRoosterCache) return;
    const n = now().getTime(), out = [];
    Object.values(S.rooster).forEach(days => (days || []).forEach(d => (d.lessons || []).forEach(l => {
      const [a, b] = (l.tijd || '').split('-').map(toMin);
      if (a == null || b == null) return;
      const s = d.date + a * 60000, e = d.date + b * 60000;
      if (e > n) out.push({ s, e, vak: l.vak || '', lok: l.lokaal || '', uit: !!l.uitval, uur: l.uur || '' });
    })));
    if (out.length) try { Native.setRoosterCache(JSON.stringify(out), accent); } catch (e) {}
  }

  /* streepje op de hoogte van "nu" (zoals in een agenda), en in de weekweergave een lichte achtergrond achter vandaag.
     Rijen met data-a/data-b (begin- en eindminuut) bepalen waar het streepje komt: in een les naar rato, in een pauze ertussen */
  /* tijd → hoogte in het weekrooster, volgens de tijdas links (lesuren en de pauzes ertussen) */
  function weekY(wk, t) {
    const rows = [...wk.querySelectorAll('.wku[data-a]')];
    if (!rows.length) return null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], a = +r.dataset.a, b = +r.dataset.b, nx = rows[i + 1];
      if (t <= a && i === 0) return r.offsetTop;
      if (t >= a && t <= b) return r.offsetTop + (t - a) / (b - a) * r.offsetHeight;
      if (nx && t > b && t < +nx.dataset.a) { const end = r.offsetTop + r.offsetHeight; return end + (t - b) / (+nx.dataset.a - b) * (nx.offsetTop - end); }
    }
    const last = rows[rows.length - 1];
    return last.offsetTop + last.offsetHeight;
  }
  /* verkorte lessen: vakje verschuiven en inkorten tot het klopt met de tijden links */
  function placeShort() {
    const wk = main.querySelector('.wk');
    if (!wk) return;
    wk.querySelectorAll('.wkc[data-kort]').forEach(cell => {
      const top = weekY(wk, +cell.dataset.ka), bottom = weekY(wk, +cell.dataset.kb);
      if (top == null || bottom == null) return;
      const h = Math.max(26, Math.round(bottom - top - 2));
      cell.style.minHeight = cell.style.height = h + 'px';
      cell.style.transform = `translateY(${Math.round(top - cell.offsetTop + 1)}px)`;
    });
  }
  function placeNowLine() {
    const n = now(), mins = n.getHours() * 60 + n.getMinutes();
    const wk = main.querySelector('.wk');
    const box = wk || main.querySelector('.swipe-area');
    if (!box) return;
    box.querySelectorAll('.nowline, .todaycol').forEach(el => el.remove());
    box.style.position = 'relative';
    const th = wk && wk.querySelector('.wkh.today');
    if (wk && !th) return; /* vandaag staat niet in deze week */
    /* week: de tijdas links (verkorte vakjes staan daar ook op hun echte tijd); dag: de lessen zelf */
    const rows = [...box.querySelectorAll(wk ? '.wku[data-a]' : '.les[data-a]')];
    if (wk) {
      const last = [...wk.children].pop();
      const col = document.createElement('div');
      col.className = 'todaycol';
      col.style.cssText = `left:${th.offsetLeft - 2}px;width:${th.offsetWidth + 4}px;top:${th.offsetTop - 4}px;height:${last.offsetTop + last.offsetHeight - th.offsetTop + 8}px`;
      wk.prepend(col);
    }
    if (!rows.length) return;
    let y = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], a = +r.dataset.a, b = +r.dataset.b;
      if (mins >= a && mins < b) { y = r.offsetTop + (mins - a) / (b - a) * r.offsetHeight; break; }
      const nx = rows[i + 1];
      if (nx && mins >= b && mins < +nx.dataset.a) { y = (r.offsetTop + r.offsetHeight + nx.offsetTop) / 2; break; }
    }
    if (y == null) return;
    const line = document.createElement('div');
    line.className = 'nowline';
    line.style.top = Math.round(y) + 'px';
    const axis = wk && wk.querySelector('.wku');
    if (wk) { line.style.left = (axis.offsetLeft + axis.offsetWidth) + 'px'; line.style.setProperty('--dot', (th.offsetLeft + 3 - axis.offsetLeft - axis.offsetWidth) + 'px'); } /* bolletje links in de kolom van vandaag, zodat vak en lokaal vrij blijven */
    box.appendChild(line);
  }

  /* lestijden van school (ichthuscollege.nl → Lestijden en vakanties); verkort o.a. tijdens rapportvergaderingen */
  const LESTIJDEN = {
    gewoon: ['08:00-08:50', '08:50-09:35', '09:35-10:20', '10:40-11:25', '11:25-12:20', '12:20-13:05', '13:25-14:10', '14:10-14:55', '14:55-15:40', '15:40-16:25'],
    verkort: ['08:00-08:35', '08:35-09:10', '09:10-09:45', '09:45-10:20', '10:35-11:10', '11:10-11:45', '11:45-12:20', '12:20-12:55', '12:55-13:30', '13:30-14:05']
  };
  function lestijdenSheet() {
    const m = document.createElement('div');
    m.className = 'modal';
    const row = (i) => `<tr><td>${i + 1}e uur</td><td>${LESTIJDEN.verkort[i].replace('-', ' – ')}</td><td class="muted">${LESTIJDEN.gewoon[i].replace('-', ' – ')}</td></tr>`;
    m.innerHTML = `<div class="sheet"><h3>Verkorte lestijden</h3>
      <p class="small muted">Lessen van 35 minuten, bijvoorbeeld tijdens rapportvergaderingen. Pauze van 10.20 tot 10.35.</p>
      <table class="lt"><tr><th></th><th>Verkort</th><th>Gewoon</th></tr>${LESTIJDEN.verkort.map((_, i) => row(i)).join('')}</table>
      <p class="small muted">Bron: de website van school → Lestijden en vakanties. De app volgt de tijden uit je rooster.</p>
      <button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    app.appendChild(m);
  }

  /* ---------- tab: rooster ---------- */
  function toMin(t) { const m = /(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
  async function renderRooster() {
    setHeader('Rooster');
    const mon = S.rMonday, key = mon.getTime();
    const shell = (body, raw) => { main.innerHTML = `<div class="pad">${weekNav(mon, 'r')}${raw ? body : `<div class="swipe-area">${body}</div>`}</div>`; bindWeekNav('rMonday', renderRooster); };
    if (!S.rooster[key] && !S.fresh['r' + key]) { const c = weekCache.get('r', key); if (c) { S.rooster[key] = c; refreshWeek('r', key, mon); } }
    if (!S.rooster[key]) {
      shell(skeleton('rooster'));
      spinning(true);
      try { S.rooster[key] = await loadRooster(mon); S.fresh['r' + key] = 1; weekCache.set('r', key, S.rooster[key]); pushWidget(); }
      catch (e) { spinning(false); if (S.tab !== 'rooster' || S.rMonday.getTime() !== key) return; return e.message === 'login' ? loginScreen() : shell(errBox(e)); }
      spinning(false);
      if (S.tab !== 'rooster' || S.rMonday.getTime() !== key) return;
    }
    const days = S.rooster[key];
    if (!days.length) return shell(emptyHtml('rooster', 'Geen lessen deze week', 'Misschien vakantie, of het rooster staat er nog niet.'));
    const today = dayStart(now());
    if (!S.rDay || !days.some(d => d.date === S.rDay)) {
      const t = days.find(d => sameDay(new Date(d.date), today));
      /* gevraagde dag staat niet in de week (bijv. vrijdag zonder lessen): dichtstbijzijnde dag kiezen */
      S.rDay = t ? t.date : S.rDay && S.rDay > days[days.length - 1].date ? days[days.length - 1].date : days[0].date;
    }
    const nowMin = now().getHours() * 60 + now().getMinutes();
    const lessonsHtml = (d, compact) => {
      const isToday = sameDay(new Date(d.date), today);
      if (!d.lessons.length) {
        const why = dayReason(d.date);
        return `<div class="free">${emptyIcon('vrij')}<b>Vrij</b>${why ? `<span>${esc(why)}</span>` : '<span>Geen lessen deze dag</span>'}</div>`;
      }
      let out = '', prevUur = null;
      d.lessons.forEach(l => {
        const u = parseInt(l.uur, 10);
        if (prevUur != null && u > prevUur + 1) out += `<div class="gap">${u - prevUur - 1 === 1 ? 'tussenuur' : (u - prevUur - 1) + ' tussenuren'}</div>`;
        if (!isNaN(u)) prevUur = u;
        const [a, b] = (l.tijd || '').split('-').map(toMin);
        const now = isToday && a != null && b != null && nowMin >= a && nowMin < b;
        const gone = isToday && b != null && nowMin >= b;
        const uitval = l.uitval || /vervall|cancel|uitval/i.test(l.status || '');
        const note = [l.wijziging, l.opmerking].filter(Boolean).join(' · ');
        out += `<div class="card-box les${compact ? ' compact' : ''}${now && !uitval ? ' now' : ''}${gone ? ' gone' : ''}${uitval ? ' vervallen' : ''}"${isToday && a != null && b != null ? ` data-a="${a}" data-b="${b}"` : ''}>
          <div class="uur"><b>${esc(l.uur || '–')}</b><span>${esc((l.tijd || '').split('-')[0].trim())}</span></div>
          <div class="wat"><b>${emoji(l.vak)} ${esc(vakName(l.vak))} ${uitval ? '<span class="tag red">UITVAL</span>' : l.type === 'exam' ? '<span class="tag">TOETS</span>' : l.tijdAnders || l.nieuw ? '<span class="tag">GEWIJZIGD</span>' : ''}</b><span>${esc(l.tijd)}${l.docent ? ' · ' + docBtn(l.docent) : ''}</span></div>
          <div class="lok${l.lokaalAnders ? ' changed' : ''}">${esc(l.lokaal || '–')}${l.wasLokaal ? `<small>was ${esc(l.wasLokaal)}</small>` : ''}</div>
          ${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
      });
      return out;
    };
    /* eigen reminders van die dag, onderaan het rooster */
    const remHtml = (date, title) => {
      const list = ownRem.on(date);
      if (!list.length) return '';
      const isToday = sameDay(new Date(date), today), nu = now();
      return `<div class="day-h">${title}</div>` + list.map(({ r, t }) => `<button class="card-box remc${t <= nu ? ' gone' : ''}" data-rem="${esc(r.id)}">
        <span class="rt">${pad(t.getHours())}:${pad(t.getMinutes())}</span><span class="rx"><b>${esc(r.text)}</b>${r.rep !== 'none' ? `<small>${esc(ownRemLabel(r).split(' · ')[0])}</small>` : ''}</span></button>`).join('');
    };
    /* reminders in het weekend: geen roosterdag, dus een eigen vakje met duidelijk erbij welke dag.
       'na' = het weekend na deze week, 'voor' = het weekend van nu als je al naar volgende week kijkt */
    const weekendHtml = which => {
      const at = n => { const x = new Date(mon); x.setDate(x.getDate() + n); return x; };
      const wdays = [];
      if (which !== 'na' && today < mon) [at(-2), at(-1)].forEach(x => { if (x >= today) wdays.push(x); });
      if (which !== 'voor') wdays.push(at(5), at(6));
      const nu = now();
      return wdays.map(x => {
        const list = ownRem.on(x);
        if (!list.length) return '';
        return `<div class="card-box wkend"><div class="wkend-h"><span class="tag">${x.getDay() === 6 ? 'ZATERDAG' : 'ZONDAG'}</span><span>${x.getDate()} ${MONTH_FULL[x.getMonth()]}${sameDay(x, today) ? ' · vandaag' : ''}</span></div>
          ${list.map(({ r, t }) => `<button class="wkend-r${t <= nu ? ' gone' : ''}" data-rem="${esc(r.id)}"><b>${pad(t.getHours())}:${pad(t.getMinutes())}</b><span>${esc(r.text)}</span></button>`).join('')}</div>`;
      }).join('');
    };
    let html = countdownHtml() + nowCardHtml(days) + `<div class="seg">${[['dag', 'Dag'], ['week', 'Week']].map(([k, l]) => `<button class="${S.rView === k ? 'on' : ''}" data-rv="${k}">${l}</button>`).join('')}</div>`;
    /* tijden per lesuur, links naast de tabel (de tijd die het vaakst bij dat uur hoort) */
    const uurTijd = {};
    days.forEach(d => d.lessons.forEach(l => {
      const u = parseInt(l.uur, 10), [a, b] = (l.tijd || '').split('-').map(toMin);
      if (isNaN(u) || a == null || b == null) return;
      const k = a + '-' + b;
      (uurTijd[u] = uurTijd[u] || {})[k] = ((uurTijd[u] || {})[k] || 0) + 1;
    }));
    const hm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    const uurAB = u => { const t = uurTijd[u]; return t ? Object.keys(t).sort((x, y) => t[y] - t[x])[0].split('-').map(Number) : null; };
    /* verkorte lessen: een dag waarop de meeste lessen minstens 5 minuten korter zijn dan normaal voor dat uur */
    const shortDay = d => {
      let n = 0, kort = 0;
      d.lessons.forEach(l => {
        const u = parseInt(l.uur, 10), [a, b] = (l.tijd || '').split('-').map(toMin), ab = uurAB(u);
        if (isNaN(u) || a == null || b == null || !ab) return;
        n++;
        if (b - a <= ab[1] - ab[0] - 5) kort++;
      });
      return n > 0 && kort * 2 > n;
    };
    if (S.rView === 'week') {
      /* roostertabel: dagen naast elkaar, lesuren als rijen */
      const uren = [...new Set(days.flatMap(d => d.lessons.map(l => parseInt(l.uur, 10)).filter(u => !isNaN(u))))].sort((a, b) => a - b);
      const rows = uren.length ? Array.from({ length: uren[uren.length - 1] - uren[0] + 1 }, (_, i) => uren[0] + i) : [];
      const tijdVan = u => { const ab = uurAB(u); return ab ? `<small>${hm(ab[0])}</small><small class="end">${hm(ab[1])}</small>` : ''; };
      /* het weekend van nu (je kijkt al naar volgende week) bovenaan, want dat is vandaag of morgen */
      html += `<div class="swipe-area">${weekendHtml('voor')}<div class="wk" style="grid-template-columns: 38px repeat(${days.length}, 1fr)"><div></div>`;
      days.forEach(d => { const x = new Date(d.date); html += `<div class="wkh${sameDay(x, today) ? ' today' : ''}">${DAYS_SHORT[x.getDay()]}<b>${x.getDate()}</b>${d.lessons.length ? (shortDay(d) ? '<i class="wfree vk" data-lestijden>verkort ⓘ</i>' : '') : '<i class="wfree">vrij</i>'}</div>`; });
      rows.forEach(u => {
        const ab = uurAB(u);
        html += `<div class="wku"${ab ? ` data-a="${ab[0]}" data-b="${ab[1]}"` : ''}><b>${u}</b>${tijdVan(u)}</div>`;
        days.forEach((d, di) => {
          const ls2 = d.lessons.filter(l => parseInt(l.uur, 10) === u);
          if (!ls2.length) { html += '<div class="wkc empty"></div>'; return; }
          const l = ls2[0], uit = l.uitval || /vervall|cancel|uitval/i.test(l.status || '');
          const isToday = sameDay(new Date(d.date), today);
          const [a, b] = (l.tijd || '').split('-').map(toMin);
          const now = isToday && a != null && b != null && nowMin >= a && nowMin < b;
          /* verkorte les: het vakje is naar verhouding lager (bijv. 35 van de 50 minuten), en de begintijd staat erbij */
          const abN = uurAB(u), kort = a != null && b != null && abN && shortDay(d) && b - a < abN[1] - abN[0];
          const kortH = kort ? Math.max(30, Math.round(48 * (b - a) / (abN[1] - abN[0]))) : 0;
          html += `<button class="wkc${uit ? ' uit' : ''}${l.type === 'exam' ? ' exam' : ''}${now && !uit ? ' now' : ''}${l.lokaalAnders || l.tijdAnders || l.wijziging ? ' chg' : ''}" data-les="${di}:${d.lessons.indexOf(l)}"${kort ? ` style="min-height:${kortH}px;height:${kortH}px;align-self:start" data-kort data-ka="${a}" data-kb="${b}"` : ''}${isToday && a != null && b != null ? ` data-today data-a="${a}" data-b="${b}"` : ''}>
            <b>${esc(l.vak.toUpperCase().slice(0, 5))}</b><span>${esc((l.lokaal || '').split(',')[0])}</span>${kort ? `<em class="wkt">${hm(a)}–${hm(b)}</em>` : ''}${ls2.length > 1 ? '<i>+' + (ls2.length - 1) + '</i>' : ''}</button>`;
        });
      });
      /* reminders: onder elke dag een eigen vakje, met wat ruimte tussen de lessen en de reminders */
      const remDays = days.map(d => ownRem.on(d.date));
      if (remDays.some(l => l.length)) {
        const nu = now();
        html += `<div class="wkr-l" aria-label="Reminders">${ICONS.bell}</div>`;
        remDays.forEach((l, di) => {
          const isToday = sameDay(new Date(days[di].date), today);
          html += `<div class="wkr${l.length ? '' : ' none'}">${l.map(({ r, t }) => `<button class="wkri${t <= nu ? ' gone' : ''}" data-rem="${esc(r.id)}"><b>${pad(t.getHours())}:${pad(t.getMinutes())}</b><span>${esc(r.text)}</span></button>`).join('')}</div>`;
        });
      }
      html += '</div>';
      const frees = days.filter(d => !d.lessons.length);
      if (frees.length) html += frees.map(d => { const why = dayReason(d.date); return `<div class="free small-free"><b>Vrij · ${esc(niceDay(new Date(d.date)))}</b>${why ? `<span>${esc(why)}</span>` : ''}</div>`; }).join('');
      const other = days.flatMap(d => d.lessons.filter(l => isNaN(parseInt(l.uur, 10))).map(l => [d, l]));
      if (other.length) html += `<div class="day-h">Overig</div>` + other.map(([d, l]) => `<div class="card-box small">${esc(niceDay(new Date(d.date)))} · ${esc(l.tijd)} · ${esc(l.vak)}${l.lokaal ? ' · ' + esc(l.lokaal) : ''}${l.uitval ? ' · <b style="color:var(--red)">uitval</b>' : ''}</div>`).join('');
      if (!rows.length && !other.length) html += emptyHtml('rooster', 'Geen lessen deze week', '');
      html += weekendHtml('na');
      html += '<p class="small muted" style="text-align:center;margin-top:4px">Tik op een les voor details</p></div>';
    } else {
      const day = days.find(d => d.date === S.rDay);
      const dd = new Date(day.date);
      html += `<div class="seg">${days.map(d => { const x = new Date(d.date); return `<button class="${d.date === S.rDay ? 'on' : ''}" data-day="${d.date}">${DAYS_SHORT[x.getDay()]} ${x.getDate()}${d.lessons.some(l => l.uitval) ? ' •' : ''}</button>`; }).join('')}</div>
        <div class="swipe-area">${day.date === days[0].date ? weekendHtml('voor') : ''}<div class="day-h${sameDay(dd, today) ? ' today' : ''}">${esc(niceDay(dd))} · ${day.lessons.length ? day.lessons.length + ' ' + (day.lessons.length === 1 ? 'les' : 'lessen') + (shortDay(day) ? ' · <button class="vkbtn" data-lestijden>verkort ⓘ</button>' : '') : 'vrij'}</div>${lessonsHtml(day, false)}${remHtml(day.date, 'Reminders')}${day.date === days[days.length - 1].date ? weekendHtml('na') : ''}</div>`;
    }
    if (!zm && !DEMO) html += `<div class="card-box"><div class="setting-h">Koppel Zermelo voor uitval</div>
      <p class="small muted">Dit rooster komt nu van het portaal en laat geen uitval zien. Koppel Zermelo om uitval, lokaalwijzigingen en meldingen te krijgen.</p>
      <div class="row" style="margin-top:10px;justify-content:flex-start"><button class="btn" data-a="zm">Zermelo koppelen</button></div></div>`;
    else html += `<p class="small muted" style="text-align:center;margin-top:6px"><span class="zm-mark">Rooster uit <img src="${ASSET('zermelo.svg')}" alt="Zermelo"></span></p>`;
    shell(html, true);
    placeShort();
    placeNowLine();
    main.querySelectorAll('[data-lestijden]').forEach(b => { b.onclick = e => { e.stopPropagation(); lestijdenSheet(); }; });
    main.querySelectorAll('[data-day]').forEach(b => { b.onclick = () => { S.rDay = +b.dataset.day; renderRooster(); }; });
    main.querySelectorAll('[data-les]').forEach(b => {
      b.onclick = () => {
        const [di, li] = b.dataset.les.split(':').map(Number);
        const d = days[di], l = d.lessons[li];
        const m = document.createElement('div');
        m.className = 'modal';
        m.innerHTML = `<div class="sheet"><h3>${emoji(l.vak)} ${esc(vakName(l.vak))} ${l.uitval ? '<span class="tag red">UITVAL</span>' : ''}</h3>
          <div class="listrow"><span class="muted">Wanneer</span><b>${esc(niceDay(new Date(d.date)))} · ${esc(l.uur ? l.uur + 'e uur' : '')}</b></div>
          <div class="listrow"><span class="muted">Tijd</span><b>${esc(l.tijd)}</b></div>
          <div class="listrow"><span class="muted">Lokaal</span><b>${esc(l.lokaal || '–')}${l.wasLokaal ? ` <span class="muted" style="font-weight:500">(was ${esc(l.wasLokaal)})</span>` : ''}</b></div>
          ${l.docent ? `<div class="listrow"><span class="muted">Docent</span><b>${docBtn(l.docent, true)}</b></div>` : ''}
          ${l.wijziging || l.opmerking ? `<div class="listrow"><span class="muted">Wijziging</span><b>${esc([l.wijziging, l.opmerking].filter(Boolean).join(' · '))}</b></div>` : ''}
          <button class="btn ghost" data-a="close">Sluiten</button></div>`;
        m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
        app.appendChild(m);
      };
    });
    /* reminder aantikken: aanpassen of verwijderen (een eenmalige die al geweest is niet meer) */
    main.querySelectorAll('[data-rem]').forEach(b => {
      b.onclick = () => {
        const cur = ownRem.get().find(r => r.id === b.dataset.rem);
        if (!cur || cur.fired || (cur.rep === 'none' && cur.at <= Date.now())) return toast('Deze reminder is al geweest');
        /* de lijst pas bij opslaan opnieuw lezen: ging er net een reminder af, dan blijft dat bewaard */
        ownRemSheet(cur, r => { const all = ownRem.get(); ownRem.set(r ? all.map(x => x.id === r.id ? r : x) : all.filter(x => x.id !== cur.id)); renderRooster(); });
      };
    });
    main.querySelectorAll('[data-rv]').forEach(b => { b.onclick = () => { S.rView = b.dataset.rv; ls.set('cp:rview', S.rView); renderRooster(); }; });
    const zb = main.querySelector('[data-a=zm]');
    if (zb) zb.onclick = zermeloSheet;
  }

  function zermeloSheet(first) {
    const m = document.createElement('div');
    m.className = 'modal zm';
    const sso = !!(Native && Native.zermeloSso);
    m.innerHTML = `<div class="sheet"><h3>Zermelo koppelen</h3>${first ? '<p class="small" style="color:var(--fg2)">Je rooster komt uit Zermelo. Koppel het nu, dan zie je meteen je echte rooster met uitval en lokaalwijzigingen.</p>' : ''}
      ${sso ? `<p class="small muted">Log in met je schoolaccount, net als via de Zermelo-link op het portaal.</p>
      <button class="btn" data-a="sso">Inloggen met schoolaccount</button>
      <div class="zerr"></div>
      <details class="small" style="color:var(--fg2)"><summary style="cursor:pointer">Of koppel met een koppelcode</summary>` : '<div class="zerr"></div>'}
      <ol class="small" style="margin:10px 0 0;padding-left:18px;color:var(--fg2);display:grid;gap:6px">
        <li>Open Zermelo (<b>ichthus.zportal.nl</b>) en log in.</li>
        <li>Ga in het menu naar <b>Koppelingen</b> en kies <b>Koppel App</b>.</li>
        <li>Vul de <b>schoolnaam</b> en <b>koppelcode</b> hieronder in.</li></ol>
      <label class="lbl" style="display:block;margin-top:10px">Schoolnaam</label><input type="text" data-f="school" value="${esc(zm ? zm.school : 'ichthus')}" autocapitalize="off" autocomplete="off">
      <label class="lbl" style="display:block;margin-top:10px">Koppelcode</label><input type="text" inputmode="numeric" data-f="code" placeholder="123 456 789 012">
      <div class="row" style="margin-top:12px"><button class="btn ${sso ? 'ghost' : ''}" data-a="go">Koppelen met code</button></div>
      ${sso ? '</details>' : ''}
      <button class="btn ghost" data-a="close">${first ? 'Later' : 'Annuleren'}</button></div>`;
    const err = m.querySelector('.zerr');
    m.querySelector('[data-a=close]').onclick = () => m.remove();
    const sb = m.querySelector('[data-a=sso]');
    if (sb) sb.onclick = async () => {
      sb.textContent = 'Zermelo openen…';
      err.innerHTML = '';
      try { await zermeloSso(false); } catch (e) { err.innerHTML = errBox(e); }
      setTimeout(() => { sb.textContent = 'Inloggen met schoolaccount'; }, 1500);
    };
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    m.querySelector('[data-a=go]').onclick = async () => {
      const b = m.querySelector('[data-a=go]');
      b.textContent = 'Bezig…';
      err.innerHTML = '';
      try {
        await zermeloLink(m.querySelector('[data-f=school]').value, String(m.querySelector('[data-f=code]').value));
        m.remove();
        S.rooster = {}; S.fresh = {}; try { localStorage.removeItem('cp:wk:r'); } catch (e) {}
        S.rDay = null;
        if (S.tab === 'rooster') renderRooster(); else if (S.tab === 'meer') renderMore();
      } catch (e) {
        err.innerHTML = errBox(e);
        b.textContent = 'Koppelen met code';
      }
    };
    app.appendChild(m);
  }

  /* ---------- tab: meer ---------- */
  /* ---------- thema's kiezen (eigen scherm, zodat Meer niet vol foto's staat) ---------- */
  /* app-icoon op je startscherm */
  /* W.S.P in ronde letters: wit op zwart (standaard), zwart op wit, goud op zwart en goud op wit */
  const ICONS_APP = [['zwartkaal', 'Zwart'], ['kaal', 'Wit'], ['zwart', 'Goud op zwart'], ['default', 'Goud op wit']];
  const curIcon = () => { try { return Native && Native.getIcon ? Native.getIcon() : ls.get('cp:icon', 'zwartkaal'); } catch (e) { return 'zwartkaal'; } };
  const shownIcon = curIcon;
  const iconGrid = cur => `<div class="icgrid">${ICONS_APP.map(([k, l]) => `<button class="icpick${cur === k ? ' on' : ''}" data-icon="${k}"><img src="${ASSET('icon-' + (k === 'default' ? 'wit' : k) + '.png')}" alt=""><span>${l}</span></button>`).join('')}</div>`;
  function setIcon(k) {
    ls.set('cp:icon', k);
    try { if (Native && Native.setIcon) Native.setIcon(k === 'default' ? 'Default' : k.charAt(0).toUpperCase() + k.slice(1)); } catch (e) {}
    buzz(12);
  }
  /* iPhone met een gratis Apple ID: de app werkt 7 dagen, dan moet SideStore hem vernieuwen. Uitleg om dat 's nachts vanzelf te laten doen */
  const expiryMs = () => { try { return Native && Native.signExpiry ? +Native.signExpiry() || 0 : 0; } catch (e) { return 0; } };
  const expiryText = () => {
    const ms = expiryMs();
    if (!ms) return 'Elke paar nachten vanzelf via SideStore';
    const days = Math.floor((ms - Date.now()) / 864e5), d = new Date(ms);
    return (days < 1 ? 'Verloopt vandaag' : days === 1 ? 'Nog 1 dag' : 'Nog ' + days + ' dagen') + ' geldig (tot ' + d.getDate() + ' ' + MONTH_FULL[d.getMonth()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ')';
  };
  const refreshSteps = () => `<p class="small" style="color:var(--fg2)"><span class="tag">VERPLICHT</span> Met een gratis Apple ID werkt W.S.P 7 dagen. Daarna moet SideStore hem vernieuwen, anders opent hij niet meer. ${esc(expiryText())}.</p>
      <p class="small" style="color:var(--fg2)">Laat <b>LocalDevVPN</b> gewoon aan staan (hij werkt alleen binnen je telefoon en kost bijna geen batterij). Laat het vernieuwen dan 's nachts vanzelf gebeuren met de app <b>Opdrachten</b>, in 3 stappen:</p>
      <ol class="small" style="margin:0;padding-left:18px;color:var(--fg2);display:grid;gap:6px">
        <li>Open <b>Opdrachten</b> → <b>Automatisering</b> → <b>+</b> → <b>Tijdstip</b>.</li>
        <li>Kies <b>02:00</b>, herhaal <b>Wekelijks</b> en vink twee dagen aan (bijv. <b>maandag</b> en <b>donderdag</b>). Kies <b>Voer direct uit</b> → <b>Volgende</b>.</li>
        <li>Zoek <b>SideStore</b>, kies <b>Refresh All Apps</b> en tik op <b>Gereed</b>.</li></ol>
      <p class="small muted">SideStore doet het op de achtergrond; iOS legt hem daarna vanzelf weer stil, je hoeft niks af te sluiten. Je telefoon moet om 02:00 wel aan staan en internet hebben.</p>`;
  const openShortcuts = () => { try { Native.open('shortcuts://'); } catch (e) {} };
  function sideStoreSheet() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Automatisch vernieuwen</h3>${refreshSteps()}
      <button class="btn" data-a="sc">Opdrachten openen</button><button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    m.querySelector('[data-a=sc]').onclick = openShortcuts;
    app.appendChild(m);
  }
  /* eerste keer op iPhone (in plaats van de batterij-stap van Android): verplicht, eerst lezen en instellen */
  function askRefreshStep() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Automatisch vernieuwen</h3>${refreshSteps()}
      <p class="small muted">Je kunt dit later teruglezen bij Meer → Automatisch vernieuwen.</p>
      <div class="row"><button class="btn ghost" data-a="sc">Opdrachten openen</button><button class="btn" data-a="done" style="flex:1">Ik heb het ingesteld</button></div></div>`;
    m.querySelector('[data-a=sc]').onclick = openShortcuts;
    readFirst(m.querySelector('[data-a=done]'), () => { ls.set('cp:refreshAsked', 1); m.remove(); askWidgetStep(); }, 8);
    app.appendChild(m);
  }
  /* widget "volgende les": de app vraagt Android hem neer te zetten, anders uitleg hoe je hem zelf toevoegt */
  function widgetSheet() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Zien wat je hierna hebt</h3>
      <div data-wsize></div>
      <p class="small muted">Een widget op je ${IOS ? 'beginscherm of toegangsscherm' : 'startscherm'} met je les van nu of je volgende les, het lokaal en of er uitval is, ${IOS ? 'klein, middel of op je toegangsscherm' : 'in drie maten'}. Tik erop en je ziet je rooster.</p>
      <div class="ws-help" hidden><p class="small"><b>Zelf toevoegen:</b> houd een leeg plekje op je startscherm ingedrukt → <b>Widgets</b> → zoek <b>W.S.P</b> → sleep <b>Volgende les</b> naar je scherm.</p></div>
      <button class="btn" data-a="pin">Op startscherm zetten</button><button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    if (IOS) {
      /* iPhone: een app kan zelf geen widget neerzetten, dus alleen de uitleg */
      m.querySelector('[data-wsize]').innerHTML = widgetPreview('');
      m.querySelector('.ws-help').outerHTML = IOS_WIDGET;
      m.querySelector('[data-a=pin]').remove();
      app.appendChild(m);
      return;
    }
    const kind = widgetSizePicker(m.querySelector('[data-wsize]'));
    m.querySelector('[data-a=pin]').onclick = () => {
      if (pinWidget(kind())) m.remove();
      else { m.querySelector('.ws-help').hidden = false; m.querySelector('[data-a=pin]').hidden = true; }
    };
    app.appendChild(m);
  }
  /* de widget in drie maten: keuze + voorbeeld; pinWidget(kind) zet hem neer (true = gelukt) */
  const WIDGET_SIZES = [['wide3', '3x1', ''], ['square', '2x2', 'sq'], ['wide4', '4x1', 'wd']];
  const widgetPreview = cls => `<div class="wprev ${cls}"><small>STRAKS · 10:40</small><div><b>EN</b><span>b112</span></div><em>4e uur · 10:40–11:25</em></div>`;
  function widgetSizePicker(box, onKind) {
    let kind = 'wide3';
    const draw = () => {
      box.innerHTML = `<div class="seg" style="justify-content:center">${WIDGET_SIZES.map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-wk="${k}">${l}</button>`).join('')}</div>
        ${widgetPreview(WIDGET_SIZES.find(x => x[0] === kind)[2])}`;
      box.querySelectorAll('[data-wk]').forEach(b => { b.onclick = () => { kind = b.dataset.wk; onKind && onKind(kind); draw(); }; });
    };
    draw();
    return () => kind;
  }
  const pinWidget = kind => {
    try {
      if (Native && Native.pinWidgetKind) return Native.pinWidgetKind(kind) === 'ok';
      if (Native && Native.pinWidget) return Native.pinWidget() === 'ok';
    } catch (e) {}
    return false;
  };
  /* eerste keer, na de batterij-stap: de widget uitleggen met een voorbeeld, en meteen neerzetten of later */
  function askWidgetStep() {
    if (ls.get('cp:widgetAsked', 0)) return askZermelo();
    if (IOS) {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<div class="sheet"><h3>Je volgende les op je beginscherm</h3>
        <p class="small" style="color:var(--fg2)">Met de widget zie je zonder de app te openen welke les je nu of straks hebt, in welk lokaal, en of hij uitvalt.</p>
        ${widgetPreview('')}${IOS_WIDGET}
        <p class="small muted">Je kunt dit later teruglezen bij Meer → Zien wat je hierna hebt.</p>
        <div class="row"><button class="btn" data-a="ok" style="flex:1">Begrepen</button></div></div>`;
      m.querySelector('[data-a=ok]').onclick = () => { ls.set('cp:widgetAsked', 1); m.remove(); askZermelo(); };
      app.appendChild(m);
      return;
    }
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Je volgende les op je startscherm</h3>
      <p class="small" style="color:var(--fg2)">Met de widget zie je zonder de app te openen welke les je nu of straks hebt, in welk lokaal, en of hij uitvalt. Kies een maat:</p>
      <div data-wsize></div>
      <p class="small muted">Tik op de widget en je rooster opent. Je kunt hem later ook neerzetten bij Meer → Zien wat je hierna hebt.</p>
      <div class="ws-help" hidden><p class="small"><b>Zelf neerzetten:</b> houd een leeg plekje op je startscherm ingedrukt → <b>Widgets</b> → zoek <b>W.S.P</b> → sleep <b>Volgende les</b> naar je scherm.</p></div>
      <div class="row"><button class="btn ghost" data-a="later">Later</button><button class="btn" data-a="pin">Op startscherm zetten</button></div></div>`;
    const done = () => { ls.set('cp:widgetAsked', 1); m.remove(); askZermelo(); };
    const kind = widgetSizePicker(m.querySelector('[data-wsize]'));
    m.querySelector('[data-a=later]').onclick = done;
    m.querySelector('[data-a=pin]').onclick = () => {
      /* Android vraagt zelf waar hij moet komen; kan dat niet op deze telefoon, dan uitleggen hoe het met de hand gaat */
      if (pinWidget(kind())) return done();
      m.querySelector('.ws-help').hidden = false;
      const b = m.querySelector('[data-a=pin]');
      b.textContent = 'Klaar';
      b.onclick = done;
      m.querySelector('[data-a=later]').hidden = true;
    };
    app.appendChild(m);
  }
  /* na het inloggen (en na voorwaarden en icoon): één keer vragen om Zermelo te koppelen */
  /* eerste keer: meteen toestaan dat W.S.P zijn eigen updates mag installeren (daarna één tik per update) */
  function askInstall() {
    const can = () => { try { return Native.canInstall(); } catch (e) { return true; } };
    if (ls.get('cp:installAsked', 0) || !(Native && Native.canInstall && Native.openInstallSettings)) return askBatteryStep();
    /* altijd laten zien bij de eerste keer (ook als het al aan staat), zodat iedereen weet hoe updates werken */
    const already = can();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Updates in de app</h3>
      <p class="small" style="color:var(--fg2)">W.S.P kan zichzelf bijwerken als er een nieuwe versie is. Daarvoor moet je één keer toestaan dat W.S.P <b>apps mag installeren</b>.</p>
      <ol class="small" style="margin:0;padding-left:18px;color:var(--fg2);display:grid;gap:6px${already ? ';opacity:.5;text-decoration:line-through' : ''}">
        <li>Tik op <b>Instellen</b>.</li><li>Zet <b>Toestaan uit deze bron</b> aan.</li><li>Ga terug naar W.S.P.</li></ol>
      <p class="small muted">Dit is alleen voor updates van W.S.P zelf. Je kunt het later altijd weer uitzetten.</p>
      <div class="small" data-inst style="font-weight:700;color:var(--accent-text)">${already ? '✓ Staat bij jou al aan. Updates kunnen met één tik.' : ''}</div>
      <div class="row"><button class="btn" data-a="set" style="flex:1">${already ? 'Verder' : 'Instellen'}</button></div><div data-stuck></div></div>`;
    let tries = 0, back = null, finished = false;
    const done = () => { if (finished) return; finished = true; ls.set('cp:installAsked', 1); if (back) document.removeEventListener('visibilitychange', back); m.remove(); askBatteryStep(); };
    if (already) { readFirst(m.querySelector('[data-a=set]'), done); app.appendChild(m); return; }
    /* terug uit de instellingen: staat het aan, dan door; updates zijn verplicht, alleen als het echt niet lukt (na 2 keer) een uitweg */
    back = () => {
      if (document.hidden) return;
      if (can()) { m.querySelector('[data-inst]').textContent = '✓ Staat aan. Updates kunnen nu met één tik.'; return setTimeout(done, 1200); }
      if (tries) m.querySelector('[data-inst]').textContent = 'Nog niet aangezet. Tik op Instellen en zet "Toestaan uit deze bron" aan.';
      if (tries >= 2) stuckLink(m, done);
    };
    document.addEventListener('visibilitychange', back);
    /* eerst de uitleg lezen (3 seconden), dan instellen */
    readFirst(m.querySelector('[data-a=set]'), () => { tries++; Native.openInstallSettings(); });
    app.appendChild(m);
  }
  /* eerst lezen: de knop werkt pas na een paar seconden (met aftellen erin) */
  function readFirst(btn, onClick, secs = 3) {
    const label = btn.innerHTML; /* innerHTML: een labeltje als "aanbevolen" in de knop blijft staan */
    let left = secs;
    btn.disabled = true;
    btn.innerHTML = label + ' (' + left + ')';
    const t = setInterval(() => {
      if (--left > 0) { btn.innerHTML = label + ' (' + left + ')'; return; }
      clearInterval(t);
      btn.disabled = false;
      btn.innerHTML = label;
    }, 1000);
    btn.onclick = onClick;
  }
  /* lukt een instelling echt niet (sommige telefoons hebben dat scherm niet), dan toch verder kunnen */
  function stuckLink(m, onContinue) {
    const box = m.querySelector('[data-stuck]');
    if (!box || box.firstChild) return;
    box.innerHTML = '<button class="linkbtn" style="text-align:center;font-size:13px;color:var(--muted);border-bottom:0">Lukt het echt niet? Ga verder</button>';
    box.firstChild.onclick = onContinue;
  }
  /* eerste keer, na de update-instelling: batterijbesparing uit voor W.S.P, eerst uitleggen wat je moet doen */
  function askBatteryStep() {
    if (IOS) return ls.get('cp:refreshAsked', 0) ? askWidgetStep() : askRefreshStep();
    const ok = () => { try { return Native.batteryOk(); } catch (e) { return true; } };
    const xiaomi = (() => { try { return !!(Native.isXiaomi && Native.isXiaomi()); } catch (e) { return false; } })();
    if (ls.get('cp:batteryAsked', 0) || !(Native && Native.batteryOk && Native.askBattery)) return askWidgetStep();
    const m = document.createElement('div');
    m.className = 'modal';
    let step = ok() ? 2 : 1, poll = 0, tries = 0, opened = false, first = true;
    /* staat al goed (en geen Xiaomi met zijn extra instelling): toch even laten zien, met Verder */
    if (step === 2 && !xiaomi) {
      m.innerHTML = `<div class="sheet"><h3>Meldingen op tijd</h3>
        <p class="small" style="color:var(--fg2)">Om batterij te sparen zet je telefoon apps op de achtergrond soms in slaap. Dan komen meldingen en reminders te laat of niet. Daarom moet de <b>batterijbesparing uit staan voor W.S.P</b>.</p>
        <div class="small" style="font-weight:700;color:var(--accent-text)">✓ Staat bij jou al goed.</div>
        <div class="row"><button class="btn" data-a="set" style="flex:1">Verder</button></div></div>`;
      readFirst(m.querySelector('[data-a=set]'), () => { ls.set('cp:batteryAsked', 1); m.remove(); askWidgetStep(); });
      app.appendChild(m);
      return;
    }
    const draw = () => {
      m.innerHTML = `<div class="sheet"><h3>Meldingen op tijd</h3>
        <p class="small" style="color:var(--fg2)">Om batterij te sparen zet je telefoon apps op de achtergrond soms in slaap. Dan komen meldingen over nieuwe cijfers en uitval, en je reminders, te laat of helemaal niet. Zet daarom de <b>batterijbesparing uit voor W.S.P</b>.</p>
        <ol class="small" style="margin:0;padding-left:18px;color:var(--fg2);display:grid;gap:6px">
          <li${step > 1 ? ' style="opacity:.5;text-decoration:line-through"' : ''}>Tik op <b>Instellen</b>. Er komt een venster van Android met de vraag of W.S.P op de achtergrond mag blijven werken: tik op <b>Toestaan</b> (of <b>OK</b>).</li>
          ${xiaomi ? `<li>Daarna opent de app-info van W.S.P. Tik op <b>Batterijbesparing</b> en kies <b>Geen beperkingen</b>. Ga dan terug naar W.S.P.</li>` : ''}</ol>
        <p class="small muted">W.S.P gebruikt daardoor niet merkbaar meer batterij: hij kijkt alleen af en toe even.</p>
        <div class="small" data-bat style="font-weight:700;color:var(--accent-text)">${step > 1 && !xiaomi ? '✓ Staat goed.' : step > 1 ? '✓ Stap 1 gelukt.' : ''}</div>
        <div class="row"><button class="btn ghost" data-a="klaar">${opened ? 'Klaar' : 'Later'}</button><button class="btn" data-a="set" style="flex:1">${step > 1 && xiaomi ? 'App-info openen' : 'Instellen <span class="aanb">aanbevolen</span>'}</button></div></div>`;
      const k = m.querySelector('[data-a=klaar]');
      const setBtn = m.querySelector('[data-a=set]');
      /* eerst de uitleg lezen (3 seconden), dan zelf kiezen: instellen of later */
      const onSet = () => {
        if (step > 1 && xiaomi) { Native.openAppInfo(); if (!opened) { opened = true; setTimeout(draw, 800); } return; }
        tries++;
        Native.askBattery();
        /* het venster van Android staat over de app heen: even blijven kijken of het al is toegestaan */
        clearInterval(poll);
        let n = 0;
        poll = setInterval(() => {
          if (++n > 90) return clearInterval(poll);
          if (!ok()) return;
          clearInterval(poll);
          step = 2;
          if (xiaomi) { draw(); setTimeout(() => { Native.openAppInfo(); opened = true; setTimeout(draw, 800); }, 700); }
          else { draw(); setTimeout(done, 1200); }
        }, 1000);
      };
      if (first) { first = false; readFirst(setBtn, onSet); readFirst(k, done); } else { setBtn.onclick = onSet; k.onclick = done; }
    };
    let finished = false;
    const done = () => { if (finished) return; finished = true; clearInterval(poll); ls.set('cp:batteryAsked', 1); m.remove(); askWidgetStep(); };
    draw();
    app.appendChild(m);
  }
  function askZermelo() {
    if (ls.get('cp:zmAsked', 0)) return;
    if ((zm || DEMO) && !ls.get('cp:simNew', 0)) return; /* bij een gesimuleerde nieuwe gebruiker toch vragen */
    ls.set('cp:zmAsked', 1);
    zermeloSheet(true);
  }
  /* eerste keer: kies je icoon (na de voorwaarden) */
  /* eerste keer: na de voorwaarden kiezen tussen licht en donker (allebei met geel), daarna het icoon en Zermelo */
  function firstRun() {
    if (!ls.get('cp:themePicked', 0)) themePicker();
    else if (!ls.get('cp:iconPicked', 0)) iconPicker();
    else askInstall();
  }
  function themePicker() {
    const m = document.createElement('div');
    m.className = 'modal';
    const mini = mode => `<span class="tmini ${mode}"><i class="tm-h"></i><i class="tm-c"><b></b><s></s></i><i class="tm-c"><b></b><s></s></i><i class="tm-n"><b></b></i></span>`;
    const draw = () => {
      const cur = theme;
      m.innerHTML = `<div class="sheet"><h3>Kies je thema</h3><p class="small muted">Je kunt dit later altijd aanpassen bij <b>Meer → Thema</b>, ook met een andere accentkleur.</p>
        <div class="tpick">${[['light', 'Wit met geel', true], ['dark', 'Zwart met geel', false]].map(([k, l, rec]) => `<button class="${cur === k ? 'on' : ''}" data-tp="${k}">${mini(k)}<span>${l}</span>${rec ? '<em class="tp-rec">Aanbevolen</em>' : '<em class="tp-rec none"></em>'}</button>`).join('')}</div>
        <button class="btn" data-a="ok">Verder</button></div>`;
      m.querySelectorAll('[data-tp]').forEach(b => {
        b.onclick = () => {
          theme = b.dataset.tp; accent = '#ffd34d';
          ls.set('cp:theme', theme); ls.set('cp:accent', accent);
          applyLook(); buzz(10); draw();
        };
      });
      m.querySelector('[data-a=ok]').onclick = () => {
        ls.set('cp:themePicked', 1); m.remove();
        if (!ls.get('cp:iconPicked', 0)) iconPicker(); else askInstall();
      };
    };
    draw();
    app.appendChild(m);
  }
  function iconPicker() {
    const m = document.createElement('div');
    m.className = 'modal';
    const draw = () => {
      m.innerHTML = `<div class="sheet"><h3>Kies je app-icoon</h3><p class="small muted">Zo staat W.S.P op je ${IOS ? 'beginscherm' : 'startscherm'}. Later aanpassen kan bij Meer → Thema.</p>
        ${iconGrid(ls.get('cp:icon', 'zwartkaal'))}<button class="btn" data-a="ok">Klaar</button></div>`;
      m.querySelectorAll('[data-icon]').forEach(b => { b.onclick = () => { ls.set('cp:icon', b.dataset.icon); draw(); }; });
      m.querySelector('[data-a=ok]').onclick = () => { setIcon(ls.get('cp:icon', 'zwartkaal')); ls.set('cp:iconPicked', 1); m.remove(); askInstall(); };
    };
    draw();
    app.appendChild(m);
  }
  function openThemes(onClose) {
    const p = document.createElement('div');
    p.className = 'panel';
    const draw = () => {
      p.innerHTML = `<div class="panel-h"><h2>Thema</h2><button class="btn" data-a="done">Klaar</button></div>
        <div class="card-box"><div class="setting-h">Weergave</div>
          <div class="seg">${[['light', 'Wit'], ['dark', 'Zwart']].map(([k, l]) => `<button class="${theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div>
          <div class="lbl" style="margin:14px 0 10px">Accentkleur</div>
          <div class="swatches">${SWATCHES.map(c => `<button class="sw${c === accent ? ' on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Kleur ${c}"></button>`).join('')}
            <label class="sw custom${SWATCHES.indexOf(accent) < 0 ? ' on' : ''}" aria-label="Eigen kleur"><input type="color" id="accent-pick" value="${accent}"></label></div></div>
        <div class="card-box"><div class="setting-h">App-icoon</div>${iconGrid(shownIcon())}
          <p class="small muted" style="margin-top:8px">${IOS ? 'Bij het wisselen laat iOS even een melding zien dat het icoon is veranderd.' : 'Na het wisselen kan het icoon op je startscherm even verdwijnen en terugkomen.'}</p></div>`;
      p.querySelector('[data-a=done]').onclick = close;
      p.querySelectorAll('[data-icon]').forEach(b => { b.onclick = () => { setIcon(b.dataset.icon); draw(); }; });
      p.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => { theme = b.dataset.theme; ls.set('cp:theme', theme); applyLook(); draw(); }; });
      const setAccent = c => { accent = applyAccent(c); ls.set('cp:accent', accent); draw(); };
      p.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => setAccent(b.dataset.c); });
      const ci = p.querySelector('#accent-pick');
      if (ci) { ci.oninput = () => { accent = applyAccent(ci.value); }; ci.onchange = () => setAccent(ci.value); }
    };
    function close() { p.remove(); if (onClose) onClose(); }
    p.closePanel = close;
    draw();
    app.appendChild(p);
    tip('themes', () => p.isConnected);
  }
  /* ---------- voorwaarden: bij de eerste start akkoord geven ---------- */
  const TERMS_VERSION = 4; /* 2: foutmeldingen gaan automatisch naar de developer; 3: updates via GitHub, controle op de achtergrond, bewaren per account; 4: nieuwe naam W.S.P, inlogpagina zonder schoollogo, iPhone */
  function showTerms(viewOnly) {
    const el = document.createElement('div');
    el.className = 'terms';
    el.innerHTML = `<div class="logos"><img src="${ASSET('mark.png')}" alt="W.S.P"><img src="${ASSET('zermelo.svg')}" alt="Zermelo"></div>
      <h2>${viewOnly ? 'Voorwaarden en privacy' : 'Voordat je begint'}</h2>
      <ul>
        <li><b>Onofficiële app.</b> W.S.P is een persoonlijke app van een leerling. Hij is niet gemaakt door of namens je school of Zermelo, en zij zijn er niet verantwoordelijk voor.</li>
        <li><b>Namen en logo's.</b> De naam van je school en de naam en het logo van Zermelo zijn van hun eigenaren. Ze staan in de app alleen om te laten zien waar de gegevens vandaan komen. Als de school of Zermelo dat niet wil, worden ze weggehaald.</li>
        <li><b>Inloggen</b> gaat via de gewone inlog van school (Microsoft) en Zermelo. De app ziet en bewaart je wachtwoord niet. Om je ingelogd te houden bewaart hij alleen de inlogcookies van het portaal (tot 30 dagen, bij elk gebruik verlengd) en de Zermelo-sleutel, in de afgeschermde opslag van de app op je telefoon. Andere apps kunnen daar niet bij. Uitloggen wist ze. Op de inlogpagina verbergt de app alleen het logo van school en zet hij een algemene voorbeeldtekst in het e-mailveld; wat je typt, leest hij niet.</li>
        ${IOS ? `<li><b>Installeren op iPhone</b> gaat met SideStore en je eigen Apple ID. Met een gratis Apple ID werkt de app 7 dagen per keer; SideStore vernieuwt hem (zie Meer → Automatisch vernieuwen). W.S.P staat niet in de App Store en is niet door Apple gecontroleerd.</li>` : ''}
        <li><b>Je gegevens</b> (cijfers, rooster, huiswerk, absentie, je reminders en huiswerk dat je zelf toevoegt) worden alleen op deze telefoon bewaard en nergens anders heen gestuurd.</li>
        <li><b>Rooster van iemand anders.</b> Staat je school het in Zermelo toe, dan kun je met een leerlingnummer het rooster van een medeleerling bekijken. De app laat alleen zien wat Zermelo jou ook laat zien, en bewaart het niet. Gebruik het netjes.</li>
        <li><b>Op de achtergrond</b> kijkt de app in het leerlingportaal en Zermelo of er nieuwe cijfers, huiswerk of roosterwijzigingen zijn: ${IOS ? "zo vaak als iOS dat toestaat (meestal een paar keer per dag), hooguit zoals je instelt, en 's nachts niet" : "op wifi standaard elk half uur, op 4G/5G standaard elke 2,5 uur (alleen rooster en cijfers), elke schooldag een uur voor je eerste les, en 's nachts niet"}. Je stelt dit zelf in bij Meer → Datagebruik. Het gaat met je eigen inlog en alleen voor de meldingen die je aan hebt staan.</li>
        <li><b>Uitloggen</b> haalt je inlog en de Zermelo-koppeling weg. Welke cijfers je al hebt geopend, je afgevinkte huiswerk en je reminders blijven op deze telefoon bewaard onder jouw account, zodat ze terugkomen als je weer inlogt. Iemand anders die hier inlogt, ziet ze niet.</li>
        <li><b>Updates.</b> De app staat op GitHub. W.S.P kijkt daar als je de app opent op wifi of er een nieuwe versie is. GitHub krijgt daarbij alleen een gewoon verzoek (met je IP-adres, zoals bij elke website), geen gegevens over jou. ${IOS ? 'Bijwerken gaat via SideStore: de app opent SideStore met de nieuwe versie.' : 'De app downloadt de nieuwe versie daar als je op Bijwerken tikt. De toestemming om apps te installeren wordt alleen gebruikt voor updates van W.S.P zelf.'}</li>
        <li><b>Foutmeldingen.</b> Loopt de app vast, dan wordt de technische foutmelding automatisch naar de developer gestuurd (via de meldingsdienst ntfy.sh)${IOS ? ' de volgende keer dat je de app opent' : ''}, met de app-versie en je telefoonmodel. Daar zitten geen cijfers, rooster, naam of inloggegevens in.</li>
        <li><b>Cookies en opslag.</b> De app gebruikt de cookies van het leerlingportaal en Zermelo om je ingelogd te houden, en lokale opslag voor je instellingen en reminders. De lettertypes zitten in de app zelf, daarvoor wordt niets van internet geladen. Er zijn geen advertenties en er wordt niets bijgehouden.</li>
        <li><b>Geen garantie.</b> De app kan fouten bevatten of verouderde informatie tonen. Controleer belangrijke dingen, zoals cijfers, toetsen en roosterwijzigingen, altijd in het leerlingportaal of Zermelo.</li>
        <li><b>Gebruik</b> is op eigen risico. Houd je aan de regels van school voor het gebruik van het portaal en Zermelo.</li>
      </ul>
      ${viewOnly ? `<p class="small muted">Akkoord gegeven: ${esc(ls.get('cp:termsDate', 'onbekend'))}</p><button class="btn" data-a="ok">Sluiten</button>`
        : `<label class="agree"><input type="checkbox" id="terms-ok"><span>Ik heb dit gelezen en ga akkoord met de voorwaarden, het gebruik van cookies en de privacyuitleg.</span></label>
      <button class="btn" data-a="ok" disabled>Akkoord en doorgaan</button>`}`;
    app.appendChild(el);
    const btn = el.querySelector('[data-a=ok]');
    const cb = el.querySelector('#terms-ok');
    if (cb) cb.onchange = () => { btn.disabled = !cb.checked; };
    btn.onclick = () => {
      if (!viewOnly) {
        if (!cb.checked) return;
        ls.set('cp:terms', TERMS_VERSION);
        const d = now();
        ls.set('cp:termsDate', d.getDate() + ' ' + MONTH_FULL[d.getMonth()] + ' ' + d.getFullYear());
      }
      el.remove();
      if (!viewOnly) firstRun();
    };
  }

  /* ---------- ontwikkelaar (achter een code) ---------- */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    app.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  /* ---------- schuivend blokje bij keuzerijen (.seg en .modes) ----------
     De schermen worden bij een keuze opnieuw getekend; we onthouden per rij welke knop gekozen was
     (herkend aan de data-naam van de knoppen, bijv. data-mode="hw:…") en laten het blokje van daar naar de nieuwe keuze schuiven */
  const segLast = new Map();
  function segKey(box) {
    const b = box.querySelector(':scope > button');
    if (!b) return null;
    for (const a of b.attributes) if (a.name.startsWith('data-')) return a.name + ':' + (a.value.includes(':') ? a.value.split(':')[0] : '');
    return null;
  }
  function animSegs() {
    sh.querySelectorAll('.seg, .modes').forEach(box => {
      const key = segKey(box);
      const btns = [...box.querySelectorAll(':scope > button')], on = btns.findIndex(b => b.classList.contains('on'));
      if (!key || on < 0 || !box.offsetParent) return;
      const prev = segLast.get(key);
      segLast.set(key, on);
      const place = (el, p) => Object.assign(p.style, { left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px' });
      let pill = box.querySelector(':scope > .segpill');
      if (!pill) {
        pill = document.createElement('i');
        pill.className = 'segpill';
        box.prepend(pill);
        box.classList.add('has-pill');
        pill.style.transition = 'none';
        place(btns[prev != null && btns[prev] ? prev : on], pill); /* begin bij de vorige keuze (net opnieuw getekend) */
        void pill.offsetWidth;
        pill.style.transition = '';
      }
      place(btns[on], pill);
    });
  }
  let segRaf = 0;
  new MutationObserver(() => { if (!segRaf) segRaf = requestAnimationFrame(() => { segRaf = 0; animSegs(); }); })
    .observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  /* ---------- uitleg bij de eerste keer: een blokje dat onderin omhoog schuift ---------- */
  const TIPS = {
    rooster: ['Je rooster', 'Wissel tussen <b>Dag</b> en <b>Week</b>. Veeg naar links of rechts voor een andere week en tik op een les voor het lokaal, de docent en wijzigingen. Rood gestreept betekent uitval.'],
    huiswerk: ['Huiswerk', 'Tik op het rondje rechts als je iets af hebt. Met het <b>belletje</b> kies je wanneer je een herinnering krijgt. Veeg voor een andere week.'],
    cijfers: ['Cijfers', 'Een nieuw cijfer is eerst wazig: tik erop om het te <b>unboxen</b>. Veeg tussen de perioden en tik op een cijfer voor de toets, weging en datum.'],
    calc: ['Wat moet ik halen?', 'Kies een vak, je <b>doel</b> en hoe zwaar je volgende toets telt. Je ziet meteen welk cijfer je minimaal nodig hebt. Met <b>Zelf invullen</b> reken je met je eigen cijfers.'],
    ownrem: ['Reminders', 'Tik op <b>+ Zet reminder</b>, typ waaraan je moet denken en kies de dag en tijd. Eenmalig of herhalend. Je ziet ze ook onderaan je rooster.'],
    meldingen: ['Meldingen', 'Kies per soort of je een melding met <b>geluid</b>, <b>trillen</b>, <b>stil</b> of helemaal niet wilt. Komt er niks binnen? Tik onderaan op "Melding op je scherm laten zien".'],
    hwremind: ['Huiswerkherinneringen', 'Kies wanneer je een seintje krijgt voordat huiswerk af moet zijn. <b>Standaard</b> geldt voor alles, per vak kun je het anders instellen. Afgevinkt huiswerk krijgt geen herinnering meer.'],
    themes: ['Thema', 'Kies <b>Wit</b> of <b>Zwart</b> en een accentkleur. Met het regenboogrondje kies je zelf een kleur. Onderaan kies je het icoontje op je startscherm.'],
    data: ['Datagebruik', 'Hier kies je hoe vaak de app kijkt op <b>wifi</b> en op <b>4G/5G</b>, en wat er op 4G/5G mag. Je ziet ook een schatting van je dataverbruik, zodat je bundel niet opgaat.'],
    sidestore: ['Automatisch vernieuwen', '<span class="tag">VERPLICHT</span> W.S.P werkt 7 dagen, daarna moet SideStore hem vernieuwen, anders opent hij niet meer. Laat LocalDevVPN aan staan en stel in <b>Opdrachten</b> één keer in:<br><b>1. Automatisering → + → Tijdstip</b><br><b>2. 02:00, Wekelijks, twee dagen aanvinken → Voer direct uit</b><br><b>3. SideStore → Refresh All Apps → Gereed</b><br>Hier zie je ook hoeveel dagen hij nog werkt.']
  };
  if (IOS) {
    TIPS.meldingen[1] = TIPS.meldingen[1].replace('<b>trillen</b>, ', '');
    Object.values(TIPS).forEach(t => { t[1] = t[1].replace(/startscherm/g, 'beginscherm'); }); /* zo heet het op iPhone */
  }
  const tipSeen = k => !!(ls.get('cp:tips', {}) || {})[k];
  /* toont de uitleg als die nog niet gezien is; zit er iets anders in de weg (een venster), dan later nog eens proberen */
  /* over: de uitleg hoort bij het venster dat net open ging, dus daar overheen tonen */
  function tip(k, when, over) {
    if (tipSeen(k) || !TIPS[k]) return;
    /* nieuw account: de rondleiding legt het uit, geen losse blokjes ervoor */
    if (!ls.get('cp:tourDone', 0) && !store.init) return;
    const ok = when || (() => true);
    let tries = 0;
    const attempt = () => {
      if (tipSeen(k) || !ok()) return;
      if (app.querySelector(over ? '.tipcard, .ov, .terms, .tour' : '.tipcard, .modal, .ov, .terms, .tour')) { if (++tries < 40) setTimeout(attempt, 800); return; }
      const seen = ls.get('cp:tips', {}) || {};
      seen[k] = 1;
      ls.set('cp:tips', seen);
      const [title, text] = TIPS[k];
      const w = document.createElement('div');
      w.className = 'tipwrap';
      w.innerHTML = `<div class="tipcard" role="dialog" aria-label="${esc(title)}"><div class="tip-h"><span class="tip-i">i</span><b>${esc(title)}</b></div><p>${text}</p><button class="btn" data-a="ok">Snap ik</button></div>`;
      const close = () => { w.classList.add('out'); setTimeout(() => w.remove(), 220); };
      w.onclick = e => { if (e.target === w || e.target.closest('[data-a=ok]')) close(); };
      app.appendChild(w);
    };
    setTimeout(attempt, 350);
  }
  /* ---------- rondleiding voor een nieuw account: na inloggen en Zermelo langs alle onderdelen ----------
     het onderdeel wordt uitgelicht (de rest donker), de app gaat er zelf naartoe, met uitleg erbij */
  const TOUR = [
    ['rooster', 'rooster', () => { const v = main.querySelector('[data-rv]'), a = main.querySelector('.swipe-area'); return a && [v ? v.parentElement : a, a]; }],
    ['huiswerk', 'huiswerk', () => main.querySelector('.swipe-area')],
    ['cijfers', 'cijfers', () => main.querySelector('.swipe-area.grades') || main.querySelector('.bn.first')],
    ['calc', 'meer', () => main.querySelector('[data-calcbox]')],
    ['ownrem', 'meer', () => { const b = main.querySelector('[data-a=ownadd]'); return b && b.closest('.card-box'); }],
    ['meldingen', 'meer', () => { const b = main.querySelector('[data-mode]'); return b && b.closest('.card-box'); }],
    ['themes', 'meer', () => main.querySelector('[data-a=themes]')],
    ['data', 'meer', () => main.querySelector('[data-a=data]')],
    /* iPhone: zonder vernieuwen werkt de app na 7 dagen niet meer */
    ...(IOS ? [['sidestore', 'meer', () => main.querySelector('[data-a=sidestore]')]] : [])
  ];
  const tourDone = () => !!ls.get('cp:tourDone', 0);
  /* nieuw account (nog niks geopend) en nog geen rondleiding gehad: starten zodra er niks anders open staat */
  function maybeTour() {
    let tries = 0;
    const attempt = () => {
      if (tourDone() || store.init || app.querySelector('.tour')) return;
      /* zolang de eerste-keer-vensters open staan blijven wachten (dat kan lang duren); anders hooguit ~3 minuten */
      if (app.querySelector('.modal, .terms, .ov, .tipcard')) { setTimeout(attempt, 800); return; }
      if (!S.grades || main.querySelector('[data-a=login]')) { if (++tries < 200) setTimeout(attempt, 800); return; }
      startTour();
    };
    setTimeout(attempt, 600);
  }
  function startTour() {
    const ov = document.createElement('div');
    ov.className = 'tour';
    ov.innerHTML = '<div class="tour-hole"></div><div class="tour-ring"></div><div class="tour-card"></div>';
    app.appendChild(ov);
    const hole = ov.querySelector('.tour-hole'), ring = ov.querySelector('.tour-ring'), card = ov.querySelector('.tour-card');
    const wait = ms => new Promise(x => setTimeout(x, ms));
    let i = 0;
    const finish = () => {
      ls.set('cp:tourDone', 1);
      const seen = ls.get('cp:tips', {}) || {};
      TOUR.forEach(([k]) => { seen[k] = 1; });
      ls.set('cp:tips', seen);
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 250);
      go('rooster');
    };
    const show = async () => {
      const [k, tab, find] = TOUR[i];
      card.classList.remove('in');
      if (S.tab !== tab) { go(tab); await wait(450); }
      let el = null;
      for (let t = 0; t < 25 && !(el = find()); t++) await wait(200); /* even wachten tot het geladen is */
      const tabBtn = sh.querySelector(`nav.tabs [data-tab="${tab}"]`);
      /* één stuk of meerdere stukken onder elkaar (dan het hele gebied eromheen uitlichten) */
      const els = el ? [].concat(el) : [];
      const area = () => els.map(e => e.getBoundingClientRect()).reduce((u, b) => ({ left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) }));
      if (els.length) {
        const h = area().bottom - area().top;
        els[0].scrollIntoView({ block: h < main.clientHeight * 0.6 ? 'center' : 'start' });
        if (h < main.clientHeight * 0.6 && els.length > 1) main.scrollTop += (area().top + area().bottom) / 2 - (main.getBoundingClientRect().top + main.clientHeight / 2);
        await wait(120);
      }
      const A = app.getBoundingClientRect(), M = main.getBoundingClientRect();
      const u = els.length ? area() : M, r = { left: u.left, top: u.top, bottom: u.bottom, width: u.right - u.left };
      const top = Math.max(r.top, M.top + 4) - 6, bottom = Math.min(r.bottom, M.bottom - 4) + 6;
      Object.assign(hole.style, { left: (r.left - A.left - 6) + 'px', top: (top - A.top) + 'px', width: (r.width + 12) + 'px', height: Math.max(40, bottom - top) + 'px' });
      if (tabBtn) { const b = tabBtn.getBoundingClientRect(); Object.assign(ring.style, { left: (b.left - A.left) + 'px', top: (b.top - A.top) + 'px', width: b.width + 'px', height: b.height + 'px' }); }
      const [title, tipText] = TIPS[k];
      /* bij Thema sta je nog in Meer, niet in het themascherm zelf */
      const text = k === 'themes' ? 'Tik hier om <b>Wit</b> of <b>Zwart</b> te kiezen, met je eigen accentkleur en een app-icoontje voor je ' + (IOS ? 'beginscherm' : 'startscherm') + '.' : tipText;
      card.innerHTML = `<div class="tip-h"><span class="tip-i">${i + 1}</span><b>${esc(title)}</b><small>${i + 1} van ${TOUR.length}</small></div><p>${text}</p>
        <div class="tour-btns"><button class="btn" data-a="next">${i === TOUR.length - 1 ? 'Klaar' : 'Volgende'}</button></div>`;
      /* uitleg onder het uitgelichte stuk als daar plek is, anders erboven, anders onderin */
      const below = A.bottom - bottom - 90, above = top - A.top;
      card.style.top = card.style.bottom = '';
      if (below > 210) card.style.top = (bottom - A.top + 12) + 'px';
      else if (above > 230) card.style.bottom = (A.bottom - top + 12) + 'px';
      else card.style.bottom = '96px';
      card.classList.add('in');
      card.querySelector('[data-a=next]').onclick = () => { buzz(8); if (++i >= TOUR.length) finish(); else show(); };
    };
    show();
  }

  /* uitleg bij een kaart in Meer zodra die voor het grootste deel in beeld komt */
  function tipWhenSeen(el, k) {
    if (!el || tipSeen(k) || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      io.disconnect();
      tip(k, () => el.isConnected && S.tab === 'meer');
    }, { threshold: 0.6 });
    io.observe(el);
  }

  /* ---------- updates: zelf kijken of er een nieuwe versie op GitHub staat en die installeren ---------- */
  const UPD_API = 'https://api.github.com/repos/wesssaa/W.S.P/releases/latest';
  const verNum = v => String(v || '').replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  /* nummer achter -canary.N / -beta.N; een echte versie (zonder) is nieuwer dan elke canary van hetzelfde nummer */
  const preNum = v => { const m = /-(?:canary|beta)\.(\d+)$/.exec(String(v || '')); return m ? +m[1] : Infinity; };
  const newer = (a, b) => {
    const x = verNum(a), y = verNum(b);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return preNum(a) > preNum(b);
  };
  /* canary-updates (ontwikkelaarsopties): alleen op deze telefoon, dan ook pre-releases van GitHub */
  const canaryOn = () => !!ls.get('cp:canary', false);
  const appVer = () => { try { return Native && Native.appVersion ? Native.appVersion() : ''; } catch (e) { return ''; } };
  const canUpdate = () => !!(Native && Native.installUpdate && appVer());
  /* via Android (het portaal kan verzoeken naar andere sites tegenhouden); in de preview gewoon met fetch */
  /* één vraag tegelijk (Android antwoordt via één callback). Vraag je iets voor een ander kanaal (canary/gewoon)
     terwijl er nog een loopt, dan eerst die afwachten en daarna een nieuwe vraag */
  let relPending = null; /* { ch, p } */
  const releaseJson = () => {
    if (!(Native && Native.fetchRelease)) return fetch(UPD_API, { headers: { Accept: 'application/vnd.github+json' } }).then(r => { if (!r.ok) throw new Error('GitHub ' + r.status); return r.json(); });
    const ch = canaryOn() && Native.fetchReleaseCanary ? 'canary' : 'gewoon';
    if (relPending) return relPending.ch === ch ? relPending.p : relPending.p.catch(() => {}).then(() => releaseJson());
    const job = { ch };
    job.p = new Promise((ok, bad) => {
      const end = () => { if (relPending === job) relPending = null; };
      window.__cpRel = t => { end(); t ? ok(JSON.parse(t)) : bad(new Error('GitHub')); };
      if (ch === 'canary') Native.fetchReleaseCanary(); else Native.fetchRelease();
      setTimeout(() => { if (relPending === job) { end(); bad(new Error('time-out')); } }, 20000);
    });
    relPending = job;
    return job.p;
  };
  async function fetchRelease() {
    const j = await releaseJson(), asset = (j.assets || []).find(a => (IOS ? /\.ipa$/i : /\.apk$/i).test(a.name));
    return asset ? { v: String(j.tag_name).replace(/^v/, ''), url: asset.browser_download_url, notes: j.body || '', size: asset.size } : null;
  }
  /* manual: via de knop in Meer (dan altijd tonen, ook als je hem had uitgesteld); test: ook als het geen nieuwere versie is */
  /* force: via de vernieuwknop (dan niet wachten op de 2 minuten tussen twee keer kijken) */
  async function checkUpdate(manual, test, force) {
    if (!canUpdate()) { if (manual) toast('Updaten kan alleen in de app'); return; }
    /* vanzelf zoeken naar updates alleen op wifi; via de knop in Meer altijd */
    if (!manual) { try { if (Native.onMobile && Native.onMobile()) return; } catch (e) {} }
    const cur = appVer();
    /* elke keer opnieuw kijken (dat kost bijna niks), maar niet vaker dan eens per 2 minuten als je snel heen en weer wisselt */
    let u = ls.get('cp:updFound', null);
    if (manual || force || Date.now() - (ls.get('cp:updCheck', 0) || 0) > 2 * 60000) {
      try { u = await fetchRelease(); ls.set('cp:updCheck', Date.now()); ls.set('cp:updFound', u); }
      catch (e) { if (manual) toast('Kon niet kijken of er een update is'); return; }
    }
    if (!u || (!test && !newer(u.v, cur))) { if (manual) toast('Je hebt de nieuwste versie (' + cur + ')'); return; }
    let tries = 0;
    const attempt = () => {
      const sn = ls.get('cp:updSnooze', null);
      if (app.querySelector('.upd') || (!manual && sn && sn.v === u.v && Date.now() < sn.until)) return;
      if (app.querySelector('.modal, .ov, .terms, .tipcard, .tour')) { if (++tries < 60) setTimeout(attempt, 1000); return; }
      updSheet(u);
    };
    attempt();
  }
  const LATER = [[3600000, '1 uur'], [86400000, '1 dag'], [3 * 86400000, '3 dagen'], [7 * 86400000, '1 week']];
  function updSheet(u) {
    let later = 86400000;
    const m = document.createElement('div');
    m.className = 'modal upd';
    m.innerHTML = `<div class="sheet"><h3>Nieuwe versie: ${esc(u.v)}</h3>
      <p class="small muted">Je hebt nu ${esc(appVer())}${u.size ? ' · download ' + dec((u.size / 1048576).toFixed(1)) + ' MB' : ''}. Je cijfers, reminders en instellingen blijven gewoon staan.</p>
      ${u.notes ? `<div class="updnotes">${esc(u.notes).replace(/\n/g, '<br>')}</div>` : ''}
      <button class="btn" data-a="go">Nu bijwerken</button>
      <div class="small" data-updmsg style="text-align:center"></div>
      <div class="lbl" style="margin-top:6px">Nu geen tijd? Herinner me over</div>
      <div class="seg">${LATER.map(([k, l]) => `<button class="${k === later ? 'on' : ''}" data-later="${k}">${l}</button>`).join('')}</div>
      <button class="btn ghost" data-a="later">Later herinneren</button></div>`;
    const msg = m.querySelector('[data-updmsg]'), go = m.querySelector('[data-a=go]');
    m.querySelectorAll('[data-later]').forEach(b => {
      b.onclick = () => { later = +b.dataset.later; m.querySelectorAll('[data-later]').forEach(x => x.classList.toggle('on', x === b)); };
    });
    m.querySelector('[data-a=later]').onclick = () => {
      ls.set('cp:updSnooze', { v: u.v, until: Date.now() + later });
      m.remove();
      toast('Je krijgt het over ' + LATER.find(x => x[0] === later)[1] + ' weer te zien');
    };
    go.onclick = () => {
      if (!canUpdate()) { msg.textContent = 'Updaten kan alleen in de app.'; return; }
      go.disabled = true;
      msg.textContent = IOS ? 'SideStore openen…' : 'Downloaden…';
      Native.installUpdate(u.url);
    };
    window.__cpUpd = (st, pct) => {
      /* iPhone: SideStore installeert de update */
      if (st === 'sidestore' || st === 'browser') {
        go.disabled = false;
        msg.textContent = st === 'sidestore' ? 'Tik in SideStore op Installeren. Daarna open je W.S.P gewoon weer.' : 'SideStore niet gevonden: de download staat in Safari. Zet hem via SideStore → My Apps → + erop.';
      }
      else if (st === 'busy') msg.textContent = 'Downloaden… ' + pct + '%';
      else if (st === 'ask') {
        msg.textContent = 'Tik in het venster van Android op Updaten.';
        /* venster weggeklikt of niet verschenen (geen antwoord van Android): knop na een paar seconden weer bruikbaar */
        setTimeout(() => { if (m.isConnected && go.disabled) { go.disabled = false; msg.textContent = 'Geen venster gezien of weggeklikt? Tik opnieuw op Nu bijwerken.'; } }, 6000);
      }
      else if (st === 'cancel') { go.disabled = false; msg.textContent = 'Bijwerken geannuleerd. Tik opnieuw op Nu bijwerken als je wilt.'; }
      else if (st === 'perm') { go.disabled = false; msg.textContent = 'Zet "Toestaan uit deze bron" aan voor W.S.P, ga terug en tik opnieuw op Nu bijwerken.'; }
      else { go.disabled = false; msg.textContent = 'Downloaden mislukt. Controleer je internet en probeer het opnieuw.'; }
    };
    app.appendChild(m);
  }
  /* bij het openen van de app, en als je terugkomt in de app (dan is "herinner me over…" misschien voorbij) */
  /* ontwikkelaar: zelf kiezen welke versie (canary of gewoon) je installeert */
  function pickRelease() {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Kies een versie</h3><div class="spinner" style="margin:6px auto"></div><button class="btn ghost" data-a="close">Sluiten</button></div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    app.appendChild(m);
    let kind = 'canary', all = null;
    const show = list => {
      all = list;
      const cur = appVer();
      const rows = (list || []).filter(r => !r.draft && (kind === 'canary' ? r.prerelease : !r.prerelease)).map(r => {
        const asset = (r.assets || []).find(a => /\.apk$/i.test(a.name));
        const v = String(r.tag_name).replace(/^v/, ''), d = new Date(r.published_at);
        const mine = v === cur, older = cur && !mine && newer(cur, v);
        const state = mine ? 'je hebt deze' : older ? 'ouder: kan niet (Android staat terugzetten niet toe)' : '';
        return asset ? `<button class="setrow" data-rel="${esc(v)}"${mine || older ? ' disabled style="opacity:.45"' : ''}>
          <span class="sr-t"><b>${esc(v)} ${r.prerelease ? '<span class="tag">CANARY</span>' : ''}</b><small>${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}${state ? ' · ' + state : ''}</small></span><span class="go">›</span></button>` : '';
      }).join('');
      m.querySelector('.sheet').innerHTML = `<h3>Kies een versie</h3>
        <div class="seg">${[['normaal', 'Normaal'], ['canary', 'Canary']].map(([k, l]) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
        <div style="max-height:50vh;overflow-y:auto">${rows || `<p class="small muted">Geen ${kind === 'canary' ? 'canary-versies' : 'versies'} gevonden.</p>`}</div><button class="btn ghost" data-a="close">Sluiten</button>`;
      m.querySelectorAll('[data-kind]').forEach(b => { b.onclick = () => { kind = b.dataset.kind; show(all); }; });
      m.querySelectorAll('[data-rel]:not([disabled])').forEach(b => {
        b.onclick = () => {
          const r = all.find(x => String(x.tag_name).replace(/^v/, '') === b.dataset.rel), asset = r.assets.find(a => /\.apk$/i.test(a.name));
          m.remove();
          updSheet({ v: b.dataset.rel, url: asset.browser_download_url, notes: r.body || '', size: asset.size });
        };
      });
    };
    if (Native && Native.fetchReleaseList) {
      window.__cpRelList = t => { let l = null; try { l = JSON.parse(t); } catch (e) {} show(l); };
      Native.fetchReleaseList();
    } else fetch('https://api.github.com/repos/wesssaa/W.S.P/releases?per_page=12').then(r => r.json()).then(show).catch(() => show(null));
  }

  /* allereerste keer: is deze APK al verouderd, dan eerst bijwerken (zo krijgt iedereen die de app doorgestuurd krijgt
     meteen de nieuwste). Zo nodig eerst toestemming geven om te installeren, daarna begint het bijwerken vanzelf */
  async function firstUpdate(next) {
    let finished = false, back = null;
    /* klaar (geen update, of "Nu niet"): niet meer luisteren, anders begint het bijwerken later alsnog vanzelf */
    const go = () => {
      if (finished) return;
      finished = true;
      if (back) document.removeEventListener('visibilitychange', back);
      if (window.__cpUpd === onUpd) window.__cpUpd = null;
      ls.set('cp:firstUpd', 1);
      m.remove();
      next();
    };
    let onUpd = null;
    const m = document.createElement('div');
    m.className = 'modal upd';
    if (!canUpdate()) { ls.set('cp:firstUpd', 1); return next(); }
    m.innerHTML = `<div class="sheet"><h3>Even kijken…</h3><p class="small muted">Is er al een nieuwere versie van W.S.P?</p><div class="spinner" style="margin:6px auto"></div></div>`;
    app.appendChild(m);
    let u = null;
    try { u = await Promise.race([fetchRelease(), new Promise((_, bad) => setTimeout(() => bad(new Error('time-out')), 8000))]); } catch (e) {}
    if (!u || !newer(u.v, appVer())) return go();
    ls.set('cp:updFound', u);
    const can = () => { try { return !Native.canInstall || Native.canInstall(); } catch (e) { return true; } };
    let started = false, tries = 0;
    const draw = () => {
      const perm = !can();
      m.innerHTML = `<div class="sheet"><h3>Eerst bijwerken</h3>
        <p class="small" style="color:var(--fg2)">Je hebt versie ${esc(appVer())}, de nieuwste is <b>${esc(u.v)}</b>. ${IOS ? 'SideStore gaat zo open om hem bij te werken' : 'W.S.P werkt zichzelf nu eerst bij'}, dan heb je meteen alles wat nieuw is.</p>
        ${perm ? `<p class="small" style="color:var(--fg2)">Daarvoor moet je één keer toestaan dat W.S.P <b>apps mag installeren</b> (alleen voor updates van W.S.P zelf):</p>
          <ol class="small" style="margin:0;padding-left:18px;color:var(--fg2);display:grid;gap:6px"><li>Tik op <b>Instellen</b>.</li><li>Zet <b>Toestaan uit deze bron</b> aan.</li><li>Ga terug naar W.S.P, het bijwerken begint dan vanzelf.</li></ol>` : ''}
        <div class="small" data-updmsg style="text-align:center;font-weight:700;color:var(--accent-text)"></div>
        ${perm ? '<div class="row"><button class="btn" data-a="set" style="flex:1">Instellen</button></div>' : ''}<div data-stuck></div></div>`;
      /* eerste keer bijwerken is verplicht: eerst lezen, dan instellen; alleen na 2 keer zonder resultaat een uitweg */
      if (perm) readFirst(m.querySelector('[data-a=set]'), () => { tries++; Native.openInstallSettings(); });
      if (tries >= 2) stuckLink(m, go);
      if (tries >= 2) stuckLink(m, go);
    };
    const msg = t => { const el = m.querySelector('[data-updmsg]'); if (el) el.textContent = t; };
    /* opnieuw proberen of toch eerst met deze versie verder */
    /* mislukt of geannuleerd: opnieuw proberen (bijwerken is verplicht); pas na 2 keer mislukken een uitweg (bijv. geen internet) */
    let fails = 0;
    const choices = text => {
      fails++;
      msg(text);
      const box = m.querySelector('[data-stuck]');
      if (!box) return;
      box.innerHTML = '<div class="row"><button class="btn" data-a="again" style="flex:1">Opnieuw</button></div>';
      box.querySelector('[data-a=again]').onclick = () => { started = false; start(); };
      if (fails >= 2) { const s = document.createElement('div'); s.setAttribute('data-stuck2', ''); box.appendChild(s); s.innerHTML = '<button class="linkbtn" style="text-align:center;font-size:13px;color:var(--muted);border-bottom:0">Lukt het echt niet? Ga verder</button>'; s.firstChild.onclick = go; }
    };
    const start = () => {
      if (started || finished) return;
      started = true;
      draw();
      msg(IOS ? 'SideStore openen…' : 'Downloaden…');
      Native.installUpdate(u.url);
    };
    onUpd = (st, pct) => {
      if (finished) return;
      /* iPhone: SideStore neemt het over; daarna mag je verder (de update komt binnen als SideStore klaar is) */
      if (st === 'sidestore' || st === 'browser') {
        /* niet vanzelf opnieuw SideStore openen als je terugkomt (anders blijf je heen en weer springen):
           zelf kiezen tussen nog eens proberen en verder met deze versie */
        started = false;
        handedOff = true;
        msg(st === 'sidestore' ? 'Tik in SideStore op Installeren en open W.S.P daarna weer.' : 'SideStore niet gevonden: de download staat in Safari.');
        const box = m.querySelector('[data-stuck]');
        if (box) {
          box.innerHTML = '<div class="row"><button class="btn ghost" data-a="on" style="flex:1">Verder met deze versie</button><button class="btn" data-a="again" style="flex:1">Opnieuw</button></div>';
          box.querySelector('[data-a=on]').onclick = go;
          box.querySelector('[data-a=again]').onclick = () => { started = false; start(); };
        }
      }
      else if (st === 'busy') msg('Downloaden… ' + pct + '%');
      /* het venster van Android kan wegvallen zonder antwoord (bijv. met de thuisknop): dan toch een uitweg */
      else if (st === 'ask') { msg('Tik in het venster van Android op Updaten.'); setTimeout(() => { if (!finished && started) choices('Geen venster gezien of weggeklikt?'); }, 6000); }
      else if (st === 'perm') { started = false; draw(); }
      else { started = false; draw(); choices(st === 'cancel' ? 'Bijwerken geannuleerd.' : 'Bijwerken mislukt. Controleer je internet.'); }
    };
    window.__cpUpd = onUpd;
    let handedOff = false; /* iPhone: al naar SideStore gestuurd */
    back = () => {
      if (document.hidden || finished || handedOff) return;
      if (!started && can()) start();
      else if (tries >= 2 && !started) stuckLink(m, go);
    };
    document.addEventListener('visibilitychange', back);
    if (can()) start(); else draw();
  }

  /* bij het openen: eerst rooster en cijfers laten laden (die gaan voor), dan pas naar een update kijken */
  function checkUpdateWhenLoaded() {
    let tries = 0;
    const wait = () => {
      const busy = !S.rooster[S.rMonday && S.rMonday.getTime()] || (!S.grades && !S.gradesErr) || S.loadingGrades;
      if (busy && ++tries < 30) return setTimeout(wait, 1000);
      checkUpdate(false);
    };
    setTimeout(wait, 1500);
  }
  /* eerste keer openen na een update: laten zien dat het gelukt is, met wat er nieuw is */
  function showUpdated() {
    const cur = appVer();
    if (!cur) return;
    /* 2.5.6 onthield de versie nog niet: had die al eens naar updates gekeken, dan kom je van een oudere versie */
    const last = ls.get('cp:lastVer', null) || (ls.get('cp:updCheck', 0) ? '0' : null);
    ls.set('cp:lastVer', cur);
    if (!last || !newer(cur, last)) return;
    const found = ls.get('cp:updFound', null), notes = found && found.v === cur ? found.notes : '';
    let tries = 0;
    const attempt = () => {
      if (app.querySelector('.tipcard, .modal, .ov, .terms, .tour')) { if (++tries < 60) setTimeout(attempt, 1000); return; }
      const w = document.createElement('div');
      w.className = 'tipwrap';
      w.innerHTML = `<div class="tipcard" role="dialog"><div class="tip-h"><span class="tip-i">✓</span><b>Bijgewerkt naar ${esc(cur)}</b></div>
        <p>De update is gelukt. Je cijfers, reminders en instellingen staan er nog.</p>
        ${notes ? `<div class="updnotes" hidden>${esc(notes).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="tour-btns">${notes ? '<button class="btn ghost" data-a="new">Wat is er nieuw?</button>' : ''}<button class="btn" data-a="ok">Top</button></div></div>`;
      const close = () => { w.classList.add('out'); setTimeout(() => w.remove(), 220); };
      w.onclick = e => {
        if (e.target.closest('[data-a=new]')) { w.querySelector('.updnotes').hidden = false; e.target.closest('[data-a=new]').remove(); return; }
        if (e.target === w || e.target.closest('[data-a=ok]')) close();
      };
      app.appendChild(w);
    };
    setTimeout(attempt, 1200);
  }
  showUpdated();
  checkUpdateWhenLoaded();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdateWhenLoaded(); });

  /* link buiten de app openen (YouTube-app of browser) */
  const openUrl = url => { if (Native && Native.open) Native.open(url); else window.open(url, '_blank'); };
  function devUnlock(redraw) {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="sheet"><h3>Ontwikkelaar</h3><label class="lbl">Code</label>
      <input type="text" inputmode="text" class="secret" data-f="code" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><div class="zerr"></div>
      <div class="row"><button class="btn" data-a="go">Openen</button><button class="btn ghost" data-a="close">Annuleren</button></div></div>`;
    /* alleen een SHA-256-hash van de code staat in de app, niet de code zelf */
    const DEV_HASH = '8ec53467b0cab19cdcca97a9273571fd10a273d57af52033721499cc0328684e';
    const go = async () => {
      let hex = '';
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ichthusplus:' + m.querySelector('[data-f=code]').value.trim()));
        hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
      if (hex === DEV_HASH) { S.devOn = true; m.remove(); redraw(); }
      else if (m.querySelector('[data-f=code]').value.trim().toLowerCase() === 'joep') { m.remove(); openUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'); } /* 🎵 */
      else m.querySelector('.zerr').innerHTML = errBox('Verkeerde code.');
    };
    m.querySelector('[data-a=go]').onclick = go;
    m.querySelector('[data-f=code]').onkeydown = e => { if (e.key === 'Enter') go(); };
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-a=close]')) m.remove(); });
    app.appendChild(m);
    setTimeout(() => m.querySelector('[data-f=code]').focus(), 50);
  }
  const ABS_SOORT = ['Te laat', 'Materiaal vergeten', 'Eruit gestuurd', 'Absent', 'Huiswerk vergeten'];
  const DEV_SUBJ = [['wi', 'Wiskunde'], ['ne', 'Nederlandse taal'], ['en', 'Engelse taal'], ['gs', 'Geschiedenis'], ['bi', 'Biologie']];
  const devSubjects = () => S.grades && S.grades.subjects.length ? S.grades.subjects.map(s => [s.afk, s.name]) : DEV_SUBJ;
  function addDevGrade(afk, val, w, soort) {
    const name = (devSubjects().find(s => s[0] === afk) || [afk, afk])[1];
    const num = toNum(val);
    S.dev.push({
      dev: true, id: 'dev' + Date.now() + Math.random().toString(36).slice(2, 6), vak: name, afk, p: S.grades ? S.grades.current : '1', kind: 'toets',
      val: num != null ? num.toFixed(1) : String(val).trim().toUpperCase() || '?', num, oms: 'Testcijfer', code: '', soort, weging: String(w),
      datum: fmt(now()), herk: 'Geen'
    });
    updateNav();
  }
  function devCard() {
    const subs = devSubjects();
    const d = S.devForm || (S.devForm = { afk: subs[0][0], val: '7.5', w: 1, soort: 'Schriftelijke overhoring', ntype: 'grades', delay: 10 });
    const left = S.devTimerEnd ? Math.max(0, Math.ceil((S.devTimerEnd - Date.now()) / 1000)) : null;
    return `<div class="card-box dev-box"><div class="setting-h">Ontwikkelaar</div>
      <div class="small muted">Testcijfers zijn weg zodra je de app sluit.</div>
      <label class="lbl" style="display:block;margin-top:12px">Testcijfer</label>
      <div class="calc-row" style="margin-top:6px"><select data-dev="afk">${subs.map(s => `<option value="${esc(s[0])}"${s[0] === d.afk ? ' selected' : ''}>${esc(s[1])}</option>`).join('')}</select>
        <input type="text" inputmode="text" data-dev="val" value="${esc(d.val)}" placeholder="7.5"></div>
      <div class="seg" style="margin-top:8px">${[1, 2, 3, 4, 5].map(w => `<button class="${w === d.w ? 'on' : ''}" data-dw="${w}">${w}×</button>`).join('')}</div>
      <div class="seg" style="margin-top:8px">${[['Schriftelijke overhoring', 'SO'], ['Repetitie', 'REP'], ['Praktische opdracht', 'PO']].map(([k, l]) => `<button class="${k === d.soort ? 'on' : ''}" data-dt="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px;justify-content:flex-start"><button class="btn" data-a="devadd">Toevoegen</button><button class="btn ghost" data-a="devrand">Willekeurig</button></div>
      ${S.dev.length ? `<div class="listrow" style="margin-top:8px"><span class="muted">${S.dev.length} testcijfer${S.dev.length === 1 ? '' : 's'} actief</span><button class="linkbtn" data-a="devclear" style="width:auto;padding:0;border:0">Wissen</button></div>` : ''}
      <label class="lbl" style="display:block;margin-top:14px">Testmelding</label>
      <div class="seg" style="margin-top:6px">${[['grades', 'Cijfer'], ['hw', 'Huiswerk'], ['rooster', 'Rooster']].map(([k, l]) => `<button class="${k === d.ntype ? 'on' : ''}" data-dn="${k}">${l}</button>`).join('')}</div>
      <div class="seg" style="margin-top:8px">${[[0, 'Nu'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [300, '5 min']].map(([k, l]) => `<button class="${k === d.delay ? 'on' : ''}" data-dd="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px;justify-content:flex-start"><button class="btn" data-a="devnotify">Plan melding</button></div>
      <div class="small" data-devcount style="margin-top:8px;color:var(--accent);font-weight:700">${left != null ? (left > 0 ? `Melding over ${left} s… (je mag de app op de achtergrond zetten)` : '✓ Melding verstuurd') : ''}</div>
      <label class="lbl" style="display:block;margin-top:14px">Nieuwe aantekening</label>
      <div class="small muted" style="margin-top:6px">Zet een testaantekening bij Absentie (vandaag, bij het gekozen vak hierboven), met het label NIEUW, en telt hem mee in de totalen. Niet opgeslagen: weg zodra je de app sluit.</div>
      <div class="seg wrap" style="margin-top:8px">${ABS_SOORT.map(k => `<button class="${(d.absSoort || ABS_SOORT[0]) === k ? 'on' : ''}" data-das="${k}">${k}</button>`).join('')}</div>
      ${(d.absSoort || ABS_SOORT[0]) === 'Te laat' ? `<div class="seg" style="margin-top:8px">${[[true, 'Geoorloofd'], [false, 'Ongeoorloofd']].map(([k, l]) => `<button class="${(d.absOk === true) === k ? 'on' : ''}" data-dao="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="seg" style="margin-top:8px">${[[0, 'Nu'], [5, '5 s'], [10, '10 s'], [30, '30 s'], [60, '1 min']].map(([k, l]) => `<button class="${(d.absDelay || 0) === k ? 'on' : ''}" data-dad="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="devabs">Simuleer nieuwe aantekening</button></div>
      <div class="small" data-abscount style="margin-top:6px;color:var(--accent-text);font-weight:700"></div>
      <label class="lbl" style="display:block;margin-top:14px">Huiswerk</label>
      <div class="small muted" style="margin-top:6px">Zet testhuiswerk bij het gekozen vak hierboven (morgen), met het label NIEUW en het rode getalletje bij Huiswerk. Niet opgeslagen: weg na vernieuwen of als je de app sluit.</div>
      <div class="seg" style="margin-top:8px">${[[false, 'Huiswerk'], [true, 'Toets']].map(([k, l]) => `<button class="${!!d.hwToets === k ? 'on' : ''}" data-dht="${k}">${l}</button>`).join('')}</div>
      <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="devhw">Simuleer nieuw huiswerk</button></div>
      <label class="lbl" style="display:block;margin-top:14px">Crash</label>
      <div class="small muted" style="margin-top:6px">${IOS ? 'Stuurt meteen een testfoutmelding naar de developer.' : 'Start de app opnieuw met een testfoutmelding. Die wordt als test naar de developer gestuurd.'}</div>
      <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="devcrash">Simuleer crashmelding</button></div>
      <label class="lbl" style="display:block;margin-top:14px">Dag en tijd</label>
      <div class="small muted" style="margin-top:6px">Doe alsof het een andere dag en tijd is, om bijv. de les van nu, uitval of reminders te testen. Alleen in de app: meldingen volgen de echte tijd.</div>
      ${simOff ? `<div class="small" style="margin-top:6px;color:var(--accent-text);font-weight:700">Gesimuleerd: ${esc(niceDay(dayStart(now())))} ${pad(now().getHours())}:${pad(now().getMinutes())}</div>` : ''}
      <div class="two" style="margin-top:8px"><input class="inp" type="date" data-sim="d" value="${ymd(now())}"><input class="inp" type="time" data-sim="t" value="${pad(now().getHours())}:${pad(now().getMinutes())}"></div>
      <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="simtime">Simuleren</button>${simOff ? '<button class="btn ghost" data-a="realtime">Echte tijd</button>' : ''}</div>
      <label class="lbl" style="display:block;margin-top:14px">Canary</label>
      <div class="small muted" style="margin-top:6px">Test-versies (pre-releases op GitHub) krijgen, alleen op deze telefoon. Gewone gebruikers krijgen die niet.${appVer() && /canary|beta/.test(appVer()) ? ' Je hebt nu canary ' + esc(appVer()) + '.' : ''}</div>
      <label class="toggle-row" style="padding:8px 0"><span><b>Canary-updates</b><small>${canaryOn() ? 'aan: je krijgt ook test-versies' : 'uit: alleen gewone versies'}</small></span><input type="checkbox" data-a="canary"${canaryOn() ? ' checked' : ''}><i class="toggle"></i></label>
      <div class="row" style="margin-top:4px;justify-content:flex-start"><button class="btn" data-a="canarynow">Installeer nieuwste canary</button><button class="btn ghost" data-a="canarypick">Kies een versie (normaal/canary)…</button></div>
      <label class="lbl" style="display:block;margin-top:14px">Update</label>
      <div class="small muted" style="margin-top:6px">Toont het updatevenster met de nieuwste versie van GitHub, ook als je die al hebt (dan wordt dezelfde versie opnieuw geïnstalleerd).</div>
      <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="devupd">Simuleer update</button></div>
      <label class="lbl" style="display:block;margin-top:14px">Nieuwe gebruiker</label>
      ${ls.get('cp:simBackup', null) ? `<div class="small" style="margin-top:6px;color:var(--accent-text);font-weight:700">Simulatie actief</div>
        <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="simstop">Stoppen en alles terugzetten</button></div>`
        : `<div class="small muted" style="margin-top:6px">Doorloop de app alsof je hem net hebt gekregen: voorwaarden, icoon kiezen, Zermelo koppelen, welkom en alle cijfers openen. Je blijft ingelogd; daarna kun je alles terugzetten.</div>
        <div class="row" style="margin-top:8px;justify-content:flex-start"><button class="btn" data-a="simnew">Simuleer nieuwe gebruiker</button></div>`}
      <button class="linkbtn" data-a="devoff" style="border-bottom:0">Ontwikkelaar sluiten</button></div>`;
  }
  /* "nieuwe gebruiker": de eerste-keer-instellingen tijdelijk wissen (met een reservekopie) en de app opnieuw starten */
  const SIM_KEYS = ['cp:terms', 'cp:termsDate', 'cp:iconPicked', 'cp:themePicked', 'cp:zmAsked', 'cijferpacks:v1', 'cp:hwdone', 'cp:tabs', 'cp:tips', 'cp:tourDone', 'cp:installAsked', 'cp:batteryAsked', 'cp:refreshAsked', 'cp:firstUpd', 'cp:widgetAsked'];
  function simNewUser() {
    const backup = {};
    SIM_KEYS.forEach(k => { try { backup[k] = localStorage.getItem(k); localStorage.removeItem(k); } catch (e) {} });
    ls.set('cp:simBackup', backup);
    ls.set('cp:simNew', 1);
    location.reload();
  }
  function simStop() {
    const backup = ls.get('cp:simBackup', {}) || {};
    SIM_KEYS.forEach(k => { try { if (backup[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, backup[k]); } catch (e) {} });
    try { localStorage.removeItem('cp:simBackup'); localStorage.removeItem('cp:simNew'); } catch (e) {}
    location.reload();
  }
  function bindDev(redraw) {
    const d = S.devForm;
    const valIn = main.querySelector('[data-dev=val]');
    main.querySelector('[data-dev=afk]').onchange = e => { d.afk = e.target.value; };
    valIn.oninput = () => { d.val = valIn.value; };
    main.querySelectorAll('[data-dw]').forEach(b => { b.onclick = () => { d.w = +b.dataset.dw; redraw(); }; });
    main.querySelectorAll('[data-dt]').forEach(b => { b.onclick = () => { d.soort = b.dataset.dt; redraw(); }; });
    main.querySelectorAll('[data-dn]').forEach(b => { b.onclick = () => { d.ntype = b.dataset.dn; redraw(); }; });
    main.querySelectorAll('[data-dd]').forEach(b => { b.onclick = () => { d.delay = +b.dataset.dd; redraw(); }; });
    main.querySelector('[data-a=devadd]').onclick = () => {
      if (toNum(d.val) == null && !/^[a-z]{1,3}$/i.test(d.val.trim())) return toast('Vul een cijfer in, bijvoorbeeld 6.8');
      addDevGrade(d.afk, d.val, d.w, d.soort);
      toast('Testcijfer toegevoegd: kijk bij Cijfers');
      redraw();
    };
    main.querySelector('[data-a=devrand]').onclick = () => {
      const subs = devSubjects(), s = subs[Math.floor(Math.random() * subs.length)];
      addDevGrade(s[0], (Math.round((3 + Math.random() * 7) * 10) / 10).toFixed(1), 1 + Math.floor(Math.random() * 3), 'Schriftelijke overhoring');
      toast('Willekeurig testcijfer toegevoegd');
      redraw();
    };
    main.querySelectorAll('[data-das]').forEach(b => { b.onclick = () => { d.absSoort = b.dataset.das; redraw(); }; });
    main.querySelectorAll('[data-dao]').forEach(b => { b.onclick = () => { d.absOk = b.dataset.dao === 'true'; redraw(); }; });
    main.querySelectorAll('[data-dad]').forEach(b => { b.onclick = () => { d.absDelay = +b.dataset.dad; redraw(); }; });
    main.querySelectorAll('[data-dht]').forEach(b => { b.onclick = () => { d.hwToets = b.dataset.dht === 'true'; redraw(); }; });
    /* testhuiswerk: alleen in het geheugen, in de week van morgen, telt mee voor het rode getalletje tot je Huiswerk bekijkt */
    main.querySelector('[data-a=devhw]').onclick = () => {
      const day = dayStart(addDays(now(), 1)), mon = mondayOf(day), key = mon.getTime();
      const it = {
        id: 'dev-hw-' + Date.now(), vak: d.afk, onderwerp: d.hwToets ? 'Testtoets' : 'Testhuiswerk', date: day.getTime(),
        datum: niceDay(day), huiswerk: d.hwToets ? 'Leren: hoofdstuk 3 (test vanuit ontwikkelaar)' : 'Opdracht 1 t/m 5 maken (test vanuit ontwikkelaar)',
        toets: !!d.hwToets, uur: '', docent: '', gemaakt: false, badge: 'NIEUW', dev: true
      };
      S.hw[key] = (S.hw[key] || []).concat(it);
      S.devHwNew = (S.devHwNew || 0) + 1;
      updateNav();
      toast((d.hwToets ? 'Testtoets' : 'Testhuiswerk') + ' toegevoegd voor ' + niceDay(day).toLowerCase());
    };
    main.querySelector('[data-a=devabs]').onclick = () => {
      const soort = d.absSoort || ABS_SOORT[0], ok = d.absOk === true, afk = d.afk, delay = d.absDelay || 0;
      /* met vertraging: zet de app gerust op een ander tabblad, dan zie je het rode getalletje bij Meer verschijnen */
      if (delay) {
        const end = Date.now() + delay * 1000;
        clearInterval(S.absTick);
        S.absTick = setInterval(() => {
          const left = Math.ceil((end - Date.now()) / 1000), el = sh.querySelector('[data-abscount]');
          if (left > 0) { if (el) el.textContent = 'Aantekening over ' + left + ' s…'; return; }
          clearInterval(S.absTick);
          if (el) el.textContent = '';
          addAbs(soort, ok, afk);
        }, 250);
        return;
      }
      addAbs(soort, ok, afk);
    };
    function addAbs(soort, ok, afk) {
      S.devAbs = S.devAbs || [];
      S.devAbs.unshift({ date: dayStart(now()).getTime(), uur: String(1 + Math.floor(Math.random() * 7)), vak: afk.toUpperCase(),
        /* alleen te laat is geoorloofd of ongeoorloofd; zelfde naam als in de totalen van het portaal */
        absentie: soort === 'Te laat' ? 'Te laat, ' + (ok ? 'geoorloofd' : 'ongeoorloofd') : soort, afgehandeld: ok ? 'Ja' : 'Nee', dev: true });
      toast('Testaantekening toegevoegd bij Absentie');
      buzz(30);
      updateNav();
      if (S.tab !== 'meer' || sh.querySelector('.modal, .panel, .ov')) return;
      redraw();
      const card = main.querySelector('[data-abs]');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const dc = main.querySelector('[data-a=devcrash]');
    if (dc) dc.onclick = () => { if (Native && Native.devCrash) { Native.devCrash(); if (IOS) toast('Testfoutmelding verstuurd naar de developer'); } else toast('Testcrash (alleen in de app)'); };
    const sn = main.querySelector('[data-a=simnew]');
    if (sn) sn.onclick = simNewUser;
    const cn = main.querySelector('[data-a=canary]');
    cn.onchange = () => { ls.set('cp:canary', cn.checked); ls.set('cp:updFound', null); ls.set('cp:updCheck', 0); toast(cn.checked ? 'Canary-updates aan' : 'Canary-updates uit'); redraw(); };
    main.querySelector('[data-a=canarynow]').onclick = () => {
      if (!canaryOn()) { ls.set('cp:canary', true); redraw(); }
      ls.set('cp:updFound', null);
      toast('Zoeken naar de nieuwste canary…');
      checkUpdate(true);
    };
    main.querySelector('[data-a=canarypick]').onclick = pickRelease;
    main.querySelector('[data-a=devupd]').onclick = () => {
      if (canUpdate()) return checkUpdate(true, true);
      updSheet({ v: '9.9.9', url: '', notes: '- Voorbeeld van wat er nieuw is\n- Nog een regel', size: 580000 });
    };
    /* gesimuleerde tijd: opnieuw starten, zodat alles (rooster, nu-kaart, aftellen) met die tijd begint */
    main.querySelector('[data-a=simtime]').onclick = () => {
      const dv = main.querySelector('[data-sim=d]').value, tv = main.querySelector('[data-sim=t]').value;
      if (!dv || !tv) return toast('Kies een dag en een tijd');
      const [y, mo, dd] = dv.split('-').map(Number), [h, mi] = tv.split(':').map(Number);
      ls.set('cp:simNow', { off: new Date(y, mo - 1, dd, h, mi).getTime() - realNow() });
      location.reload();
    };
    const rt = main.querySelector('[data-a=realtime]');
    if (rt) rt.onclick = () => { try { localStorage.removeItem('cp:simNow'); } catch (e) {} location.reload(); };
    const ss = main.querySelector('[data-a=simstop]');
    if (ss) ss.onclick = simStop;
    const clr = main.querySelector('[data-a=devclear]');
    if (clr) clr.onclick = () => { S.dev = []; S.devSeen.clear(); updateNav(); redraw(); };
    main.querySelector('[data-a=devnotify]').onclick = () => {
      if (Native && Native.devNotify) Native.devNotify(d.ntype, d.delay);
      else setTimeout(() => toast('Testmelding (' + d.ntype + ')'), d.delay * 1000);
      S.devTimerEnd = Date.now() + d.delay * 1000;
      clearInterval(S.devTick);
      S.devTick = setInterval(() => {
        const el = sh.querySelector('[data-devcount]');
        const left = Math.max(0, Math.ceil((S.devTimerEnd - Date.now()) / 1000));
        if (el) el.textContent = left > 0 ? `Melding over ${left} s… (je mag de app op de achtergrond zetten)` : '✓ Melding verstuurd';
        if (left <= 0) clearInterval(S.devTick);
      }, 500);
      redraw();
    };
    main.querySelector('[data-a=devoff]').onclick = () => { S.devOn = false; redraw(); };
  }

  const SWATCHES = ['#ffd34d', '#ff4d6d', '#ff8a3d', '#3ddc97', '#4da3ff', '#b07cff', '#ffffff'];
  async function renderMore() {
    setHeader('Meer');
    const absHtml = () => {
      if (!S.abs) return `<div class="card-box"><div class="setting-h">Absentie</div><div class="muted small">Laden…</div></div>`;
      if (S.abs.error) return `<div class="card-box"><div class="setting-h">Absentie</div>${errBox(S.abs.error.message === 'login' ? 'Je bent uitgelogd.' : S.abs.error)}</div>`;
      /* weggeklikte aantekeningen niet meer tonen (de totalen blijven gewoon kloppen) */
      const hidden = ls.get('cp:absHidden', []) || [];
      const absItems = (S.devAbs || []).concat(S.abs.items).filter(i => !hidden.includes(absKey(i)));
      return `<div class="card-box" data-abs><div class="setting-h">Absentie dit schooljaar</div>
        ${absTotals().map(t => `<div class="listrow"><span class="muted">${esc(t.label)}</span><b>${esc(t.value)}</b></div>`).join('') || '<div class="muted small">Geen gegevens.</div>'}
        ${absItems.length ? `<div class="setting-h" style="margin-top:12px">Deze week</div>${absItems.map(i => `<div class="listrow"><span>${i.dev || absIsNew(i) ? '<span class="tag red">NIEUW</span> ' : ''}${i.date ? esc(niceDay(new Date(i.date))) : ''} · ${esc(i.uur)}e uur ${esc(i.vak)}</span><b${/ongeoorloofd/i.test(i.absentie) ? ' style="color:var(--red)"' : ''}>${esc(i.absentie)}</b><button class="absx" data-absx="${esc(absKey(i))}" aria-label="Wegklikken">×</button></div>`).join('')}` : ''}
      </div>`;
    };
    const toggle = (key, title, sub, on) => `<label class="toggle-row" style="padding:8px 0"><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>
      <input type="checkbox" data-n="${key}"${on ? ' checked' : ''}><i class="toggle"></i></label>`;
    /* per soort melding: geluid, trillen, stil of helemaal uit */
    const modeRow = (type, title, sub, mode) => `<div class="nrow"><b>${title}</b>${sub ? `<div class="small muted">${sub}</div>` : ''}
      <div class="modes">${[['geluid', 'Geluid'], ...(IOS ? [] : [['trillen', 'Trillen']]), ['stil', 'Stil'], ['uit', 'Uit']].map(([k, l]) => `<button class="${(IOS && mode === 'trillen' ? 'geluid' : mode) === k ? 'on' : ''}" data-mode="${type}:${k}">${l}</button>`).join('')}</div></div>`;
    const draw = () => {
      let ns = null;
      try { ns = Native && Native.getSettings ? JSON.parse(Native.getSettings()) : null; } catch (e) {}
      const own = ownRem.upcoming();
      main.innerHTML = `<div class="pad">
        ${S.grades && S.grades.student ? `<div class="muted small">Ingelogd als ${esc(S.grades.student)}</div>` : ''}
        ${calcCard()}
        ${absHtml()}
        <div class="card-box"><div class="setting-h">Reminders</div>
          ${own.map(r => `<button class="setrow" data-own="${esc(r.id)}"><span class="sr-t"><b>${esc(r.text)}</b><small>${esc(ownRemLabel(r))}</small></span><span class="go">›</span></button>`).join('')}
          ${own.length && ns && !ns.exact && Native.openExactSettings ? `<button class="setrow" data-a="exact"><span class="sr-t"><b>Precies op tijd</b><small>Zet "Wekkers en herinneringen" aan, anders kan een reminder een paar minuten later komen</small></span><span class="go">›</span></button>` : ''}
          <button class="linkbtn" data-a="ownadd" style="border-bottom:0;padding-bottom:0">+ Zet reminder</button>
        </div>
        ${ns ? `<div class="card-box"><div class="setting-h">Meldingen</div>
          ${ns.allowed ? '' : `<div class="err" style="margin-bottom:8px">${IOS ? 'Meldingen staan uit voor W.S.P. Zet ze aan bij Instellingen → W.S.P → Berichtgeving.' : 'Meldingen staan uit in de Android-instellingen voor deze app.'}</div>`}
          <button class="setrow" data-a="remind"><span class="sr-t"><b>Herinneringen instellen</b><small>Standaard: ${esc(ruleLabel(hwRules.def))}</small></span><span class="go">›</span></button>
          ${modeRow('hw', 'Huiswerk', 'Nieuw huiswerk en nieuwe aantekeningen', ns.n_hw_mode)}
          ${modeRow('rooster', 'Rooster', zm ? 'Uitval en lokaalwijzigingen (Zermelo)' : 'Koppel Zermelo voor betrouwbare uitval', ns.n_rooster_mode)}
          ${modeRow('remind', 'Huiswerkherinneringen', 'Een seintje voordat iets af moet zijn', ns.n_remind_mode || 'geluid')}
          ${modeRow('own', 'Eigen reminders', 'Reminders die je zelf zet bij Meer', ns.n_own_mode || 'geluid')}
          ${modeRow('grades', 'Nieuwe cijfers', '', ns.n_grades_mode)}
          ${toggle('n_showgrade', 'Cijfer laten zien in melding', 'Uit: alleen het vak, het cijfer zie je bij het unboxen', ns.n_showgrade)}
          ${Native && Native.openNotifSettings ? `<button class="setrow" data-a="nsys" style="padding-top:10px;border-bottom:0"><span class="sr-t"><b>Melding op je scherm laten zien</b><small>${IOS ? 'In Instellingen → W.S.P → Berichtgeving: zet Toegangsscherm en Banners aan' : 'Xiaomi/Redmi: zet "Zwevende meldingen" en "Vergrendelscherm" aan voor W.S.P'}</small></span><span class="go">›</span></button>` : ''}
        </div>` : ''}
        <div class="card-box"><div class="setting-h">Zermelo</div>
          ${zm ? `<div class="listrow"><span class="muted">Gekoppeld met</span><b>${esc(zm.school)}${zm.sso ? ' · schoolaccount' : ''}</b></div><button class="linkbtn red" data-a="zmoff" style="border-bottom:0">Ontkoppelen</button>`
            : `<p class="small muted">Koppel Zermelo voor je actuele rooster met uitval.</p><button class="linkbtn" data-a="zmon" style="border-bottom:0">Zermelo koppelen ›</button>`}
        </div>
        ${zm || DEMO ? `<div class="card-box"><div class="setting-h">Rooster van iemand anders</div>
          <p class="small muted">Typ het leerlingnummer. Werkt alleen als je school dat in Zermelo toestaat.</p>
          <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input class="inp" id="zm-find" inputmode="numeric" placeholder="Bijv. 123456" autocomplete="off" style="flex:1"><button class="btn" data-a="zmfind">Zoek</button></div>
          <div data-zmfound></div></div>` : ''}
        <div class="card-box"><div class="setting-h">Instellingen</div>
          <button class="setrow" data-a="themes"><span class="sr-pic" style="--pic:linear-gradient(135deg, ${theme === 'light' ? '#f3f1ec' : '#0d0c0a'} 50%, ${accent} 50%)"></span>
            <span class="sr-t"><b>Thema</b><small>${theme === 'light' ? 'Wit' : 'Zwart'} met accentkleur · app-icoon</small></span><span class="go">›</span></button>
          <button class="setrow" data-a="widget" style="padding-top:12px"><span class="sr-t"><b>Zien wat je hierna hebt</b><small>Widget op je ${IOS ? 'beginscherm' : 'startscherm'} met je volgende les, lokaal en uitval</small></span><span class="go">›</span></button>
          ${ns && ns.n_mob_r_mode ? `<button class="setrow" data-a="data" style="padding-top:12px"><span class="sr-t"><b>Datagebruik</b><small>Hoe vaak de app kijkt op wifi en op 4G/5G, met een schatting</small></span><span class="go">›</span></button>` : ''}
          <button class="setrow" data-a="tabs" style="padding-top:12px"><span class="sr-t"><b>Tabbalk</b><small>${visibleTabs().map(k => TABS.find(t => t.k === k).label).join(' · ')}</small></span><span class="go">›</span></button>
          ${IOS ? `<button class="setrow" data-a="sidestore" style="padding-top:12px"><span class="sr-t"><b>Automatisch vernieuwen</b><small>${expiryText()}</small></span><span class="go">›</span></button>` : ''}
          <div class="setting-h" style="margin:16px 0 10px;font-size:15px">Geluid bij cijfers</div>
          <div class="seg">${[[true, 'Aan'], [false, 'Uit']].map(([k, l]) => `<button class="${soundOn === k ? 'on' : ''}" data-snd2="${k}">${l}</button>`).join('')}</div>
          ${soundOn ? `<div class="vol"><span aria-hidden="true">🔈</span><input type="range" min="0.05" max="1" step="0.05" value="${volume}" id="snd-vol" aria-label="Volume"><b id="snd-vol-v">${Math.round(volume * 100)}%</b></div>
          <div class="row" style="margin-top:8px"><button class="btn ghost" data-try="happy">▶ Voldoende</button><button class="btn ghost" data-try="sad">▶ Bo-womp</button></div>` : ''}
          <p class="small muted" style="margin-top:8px">Onder een 5,5 een "bo-womp", vanaf 5,5 een vrolijk geluidje.</p>
        </div>
        <div class="card-box">
          <button class="linkbtn" data-a="reset">Alle cijfers opnieuw unboxen</button>
          <button class="linkbtn" data-a="tipsreset">Rondleiding opnieuw doen</button>
          <button class="linkbtn" data-a="portal">Portaal openen in browser</button>
          <button class="linkbtn red" data-a="logout">Uitloggen</button>
        </div>
        <div class="card-box"><div class="setting-h">Over W.S.P</div>
          <div class="logos"><img src="${ASSET('mark.png')}" alt="W.S.P"><img src="${ASSET('zermelo.svg')}" alt="Zermelo"></div>
          <p class="small muted" style="margin-top:10px">W.S.P is een onofficiële app. Hij is niet gemaakt door of namens je school of Zermelo. Gegevens komen van het leerlingportaal en Zermelo, met jouw eigen inlog.</p>
          ${canUpdate() ? `<button class="linkbtn" data-a="upd">Zoek naar updates <span class="muted" style="font-weight:500">· je hebt versie ${esc(appVer())}</span></button>` : ''}
          <button class="linkbtn" data-a="terms" style="border-bottom:0;padding-bottom:0">Voorwaarden en privacy bekijken</button>
        </div>
        ${S.devOn ? devCard() : '<button class="linkbtn" data-a="dev" style="text-align:center;color:var(--muted);font-size:13px">Ontwikkelaar</button>'}
      </div>`;
      main.querySelectorAll('[data-n]').forEach(c => { c.onchange = () => { Native.setSetting(c.dataset.n, String(c.checked)); }; });
      main.querySelectorAll('[data-mode]').forEach(b => {
        b.onclick = () => { const [type, mode] = b.dataset.mode.split(':'); Native.setSetting('n_' + type + '_mode', mode); draw(); };
      });
      bindCalc(main);
      const dv = main.querySelector('[data-a=dev]');
      if (dv) dv.onclick = () => devUnlock(draw);
      if (S.devOn) bindDev(draw);
      main.querySelector('[data-a=themes]').onclick = () => openThemes(draw);
      main.querySelector('[data-a=tabs]').onclick = () => openTabs(draw);
      const ss = main.querySelector('[data-a=sidestore]');
      if (ss) ss.onclick = sideStoreSheet;
      const db = main.querySelector('[data-a=data]');
      if (db) db.onclick = () => openData(draw);
      const wb = main.querySelector('[data-a=widget]');
      if (wb) wb.onclick = widgetSheet;
      /* aantekening wegklikken: schuift weg en komt niet meer terug */
      main.querySelectorAll('[data-absx]').forEach(b => {
        b.onclick = () => {
          const k = b.dataset.absx;
          S.devAbs = (S.devAbs || []).filter(i => absKey(i) !== k);
          const hidden = ls.get('cp:absHidden', []) || [];
          if (!hidden.includes(k)) hidden.push(k);
          ls.set('cp:absHidden', hidden.slice(-300));
          const row = b.closest('.listrow');
          row.classList.add('gone-out');
          buzz(10);
          setTimeout(() => { updateNav(); draw(); }, 220);
        };
      });
      const nsys = main.querySelector('[data-a=nsys]');
      if (nsys) nsys.onclick = () => Native.openNotifSettings();
      const rb = main.querySelector('[data-a=remind]');
      if (rb) rb.onclick = () => openReminders(draw);
      tipWhenSeen(main.querySelector('[data-calcbox]'), 'calc');
      tipWhenSeen(main.querySelector('[data-a=ownadd]').closest('.card-box'), 'ownrem');
      tipWhenSeen(main.querySelector('[data-mode]') && main.querySelector('[data-mode]').closest('.card-box'), 'meldingen');
      main.querySelector('[data-a=ownadd]').onclick = () => ownRemSheet(null, r => { ownRem.set(ownRem.get().concat(r)); buzz(10); toast('Reminder gezet: ' + ownRemLabel(r)); draw(); });
      main.querySelectorAll('[data-own]').forEach(b => {
        b.onclick = () => ownRemSheet(own.find(r => r.id === b.dataset.own), r => {
          const all = ownRem.get();
          ownRem.set(r ? all.map(x => x.id === r.id ? r : x) : all.filter(x => x.id !== b.dataset.own));
          if (!r) toast('Reminder verwijderd');
          draw();
        });
      });
      const ex = main.querySelector('[data-a=exact]');
      if (ex) ex.onclick = () => Native.openExactSettings();
      main.querySelector('[data-a=terms]').onclick = () => showTerms(true);
      const ub = main.querySelector('[data-a=upd]');
      if (ub) ub.onclick = () => { toast('Zoeken naar updates…'); checkUpdate(true); };
      /* de rondleiding opnieuw doen, en de losse uitlegblokjes weer laten zien */
      main.querySelector('[data-a=tipsreset]').onclick = () => { try { localStorage.removeItem('cp:tips'); } catch (e) {} startTour(); };
      main.querySelectorAll('[data-snd2]').forEach(b => {
        b.onclick = () => { soundOn = b.dataset.snd2 === 'true'; ls.set('cp:sound', soundOn); if (soundOn) playHappy(); draw(); };
      });
      const vol = main.querySelector('#snd-vol');
      if (vol) {
        vol.oninput = () => { volume = +vol.value; ls.set('cp:vol', volume); if (master) master.gain.value = volume; main.querySelector('#snd-vol-v').textContent = Math.round(volume * 100) + '%'; };
        vol.onchange = () => SND.tick();
      }
      main.querySelectorAll('[data-try]').forEach(b => { b.onclick = () => SND[b.dataset.try](); });
      const zf = main.querySelector('[data-a=zmfind]');
      if (zf) {
        const inp = main.querySelector('#zm-find'), out = main.querySelector('[data-zmfound]');
        /* alleen op leerlingnummer (niet op naam) */
        const search = () => {
          const q = inp.value.trim();
          if (!q) return;
          if (!/^\d{3,}$/.test(q)) { out.innerHTML = '<p class="small" style="margin-top:8px;color:var(--red)">Typ een leerlingnummer (alleen cijfers).</p>'; return; }
          out.innerHTML = '';
          otherRooster(q, 'Leerling ' + q);
        };
        zf.onclick = search;
        inp.onkeydown = e => { if (e.key === 'Enter') search(); };
      }
      const zon = main.querySelector('[data-a=zmon]');
      if (zon) zon.onclick = zermeloSheet;
      const zoff = main.querySelector('[data-a=zmoff]');
      if (zoff) zoff.onclick = () => { zermeloUnlink(); S.rooster = {}; S.fresh = {}; try { localStorage.removeItem('cp:wk:r'); } catch (e) {} draw(); };
      main.querySelector('[data-a=reset]').onclick = () => {
        store = { init: true, seen: {} };
        saveStore();
        S.packList = null;
        S.packBusy = false;
        go('cijfers');
      };
      main.querySelector('[data-a=portal]').onclick = () => { if (Native) Native.open(location.origin + P_CIJFERS); };
      main.querySelector('[data-a=logout]').onclick = () => {
        /* een andere leerling heeft ander rooster en andere cijfers: alles van deze leerling weg, ook Zermelo.
           Thema, icoon en geluid blijven staan (die horen bij de telefoon) */
        zermeloUnlink();
        stashAccount();
        ['cp:cache:grades', 'cijferpacks:v1', 'cp:hwdone', 'cp:hwrules', 'cp:hwseen', 'cp:docenten', 'cp:roosterKey', 'cp:zmurl2', 'cp:calcTarget', 'cp:zmAsked', 'cp:abs', 'cp:wk:r', 'cp:wk:hw', 'cp:absSeen', 'cp:absHidden', 'cp:tourDone', 'cp:klas', 'cp:ownHw']
          .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
        ls.set('cp:cache:grades', null);
        if (Native) Native.logout(); else location.href = '/?logout=true';
      };
    };
    draw();
    if (!S.abs) {
      /* laatst bekende absentie meteen tonen, intussen verversen */
      const cached = ls.get('cp:abs', null);
      if (cached) { S.abs = cached; if (S.tab === 'meer') draw(); }
      await loadAbsenceBg();
    }
    /* je hebt de absentie gezien: het getalletje bij Meer verdwijnt (het label NIEUW blijft tot je weer terugkomt) */
    clearTimeout(S.absSeenT);
    S.absSeenT = setTimeout(() => { if (S.tab === 'meer') absMarkSeen(); }, 1500);
  }

  /* ---------- terugknop (Android) ---------- */
  window.__cpBack = function () {
    const tm = sh.querySelector('.terms');
    if (tm) { if (ls.get('cp:terms', 0) === TERMS_VERSION) { tm.remove(); return true; } return false; }
    const pn = sh.querySelector('.panel');
    if (pn && !sh.querySelector('.modal')) { pn.closePanel(); return true; }
    const ov = sh.querySelector('.ov');
    if (ov) { const nx = ov.querySelector('.ub-next:not([hidden])'); if (nx) nx.click(); return true; }
    const m = sh.querySelector('.modal');
    if (m) { m.remove(); return true; }
    if (S.tab !== 'rooster') { go('rooster'); return true; }
    return false;
  };

  /* vegen: naar rechts = terug, naar links = verder (rooster: week of dag, huiswerk: week, cijfers: periode) */
  /* de inhoud volgt je vinger; bij loslaten schuift hij weg en komt de volgende week/dag van de andere kant binnen */
  let swipe = null;
  const SWIPE_TABS = ['rooster', 'huiswerk', 'cijfers'];
  /* periodes bij Cijfers (zonder voorbij de eerste of laatste te gaan); rooster en huiswerk kunnen altijd verder */
  const nextPeriod = dir => { const ps = S.grades ? S.grades.periods : []; const i = ps.indexOf(S.ovPeriod) + dir; return i >= 0 && i < ps.length ? ps[i] : null; };
  const canSwipe = dir => S.tab !== 'cijfers' || !!nextPeriod(dir);
  /* alleen de lessen of het huiswerk schuift mee; de rest blijft staan en de datum vervaagt naar de nieuwe */
  const page = () => main.querySelector('.swipe-area') || main.firstElementChild;
  const dateLbl = () => main.querySelector('.weeknav .lbl');
  /* naar beneden trekken (bovenaan de pagina) = vernieuwen, met een rondje dat meekomt */
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.innerHTML = ICONS.refresh;
  app.appendChild(ptr);
  let pull = null;
  main.addEventListener('touchstart', e => {
    pull = main.scrollTop <= 0 && e.touches.length === 1 && !sh.querySelector('.modal, .panel, .ov, .tour') ? { y: e.touches[0].clientY, x: e.touches[0].clientX, d: 0 } : null;
  }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (!pull) return;
    const dy = e.touches[0].clientY - pull.y, dx = e.touches[0].clientX - pull.x;
    if (pull.d === 0 && Math.abs(dx) > Math.abs(dy)) { pull = null; return; } /* zijwaarts vegen is voor de weken */
    pull.d = Math.max(0, Math.min(110, dy * 0.5));
    ptr.style.transition = 'none';
    ptr.style.transform = `translate(-50%, ${pull.d - 50}px) rotate(${pull.d * 3}deg)`;
    ptr.style.opacity = Math.min(1, pull.d / 50);
    ptr.classList.toggle('ready', pull.d > 60);
  }, { passive: true });
  main.addEventListener('touchend', () => {
    if (!pull) return;
    const go = pull.d > 60;
    pull = null;
    ptr.style.transition = '';
    ptr.classList.remove('ready');
    if (go) {
      ptr.classList.add('spin');
      ptr.style.transform = 'translate(-50%, 18px)';
      buzz(10);
      refreshCurrent(true);
      setTimeout(() => { ptr.classList.remove('spin'); ptr.style.transform = ''; ptr.style.opacity = ''; }, 1200);
    } else { ptr.style.transform = ''; ptr.style.opacity = ''; }
  });
  main.addEventListener('touchstart', e => {
    if (!SWIPE_TABS.includes(S.tab) || e.touches.length !== 1 || e.target.closest('.seg') || sh.querySelector('.modal, .panel, .ov')) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  }, { passive: true });
  main.addEventListener('touchmove', e => {
    if (!swipe) return;
    const dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
    if (!swipe.axis && Math.hypot(dx, dy) > 10) swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (swipe.axis !== 'x' || !page()) return;
    /* bij Cijfers voorbij de eerste of laatste periode: veert terug */
    const k = canSwipe(dx < 0 ? 1 : -1) ? 0.9 : 0.25;
    page().style.transition = 'none';
    page().style.transform = `translateX(${dx * k}px)`;
    page().style.opacity = String(1 - Math.min(Math.abs(dx) / main.clientWidth, 1) * 0.5);
    swipe.week = weekChanges(dx < 0 ? 1 : -1);
    const lb = dateLbl();
    if (lb) { lb.style.transition = 'none'; lb.style.opacity = swipe.week ? String(1 - Math.min(Math.abs(dx) / main.clientWidth, 1) * 0.7) : ''; }
  }, { passive: true });
  const settle = el => { if (!el) return; el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s'; el.style.transform = ''; el.style.opacity = ''; };
  main.addEventListener('touchend', e => {
    if (!swipe || !SWIPE_TABS.includes(S.tab)) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, axis = swipe.axis;
    swipe = null;
    if (axis !== 'x') return;
    if (Math.abs(dx) < 70 || !canSwipe(dx < 0 ? 1 : -1)) { settle(page()); const lb = dateLbl(); if (lb) { lb.style.transition = 'opacity .2s'; lb.style.opacity = ''; } return; }
    const dir = dx < 0 ? 1 : -1;
    const out = page();
    if (out) {
      out.style.transition = 'transform .16s ease-in, opacity .16s';
      out.style.transform = `translateX(${-dir * 100}%)`;
      out.style.opacity = '0';
    }
    const lb = dateLbl(), week = weekChanges(dir);
    if (lb && week) { lb.style.transition = 'opacity .15s'; lb.style.opacity = '0'; }
    setTimeout(() => swipeTo(dir, week), 150);
  }, { passive: true });
  /* gaat deze veeg naar een andere week? (dan vervaagt de datum bovenaan) */
  function weekChanges(dir) {
    if (S.tab === 'cijfers') return false;
    if (S.tab === 'huiswerk') return true;
    const days = S.rooster[S.rMonday.getTime()];
    if (S.rView === 'week' || !days || !days.length) return true;
    const i = days.findIndex(d => d.date === S.rDay) + dir;
    return i < 0 || i >= days.length;
  }
  function swipeTo(dir, week) {
    if (S.tab === 'cijfers') {
      const np = nextPeriod(dir);
      if (np) { S.ovPeriod = np; buzz(10); renderGrades(); slideIn(dir, false); }
      return;
    }
    if (S.tab === 'huiswerk') {
      S.hwMonday = addDays(S.hwMonday, 7 * dir);
      buzz(10);
      renderHomework();
      slideIn(dir, true);
      return;
    }
    const days = S.rooster[S.rMonday.getTime()];
    if (S.rView === 'week' || !days || !days.length) {
      S.rMonday = addDays(S.rMonday, 7 * dir);
      S.rDay = null;
    } else {
      const i = days.findIndex(d => d.date === S.rDay) + dir;
      if (i >= 0 && i < days.length) S.rDay = days[i].date;
      else {
        /* voorbij vrijdag of voor maandag: naar de volgende of vorige week */
        S.rMonday = addDays(S.rMonday, 7 * dir);
        S.rDay = dir > 0 ? S.rMonday.getTime() : addDays(S.rMonday, 4).getTime();
      }
    }
    buzz(10);
    renderRooster();
    slideIn(dir, week);
  }
  /* nieuwe inhoud komt van de andere kant binnen */
  function slideIn(dir, week) {
    const lb = dateLbl();
    if (lb && week) { lb.style.transition = 'none'; lb.style.opacity = '0'; void lb.offsetWidth; lb.style.transition = 'opacity .28s ease-out'; lb.style.opacity = ''; }
    const inEl = page();
    if (inEl) {
      inEl.style.transition = 'none';
      inEl.style.transform = `translateX(${dir * 40}%)`;
      inEl.style.opacity = '0';
      void inEl.offsetWidth;
      settle(inEl);
    }
  }

  /* altijd het rooster van vandaag: bij openen, terugkomen in de app en als het middernacht wordt */
  S.dayKey = dayStart(now()).getTime();
  function goToday() {
    S.dayKey = dayStart(now()).getTime();
    S.rMonday = defaultMonday();
    S.hwMonday = defaultMonday();
    S.rDay = null;
  }
  function checkDay(rerender) {
    if (dayStart(now()).getTime() === S.dayKey) return false;
    goToday();
    if (rerender && (S.tab === 'rooster' || S.tab === 'huiswerk') && !sh.querySelector('.modal, .ov')) render();
    return true;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!checkDay(true) && S.tab === 'rooster') { delete S.rooster[S.rMonday.getTime()]; if (!sh.querySelector('.modal, .ov')) renderRooster(); }
  });
  setInterval(() => {
    if (document.hidden || checkDay(true)) return; /* niet in beeld: niks doen (batterij) */
    /* elke minuut de les van nu bijwerken */
    if (S.tab === 'rooster' && S.rooster[S.rMonday.getTime()] && !sh.querySelector('.modal, .ov')) renderRooster();
  }, 60000);

  window.__cpApp = { refresh: () => refreshGrades(true), go: t => { if (t === 'packs' || TABS.some(x => x.k === t)) go(t); }, today: () => { goToday(); render(); },
    subjects: () => (S.grades ? S.grades.subjects : []), docVak: code => docenten && docenten.vakken[code] };
  /* docentenlijst op de achtergrond verversen; daarna kloppen namen in rooster en huiswerk */
  /* docenten pas na het opstarten ophalen, en alleen opnieuw tekenen als er echt een nieuwe lijst binnenkwam */
  setTimeout(() => { const before = docenten; loadDocenten().then(d => { if (d !== before && (S.tab === 'rooster' || S.tab === 'huiswerk') && !sh.querySelector('.modal, .panel, .ov')) render(); }).catch(() => {}); }, 3000);
  S.tab = visibleTabs()[0];
  if (window.__cpStartTab) { S.tab = window.__cpStartTab === 'packs' ? 'cijfers' : window.__cpStartTab; window.__cpStartTab = null; }
  render();
  /* cijfers staan al klaar uit het geheugen; opnieuw ophalen kan even wachten, zodat het rooster eerst het netwerk krijgt */
  if (S.tab === 'cijfers' || !S.grades) refreshGrades(); else setTimeout(refreshGrades, 1500);
  /* voor het getalletje bij Meer; data sparen: hooguit eens per half uur opnieuw (bij Meer → vernieuwen altijd) */
  setTimeout(() => {
    if (S.abs) return;
    const cached = ls.get('cp:abs', null);
    if (cached && Date.now() - (ls.get('cp:absT', 0) || 0) < 30 * 60000) { S.abs = cached; updateNav(); }
    else loadAbsenceBg();
  }, 2500);
  /* huiswerk van deze week op de achtergrond, voor het getalletje bij Huiswerk (op 4G/5G alleen als huiswerk daar mag) */
  setTimeout(() => {
    const key = S.hwMonday.getTime();
    if (S.tab === 'huiswerk' || S.fresh['hw' + key]) return;
    try {
      if (Native && Native.onMobile && Native.onMobile()) {
        if ((JSON.parse(Native.getSettings()).n_mob_h_mode || DATA_DEF.h) === 'off') return;
      }
    } catch (e) {}
    refreshWeek('hw', key, S.hwMonday).then(updateNav);
  }, 3500);
  saveRules();
  if (curIcon() === 'glas') setIcon('zwartkaal'); /* het glas-icoon bestaat niet meer */
  /* allereerste keer openen: eerst kijken of er al een nieuwere versie is (een doorgestuurde APK kan oud zijn) */
  if (!ls.get('cp:terms', 0) && !ls.get('cp:firstUpd', 0)) firstUpdate(() => showTerms(false));
  else if (ls.get('cp:terms', 0) !== TERMS_VERSION) showTerms(false);
  else firstRun();
  maybeTour(); /* wacht zelf tot voorwaarden, thema, icoon en Zermelo klaar zijn en de cijfers er zijn */
})();
