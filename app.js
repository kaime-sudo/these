/* =====================================================================
   APP DE THÈSE : interface
   ===================================================================== */
'use strict';

/* ---------- Base de données (IndexedDB) ---------- */
const DB = {
  conn: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('TheseDB', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('sessions', { keyPath: 'id' });
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => { DB.conn = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const q = fn(DB.conn.transaction(store, mode).objectStore(store));
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  },
  all: () => DB.req('sessions', 'readonly', (o) => o.getAll()),
  put: (v) => DB.req('sessions', 'readwrite', (o) => o.put(v)),
  del: (k) => DB.req('sessions', 'readwrite', (o) => o.delete(k)),
  getMeta: (k) => DB.req('meta', 'readonly', (o) => o.get(k)),
  setMeta: (k, v) => DB.req('meta', 'readwrite', (o) => o.put(v, k)),
  /* Tout ou rien. */
  batch(fn) {
    return new Promise((res, rej) => {
      const t = DB.conn.transaction(['sessions', 'meta'], 'readwrite');
      fn((n) => t.objectStore(n));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
};

/* ---------- État ---------- */
const VIEWS = { aujourdhui: "Aujourd'hui", plan: 'Plan', seances: 'Séances', bilan: 'Bilan', reglages: 'Réglages' };
const DEFAULT_SETTINGS = { name: '', director: '', blockMin: 25, limit: '16:00', weeklyHours: 6, rates: { ...DEFAULT_RATES } };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const defaultPlan = () => ({
  deadline: '2027-01-01',
  chapters: [
    { id: uid(), title: 'Avant-dernier chapitre', target: 30, draftBase: 0, revBase: 0, sections: [] },
    { id: uid(), title: 'Dernier chapitre', target: 30, draftBase: 0, revBase: 0, sections: [] },
  ],
});
const state = {
  plan: null, sessions: [], settings: { ...DEFAULT_SETTINGS }, next: null, lastReport: null,
  view: 'aujourdhui', report: { period: '7', blockers: '', estimate: true, hours: false },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => isoDate(new Date());
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtWeekday = (s) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(s));
const parseNum = (v) => { const n = Number(String(v).trim().replace(',', '.')); return String(v).trim() === '' ? null : n; };
const hoursTxt = (h) => (Number.isFinite(h) ? fmtHours(h * 60) : 'plus que le temps restant');
const chapter = (id) => state.plan.chapters.find((c) => c.id === id);
function taskParts(key) {
  const [cid, sid] = String(key || '').split('/');
  const ch = chapter(cid);
  return { ch, sec: ch && sid ? ch.sections.find((s) => s.id === sid) : null };
}
function taskLabel(key) {
  const { ch, sec } = taskParts(key);
  if (!ch) return 'Tâche supprimée';
  return sec ? `${ch.title} : ${sec.title}` : `${ch.title} (chapitre entier)`;
}
const sessionTask = (s) => (s.sectionId ? `${s.chapterId}/${s.sectionId}` : s.chapterId);
function taskOptions(selected) {
  return state.plan.chapters.map((ch) => `<optgroup label="${esc(ch.title)}">
    ${ch.sections.map((s) => `<option value="${esc(`${ch.id}/${s.id}`)}" ${selected === `${ch.id}/${s.id}` ? 'selected' : ''}>${esc(s.title)}${s.status === 'done' ? ' (terminée)' : ''}</option>`).join('')}
    <option value="${esc(ch.id)}" ${selected === ch.id ? 'selected' : ''}>${esc(ch.title)} (chapitre entier)</option></optgroup>`).join('');
}
/* Première section pas encore terminée : la suite logique. */
function firstOpenTask() {
  for (const ch of state.plan.chapters) {
    const s = ch.sections.find((x) => x.status !== 'done');
    if (s) return `${ch.id}/${s.id}`;
  }
  return state.plan.chapters[0]?.id || '';
}
const modeSeg = (name, value) => `<div class="seg">${Object.entries(MODES).map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
const applyBars = (root) => {
  $$('[data-w]', root).forEach((el) => { el.style.width = `${Math.max(0, Math.min(100, +el.dataset.w))}%`; });
  $$('[data-h]', root).forEach((el) => { el.style.height = `${Math.max(0, Math.min(100, +el.dataset.h))}%`; });
};
const proj = () => projection(state.plan, state.sessions, today(), state.settings);

async function load() {
  state.sessions = await DB.all();
  state.plan = await DB.getMeta('plan');
  if (!state.plan) { state.plan = defaultPlan(); await DB.setMeta('plan', state.plan); }
  const s = (await DB.getMeta('settings')) || {};
  state.settings = { ...DEFAULT_SETTINGS, ...s, rates: { ...DEFAULT_RATES, ...(s.rates || {}) } };
  state.next = (await DB.getMeta('next')) || null;
  state.lastReport = (await DB.getMeta('lastReport')) || null;
}
const savePlan = () => DB.setMeta('plan', state.plan);
const saveSettings = () => DB.setMeta('settings', state.settings);

/* ---------- Message temporaire ---------- */
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  const host = $('#sheet').open ? $('#sheet') : document.body;
  if (el.parentElement !== host) host.append(el);
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) $('button', el).onclick = () => { el.classList.remove('show'); action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action?.sticky ? 60000 : action ? 8000 : 4000);
}

/* ---------- Fenêtre modale ---------- */
function openSheet(title, body, foot, onMount) {
  const d = $('#sheet');
  if ($('#toast', d)) document.body.append($('#toast', d));
  d.innerHTML = `<form class="sheet-form" novalidate>
    <div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fermer">×</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</form>`;
  $('form', d).addEventListener('submit', (e) => e.preventDefault());
  if (!d.open) { d.showModal(); history.pushState({ sheet: true }, ''); }
  onMount?.(d, $('form', d));
}
function closeSheet() {
  const d = $('#sheet');
  if (!d.open) return;
  d.close();
  if (history.state?.sheet) history.back();
}
$('#sheet').addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
window.addEventListener('popstate', () => { if ($('#sheet').open) $('#sheet').close(); });

/* =====================================================================
   CHRONO DE SÉANCE : blocs de concentration liés à UNE tâche choisie
   Calculé sur l'heure réelle, il survit à un rechargement de la page.
   ===================================================================== */
const TKEY = 'these-seance';
let T = null;
const saveT = () => { try { if (T) localStorage.setItem(TKEY, JSON.stringify(T)); else localStorage.removeItem(TKEY); } catch { /* facultatif */ } };
try { T = JSON.parse(localStorage.getItem(TKEY)); } catch { T = null; }
const elapsed = () => (T ? T.focusMs + (T.runStart ? Date.now() - T.runStart : 0) : 0);
const remaining = () => T.blockMs - (elapsed() - T.blockStartFocus);
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

let audio;
const unlockAudio = () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* sans son */ } };
function chime() {
  try {
    const t0 = audio.currentTime + 0.02;
    [[659, 0], [784, 0.25], [988, 0.5], [659, 1.2], [784, 1.45], [988, 1.7]].forEach(([f, s]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + s);
      g.gain.exponentialRampToValueAtTime(0.8, t0 + s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + 0.6);
      o.connect(g); g.connect(audio.destination);
      o.start(t0 + s); o.stop(t0 + s + 0.65);
    });
  } catch { /* sans son */ }
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body, tag: 'these-bloc', renotify: true, icon: 'icons/icon-192.png' };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* refusée */ }
}

