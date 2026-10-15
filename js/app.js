import { SUPABASE_URL, SUPABASE_ANON_KEY, IDLE_LOGOUT_MINUTES } from './config.js';
import { parseHl7, Hl7Error } from './hl7.js';
import { buildReport, SPEC_VERSION } from './micro.js';
import { el, renderReport, renderIssues, renderStructure } from './render.js';
import { pseudonymize, browserSalt, decodeHl7 } from './privacy.js';

const $ = (id) => document.getElementById(id);
const configured = !SUPABASE_URL.includes('DEIN-PROJEKT') && !SUPABASE_ANON_KEY.startsWith('DEIN-');

const state = { user: null, examples: [], session: [], current: null, view: 'report', msg: null, scope: 'message' };
// Alle sichtbaren Nachrichten für Fall- und Patientenansicht: id -> { title, report }
let allReports = null;
let allReportsLoading = false;
// Gesichtet-Status nur lokal für die Sitzung (simuliert den Button im Viewer)
const ack = new Set();
ack.onchange = () => update();
let sb = null;

// ---------- Anmeldung ----------

function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-step-mail').hidden = false;
  $('login-step-code').hidden = true;
  $('login-info').textContent = '';
}

async function requestCode(ev) {
  ev.preventDefault();
  const email = $('login-email').value.trim().toLowerCase();
  if (!email) return;
  const btn = $('login-send');
  btn.disabled = true;
  // Anmeldung ausschließlich per Einmalcode (kein Link in der Mail)
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  btn.disabled = false;
  // Bewusst keine Unterscheidung zwischen bekannten und unbekannten Adressen (keine Account-Enumeration).
  if (error && error.status === 429) {
    $('login-info').textContent = 'Zu viele Anfragen. Bitte später erneut versuchen.';
    return;
  }
  $('login-info').textContent = 'Falls die Adresse freigeschaltet ist, wurde eine E-Mail mit einem Anmeldecode versendet.';
  $('login-step-mail').hidden = true;
  $('login-step-code').hidden = false;
  $('login-code').focus();
}

async function verifyCode(ev) {
  ev.preventDefault();
  const email = $('login-email').value.trim().toLowerCase();
  const token = $('login-code').value.replace(/\s/g, '');
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) $('login-info').textContent = 'Code ungültig oder abgelaufen.';
}

async function logout() {
  await sb.auth.signOut();
}

let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  if (state.user) idleTimer = setTimeout(logout, IDLE_LOGOUT_MINUTES * 60 * 1000);
}

// ---------- Datenschutz ----------

// Prüft den Editorinhalt auf wahrscheinlich echte Personendaten und ersetzt sie direkt im Editor.
// Die Änderungen werden am Sitzungseintrag vermerkt und im Hinweis angezeigt.
let pendingChanges = [];
function checkEditor() {
  const ta = $('hl7');
  let res;
  try {
    res = pseudonymize(ta.value, browserSalt());
  } catch {
    return;
  }
  if (!res.changed) return;
  const pos = ta.selectionStart;
  const delta = res.text.length - ta.value.length;
  ta.value = res.text;
  try { ta.setSelectionRange(Math.max(0, pos + delta), Math.max(0, pos + delta)); } catch { /* ignorieren */ }
  pendingChanges.push(...res.changes);
}

function currentSessionItem() {
  return state.current?.kind === 'session' ? state.session.find((x) => x.id === state.current.id) : null;
}

function renderPrivacyNote() {
  const note = $('privacy-note');
  const changes = currentSessionItem()?.privacy || [];
  if (!changes.length) { note.hidden = true; return; }
  note.replaceChildren(
    el('b', { text: 'Die Nachricht enthielt vermutlich echte Personendaten. Folgende Angaben wurden ersetzt:' }),
    el('ul', {}, changes.map((c) => el('li', { text: c }))),
    el('div', { class: 'small', text: 'Freitexte bitte zusätzlich prüfen – dort können weitere Personendaten stehen.' }),
    el('button', { type: 'button', class: 'link', text: 'Hinweis schließen', onclick: () => { note.hidden = true; } }));
  note.hidden = false;
}

// Prüfen, in die Sitzung übernehmen, Hinweis aktualisieren, neu darstellen
function onEditorChange() {
  checkEditor();
  syncEditor();
  const m = currentSessionItem();
  if (m && pendingChanges.length) {
    m.privacy = [...new Set([...(m.privacy || []), ...pendingChanges])];
  }
  pendingChanges = [];
  renderPrivacyNote();
  update();
}

// ---------- Nachrichtenverwaltung ----------
// Aus der Datenbank kommen nur die gemeinsamen Beispiele (nur lesend).
// Eigene Nachrichten existieren ausschließlich im Arbeitsspeicher dieses Browserfensters.

let sessionSeq = 0;

