import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHl7, get, unescapeHl7, Hl7Error } from '../js/hl7.js';
import { buildReport } from '../js/micro.js';

const load = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8');
const report = (name) => buildReport(parseHl7(load(name)));
const has = (r, field, level) => r.issues.some((i) => i.field === field && (!level || i.level === level));

test('Parser: MSH-Felder, Subkomponenten und Escape-Sequenzen', () => {
  const msg = parseHl7(load('oru_urin_spezifikationsbeispiel.hl7'));
  const msh = msg.segments[0];
  assert.equal(get(msh, msg.enc, 1), '|');
  assert.equal(get(msh, msg.enc, 2), '^~\\&');
  assert.equal(get(msh, msg.enc, 9, 2), 'R01');
  const obr = msg.segments.find((s) => s.name === 'OBR');
  assert.equal(get(obr, msg.enc, 15, 1, 1, 2), 'URINE RANDOM');
  assert.equal(unescapeHl7('a\\F\\b\\.br\\c\\T\\d', msg.enc), 'a|b\nc&d');
});

test('Parser: lehnt Nachricht ohne MSH ab, akzeptiert LF und MLLP', () => {
  assert.throws(() => parseHl7('PID|1||123'), Hl7Error);
  const msg = parseHl7('\x0b' + load('orm_status_abgelehnt.hl7').replace(/\r/g, '\n') + '\x1c');
  assert.equal(msg.segments.at(-1).name, 'ORC');
});

test('Spezifikationsbeispiel: Abschnitte, Isolate, Bemerkungen', () => {
  const r = report('oru_urin_spezifikationsbeispiel.hl7');
  assert.equal(r.groups.length, 1);
  const [grp] = r.groups;
  assert.equal(grp.collected, '09/07/26 12:57');
  assert.equal(grp.specimenText, 'UR-URINE RANDOM');
  assert.equal(grp.statusText, 'Final');
  assert.equal(grp.orderNo, 'DEM-25');
  assert.deepEqual(r.obrs.map((o) => o.text), ['URINE ANALYSIS', 'URINE MACROSCOPY', 'URINE MICROSCOPY',
    'URINE BIOCHEMISTRY', 'Urine Culture Isolate - 1', 'Urine Culture Isolate - 2']);
  const colour = r.obrs[1].observations[0];
  assert.equal(colour.value, 'Slightly cloudy & yellow');
  const sg = r.obrs[3].observations.at(-1);
  assert.equal(sg.notes[0], 'IDENTIFICATION1 AND SENSITIVITY TO FOLLOW');
  const iso1 = r.obrs[4];
  assert.equal(iso1.kind, 'MOI');
  assert.equal(iso1.observations[0].type, 'IS');
  assert.equal(iso1.observations[0].value, 'GRAM NEG. BACILLI');
  assert.equal(iso1.observations[1].notes.length, 6);
  assert.equal(r.obrs[5].kind, '');
});

test('Spezifikationsbeispiel: Prüfung meldet die Abweichungen des Beispiels', () => {
  const r = report('oru_urin_spezifikationsbeispiel.hl7');
  assert.ok(has(r, 'ORC-3', 'warning'));       // Filler Order Number muss leer sein
  assert.ok(has(r, 'MSH-10', 'warning'));      // Control ID länger als 10
  assert.ok(has(r, 'MSH-16', 'info'));         // AL statt NE
  assert.ok(has(r, 'OBX-8', 'warning'));       // Flag außerhalb ABG
  assert.ok(has(r, 'OBR-31', 'info'));         // IS ohne MOI
  assert.ok(!r.issues.some((i) => i.level === 'error'), JSON.stringify(r.issues.filter((i) => i.level === 'error')));
});

test('Blutkultur: Zwischenbefund, Antibiogramm mit Wirkstoffgruppen, CMT', () => {
  const r = report('oru_blutkultur_antibiogramm.hl7');
  assert.equal(r.groups[0].statusText, 'Intermediate');
  assert.equal(r.groups[0].specimenText, 'BK-BLOOD CULTURE,Description:VEN-Venous blood');
  const abg = r.obrs.find((o) => o.kind === 'ABG');
  assert.equal(abg.text, 'Blood Culture Isolate - 1 - Antibiogram');
  assert.equal(abg.observations.length, 8);
  assert.equal(abg.observations[0].flag, 'R');
  assert.equal(abg.observations[0].method, 'Penicillins');
  const cmt = r.obrs.find((o) => o.kind === 'CMT');
  assert.equal(cmt.notes.length, 2);
  assert.ok(!r.issues.some((i) => i.level !== 'info'), JSON.stringify(r.issues));
  assert.ok(has(r, 'OBX-17', 'info'));         // Cotrimoxazol ohne Wirkstoffgruppe
});

test('PDF-Dokument (ED) wird erkannt und geprüft', () => {
  const r = report('oru_wundabstrich_pdf.hl7');
  const [doc] = r.obrs[0].documents;
  assert.equal(doc.document.title, 'Microbiology report (PDF)');
  assert.equal(doc.document.subType, 'PDF');
  assert.match(Buffer.from(doc.document.data, 'base64').toString('latin1'), /^%PDF-1\.4/);
  assert.equal(r.obrs[0].observations.length, 1);
  assert.deepEqual(r.issues.map((i) => i.level), ['info']);
  assert.match(r.issues[0].text, /DMS/);
});

