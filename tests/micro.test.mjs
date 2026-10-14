import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHl7, get, unescapeHl7, Hl7Error } from '../js/hl7.js';
import { buildReport } from '../js/micro.js';

const load = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8');

test('Parser: MSH-Felder und Escape-Sequenzen', () => {
  const msg = parseHl7(load('urinkultur_kind-obr.hl7'));
  const msh = msg.segments[0];
  assert.equal(get(msh, msg.enc, 1), '|');
  assert.equal(get(msh, msg.enc, 2), '^~\\&');
  assert.equal(get(msh, msg.enc, 9, 2), 'R01');
  assert.equal(unescapeHl7('a\\F\\b\\.br\\c\\X41\\', msg.enc), 'a|b\nca'.replace('ca', 'cA'));
});

test('Parser: lehnt Nachricht ohne MSH ab', () => {
  assert.throws(() => parseHl7('PID|1||123'), Hl7Error);
});

test('Parser: akzeptiert LF-Zeilenenden und MLLP-Rahmen', () => {
  const text = '\x0b' + load('blutkultur_sub-id.hl7').replace(/\r/g, '\n') + '\x1c';
  const msg = parseHl7(text);
  assert.equal(msg.segments[0].name, 'MSH');
  assert.equal(msg.segments.at(-1).name, 'NTE');
});

test('Urinkultur: Kind-OBR-Antibiogramme werden den Erregern zugeordnet', () => {
  const r = buildReport(parseHl7(load('urinkultur_kind-obr.hl7')));
  assert.equal(r.patient.family, 'Mustermann');
  assert.equal(r.orders[0].statusText, 'Endbefund');
  assert.equal(r.orders[0].specimen, 'Mittelstrahlurin');
  const [ecoli, efae] = r.micro.isolates;
  assert.equal(ecoli.organism, 'Escherichia coli');
  assert.equal(ecoli.quantity, '>10^5 KBE/ml');
  assert.equal(ecoli.abx.length, 10);
  assert.equal(ecoli.abx.find((a) => a.code === 'CIP').flag, 'R');
  assert.equal(ecoli.abx.find((a) => a.code === 'PIT').mic, '<=4');
  assert.equal(efae.organism, 'Enterococcus faecalis');
  assert.equal(efae.abx.length, 4);
  assert.equal(r.micro.antibiotics.length, 12);
  assert.equal(r.micro.findings.length, 1);
  assert.match(r.micro.findings[0].value, /Leukozyten/);
});

test('Blutkultur: Antibiogramm über OBX-4 Sub-ID', () => {
  const r = buildReport(parseHl7(load('blutkultur_sub-id.hl7')));
  assert.equal(r.orders[0].statusText, 'Vorläufiger Befund');
  assert.equal(r.micro.isolates.length, 1);
  const [sau] = r.micro.isolates;
  assert.equal(sau.organism, 'Staphylococcus aureus');
  assert.equal(sau.abx.length, 5);
  assert.equal(sau.abx[0].flag, 'R');
  assert.match(sau.abx[0].mic, />2/);
  assert.match(r.orders[0].observations.at(-1).notes[0], /informieren\.\nVorläufiger/);
});
