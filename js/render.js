// DOM-Aufbau für Befundansicht und HL7-Strukturansicht.
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

const SEX = { M: 'männlich', F: 'weiblich', W: 'weiblich', D: 'divers', U: 'unbekannt', O: 'divers' };

function kv(label, value, segIndex) {
  if (!value) return null;
  return el('div', { class: 'kv' },
    el('span', { class: 'k', text: label }),
    el('span', { class: 'v src', text: value, dataset: segIndex != null ? { seg: segIndex } : {} }));
}

function multiline(text) {
  const parts = String(text).split('\n');
  const out = [];
  parts.forEach((p, i) => { if (i) out.push(el('br')); out.push(p); });
  return out;
}

export function renderReport(report) {
  const root = el('div', { class: 'report' });
  const p = report.patient;
  const main = report.orders.find((o) => !o.parentObs && !o.parentFiller) || report.orders[0];

  if (report.warnings.length) {
    root.append(el('div', { class: 'warn' }, report.warnings.map((w) => el('div', { text: w }))));
  }

  // Kopf
  root.append(el('section', { class: 'card head' },
    el('div', { class: 'head-row' },
      el('div', {},
        el('div', { class: 'pat-name', text: [p.family, p.given].filter(Boolean).join(', ') || 'Unbekannter Patient' }),
        el('div', { class: 'pat-meta' },
          [p.birth && `* ${p.birth}`, SEX[p.sex] || p.sex, p.id && `PID ${p.id}`, report.visit.caseId && `Fall ${report.visit.caseId}`]
            .filter(Boolean).join(' · '))),
      main ? el('span', { class: `status st-${(main.status || 'x').toLowerCase()}`, text: main.statusText || 'Status unbekannt' }) : null),
    main ? el('div', { class: 'grid' },
      kv('Untersuchung', main.text, main.segIndex),
      kv('Material', [main.specimen, main.specimenSite].filter(Boolean).join(' – '), main.segIndex),
      kv('Entnahme', main.collected, main.segIndex),
      kv('Eingang Labor', main.received, main.segIndex),
      kv('Befundzeit', main.resultTime, main.segIndex),
      kv('Auftragsnr.', [main.placer, main.filler].filter(Boolean).join(' / '), main.segIndex),
      kv('Station', [report.visit.ward, report.visit.room, report.visit.bed].filter(Boolean).join(' / ')),
      kv('Einsender', main.orderedBy || report.visit.attending),
    ) : null,
  ));

  const { isolates, antibiotics, findings } = report.micro;

  // Sonstige Befunde
  if (findings.length) {
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Befund' }),
      el('table', { class: 'findings' }, el('tbody', {}, findings.map((f) =>
        el('tr', { class: 'src', dataset: { seg: f.segIndex } },
          el('th', { text: f.name }),
          el('td', {}, multiline([f.value, f.unit].filter(Boolean).join(' ')),
            f.flag ? el('span', { class: 'flag', text: ` (${f.flag})` }) : null,
            f.notes.map((n) => el('div', { class: 'note' }, multiline(n)))))))),
    ));
  }

  // Erreger
  if (isolates.length) {
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Erregernachweis' }),
      el('ol', { class: 'isolates' }, isolates.map((iso) =>
        el('li', { class: 'src', dataset: iso.segIndex != null ? { seg: iso.segIndex } : {} },
          el('span', { class: 'org', text: iso.organism }),
          iso.quantity ? el('span', { class: 'qty', text: iso.quantity }) : null,
          iso.notes.map((n) => el('div', { class: 'note' }, multiline(n)))))),
    ));
  } else {
    root.append(el('section', { class: 'card' }, el('h3', { text: 'Erregernachweis' }),
      el('p', { class: 'muted', text: 'Kein Erreger in der Nachricht erkannt.' })));
  }

  // Antibiogramm
  if (antibiotics.length) {
    const withAbx = isolates.filter((i) => i.abx.length);
    const table = el('table', { class: 'abx' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Antibiotikum' }),
        withAbx.map((iso) => el('th', { title: iso.organism }, `Isolat ${iso.number}`,
          el('div', { class: 'th-org', text: iso.organism }))))),
      el('tbody', {}, antibiotics.map((ab) => el('tr', {},
        el('th', { text: ab.name }),
        withAbx.map((iso) => {
          const r = iso.abx.find((a) => (a.code || a.name) === ab.key);
          if (!r) return el('td', { class: 'empty', text: '' });
          return el('td', {
            class: `sir sir-${r.flag.toLowerCase()} src`,
            title: `${interpretationText(r.flag)}${r.mic ? ` · MHK ${r.mic} ${r.unit}` : ''}`,
            dataset: { seg: r.segIndex },
          }, el('b', { text: r.flag }), r.mic ? el('span', { class: 'mic', text: r.mic }) : null);
        })))));
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Antibiogramm' }),
      el('div', { class: 'table-wrap' }, table),
      el('div', { class: 'legend' },
        ['S', 'I', 'R'].map((c) => el('span', {}, el('b', { class: `sir-${c.toLowerCase()}`, text: c }), ` ${interpretationText(c)}`)),
        el('span', { text: 'Zahl = MHK' })),
    ));
  }

  // Kommentare zum Auftrag
  const orderNotes = report.orders.flatMap((o) => o.notes.map((n) => ({ n, seg: o.segIndex })));
  const obsNotes = report.orders.flatMap((o) => o.observations
    .filter((ob) => ob.notes.length && !findings.includes(ob))
    .flatMap((ob) => ob.notes.map((n) => ({ n, seg: ob.segIndex }))))
    .filter((x) => !isolates.some((i) => i.segIndex === x.seg) && !findings.some((f) => f.segIndex === x.seg));
  const notes = [...orderNotes, ...obsNotes];
  if (notes.length) {
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Kommentar' }),
      notes.map(({ n, seg }) => el('p', { class: 'note src', dataset: { seg } }, multiline(n)))));
  }

  root.append(el('div', { class: 'footer-meta', text:
    [report.header.sendingApp && `Absender ${report.header.sendingApp}`, report.header.time && `gesendet ${report.header.time}`,
      report.header.controlId && `Kontroll-ID ${report.header.controlId}`, report.header.version && `HL7 ${report.header.version}`]
      .filter(Boolean).join(' · ') }));

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
    const start = seg.name === 'MSH' ? 1 : 1;
    for (let i = start; i < seg.rawFields.length; i++) {
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
          const pos = `${seg.name}-${fieldNo}${reps.length > 1 ? `[${ri + 1}]` : ''}.${ci + 1}`;
          if (comp === '') return;
          line.append(el('span', {
            class: 'fld', title: pos, text: comp,
            onclick: () => onPick?.(pos, comp),
          }));
        });
      });
    }
    root.append(line);
  }
  return root;
}