function startSession(task, mode) {
  unlockAudio();
  const now = Date.now();
  T = { task, mode, blockMs: state.settings.blockMin * 60000, focusMs: 0, runStart: now, blockStartFocus: 0, startedAt: now };
  saveT(); render();
}
function pauseSession() { T.focusMs = elapsed(); T.runStart = 0; saveT(); render(); }
function resumeSession() { unlockAudio(); T.runStart = Date.now(); saveT(); render(); }
function nextBlock() { T.blockStartFocus = elapsed(); T.runStart = Date.now(); saveT(); closeSheet(); render(); }
function blockEnded() {
  T.focusMs = T.blockStartFocus + T.blockMs;
  T.runStart = 0;
  saveT();
  chime();
  if (document.hidden) notify('Bloc terminé', `${taskLabel(T.task)} : ${fmtHours(elapsed() / 60000)} de travail.`);
  render();
  openSheet('Bloc terminé', `<p>${esc(fmtHours(elapsed() / 60000))} de travail sur : <b>${esc(taskLabel(T.task))}</b>.</p>
    <p class="muted">Lève-toi deux minutes, puis continue si tu peux.</p>`,
  `<button type="button" class="btn" id="b-stop">Terminer et noter</button><button type="button" class="btn primary" id="b-more">Continuer ${state.settings.blockMin} min</button>`, (d) => {
    $('#b-more', d).onclick = nextBlock;
    $('#b-stop', d).onclick = () => finishSession();
  });
}
function finishSession() {
  if (T.runStart) { T.focusMs = elapsed(); T.runStart = 0; saveT(); }
  const st = new Date(T.startedAt);
  openLogForm({ task: T.task, mode: T.mode, date: isoDate(st), time: `${pad(st.getHours())}:${pad(st.getMinutes())}`, minutes: Math.max(1, Math.round(elapsed() / 60000)), fromTimer: true });
}
function abandonSession() {
  openSheet('Abandonner la séance ?', `<p>Les ${esc(fmtHours(elapsed() / 60000))} en cours ne seront pas comptés.</p>`,
    '<button type="button" class="btn" data-close>Garder la séance</button><button type="button" class="btn danger" id="b-drop">Abandonner</button>', (d) => {
      $('#b-drop', d).onclick = () => { T = null; saveT(); closeSheet(); render(); toast('Séance abandonnée.'); };
    });
}
setInterval(() => {
  if (!T) { document.title = `${VIEWS[state.view]} - Thèse`; return; }
  if (T.runStart && remaining() <= 0) { blockEnded(); return; }
  const r = $('#t-left');
  if (r) r.textContent = clock(remaining());
  const tot = $('#t-total');
  if (tot) tot.textContent = fmtHours(elapsed() / 60000);
  const bar = $('#t-bar');
  if (bar) bar.style.width = `${Math.min(100, ((elapsed() - T.blockStartFocus) / T.blockMs) * 100)}%`;
  document.title = `${T.runStart ? clock(remaining()) : 'En pause'} - Thèse`;
}, 500);