test('ORM-Statusnachricht: Ablehnung mit Grund', () => {
  const r = report('orm_status_abgelehnt.hl7');
  assert.equal(r.type, 'ORM^O01');
  assert.equal(r.order.status, 'RJ');
  assert.equal(r.order.rejectReason, 'Sample container leaking');
  assert.ok(!r.issues.some((i) => i.level === 'error'));
});

test('Prüfregeln: CMT ohne ABG, MOI ohne IS, falsches OBR-24', () => {
  const msg = [
    'MSH|^~\\&|LAB||iMedOne||20260101120000||ORU^R01|X1|P|2.4',
    'PID|1||1',
    'PV1|1|I||||||||||||||||||9',
    'OBR|1|||^Test|||20260101100000|||||||||||||||||LAB|F||||||MOI',
    'OBX|1|ST|A^A||x||||||F|||20260101100000',
    'OBR|2|||C^Kommentar|||20260101100000|||||||||||||||||MB|F||||||CMT',
  ].join('\r');
  const r = buildReport(parseHl7(msg));
  assert.ok(has(r, 'OBR-4.1', 'error'));
  assert.ok(has(r, 'OBR-24', 'error'));
  assert.ok(has(r, 'OBX-2', 'error'));
  assert.ok(r.issues.some((i) => i.field === 'OBR-31' && /CMT/.test(i.text)));
});

test('Fall- und Patientenzuordnung der Beispiele', () => {
  const a = report('oru_blutkultur_antibiogramm.hl7');
  const b = report('oru_blutkultur_endbefund.hl7');
  const c = report('oru_urin_frueherer_fall.hl7');
  assert.equal(a.patient.id, b.patient.id);
  assert.equal(a.visit.caseId, b.visit.caseId);
  assert.equal(a.patient.id, c.patient.id);
  assert.notEqual(a.visit.caseId, c.visit.caseId);
  assert.equal(b.groups[0].statusText, 'Final');
  assert.ok(!b.issues.some((i) => i.level === 'error'));
  assert.ok(!c.issues.some((i) => i.level === 'error'));
});

test('Hinweis bei HTML-Tags im Text', () => {
  const msg = [
    'MSH|^~\\&|LAB||iMedOne||20260101120000||ORU^R01|X1|P|2.4',
    'PID|1||1||MUSTER^TEST',
    'PV1|1|I||||||||||||||||||9',
    'OBR|1|||C^Kommentar|||20260101100000|||||||||||||||20260101110000||MB|F',
    'OBX|1|ST|C^COMMENT||Zeile 1<BR>Zeile 2||||||F|||20260101100000',
  ].join('\r');
  const r = buildReport(parseHl7(msg));
  assert.equal(r.obrs[0].observations[0].value, 'Zeile 1<BR>Zeile 2');
  assert.ok(r.issues.some((i) => i.field === 'OBX-5' && /<BR>/.test(i.text) && /\\\.br\\/.test(i.text)));
});

test('Fehlendes OBX-14 ist nur eine Warnung, wenn OBR-7 gesetzt ist', () => {
  const base = [
    'MSH|^~\\&|LAB||iMedOne||20260101120000||ORU^R01|X1|P|2.4',
    'PID|1||1||MUSTER^TEST',
    'PV1|1|I||||||||||||||||||9',
  ];
  const withObr7 = buildReport(parseHl7([...base,
    'OBR|1|||C^Kultur|||20260101100000|||||||||||||||20260101110000||MB|F',
    'OBX|1|ST|C^Kultur||negativ||||||F'].join('\r')));
  assert.deepEqual(withObr7.issues.filter((i) => i.field === 'OBX-14').map((i) => i.level), ['warning']);
  const without = buildReport(parseHl7([...base,
    'OBR|1|||C^Kultur||||||||||||||||||20260101110000||MB|F',
    'OBX|1|ST|C^Kultur||negativ||||||F'].join('\r')));
  assert.deepEqual(without.issues.filter((i) => i.field === 'OBX-14').map((i) => i.level), ['error']);
});

test('OBX-8: Antibiotika ohne ABG (Gruppe in OBX-17 oder S/I/R) erzeugen keine Warnung', () => {
  const msg = [
    'MSH|^~\\&|LAB||iMedOne||20260101120000||ORU^R01|X1|P|2.4',
    'PID|1||1||MUSTER^TEST',
    'PV1|1|I||||||||||||||||||9',
    'OBR|1|||ZMGCUL^Isolate - 1 Antibiogram|||20260101100000|||||||||||||||20260101110000||MB|F',
    'OBX|1|ST|42355-8^TIGECYCLINE||2|||S|||F|||20260101100000',
    'OBX|2|ST|16-6^AMPICILLIN||>=32|||R|||F|||20260101100000|||PENICILLINS',
    'OBX|3|ST|LEST^LEUCOCYTE ESTERASE||3 plus|||**|||F|||20260101100000',
  ].join('\r');
  const r = buildReport(parseHl7(msg));
  const w = r.issues.filter((i) => i.field === 'OBX-8');
  assert.equal(w.length, 1);
  assert.match(w[0].text, /\*\*/);
  const obr31 = r.issues.filter((i) => i.field === 'OBR-31');
  assert.equal(obr31.length, 1);
  assert.equal(obr31[0].level, 'warning');
  assert.match(obr31[0].text, /2 Antibiotika-Zeile/);
});