async function loadList() {
  const { data, error } = await sb.from('messages').select('id,title').eq('shared', true).order('title');
  if (error) { toast(`Laden fehlgeschlagen: ${error.message}`); return; }
  state.examples = data;
  allReports = null;
  renderList();
  if (state.scope !== 'message') update();
}

async function loadAllReports() {
  if (allReports || allReportsLoading) return;
  allReportsLoading = true;
  const { data, error } = await sb.from('messages').select('id,title,hl7').eq('shared', true);
  allReportsLoading = false;
  if (error) { toast(`Laden fehlgeschlagen: ${error.message}`); return; }
  allReports = new Map();
  for (const m of data) {
    const report = tryReport(m.hl7);
    if (report) allReports.set(`ex:${m.id}`, { title: m.title, report });
  }
  update();
}

function tryReport(hl7) {
  try {
    const report = buildReport(parseHl7(hl7));
    return report.type === 'ORU^R01' ? report : null;
  } catch {
    return null;
  }
}

function currentKey() {
  return state.current ? `${state.current.kind === 'example' ? 'ex' : 'se'}:${state.current.id}` : null;
}

// Weitere Nachrichten desselben Falls (PV1-19) bzw. Patienten (PID-3): Beispiele + Nachrichten dieser Sitzung
function relatedReports(report) {
  if (state.scope === 'message' || !allReports) return [];
  const pid = report.patient.id;
  const cid = report.visit.caseId;
  if (!pid) return [];
  const pool = [...allReports.entries()];
  for (const m of state.session) {
    const r = tryReport(m.hl7);
    if (r) pool.push([`se:${m.id}`, { title: m.title, report: r }]);
  }
  return pool
    .filter(([key]) => key !== currentKey())
    .map(([, v]) => v)
    .filter((v) => v.report.patient.id === pid && (state.scope === 'patient' || (cid && v.report.visit.caseId === cid)));
}

function setScope(scope) {
  state.scope = scope;
  if (scope !== 'message') loadAllReports();
  update();
}

function renderList() {
  const list = $('msg-list');
  list.replaceChildren();
  const isActive = (kind, id) => state.current?.kind === kind && state.current.id === id;

  list.append(el('div', { class: 'group', text: 'Beispiele' }));
  if (!state.examples.length) list.append(el('div', { class: 'muted small', text: 'keine' }));
  for (const m of state.examples) {
    list.append(el('button', {
      class: `msg-item${isActive('example', m.id) ? ' active' : ''}`, text: m.title, onclick: () => openExample(m.id),
    }));
  }

  list.append(el('div', { class: 'group', text: 'Diese Sitzung' }));
  list.append(el('div', { class: 'muted small', text: 'Nur in diesem Browserfenster, nicht gespeichert.' }));
  for (const m of state.session) {
    list.append(el('div', { class: 'session-item' },
      el('button', { class: `msg-item${isActive('session', m.id) ? ' active' : ''}`, text: m.title, onclick: () => openSession(m.id) }),
      el('button', { class: 'remove-btn', type: 'button', title: 'Aus der Sitzung entfernen', text: '✕', onclick: () => removeSession(m.id) })));
  }
}

function show(current, title, hl7) {
  state.current = current;
  pendingChanges = [];
  $('title').value = title;
  $('hl7').value = hl7;
  renderList();
  renderPrivacyNote();
  update();
}

async function openExample(id) {
  const { data, error } = await sb.from('messages').select('id,title,hl7').eq('id', id).single();
  if (error) { toast(`Öffnen fehlgeschlagen: ${error.message}`); return; }
  show({ kind: 'example', id }, data.title, data.hl7);
}

function openSession(id) {
  const m = state.session.find((x) => x.id === id);
  if (m) show({ kind: 'session', id }, m.title, m.hl7);
}

function newMessage() {
  show(null, '', '');
  $('hl7').focus();
}

function addSession(title, hl7) {
  const m = { id: ++sessionSeq, title: title || `Nachricht ${sessionSeq}`, hl7 };
  state.session.push(m);
  state.current = { kind: 'session', id: m.id };
  $('title').value = m.title;
  renderList();
  return m;
}

// Änderungen im Editor landen in der Sitzungsliste; ein bearbeitetes Beispiel wird zur Kopie
function syncEditor() {
  const hl7 = $('hl7').value;
  if (state.current?.kind === 'session') {
    const m = state.session.find((x) => x.id === state.current.id);
    if (m) m.hl7 = hl7;
  } else if (hl7.trim()) {
    const base = $('title').value.trim();
    addSession(state.current?.kind === 'example' ? `Kopie: ${base}` : base, hl7);
  }
}

function onTitleChange() {
  if (state.current?.kind !== 'session') return;
  const m = state.session.find((x) => x.id === state.current.id);
  if (m) {
    m.title = $('title').value.trim() || m.title;
    renderList();
  }
}

