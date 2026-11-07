/* =====================================================================
   LOGIQUE DE L'APP DE THÈSE
   Aucun accès à la page ni à la base : ces fonctions se testent seules.
   ===================================================================== */
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const weekStart = (s) => addDays(s, -((parseDate(s).getDay() + 6) % 7)); // Lundi
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(parseDate(s)) === s;
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const MODES = { draft: 'Premier jet', revision: 'Révision' };
const STATUSES = { todo: 'À rédiger', draft: 'Premier jet fait', done: 'Terminée' };
/* Vitesses utilisées tant que tu n'as pas 3 h mesurées dans un mode (pages par heure). */
const DEFAULT_RATES = { draft: 1, revision: 2 };
const MIN_HOURS_FOR_RATE = 3;

const fmtPages = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
function fmtHours(minutes) {
  const t = Math.max(0, Math.round(minutes));
  const h = Math.floor(t / 60), m = t % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}
const fmtLong = (s) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(s)).replace(/^1 /, '1er ');
const fmtDay = (s) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(parseDate(s)).replace(/^1 /, '1er ');

/* Avancement d'un chapitre : pages déjà écrites avant l'app + pages notées après chaque séance. */
function chapterProgress(ch, sessions) {
  let draft = ch.draftBase || 0, revision = ch.revBase || 0, minutes = 0;
  for (const s of sessions) {
    if (s.chapterId !== ch.id) continue;
    if (s.mode === 'draft') draft += s.pages; else revision += s.pages;
    minutes += s.minutes;
  }
  return { draft, revision, minutes, draftLeft: Math.max(0, ch.target - draft), revLeft: Math.max(0, ch.target - revision) };
}

/* Vitesse réelle, mesurée dès 3 h de travail dans un mode. */
function rates(sessions, defaults = DEFAULT_RATES) {
  const out = {};
  for (const mode of ['draft', 'revision']) {
    const list = sessions.filter((s) => s.mode === mode);
    const hours = list.reduce((n, s) => n + s.minutes, 0) / 60;
    const pages = list.reduce((n, s) => n + s.pages, 0);
    out[mode] = hours >= MIN_HOURS_FOR_RATE && pages > 0
      ? { rate: pages / hours, measured: true, hours }
      : { rate: defaults[mode], measured: false, hours };
  }
  return out;
}

/* Heures par semaine sur les 14 derniers jours ; avant une semaine de recul, on prend ton estimation. */
function weeklyHours(sessions, today, fallback) {
  const first = sessions.reduce((m, s) => (!m || s.date < m ? s.date : m), null);
  if (!first) return { hours: fallback, measured: false };
  const span = Math.min(14, daysBetween(first, today) + 1);
  if (span < 7) return { hours: fallback, measured: false };
  const from = addDays(today, -(span - 1));
  const minutes = sessions.filter((s) => s.date >= from && s.date <= today).reduce((n, s) => n + s.minutes, 0);
  return { hours: minutes / 60 / (span / 7), measured: true };
}

/* La question centrale : à ce rythme, quand auras-tu fini ? */
function projection(plan, sessions, today, settings) {
  const r = rates(sessions, settings.rates);
  let draftLeft = 0, revLeft = 0, target = 0, draft = 0, revision = 0;
  for (const ch of plan.chapters) {
    const p = chapterProgress(ch, sessions);
    draftLeft += p.draftLeft; revLeft += p.revLeft; target += ch.target;
    draft += Math.min(p.draft, ch.target); revision += Math.min(p.revision, ch.target);
  }
  const hoursNeeded = draftLeft / r.draft.rate + revLeft / r.revision.rate;
  const wk = weeklyHours(sessions, today, settings.weeklyHours);
  const daysLeft = daysBetween(today, plan.deadline);
  const perWeek = daysLeft > 0 ? hoursNeeded / (daysLeft / 7) : Infinity;
  let finish = null;
  if (hoursNeeded === 0) finish = today;
  else if (wk.hours > 0) finish = addDays(today, Math.ceil((hoursNeeded / wk.hours) * 7));
  const status = hoursNeeded === 0 ? 'done' : !finish ? 'unknown' : finish <= plan.deadline ? 'ok' : 'late';
  return { r, wk, draftLeft, revLeft, target, draft, revision, hoursNeeded, daysLeft, perWeek, finish, status };
}

/* Séance commencée à l'heure limite ou après (par défaut 16 h, avant les cours de répétition). */
const isLate = (time, limit) => isTime(time) && time >= limit;

