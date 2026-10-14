import { SUPABASE_URL, SUPABASE_ANON_KEY, IDLE_LOGOUT_MINUTES } from './config.js';
import { parseHl7, Hl7Error } from './hl7.js';
import { buildReport } from './micro.js';
import { el, renderReport, renderStructure } from './render.js';

const $ = (id) => document.getElementById(id);
const configured = !SUPABASE_URL.includes('DEIN-PROJEKT') && !SUPABASE_ANON_KEY.startsWith('DEIN-');

const state = { user: null, messages: [], current: null, view: 'report', msg: null };
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
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  btn.disabled = false;
  // Bewusst keine Unterscheidung zwischen bekannten und unbekannten Adressen (keine Account-Enumeration).
  if (error && error.status === 429) {
    $('login-info').textContent = 'Zu viele Anfragen. Bitte später erneut versuchen.';
    return;
  }
  $('login-info').textContent = 'Falls die Adresse freigeschaltet ist, wurde eine E-Mail mit Anmeldelink und Code versendet.';
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

// ---------- Nachrichtenverwaltung ----------

async function loadList() {
  const { data, error } = await sb.from('messages')
    .select('id,title,shared,owner_id,updated_at')
    .order('shared', { ascending: false })
    .order('title');
  if (error) { toast(`Laden fehlgeschlagen: ${error.message}`); return; }
  state.messages = data;
  renderList();
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
  $('title').value = data.title;
  $('hl7').value = data.hl7;
  updateButtons();
  renderList();
  update();
}

function newMessage() {
  state.current = null;
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
  const hl7 = $('hl7').value;
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
    $('hl7').value = String(reader.result);
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
    return;
  }
  if (state.view === 'report') {
    out.append(renderReport(buildReport(state.msg)));
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
  if (!src || state.view !== 'report') return;
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
  $('tab-report').classList.toggle('active', v === 'report');
  $('tab-structure').classList.toggle('active', v === 'structure');
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
  // Anmeldeparameter aus der Adresszeile entfernen
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);
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
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
  $('tab-report').addEventListener('click', () => setView('report'));
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
