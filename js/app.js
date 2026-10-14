import { SUPABASE_URL, SUPABASE_ANON_KEY, IDLE_LOGOUT_MINUTES } from './config.js';
import { parseHl7, Hl7Error } from './hl7.js';
import { buildReport, SPEC_VERSION } from './micro.js';
import { el, renderReport, renderIssues, renderStructure } from './render.js';
import { pseudonymize, browserSalt } from './privacy.js';

const $ = (id) => document.getElementById(id);
const configured = !SUPABASE_URL.includes('DEIN-PROJEKT') && !SUPABASE_ANON_KEY.startsWith('DEIN-');

const state = { user: null, messages: [], current: null, view: 'report', msg: null, scope: 'message' };
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

// Prüft auf wahrscheinlich echte Personendaten und pseudonymisiert sie; informiert den Nutzer.
function applyPrivacy(text) {
  let res;
  try {
    res = pseudonymize(text, browserSalt());
  } catch {
    return text;
  }
  const note = $('privacy-note');
  if (!res.changed) return text;
  note.replaceChildren(
    el('b', { text: 'Die Nachricht enthielt vermutlich echte Personendaten und wurde pseudonymisiert:' }),
    el('ul', {}, res.changes.map((c) => el('li', { text: c }))),
    el('div', { class: 'small', text: 'Freitexte bitte zusätzlich prüfen – dort können weitere Personendaten stehen.' }),
    el('button', { type: 'button', class: 'link', text: 'Hinweis schließen', onclick: () => { note.hidden = true; } }));
  note.hidden = false;
  return res.text;
}

function onPaste() {
  // Einfügen abwarten, dann den gesamten Inhalt prüfen
  setTimeout(() => {
    const ta = $('hl7');
    const checked = applyPrivacy(ta.value);
    if (checked !== ta.value) {
      ta.value = checked;
      update();
    }
  }, 0);
}

// ---------- Nachrichtenverwaltung ----------

async function loadList() {
  const { data, error } = await sb.from('messages')
    .select('id,title,shared,owner_id,updated_at')
    .order('shared', { ascending: false })
    .order('title');
  if (error) { toast(`Laden fehlgeschlagen: ${error.message}`); return; }
  state.messages = data;
  allReports = null;
  renderList();
  if (state.scope !== 'message') update();
}

async function loadAllReports() {
  if (allReports || allReportsLoading) return;
  allReportsLoading = true;
  const { data, error } = await sb.from('messages').select('id,title,hl7');
  allReportsLoading = false;
  if (error) { toast(`Laden fehlgeschlagen: ${error.message}`); return; }
  allReports = new Map();
  for (const m of data) {
    try {
      const report = buildReport(parseHl7(m.hl7));
      if (report.type === 'ORU^R01') allReports.set(m.id, { title: m.title, report });
    } catch { /* fehlerhafte Nachrichten ignorieren */ }
  }
  update();
}

// Weitere Nachrichten desselben Falls (PV1-19) bzw. Patienten (PID-3)
function relatedReports(report) {
  if (state.scope === 'message' || !allReports) return [];
  const pid = report.patient.id;
  const cid = report.visit.caseId;
  if (!pid) return [];
  return [...allReports.entries()]
    .filter(([id]) => id !== state.current?.id)
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
  const groups = [
    ['Beispiele', state.messages.filter((m) => m.shared)],
    ['Eigene Nachrichten', state.messages.filter((m) => !m.shared)],
  ];
  for (const [title, items] of groups) {
    list.append(el('div', { class: 'group', text: title }));
    if (!items.length) list.append(el('div', { class: 'muted small', text: 'keine' }));
    for (const m of items) {
      list.append(el('button', {
        class: `msg-item${state.current?.id === m.id ? ' active' : ''}`,
        text: m.title,
        onclick: () => openMessage(m.id),
      }));
    }
  }
}

async function openMessage(id) {
  const { data, error } = await sb.from('messages').select('id,title,hl7,shared,owner_id').eq('id', id).single();
  if (error) { toast(`Öffnen fehlgeschlagen: ${error.message}`); return; }
  state.current = data;
  $('privacy-note').hidden = true;
  $('title').value = data.title;
  $('hl7').value = data.hl7;
  updateButtons();
  renderList();
  update();
}

function newMessage() {
  state.current = null;
  $('privacy-note').hidden = true;
  $('title').value = '';
  $('hl7').value = '';
  updateButtons();
  renderList();
  update();
  $('hl7').focus();
}

function isOwn() {
  return state.current && state.current.owner_id === state.user?.id;
}

function updateButtons() {
  $('btn-delete').hidden = !isOwn();
  $('btn-save').textContent = isOwn() ? 'Speichern' : 'Als eigene Nachricht speichern';
}

async function save() {
  const title = $('title').value.trim() || 'Ohne Titel';
  const hl7 = applyPrivacy($('hl7').value);
  if (hl7 !== $('hl7').value) {
    $('hl7').value = hl7;
    update();
  }
  let res;
  if (isOwn()) {
    res = await sb.from('messages').update({ title, hl7, updated_at: new Date().toISOString() })
      .eq('id', state.current.id).select('id,title,hl7,shared,owner_id').single();
  } else {
    res = await sb.from('messages').insert({ title, hl7 }).select('id,title,hl7,shared,owner_id').single();
  }
  if (res.error) { toast(`Speichern fehlgeschlagen: ${res.error.message}`); return; }
  state.current = res.data;
  updateButtons();
  await loadList();
  toast('Gespeichert.');
}

async function remove() {
  if (!isOwn() || !confirm(`„${state.current.title}“ löschen?`)) return;
  const { error } = await sb.from('messages').delete().eq('id', state.current.id);
  if (error) { toast(`Löschen fehlgeschlagen: ${error.message}`); return; }
  newMessage();
  await loadList();
}

function loadFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  if (file.size > 200_000) { toast('Datei zu groß (max. 200 KB).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    state.current = null;
    $('title').value = file.name.replace(/\.[^.]+$/, '');
    $('hl7').value = applyPrivacy(String(reader.result));
    updateButtons();
    renderList();
    update();
  };
  reader.readAsText(file);
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
    state.messages = [];
    state.current = null;
    $('hl7').value = '';
    $('title').value = '';
    showLogin();
    return;
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('user-email').textContent = state.user.email;
  resetIdle();
  updateButtons();
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
  $('btn-save').addEventListener('click', save);
  $('btn-delete').addEventListener('click', remove);
  $('file').addEventListener('change', loadFile);
  $('hl7').addEventListener('input', debounce(update, 250));
  $('hl7').addEventListener('paste', onPaste);
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