function weekStats(sessions, today, limit) {
  const from = weekStart(today);
  const list = sessions.filter((s) => s.date >= from && s.date <= today);
  return {
    minutes: list.reduce((n, s) => n + s.minutes, 0),
    draft: list.filter((s) => s.mode === 'draft').reduce((n, s) => n + s.pages, 0),
    revision: list.filter((s) => s.mode === 'revision').reduce((n, s) => n + s.pages, 0),
    days: new Set(list.map((s) => s.date)).size,
    late: list.filter((s) => isLate(s.time, limit)).length,
    elapsedDays: daysBetween(from, today) + 1,
  };
}
function weekSeries(sessions, today, count = 8) {
  const out = [];
  const cur = weekStart(today);
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(cur, -7 * i), end = addDays(start, 6);
    const list = sessions.filter((s) => s.date >= start && s.date <= end);
    out.push({ start, minutes: list.reduce((n, s) => n + s.minutes, 0), pages: list.reduce((n, s) => n + s.pages, 0) });
  }
  return out;
}

/* Texte du bilan pour le directeur : factuel, prêt à envoyer. */
function buildReport({ plan, sessions, from, to, proj, next, opts }) {
  const inP = sessions.filter((s) => s.date >= from && s.date <= to);
  const draft = inP.filter((s) => s.mode === 'draft').reduce((n, s) => n + s.pages, 0);
  const revision = inP.filter((s) => s.mode === 'revision').reduce((n, s) => n + s.pages, 0);
  const minutes = inP.reduce((n, s) => n + s.minutes, 0);
  const L = [`Bonjour${opts.director ? ` ${opts.director}` : ''},`, '',
    `Voici mon point d'avancement sur la rédaction, du ${fmtDay(from)} au ${fmtDay(to)}.`, '', 'Où en sont les chapitres :'];
  for (const ch of plan.chapters) {
    const p = chapterProgress(ch, sessions);
    L.push(`- ${ch.title} : ${fmtPages(Math.min(p.draft, ch.target))} pages rédigées sur ${ch.target} prévues, ${fmtPages(Math.min(p.revision, ch.target))} relues et corrigées.`);
  }
  L.push('', 'Sur la période :');
  L.push(draft || revision
    ? `- ${fmtPages(draft)} pages en premier jet et ${fmtPages(revision)} pages relues${opts.hours ? `, en ${fmtHours(minutes)} de travail` : ''}.`
    : '- Pas de rédaction sur cette période.');
  const finished = [];
  for (const ch of plan.chapters) {
    for (const sec of ch.sections) {
      if (sec.status === 'done' && sec.statusAt >= from && sec.statusAt <= to) finished.push(`${ch.title}, ${sec.title}`);
    }
  }
  if (finished.length) L.push(`- Sections terminées : ${finished.join(' ; ')}.`);
  if (next) L.push('', `Prochaine étape : ${next}.`);
  if (opts.blockers?.trim()) L.push('', "Points sur lesquels j'aurais besoin de votre avis :", opts.blockers.trim());
  if (opts.estimate && proj.finish && proj.status !== 'done') {
    L.push('', proj.status === 'ok'
      ? `Au rythme actuel, je prévois de terminer le ${fmtLong(proj.finish)}, pour une remise prévue le ${fmtLong(plan.deadline)}.`
      : `Au rythme actuel, la fin est estimée au ${fmtLong(proj.finish)}, après la remise prévue le ${fmtLong(plan.deadline)}. Je souhaiterais en parler avec vous.`);
  }
  L.push('', 'Bien cordialement,');
  if (opts.name) L.push(opts.name);
  return L.join('\n');
}

/* Sauvegarde : refuse un fichier d'une autre app, ignore les lignes abîmées. */
function parseBackup(text) {
  const data = JSON.parse(text);
  const plan = data?.plan;
  if (data?.app !== 'these' || !plan || !isDate(plan.deadline) || !Array.isArray(plan.chapters)) throw new Error('format');
  const chapters = plan.chapters.filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string' && Number.isFinite(c.target) && c.target > 0)
    .map((c) => ({ ...c, sections: Array.isArray(c.sections) ? c.sections.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string' && STATUSES[s.status]) : [] }));
  const ids = new Set(chapters.map((c) => c.id));
  const raw = Array.isArray(data.sessions) ? data.sessions : [];
  const sessions = raw.filter((s) => s && typeof s.id === 'string' && ids.has(s.chapterId) && MODES[s.mode] && isDate(s.date)
    && Number.isFinite(s.minutes) && s.minutes > 0 && s.minutes <= 600 && Number.isFinite(s.pages) && s.pages >= 0 && s.pages <= 100);
  return { plan: { deadline: plan.deadline, chapters }, sessions, settings: data.settings && typeof data.settings === 'object' ? data.settings : null, rejected: raw.length - sessions.length };
}
