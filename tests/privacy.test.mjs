import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pseudonymize, looksAnonymized } from '../js/privacy.js';
import { parseHl7, get } from '../js/hl7.js';
import { buildReport } from '../js/micro.js';

const REAL = [
  'MSH|^~\\&|LAB||iMedOne||20260101120000||ORU^R01|X1|P|2.4',
  'PID|1|EXT1|8812345^^^KH^PI||Schneider^Johanna^Maria||19620814|F|||Hauptstr. 5^^Köln^^50667||0221123456|||||ACC99|123-45-6789',
  'NK1|1|Schneider^Peter|SPO|Hauptstr. 5^^Köln',
  'PV1|1|I|STA1||||4711^Weber^Thomas^^^Dr.||||||||||||777888',
  'ORC|RE|A1||||||||||4711^Weber^Thomas',
  'OBR|1|A1||T^Test|||20260101100000|||||||||||||20260101110000||MB|F',
  'OBX|1|ST|C^Kommentar||Rücksprache mit Frau Schneider erfolgt||||||F|||20260101100000',
  'NTE|1|L|Johanna Schneider informiert',
].join('\r');

test('Erkennung von Test-/Musterdaten', () => {
  assert.ok(looksAnonymized('MUSTERMANN^MAX'));
  assert.ok(looksAnonymized('Testpatient^Eins'));
  assert.ok(!looksAnonymized('Schneider^Johanna'));
});

test('Beispielnachrichten bleiben unverändert', () => {
  for (const f of readdirSync(new URL('../samples/', import.meta.url))) {
    const text = readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8');
    assert.equal(pseudonymize(text, 'salt').changed, false, f);
  }
});

test('Echte Daten werden pseudonymisiert', () => {
  const res = pseudonymize(REAL, 'salt');
  assert.ok(res.changed);
  const msg = parseHl7(res.text);
  const seg = (n) => msg.segments.find((s) => s.name === n);
  const pid = seg('PID');
  assert.equal(get(pid, msg.enc, 5, 1), 'MUSTER');
  assert.equal(get(pid, msg.enc, 7), '19620101');
  assert.match(get(pid, msg.enc, 3), /^P[0-9A-Z]{8}$/);
  for (const i of [2, 11, 13, 18, 19]) assert.equal(get(pid, msg.enc, i), '', `PID-${i}`);
  assert.equal(seg('NK1'), undefined);
  assert.match(get(seg('PV1'), msg.enc, 19), /^F[0-9A-Z]{8}$/);
  assert.equal(get(seg('PV1'), msg.enc, 7, 2), 'MUSTERARZT');
  assert.equal(get(seg('ORC'), msg.enc, 12, 2), 'MUSTERARZT');
  assert.doesNotMatch(res.text, /Schneider|Johanna|Weber|Köln|0221123456|123-45-6789/i);
  assert.ok(res.changes.some((c) => c.includes('Freitext')));
  // Ergebnis gilt danach als anonymisiert (idempotent) und bleibt auswertbar
  assert.equal(pseudonymize(res.text, 'salt').changed, false);
  assert.equal(buildReport(msg).obrs.length, 1);
});

test('Pseudonyme sind stabil je Schlüssel und verschieden zwischen Schlüsseln', () => {
  const a = pseudonymize(REAL, 'salt').text;
  const b = pseudonymize(REAL, 'salt').text;
  const c = pseudonymize(REAL, 'other').text;
  assert.equal(a, b);
  assert.notEqual(a, c);
});
