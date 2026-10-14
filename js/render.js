// DOM-Aufbau: Befundansicht (angelehnt an den iMedOne-Mikrobiologie-Viewer), Prüfergebnis, HL7-Struktur.
// Sicherheitsregel: Inhalte aus Nachrichten werden ausschließlich über textContent gesetzt, nie über innerHTML.

import { interpretationText } from './micro.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const segData = (i) => (i != null ? { seg: i } : {});

function age(birth) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(birth || '');
  if (!m) return '';
  const b = new Date(+m[3], +m[2] - 1, +m[1]);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return `${a} Jahre`;
}

function cleanNotes(notes) {
  const lines = notes.join('\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines;
}

// „Bemerkung anzeigen/verbergen“ wie im Viewer
function remark(notes, segIndex, open = false) {
  const lines = cleanNotes(notes);
  if (!lines.length) return null;
  const body = el('div', { class: 'remark-text src', dataset: segData(segIndex) },
    lines.map((l) => el('div', { text: l || ' ' })));
  body.hidden = !open;
  const btn = el('button', { class: 'remark-toggle', type: 'button' });
  const sync = () => { btn.textContent = body.hidden ? 'Bemerkung anzeigen ▾' : 'Bemerkung verbergen ▴'; };
  btn.addEventListener('click', () => { body.hidden = !body.hidden; sync(); });
  sync();
  return el('div', { class: 'remark' }, body, btn);
}

function row(label, value, segIndex, extra) {
  return el('div', { class: 'vrow src', dataset: segData(segIndex) },
    el('span', { class: 'vlabel', text: label.replace(/\s+/g, ' ').trim() }),
    el('span', { class: 'vsep', text: ':' }),
    el('span', { class: 'vvalue' }, value, extra));
}

function documentRow(doc) {
  const d = doc.document;
  const btn = el('button', {
    class: 'secondary small-btn', type: 'button', text: 'PDF herunterladen',
    onclick: () => {
      try {
        const bin = atob(d.data.replace(/\s/g, ''));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = el('a', { href: url, download: `${(d.title || 'Dokument').replace(/[^\w.\- ]+/g, '_')}.pdf` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch {
        alert('Dokumenteninhalt ist kein gültiges Base64.');
      }
    },
  });
  return el('div', { class: 'vrow doc src', dataset: segData(doc.segIndex) },
    el('span', { class: 'vlabel', text: `Dokument: ${d.title || '(ohne Titel)'}` }),
    el('span', { class: 'vsep', text: '' }),
    el('span', { class: 'vvalue' }, btn));
}

function valueText(o) {
  return [o.value, o.unit].filter(Boolean).join(' ');
}

function renderObr(obr) {
  const sec = el('div', { class: 'obr' },
    el('div', { class: 'obr-title src', dataset: segData(obr.segIndex), text: obr.text || obr.code }));
  sec.append(...obr.documents.map(documentRow));
  if (obr.notes.length && obr.kind !== 'CMT') sec.append(remark(obr.notes, obr.segIndex));

  if (obr.kind === 'ABG') {
    sec.append(renderAntibiogram(obr));
    return sec;
  }
  if (obr.kind === 'CMT') {
    const lines = cleanNotes(obr.notes);
    sec.append(el('div', { class: 'cmt src', dataset: segData(obr.segIndex) }, lines.map((l) => el('div', { text: l || ' ' }))));
    return sec;
  }

  obr.observations.forEach((o, i) => {
    if (o.type === 'IS') {
      // Erregername nur bei OBR-31 = MOI als Mikroorganismus (erstes OBX)
      if (obr.kind === 'MOI' && i === 0) {
        sec.append(el('div', { class: 'organism src', dataset: segData(o.segIndex), text: o.value }));
      }
    } else {
      sec.append(row(o.name || o.code, valueText(o), o.segIndex,
        o.flag ? el('span', { class: 'flag', text: ` ${o.flag}` }) : null));
    }
    if (o.notes.length) sec.append(remark(o.notes, o.segIndex));
  });
  return sec;
}

function renderAntibiogram(obr) {
  const groups = new Map();
  for (const o of obr.observations) {
    const g = o.method || 'OTHERS';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(o);
  }
  const body = el('tbody');
  for (const [g, items] of groups) {
    body.append(el('tr', { class: 'abx-group' }, el('th', { colspan: '3', text: g })));
    for (const o of items) {
      body.append(el('tr', { class: 'src', dataset: segData(o.segIndex) },
        el('td', { text: o.name || o.code }),
        el('td', { class: 'mic', text: valueText(o) }),
        el('td', { class: `sir sir-${o.flag.toLowerCase()}`, title: interpretationText(o.flag), text: o.flag })));
      if (o.notes.length) {
        body.append(el('tr', {}, el('td', { colspan: '3' }, remark(o.notes, o.segIndex))));
      }
    }
  }
  return el('div', { class: 'table-wrap' }, el('table', { class: 'abx' },
    el('thead', {}, el('tr', {}, el('th', { text: 'Antibiotikum' }), el('th', { text: 'MHK' }), el('th', { text: 'Bewertung' }))),
    body));
}

export function renderReport(report, ack) {
  const root = el('div', { class: 'report' });
  const p = report.patient;
  const name = [[p.prefix, p.family].filter(Boolean).join(' '), [p.given, p.middle].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  root.append(el('div', { class: 'patbar' },
    [name || 'Unbekannter Patient', age(p.birth), p.birth, p.id && `Pat.-Nr. ${p.id}`, report.visit.caseId && `Fall ${report.visit.caseId}`]
      .filter(Boolean).join('; ')));

  if (report.type === 'ORM^O01') {
    const o = report.order;
    root.append(el('div', { class: `orm st-${(o?.status || '').toLowerCase()}` },
      el('div', { class: 'orm-title', text: 'Auftragsstatus (ORM)' }),
      o ? [
        row('Auftragsnr.', o.placer || '–', null),
        row('Status', `${o.status} – ${o.statusText}`, null),
        o.status === 'RJ' ? row('Ablehnungsgrund', o.rejectReason || '–', null) : null,
      ] : el('p', { class: 'muted', text: 'Kein ORC-Segment.' })));
    return root;
  }

  const viewer = el('div', { class: 'viewer-box' },
    el('div', { class: 'viewer-head' }, el('span', { class: 'pill', text: 'Mikrobiologie' })));
  root.append(viewer);

  if (report.order?.notes.length) viewer.append(remark(report.order.notes, null, true));

  report.groups.forEach((grp, gi) => {
    const key = `${report.header.controlId}|${grp.collectedRaw}`;
    const seen = ack.has(key);
    const details = el('details', { class: `grp grp-${grp.status === 'F' ? 'final' : 'interim'}`, open: gi === 0 ? '' : null },
      el('summary', {},
        `Entnahme ${grp.collected || '–'}${grp.specimenText ? ` Specimen ${grp.specimenText}` : ''}, ${grp.statusText} Ergebnisstatus`,
        seen ? null : el('span', { class: 'unseen', text: ' (ungesichtete Ergebnisse)' })));
    const ackBtn = el('button', {
      class: seen ? 'small-btn' : 'secondary small-btn', type: 'button', text: seen ? 'gesichtet' : 'ungesichtet',
      onclick: () => { if (seen) ack.delete(key); else ack.add(key); ack.onchange?.(); },
    });
    details.append(el('div', { class: 'grp-meta' },
      el('span', {}, el('b', { text: 'Auftragsnr. ' }), grp.orderNo || '–'),
      el('span', {}, el('b', { text: 'Befunddatum ' }), grp.resultTime || '–'),
      el('span', {}, el('b', { text: 'Ergebnisstatus ' }), grp.statusText),
      ackBtn));
    details.append(...grp.obrs.map(renderObr));
    viewer.append(details);
  });

  if (!report.groups.length) viewer.append(el('p', { class: 'muted', text: 'Keine Ergebnisse in der Nachricht.' }));

  root.append(el('div', { class: 'footer-meta', text:
    [report.type, report.header.sendingApp && `Absender ${report.header.sendingApp}`,
      report.header.time && `gesendet ${report.header.time}`, report.header.controlId && `Kontroll-ID ${report.header.controlId}`,
      report.header.version && `HL7 ${report.header.version}`].filter(Boolean).join(' · ') }));
  return root;
}

const LEVEL = { error: 'Fehler', warning: 'Warnung', info: 'Hinweis' };

export function renderIssues(report, specVersion) {
  const root = el('div', { class: 'issues' });
  const counts = { error: 0, warning: 0, info: 0 };
  report.issues.forEach((i) => { counts[i.level]++; });
  root.append(el('p', { class: 'muted small',
    text: `Prüfung gegen Schnittstellenbeschreibung HL7-IN Mikrobiologiebefunde, Version ${specVersion}. ` +
      `${counts.error} Fehler, ${counts.warning} Warnungen, ${counts.info} Hinweise.` }));
  if (!report.issues.length) {
    root.append(el('div', { class: 'ok', text: 'Keine Abweichungen gefunden.' }));
    return root;
  }
  root.append(el('table', { class: 'issue-table' },
    el('thead', {}, el('tr', {}, ['Stufe', 'Zeile', 'Feld', 'Meldung'].map((h) => el('th', { text: h })))),
    el('tbody', {}, report.issues.map((i) => el('tr', { class: `lvl-${i.level} src`, dataset: segData(i.seg) },
      el('td', {}, el('span', { class: `badge b-${i.level}`, text: LEVEL[i.level] })),
      el('td', { text: i.seg != null ? String(i.seg + 1) : '–' }),
      el('td', { class: 'mono', text: i.field }),
      el('td', { text: i.text }))))));
  return root;
}

// Rohnachricht, jedes Feld mit Positionsangabe (z. B. OBX-5.2) als Tooltip
export function renderStructure(msg, onPick) {
  const { enc, segments } = msg;
  const root = el('div', { class: 'structure' });
  for (const seg of segments) {
    const line = el('div', { class: 'seg', dataset: { seg: seg.index } },
      el('span', { class: 'lno', text: String(seg.index + 1) }),
      el('span', { class: 'sname', text: seg.name }));
    for (let i = 1; i < seg.rawFields.length; i++) {
      const fieldNo = seg.name === 'MSH' ? i + 1 : i;
      line.append(el('span', { class: 'sep', text: enc.field }));
      const raw = seg.rawFields[i];
      if (seg.name === 'MSH' && i === 1) {
        line.append(el('span', { class: 'fld', title: 'MSH-2', text: raw }));
        continue;
      }
      const reps = raw.split(enc.repetition);
      reps.forEach((rep, ri) => {
        if (ri) line.append(el('span', { class: 'sep', text: enc.repetition }));
        rep.split(enc.component).forEach((comp, ci) => {
          if (ci) line.append(el('span', { class: 'sep', text: enc.component }));
          if (comp === '') return;
          const pos = `${seg.name}-${fieldNo}${reps.length > 1 ? `[${ri + 1}]` : ''}.${ci + 1}`;
          const shown = comp.length > 120 ? `${comp.slice(0, 120)}… (${comp.length} Zeichen)` : comp;
          line.append(el('span', { class: 'fld', title: pos, text: shown, onclick: () => onPick?.(pos, shown) }));
        });
      });
    }
    root.append(line);
  }
  return root;
}