function removeSession(id) {
  state.session = state.session.filter((x) => x.id !== id);
  if (state.current?.kind === 'session' && state.current.id === id) newMessage();
  else { renderList(); update(); }
}

function loadFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  if (file.size > 200_000) { toast('Datei zu groß (max. 200 KB).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const text = decodeHl7(new Uint8Array(reader.result));
    show(null, file.name.replace(/\.[^.]+$/, ''), text);
    onEditorChange();
  };
  reader.readAsArrayBuffer(file);
  ev.target.value = '';
}

// ---------- Darstellung ----------

function update() {
  const out = $('output');
  const text = $('hl7').value;
  out.replaceChildren();
  state.msg = null;
  if (!text.trim()) {
    out.append(el('p', { class: 'muted', text: 'HL7-Nachricht links einfügen, eine Datei laden oder ein Beispiel wählen.' }));
    return;
  }
  try {
    state.msg = parseHl7(text);
  } catch (e) {
    out.append(el('div', { class: 'warn', text: e instanceof Hl7Error ? e.message : `Fehler: ${e.message}` }));
    $('tab-issues').textContent = 'Prüfung';
    return;
  }
  const report = buildReport(state.msg);
  if (state.scope !== 'message' && !allReports) loadAllReports();
  const errors = report.issues.filter((i) => i.level === 'error').length;
  const warnings = report.issues.filter((i) => i.level === 'warning').length;
  $('tab-issues').textContent = `Prüfung${errors || warnings ? ` (${errors} F / ${warnings} W)` : ' ✓'}`;
  $('tab-issues').classList.toggle('has-errors', errors > 0);
  if (state.view === 'report') {
    out.append(renderReport(report, ack, {
      scope: state.scope, onScope: setScope, others: relatedReports(report),
      loading: state.scope !== 'message' && !allReports,
    }));
  } else if (state.view === 'issues') {
    out.append(renderIssues(report, SPEC_VERSION));
  } else {
    out.append(el('p', { class: 'muted small', text: 'Feld anklicken bzw. mit der Maus darauf zeigen, um die HL7-Position zu sehen.' }));
    out.append(el('div', { id: 'pick', class: 'pick' }));
    out.append(renderStructure(state.msg, (pos, val) => {
      $('pick').textContent = `${pos} = ${val}`;
    }));
  }
}

// Klick auf ein Element der Befundansicht springt zum Quellsegment
function onOutputClick(ev) {
  const src = ev.target.closest('.src[data-seg]');
  if (!src || state.view === 'structure' || ev.target.closest('button')) return;
  const seg = src.dataset.seg;
  setView('structure');
  const line = document.querySelector(`.seg[data-seg="${CSS.escape(seg)}"]`);
  if (line) {
    line.classList.add('hl');
    line.scrollIntoView({ block: 'center' });
  }
}

function setView(v) {
  state.view = v;
  for (const t of ['report', 'issues', 'structure']) $(`tab-${t}`).classList.toggle('active', v === t);
  update();
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Start ----------

async function onSession(session) {
  state.user = session?.user ?? null;
  if (!state.user) {
    clearTimeout(idleTimer);
    state.examples = [];
    state.session = [];
    state.current = null;
    pendingChanges = [];
    $('privacy-note').hidden = true;
    $('hl7').value = '';
    $('title').value = '';
    showLogin();
    return;
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('user-email').textContent = state.user.email;
  resetIdle();
  update();
  await loadList();
}

function init() {
  if (!configured) {
    $('login').hidden = false;
    $('login-step-mail').hidden = true;
    $('login-info').textContent = 'Supabase ist noch nicht konfiguriert (js/config.js).';
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  $('login-step-mail').addEventListener('submit', requestCode);
  $('login-step-code').addEventListener('submit', verifyCode);
  $('login-back').addEventListener('click', showLogin);
  $('btn-logout').addEventListener('click', logout);
  $('btn-new').addEventListener('click', newMessage);
  $('title').addEventListener('input', debounce(onTitleChange, 300));
  $('file').addEventListener('change', loadFile);
  // Prüfung bei jeder Änderung (Tippen, Einfügen, Drag & Drop); Einfügen sofort
  $('hl7').addEventListener('input', debounce(onEditorChange, 250));
  $('hl7').addEventListener('paste', () => setTimeout(onEditorChange, 0));
  $('tab-report').addEventListener('click', () => setView('report'));
  $('tab-issues').addEventListener('click', () => setView('issues'));
  $('tab-structure').addEventListener('click', () => setView('structure'));
  $('output').addEventListener('click', onOutputClick);
  for (const evName of ['click', 'keydown', 'mousemove', 'touchstart']) {
    document.addEventListener(evName, debounce(resetIdle, 1000), { passive: true });
  }

  sb.auth.onAuthStateChange((event, session) => {
    // Callback darf keine weiteren Supabase-Aufrufe blockieren
    setTimeout(() => onSession(session), 0);
  });
}

init();