/* ---------- Noter une séance (après le chrono, oubli ou modification) ---------- */
function openLogForm(p, existing) {
  const s = existing || p;
  const task = existing ? sessionTask(existing) : p.task;
  const showNext = !existing;
  const nx = state.next || {};
  const tomorrow = addDays(today(), 1);
  openSheet(existing ? 'Modifier la séance' : p.fromTimer ? 'Noter la séance' : 'Ajouter une séance oubliée', `
    <label class="field"><span>Tâche</span><select name="task">${taskOptions(task)}</select></label>
    <fieldset><legend class="legend">Mode</legend>${modeSeg('mode', s.mode)}</fieldset>
    <div class="row3">
      <label class="field"><span>Date</span><input type="date" name="date" max="${today()}" value="${esc(s.date)}"></label>
      <label class="field"><span>Début</span><input type="time" name="time" value="${esc(s.time)}"></label>
      <label class="field"><span>Durée (min)</span><input name="minutes" inputmode="numeric" value="${esc(s.minutes ?? '')}"></label>
    </div>
    <p class="err" data-err="when"></p>
    <label class="field"><span id="pages-label">${s.mode === 'revision' ? 'Pages relues et corrigées' : 'Pages rédigées (premier jet)'}</span><input name="pages" inputmode="decimal" placeholder="0" value="${existing ? esc(fmtPages(s.pages)) : ''}" aria-describedby="pages-hint">
      <span class="hint" id="pages-hint">Compte même une demi-page (0,5). Zéro est une réponse honnête.</span></label>
    <p class="err" data-err="pages"></p>
    <div id="sec-status"></div>
    <label class="field"><span>Note (facultatif)</span><input name="note" maxlength="140" autocomplete="off" placeholder="Bloqué sur la transition 3.2" value="${esc(s.note)}"></label>
    ${showNext ? `<fieldset class="next-box"><legend class="legend">Prochaine séance</legend>
      <p class="hint">Décide maintenant : demain, tu n'auras qu'à appuyer sur Démarrer.</p>
      <label class="field"><span>Tâche</span><select name="nextTask"></select></label>
      ${modeSeg('nextMode', nx.mode || s.mode)}
      <div class="row2"><label class="field"><span>Jour</span><input type="date" name="nextDate" min="${today()}" value="${esc(tomorrow)}"></label>
      <label class="field"><span>Heure</span><input type="time" name="nextTime" value="${esc(nx.time || '09:00')}"></label></div>
      <p class="err" data-err="next"></p></fieldset>` : ''}`,
  `${existing ? '<button type="button" class="btn danger" id="s-del">Supprimer</button>' : ''}${p?.fromTimer ? '<button type="button" class="btn" id="s-resume">Reprendre</button>' : ''}<button type="submit" class="btn primary">Enregistrer</button>`, (d, form) => {
    const f = form.elements;
    const secBox = $('#sec-status', d);
    const drawNext = () => { if (showNext) $('[name=nextTask]', d).innerHTML = taskOptions(suggestNext(f.task.value, f.secStatus?.value)); };
    const drawSec = () => {
      const { sec } = taskParts(f.task.value);
      secBox.innerHTML = sec ? `<label class="field"><span>État de la section « ${esc(sec.title)} »</span><select name="secStatus">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${k === sec.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
      drawNext();
    };
    drawSec();
    form.addEventListener('input', (e) => { const k = e.target.name === 'pages' ? 'pages' : ['date', 'time', 'minutes'].includes(e.target.name) ? 'when' : null; if (k) $(`[data-err=${k}]`, d).textContent = ''; });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'task') drawSec();
      if (e.target.name === 'secStatus') drawNext();
      if (e.target.name === 'mode') $('#pages-label', d).textContent = e.target.value === 'revision' ? 'Pages relues et corrigées' : 'Pages rédigées (premier jet)';
    });
    if (p?.fromTimer) { f.pages.focus(); $('#s-resume', d).onclick = () => { closeSheet(); resumeSession(); }; }
    if (existing) $('#s-del', d).onclick = () => deleteSession(existing);
    form.addEventListener('submit', async () => {
      $$('[data-err]', d).forEach((e) => { e.textContent = ''; });
      const minutes = Number(f.minutes.value);
      const pages = parseNum(f.pages.value) ?? 0;
      const fail = (k, m, el) => { $(`[data-err=${k}]`, d).textContent = m; el.focus(); };
      if (!isDate(f.date.value) || f.date.value > today()) return fail('when', "Choisis une date passée ou celle d'aujourd'hui.", f.date);
      if (!isTime(f.time.value)) return fail('when', "Indique l'heure de début.", f.time);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return fail('when', 'Durée entre 1 et 600 minutes.', f.minutes);
      if (!Number.isFinite(pages) || pages < 0 || pages > 100) return fail('pages', 'Nombre de pages entre 0 et 100, par exemple 1,5.', f.pages);
      if (showNext && (!isDate(f.nextDate.value) || f.nextDate.value < today() || !isTime(f.nextTime.value))) return fail('next', 'Choisis un jour et une heure pour la prochaine séance.', f.nextDate);
      const { ch, sec } = taskParts(f.task.value);
      const rec = { id: existing?.id || uid(), chapterId: ch.id, sectionId: sec?.id || null, mode: f.mode.value, date: f.date.value, time: f.time.value, minutes, pages: Math.round(pages * 10) / 10, note: f.note.value.trim() };
      if (sec && f.secStatus && f.secStatus.value !== sec.status) { sec.status = f.secStatus.value; sec.statusAt = rec.date; }
      await DB.batch((o) => {
        o('sessions').put(rec);
        o('meta').put(state.plan, 'plan');
        if (showNext) o('meta').put({ task: f.nextTask.value, mode: f.nextMode.value, date: f.nextDate.value, time: f.nextTime.value }, 'next');
      });
      if (p?.fromTimer) { T = null; saveT(); }
      closeSheet(); await load(); render();
      const late = isLate(rec.time, state.settings.limit) ? ` Séance commencée après ${state.settings.limit.replace(':', ' h ')} : vise plutôt le matin.` : '';
      toast(existing ? 'Séance modifiée.' : `Séance notée : ${fmtHours(minutes)}, ${fmtPages(rec.pages)} page(s).${late}`);
    });
  });
}
/* Suggestion : même tâche, sauf si la section vient d'être terminée. */
function suggestNext(task, newStatus) {
  const { ch, sec } = taskParts(task);
  if (!sec || newStatus !== 'done') return task;
  const i = ch.sections.indexOf(sec);
  const after = ch.sections.slice(i + 1).find((s) => s.status !== 'done');
  return after ? `${ch.id}/${after.id}` : firstOpenTask();
}
async function deleteSession(s) {
  await DB.del(s.id);
  closeSheet(); await load(); render();
  toast('Séance supprimée.', { label: 'Annuler', run: async () => { await DB.put(s); await load(); render(); toast('Séance restaurée.'); } });
}

/* =====================================================================
   VUE : AUJOURD'HUI
   ===================================================================== */
function heroHtml(p) {
  const deadline = fmtLong(state.plan.deadline);
  if (p.status === 'done') return `<p class="lead">Tous les chapitres sont rédigés et relus.</p><p>Il ne reste qu'à les envoyer avant le ${esc(deadline)}.</p>`;
  if (p.status === 'unknown') return `<p class="lead">Note ta première séance pour obtenir une date de fin estimée.</p><p>Remise prévue : ${esc(deadline)}.</p>`;
  const weeksLate = Math.ceil(daysBetween(state.plan.deadline, p.finish) / 7);
  const notes = [];
  if (!p.wk.measured) notes.push(`rythme pris dans tes réglages (${hoursTxt(state.settings.weeklyHours)} par semaine) tant que tu n'as pas une semaine de séances`);
  if (!p.r.draft.measured || !p.r.revision.measured) notes.push(`vitesse par défaut tant que tu n'as pas ${MIN_HOURS_FOR_RATE} h mesurées dans chaque mode`);
  return `<p class="lead">Au rythme ${p.wk.measured ? 'actuel' : 'prévu'}, tu finis le <mark>${esc(fmtLong(p.finish))}</mark>.</p>
    <p class="verdict ${p.status}">${p.status === 'ok' ? 'Dans les temps' : `Environ ${weeksLate} semaine${weeksLate > 1 ? 's' : ''} après la remise du ${esc(deadline)}`}</p>
    <p>Il reste environ <b>${esc(hoursTxt(p.hoursNeeded))}</b> de travail${p.daysLeft > 0 ? ` en ${p.daysLeft} jours` : ''}. Il faut <b>${esc(hoursTxt(p.perWeek))} par semaine</b> ; ${p.wk.measured ? 'tu en fais' : 'tu as prévu'} ${esc(hoursTxt(p.wk.hours))}.</p>
    ${notes.length ? `<p class="small">Estimation provisoire : ${esc(notes.join(' ; '))}.</p>` : ''}`;
}
function sessionCardHtml() {
  const limit = state.settings.limit;
  if (T) {
    const left = remaining();
    return `<section class="card session live" aria-label="Séance en cours">
      <p class="eyebrowless">${esc(MODES[T.mode])}</p><h2>${esc(taskLabel(T.task))}</h2>
      <p class="timer" role="timer" id="t-left">${clock(left)}</p>
      <div class="meter" aria-hidden="true"><span id="t-bar"></span></div>
      <p>Temps de la séance : <b id="t-total">${esc(fmtHours(elapsed() / 60000))}</b>${T.runStart ? '' : ', en pause'}</p>
      <div class="btn-row">${T.runStart ? '<button type="button" class="btn" data-act="pause">Pause</button>' : '<button type="button" class="btn primary" data-act="resume">Reprendre</button>'}
        <button type="button" class="btn" data-act="finish">Terminer et noter</button></div>
      <button type="button" class="link" data-act="abandon">Abandonner sans compter</button></section>`;
  }
  const nx = state.next && taskParts(state.next.task).ch ? state.next : null;
  const task = nx?.task || firstOpenTask();
  const mode = nx?.mode || 'draft';
  const after = nowTime() >= limit;
  let plan = '';
  if (nx) {
    const when = nx.date === today() ? "aujourd'hui" : nx.date === addDays(today(), 1) ? 'demain' : `le ${fmtWeekday(nx.date)}`;
    plan = `<p class="planned">${nx.date < today() ? 'Séance prévue et manquée' : 'Prévue'} ${esc(nx.date < today() ? `le ${fmtWeekday(nx.date)}` : when)} à ${esc(nx.time.replace(':', ' h '))}.</p>`;
  }
  return `<section class="card session" aria-labelledby="s-title">
    <h2 id="s-title">Séance de rédaction</h2>
    ${after ? `<div class="notice"><p>Il est plus de ${esc(limit.replace(':', ' h '))} : ce n'est pas ton bon créneau. Prends deux minutes pour fixer la séance de demain matin.</p><button type="button" class="btn" data-act="plan-next">Fixer la prochaine séance</button></div>` : ''}
    ${plan}
    <label class="field"><span>Une seule tâche</span><select id="h-task">${taskOptions(task)}</select></label>
    <fieldset><legend class="legend">Mode</legend>${modeSeg('h-mode', mode)}</fieldset>
    <p class="hint">Premier jet : avancer sans corriger. Révision : reprendre ce qui est écrit.</p>
    <button type="button" class="btn primary big" data-act="start">Démarrer ${state.settings.blockMin} min</button></section>`;
}
function viewToday(root) {
  const p = proj();
  const w = weekStats(state.sessions, today(), state.settings.limit);
  const target = Number.isFinite(p.perWeek) ? p.perWeek * 60 : 0;
  root.innerHTML = `<div class="today">
    <section class="hero" aria-label="Projection">${heroHtml(p)}</section>
    ${sessionCardHtml()}
    <div class="side">
      <section class="card"><h2>Cette semaine</h2>
        <dl class="stats">
          <div><dt>Travail</dt><dd>${esc(fmtHours(w.minutes))}${target ? ` <span class="muted">sur ${esc(fmtHours(target))}</span>` : ''}</dd></div>
          <div><dt>Jours avec séance</dt><dd>${w.days} sur ${w.elapsedDays}</dd></div>
          <div><dt>Premier jet</dt><dd>${esc(fmtPages(w.draft))} p.</dd></div>
          <div><dt>Révision</dt><dd>${esc(fmtPages(w.revision))} p.</dd></div>
        </dl>
        ${target ? `<div class="meter big" aria-hidden="true"><span data-w="${(w.minutes / target) * 100}"></span></div>` : ''}
        ${w.late ? `<p class="warn">${w.late} séance${w.late > 1 ? 's' : ''} commencée${w.late > 1 ? 's' : ''} après ${esc(state.settings.limit.replace(':', ' h '))} cette semaine.</p>` : ''}
        <p class="small">Vitesse ${p.r.draft.measured ? 'mesurée' : 'par défaut'} : ${esc(fmtPages(p.r.draft.rate))} page/h en premier jet, ${esc(fmtPages(p.r.revision.rate))} en révision.</p>
      </section>
      <section class="card"><div class="head"><h2>Chapitres</h2><a class="link" href="#plan">Modifier le plan</a></div>
        ${state.plan.chapters.map((ch) => { const c = chapterProgress(ch, state.sessions); return `<div class="chap">
          <p><b>${esc(ch.title)}</b><span class="muted"> ${esc(fmtPages(Math.min(c.draft, ch.target)))} / ${ch.target} p. rédigées, ${esc(fmtPages(Math.min(c.revision, ch.target)))} relues</span></p>
          <div class="dual" aria-hidden="true"><span class="d" data-w="${(c.draft / ch.target) * 100}"></span><span class="r" data-w="${(c.revision / ch.target) * 100}"></span></div></div>`; }).join('')}
        <p class="legend-line small"><span class="key d"></span>Rédigé <span class="key r"></span>Relu</p>
      </section>
    </div></div>`;
  applyBars(root);
  const bar = $('#t-bar', root);
  if (bar && T) bar.style.width = `${Math.min(100, ((elapsed() - T.blockStartFocus) / T.blockMs) * 100)}%`;
}
function openNextForm() {
  const nx = state.next || {};
  openSheet('Prochaine séance', `<p class="hint">Choisis la tâche et l'heure maintenant : demain, tu n'auras qu'à démarrer.</p>
    <label class="field"><span>Tâche</span><select name="task">${taskOptions(nx.task && taskParts(nx.task).ch ? nx.task : firstOpenTask())}</select></label>
    ${modeSeg('mode', nx.mode || 'draft')}
    <div class="row2"><label class="field"><span>Jour</span><input type="date" name="date" min="${today()}" value="${esc(addDays(today(), 1))}"></label>
    <label class="field"><span>Heure</span><input type="time" name="time" value="${esc(nx.time || '09:00')}"></label></div><p class="err" data-err="x"></p>`,
  '<button type="submit" class="btn primary">Enregistrer</button>', (d, form) => {
    form.addEventListener('submit', async () => {
      const f = form.elements;
      if (!isDate(f.date.value) || f.date.value < today() || !isTime(f.time.value)) { $('[data-err=x]', d).textContent = 'Choisis un jour à venir et une heure.'; return; }
      await DB.setMeta('next', { task: f.task.value, mode: f.mode.value, date: f.date.value, time: f.time.value });
      closeSheet(); await load(); render();
      toast(`Séance fixée le ${fmtWeekday(f.date.value)} à ${f.time.value.replace(':', ' h ')}.`);
    });
  });
}

/* =====================================================================
   VUE : PLAN
   ===================================================================== */
function viewPlan(root) {
  root.innerHTML = `<div class="stack">
    <section class="card"><label class="field"><span>Date de remise au directeur</span><input type="date" id="deadline" value="${esc(state.plan.deadline)}"></label>
      <p class="hint">Découpe chaque chapitre en sections de 2 à 5 pages : une section se termine en quelques séances, un chapitre entier décourage.</p></section>
    ${state.plan.chapters.map((ch) => { const c = chapterProgress(ch, state.sessions); return `<section class="card" aria-label="${esc(ch.title)}">
      <div class="head"><h2>${esc(ch.title)}</h2><button type="button" class="link" data-act="ch-edit" data-id="${esc(ch.id)}">Modifier</button></div>
      <p class="muted">${esc(fmtPages(Math.min(c.draft, ch.target)))} / ${ch.target} pages rédigées, ${esc(fmtPages(Math.min(c.revision, ch.target)))} relues, ${esc(fmtHours(c.minutes))} de travail noté.</p>
      <div class="dual" aria-hidden="true"><span class="d" data-w="${(c.draft / ch.target) * 100}"></span><span class="r" data-w="${(c.revision / ch.target) * 100}"></span></div>
      <ul class="sections">${ch.sections.map((s) => `<li><span class="sec-title">${esc(s.title)}</span>
        <label><span class="vh">État de ${esc(s.title)}</span><select data-status data-ch="${esc(ch.id)}" data-sec="${esc(s.id)}">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button type="button" class="icon-btn" data-act="sec-del" data-ch="${esc(ch.id)}" data-sec="${esc(s.id)}" aria-label="Retirer la section ${esc(s.title)}">×</button></li>`).join('') || '<li class="muted">Aucune section pour le moment.</li>'}</ul>
      <div class="add-row"><label><span class="vh">Nouvelle section de ${esc(ch.title)}</span><input data-new-sec="${esc(ch.id)}" placeholder="Ex. 4.2 Résultats de l'enquête" maxlength="80"></label>
        <button type="button" class="btn" data-act="sec-add" data-ch="${esc(ch.id)}">Ajouter</button></div></section>`; }).join('')}
    <button type="button" class="btn" data-act="ch-add">Ajouter un chapitre</button></div>`;
  applyBars(root);
  $('#deadline', root).addEventListener('change', async (e) => {
    if (!isDate(e.target.value)) return;
    state.plan.deadline = e.target.value; await savePlan(); toast(`Remise fixée au ${fmtLong(e.target.value)}.`);
  });
  $$('[data-status]', root).forEach((sel) => sel.addEventListener('change', async () => {
    const sec = chapter(sel.dataset.ch).sections.find((s) => s.id === sel.dataset.sec);
    sec.status = sel.value; sec.statusAt = today();
    await savePlan(); toast(`${sec.title} : ${STATUSES[sel.value].toLowerCase()}.`);
  }));
  $$('[data-new-sec]', root).forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSection(inp.dataset.newSec); } }));
}
async function addSection(chId) {
  const inp = $(`[data-new-sec="${chId}"]`);
  const title = inp.value.trim();
  if (!title) { inp.focus(); toast('Écris le titre de la section.'); return; }
  chapter(chId).sections.push({ id: uid(), title, status: 'todo', statusAt: today() });
  await savePlan(); render();
  $(`[data-new-sec="${chId}"]`)?.focus();
}
async function removeSection(chId, secId) {
  const ch = chapter(chId);
  const i = ch.sections.findIndex((s) => s.id === secId);
  const [sec] = ch.sections.splice(i, 1);
  await savePlan(); render();
  toast(`Section « ${sec.title} » retirée. Ses séances restent comptées dans le chapitre.`, { label: 'Annuler', run: async () => { ch.sections.splice(i, 0, sec); await savePlan(); render(); } });
}
function openChapterForm(existing) {
  const c = existing || { title: '', target: 30, draftBase: 0, revBase: 0 };
  openSheet(existing ? 'Modifier le chapitre' : 'Nouveau chapitre', `
    <label class="field"><span>Titre</span><input name="title" maxlength="80" value="${esc(c.title)}"></label>
    <label class="field"><span>Taille visée (pages)</span><input name="target" inputmode="numeric" value="${esc(c.target)}"></label>
    <div class="row2"><label class="field"><span>Pages déjà rédigées avant l'app</span><input name="draftBase" inputmode="decimal" value="${esc(fmtPages(c.draftBase))}"></label>
    <label class="field"><span>Pages déjà relues avant l'app</span><input name="revBase" inputmode="decimal" value="${esc(fmtPages(c.revBase))}"></label></div>
    <p class="err" data-err="x"></p>`,
  `${existing && state.plan.chapters.length > 1 ? '<button type="button" class="btn danger" id="ch-del">Supprimer</button>' : ''}<button type="submit" class="btn primary">Enregistrer</button>`, (d, form) => {
    if (!existing) form.elements.title.focus();
    if ($('#ch-del', d)) $('#ch-del', d).onclick = () => deleteChapter(existing);
    form.addEventListener('submit', async () => {
      const f = form.elements;
      const target = Number(f.target.value), draftBase = parseNum(f.draftBase.value) ?? 0, revBase = parseNum(f.revBase.value) ?? 0;
      const err = (m, el) => { $('[data-err=x]', d).textContent = m; el.focus(); };
      if (!f.title.value.trim()) return err('Écris le titre.', f.title);
      if (!Number.isInteger(target) || target < 1 || target > 500) return err('Taille visée entre 1 et 500 pages.', f.target);
      if (!(draftBase >= 0 && draftBase <= target)) return err(`Pages rédigées entre 0 et ${target}.`, f.draftBase);
      if (!(revBase >= 0 && revBase <= target)) return err(`Pages relues entre 0 et ${target}.`, f.revBase);
      const rec = { ...c, title: f.title.value.trim(), target, draftBase, revBase };
      if (existing) Object.assign(existing, rec);
      else state.plan.chapters.push({ ...rec, id: uid(), sections: [] });
      await savePlan(); closeSheet(); render(); toast('Chapitre enregistré.');
    });
  });
}
function deleteChapter(ch) {
  const n = state.sessions.filter((s) => s.chapterId === ch.id).length;
  openSheet('Supprimer ce chapitre ?', `<p>« ${esc(ch.title)} », ses sections et ses ${n} séance(s) notée(s) seront supprimés.</p>`,
    '<button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn danger" id="ch-go">Supprimer</button>', (d) => {
      $('#ch-go', d).onclick = async () => {
        state.plan.chapters = state.plan.chapters.filter((c) => c.id !== ch.id);
        await DB.batch((o) => { o('meta').put(state.plan, 'plan'); state.sessions.filter((s) => s.chapterId === ch.id).forEach((s) => o('sessions').delete(s.id)); });
        closeSheet(); await load(); render(); toast('Chapitre supprimé.');
      };
    });
}

/* =====================================================================
   VUE : SÉANCES
   ===================================================================== */
function viewSessions(root) {
  const p = proj();
  const series = weekSeries(state.sessions, today());
  const goal = Number.isFinite(p.perWeek) ? p.perWeek : 0;
  const max = Math.max(goal, ...series.map((w) => w.minutes / 60), 1) * 1.1;
  const weekLabel = (s) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(parseDate(s));
  const groups = {};
  [...state.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).forEach((s) => { (groups[weekStart(s.date)] ??= []).push(s); });
  root.innerHTML = `<div class="stack">
    <section class="card"><h2>Heures par semaine</h2>
      <p class="small">${goal ? `Le trait indique les ${esc(hoursTxt(goal))} par semaine nécessaires pour tenir la remise.` : 'Aucun objectif : tout est terminé ou la date est passée.'}</p>
      <div class="chart" role="group" aria-label="Heures de travail des 8 dernières semaines">
        ${goal ? `<span class="goal" data-h-goal="${(goal / max) * 100}" aria-hidden="true"></span>` : ''}
        ${series.map((w) => `<div class="col"><span class="bar ${goal && w.minutes / 60 >= goal ? 'met' : ''}" data-h="${(w.minutes / 60 / max) * 100}"></span><span class="col-label">${esc(weekLabel(w.start))}</span><span class="vh">${esc(fmtHours(w.minutes))}, ${esc(fmtPages(w.pages))} pages</span></div>`).join('')}
      </div>
      <details><summary>Voir en tableau</summary><table><thead><tr><th scope="col">Semaine du</th><th scope="col">Travail</th><th scope="col">Pages</th></tr></thead>
        <tbody>${series.map((w) => `<tr><td>${esc(weekLabel(w.start))}</td><td>${esc(fmtHours(w.minutes))}</td><td>${esc(fmtPages(w.pages))}</td></tr>`).join('')}</tbody></table></details></section>
    <button type="button" class="btn" data-act="log-manual">Ajouter une séance oubliée</button>
    ${Object.entries(groups).map(([wk, list]) => `<section class="card"><h2 class="h3">Semaine du ${esc(fmtDay(wk))}<span class="muted"> : ${esc(fmtHours(list.reduce((n, s) => n + s.minutes, 0)))}, ${esc(fmtPages(list.reduce((n, s) => n + s.pages, 0)))} p.</span></h2>
      ${list.map((s) => `<button type="button" class="srow" data-act="log-edit" data-id="${esc(s.id)}">
        <span><b>${esc(taskLabel(sessionTask(s)))}</b><span class="muted block">${esc(fmtWeekday(s.date))}, ${esc(s.time.replace(':', ' h '))}, ${esc(MODES[s.mode].toLowerCase())}${isLate(s.time, state.settings.limit) ? ', après l\'heure limite' : ''}${s.note ? `. ${esc(s.note)}` : ''}</span></span>
        <span class="num">${esc(fmtHours(s.minutes))}<span class="muted block">${esc(fmtPages(s.pages))} p.</span></span></button>`).join('')}</section>`).join('') || '<p class="empty">Aucune séance notée pour le moment.</p>'}
  </div>`;
  applyBars(root);
  const g = $('[data-h-goal]', root);
  if (g) g.style.bottom = `calc(${Math.min(100, +g.dataset.hGoal)}% * var(--plot) / 100 + var(--label))`;
}

/* =====================================================================
   VUE : BILAN POUR LE DIRECTEUR
   ===================================================================== */
function reportRange() {
  const t = today();
  if (state.report.period === 'last' && state.lastReport) return [addDays(state.lastReport, 1) > t ? t : addDays(state.lastReport, 1), t];
  return [addDays(t, -(Number(state.report.period) - 1)), t];
}
function reportText() {
  const [from, to] = reportRange();
  const nx = state.next && taskParts(state.next.task).ch ? `${taskLabel(state.next.task)}, en ${MODES[state.next.mode].toLowerCase()}` : null;
  return buildReport({ plan: state.plan, sessions: state.sessions, from, to, proj: proj(), next: nx,
    opts: { ...state.report, director: state.settings.director, name: state.settings.name } });
}
function viewReport(root) {
  const r = state.report;
  const periods = [['7', '7 jours'], ['14', '14 jours'], ['30', '30 jours']];
  if (state.lastReport) periods.push(['last', `Depuis le ${fmtDay(state.lastReport)}`]);
  root.innerHTML = `<div class="report">
    <section class="card stack-in"><h2>Contenu</h2>
      <fieldset><legend class="legend">Période</legend><div class="seg wrap">${periods.map(([v, l]) => `<label><input type="radio" name="period" value="${v}" ${r.period === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></fieldset>
      <label class="field"><span>Formule d'appel</span><input id="r-dir" placeholder="Professeur Koffi" value="${esc(state.settings.director)}" autocomplete="off"></label>
      <label class="field"><span>Points à discuter (facultatif)</span><textarea id="r-block" rows="3" placeholder="J'hésite sur la structure de la section 4.3.">${esc(r.blockers)}</textarea></label>
      <label class="check"><input type="checkbox" id="r-est" ${r.estimate ? 'checked' : ''}><span>Inclure la date de fin estimée</span></label>
      <label class="check"><input type="checkbox" id="r-hours" ${r.hours ? 'checked' : ''}><span>Inclure les heures de travail</span></label>
      <p class="small">${state.lastReport ? `Dernier bilan envoyé le ${esc(fmtLong(state.lastReport))}.` : "Aucun bilan envoyé depuis l'app."}</p></section>
    <section class="card stack-in"><h2>Message</h2>
      <label class="field"><span class="vh">Texte du bilan</span><textarea id="r-text" rows="16">${esc(reportText())}</textarea></label>
      <p class="hint">Tu peux corriger le texte avant de l'envoyer. Changer un réglage à gauche le recrée.</p>
      <div class="btn-row"><button type="button" class="btn primary" data-act="r-copy">Copier</button>
        <a class="btn" id="r-wa" target="_blank" rel="noopener">WhatsApp</a><a class="btn" id="r-mail">E-mail</a></div></section></div>`;
  const text = $('#r-text', root);
  const links = () => {
    $('#r-wa', root).href = `https://wa.me/?text=${encodeURIComponent(text.value)}`;
    $('#r-mail', root).href = `mailto:?subject=${encodeURIComponent('Point d\'avancement de la rédaction')}&body=${encodeURIComponent(text.value)}`;
  };
  const regen = () => { text.value = reportText(); links(); };
  links();
  text.addEventListener('input', links);
  $$('[name=period]', root).forEach((x) => x.addEventListener('change', () => { r.period = x.value; regen(); }));
  $('#r-dir', root).addEventListener('change', async (e) => { state.settings.director = e.target.value.trim(); await saveSettings(); regen(); });
  $('#r-block', root).addEventListener('input', (e) => { r.blockers = e.target.value; regen(); });
  $('#r-est', root).addEventListener('change', (e) => { r.estimate = e.target.checked; regen(); });
  $('#r-hours', root).addEventListener('change', (e) => { r.hours = e.target.checked; regen(); });
  ['#r-wa', '#r-mail'].forEach((s) => $(s, root).addEventListener('click', markSent));
}
async function markSent() { state.lastReport = today(); await DB.setMeta('lastReport', state.lastReport); }
async function copyReport() {
  const t = $('#r-text');
  try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
  await markSent();
  toast('Bilan copié. Colle-le dans ton message.');
}

/* =====================================================================
   VUE : RÉGLAGES ET SAUVEGARDE
   ===================================================================== */
function viewSettings(root) {
  const s = state.settings;
  const notif = 'Notification' in window ? Notification.permission : 'absent';
  root.innerHTML = `<div class="stack narrow">
    <section class="card stack-in"><h2>Organisation</h2>
      <fieldset><legend class="legend">Durée d'un bloc</legend><div class="seg">${[25, 50].map((m) => `<label><input type="radio" name="blockMin" value="${m}" ${s.blockMin === m ? 'checked' : ''}><span>${m} min</span></label>`).join('')}</div></fieldset>
      <label class="field"><span>Heure limite pour rédiger</span><input type="time" id="set-limit" value="${esc(s.limit)}"><span class="hint">Après cette heure, l'app te propose de préparer la séance du lendemain au lieu de rédiger.</span></label>
      <label class="field"><span>Heures prévues par semaine</span><input id="set-week" inputmode="decimal" value="${esc(fmtPages(s.weeklyHours))}"><span class="hint">Utilisées seulement pendant ta première semaine. Ensuite, l'app prend ton rythme réel.</span></label>
      <div class="row2"><label class="field"><span>Vitesse premier jet par défaut (pages/h)</span><input id="set-rd" inputmode="decimal" value="${esc(fmtPages(s.rates.draft))}"></label>
      <label class="field"><span>Vitesse révision par défaut (pages/h)</span><input id="set-rr" inputmode="decimal" value="${esc(fmtPages(s.rates.revision))}"></label></div>
      <p class="hint">Ces vitesses servent jusqu'à ${MIN_HOURS_FOR_RATE} h mesurées dans chaque mode.</p><p class="err" id="set-err"></p></section>
    <section class="card stack-in"><h2>Signature du bilan</h2><label class="field"><span>Ton nom</span><input id="set-name" autocomplete="name" value="${esc(s.name)}"></label></section>
    <section class="card stack-in"><h2>Fin de bloc</h2>
      <p>Un carillon sonne à la fin de chaque bloc.${{ granted: ' Les notifications sont activées : tu es prévenu même si la fenêtre est cachée.', denied: ' Les notifications sont bloquées : autorise-les pour ce site dans les réglages du navigateur.', absent: '' }[notif] || ''}</p>
      ${notif === 'default' ? '<button type="button" class="btn" data-act="notif">Activer les notifications</button>' : ''}
      <button type="button" class="btn" data-act="chime">Écouter le carillon</button></section>
    <section class="card stack-in"><h2>Sauvegarde</h2>
      <p>Tes données restent dans ce navigateur, sur cet ordinateur. Exporte-les chaque semaine et garde le fichier ailleurs (clé USB, Drive).</p>
      <button type="button" class="btn primary" data-act="export">Exporter les données</button>
      <label class="btn" for="import">Importer une sauvegarde</label><input class="vh" type="file" id="import" accept=".json,application/json">
      <button type="button" class="btn danger" data-act="erase">Tout effacer</button></section>
    <p class="small">Thèse, version 1.0</p></div>`;
  const err = $('#set-err', root);
  const num = async (id, apply, min, max) => {
    const v = parseNum($(id, root).value);
    if (!(v >= min && v <= max)) { err.textContent = `Valeur entre ${min} et ${max}.`; $(id, root).focus(); return; }
    err.textContent = ''; apply(v); await saveSettings(); toast('Réglage enregistré.');
  };
  $$('[name=blockMin]', root).forEach((x) => x.addEventListener('change', async () => { s.blockMin = Number(x.value); await saveSettings(); toast(`Blocs de ${s.blockMin} min.`); }));
  $('#set-limit', root).addEventListener('change', async (e) => { if (isTime(e.target.value)) { s.limit = e.target.value; await saveSettings(); toast('Heure limite enregistrée.'); } });
  $('#set-week', root).addEventListener('change', () => num('#set-week', (v) => { s.weeklyHours = v; }, 0.5, 80));
  $('#set-rd', root).addEventListener('change', () => num('#set-rd', (v) => { s.rates.draft = v; }, 0.1, 20));
  $('#set-rr', root).addEventListener('change', () => num('#set-rr', (v) => { s.rates.revision = v; }, 0.1, 40));
  $('#set-name', root).addEventListener('change', async (e) => { s.name = e.target.value.trim(); await saveSettings(); toast('Nom enregistré.'); });
  $('#import', root).addEventListener('change', importFile);
}
async function exportData() {
  const payload = { app: 'these', version: 1, exportedAt: new Date().toISOString(), plan: state.plan, sessions: state.sessions, settings: state.settings, next: state.next };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  a.download = `these-sauvegarde-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Sauvegarde exportée. Copie-la hors de cet ordinateur.');
}
async function importFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let r;
  try { r = parseBackup(await file.text()); } catch { toast("Ce fichier n'est pas une sauvegarde de l'app Thèse. Rien n'a été modifié."); return; }
  openSheet('Remplacer les données ?', `<p>Le fichier contient ${r.plan.chapters.length} chapitre(s) et ${r.sessions.length} séance(s).${r.rejected ? ` ${r.rejected} ligne(s) illisible(s) seront ignorées.` : ''}</p><p>Les données actuelles seront <b>remplacées</b>.</p>`,
    '<button type="button" class="btn" data-close>Annuler</button><button type="submit" class="btn primary">Remplacer</button>', (d, form) => {
      form.addEventListener('submit', async () => {
        await DB.batch((o) => {
          o('sessions').clear(); r.sessions.forEach((s) => o('sessions').put(s));
          o('meta').put(r.plan, 'plan');
          if (r.settings) o('meta').put(r.settings, 'settings');
        });
        closeSheet(); await load(); render(); toast('Données restaurées.');
      });
    });
}
function openErase() {
  openSheet('Tout effacer ?', `<p>Plan, séances et réglages seront supprimés de ce navigateur. Exporte d'abord si tu veux les garder.</p>
    <label class="field"><span>Écris EFFACER pour confirmer</span><input name="c" autocomplete="off"></label><p class="err" data-err="c"></p>`,
  '<button type="submit" class="btn danger">Effacer définitivement</button>', (d, form) => {
    form.addEventListener('submit', async () => {
      if (form.elements.c.value.trim().toUpperCase() !== 'EFFACER') { $('[data-err=c]', d).textContent = 'Écris exactement EFFACER.'; return; }
      await DB.batch((o) => { o('sessions').clear(); o('meta').clear(); });
      T = null; saveT();
      closeSheet(); await load(); render(); toast('Données effacées.');
    });
  });
}

/* =====================================================================
   ACTIONS ET NAVIGATION
   ===================================================================== */
const ACTIONS = {
  start: () => {
    const task = $('#h-task').value;
    if (!taskParts(task).ch) { toast('Choisis une tâche.'); return; }
    startSession(task, $('[name=h-mode]:checked').value);
  },
  pause: pauseSession,
  resume: resumeSession,
  finish: finishSession,
  abandon: abandonSession,
  'plan-next': openNextForm,
  'log-manual': () => openLogForm({ task: firstOpenTask(), mode: 'draft', date: today(), time: nowTime(), minutes: 25 }),
  'log-edit': (d) => openLogForm(null, state.sessions.find((s) => s.id === d.id)),
  'ch-add': () => openChapterForm(),
  'ch-edit': (d) => openChapterForm(chapter(d.id)),
  'sec-add': (d) => addSection(d.ch),
  'sec-del': (d) => removeSection(d.ch, d.sec),
  'r-copy': copyReport,
  chime: () => { unlockAudio(); chime(); },
  notif: async () => { const r = await Notification.requestPermission(); render(); toast(r === 'granted' ? 'Notifications activées.' : 'Notifications refusées.'); },
  export: exportData,
  erase: openErase,
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el) ACTIONS[el.dataset.act]?.(el.dataset, el);
});
document.addEventListener('pointerdown', unlockAudio, { passive: true });

function render() {
  const v = state.view;
  $('#title').textContent = VIEWS[v];
  $$('nav a').forEach((a) => { if (a.dataset.tab === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  ({ aujourdhui: viewToday, plan: viewPlan, seances: viewSessions, bilan: viewReport, reglages: viewSettings }[v])($('#view'));
  if (!T) document.title = `${VIEWS[v]} - Thèse`;
}
function route() {
  const h = location.hash.slice(1);
  const next = VIEWS[h] ? h : 'aujourdhui';
  const changed = next !== state.view;
  state.view = next;
  render();
  if (changed) { scrollTo(0, 0); $('#title').focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'aujourdhui' && !$('#sheet').open) render(); });

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => toast('Nouvelle version prête.', { label: 'Mettre à jour', sticky: true, run: () => w.postMessage('SKIP_WAITING') });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
  const had = !!navigator.serviceWorker.controller;
  let done = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !done) { done = true; location.reload(); } });
}

(async function init() {
  try {
    await DB.open();
    await load();
    if (T && !taskParts(T.task).ch) { T = null; saveT(); }
    route();
    registerSw();
  } catch (e) {
    document.body.textContent = `Impossible d'ouvrir les données (${e?.name || e?.message}). Recharge la page. Tes données n'ont pas été modifiées.`;
  }
})();
