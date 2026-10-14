// Generischer HL7-v2-Parser (ER7-Format). Keine Abhängigkeiten, läuft im Browser und in Node.

export class Hl7Error extends Error {}

export function parseHl7(text) {
  if (typeof text !== 'string') throw new Hl7Error('Keine Nachricht übergeben.');
  const lines = text
    .replace(/^﻿/, '')
    .replace(/\\X0D\\/g, '\r') // falls bereits escaped eingefügt
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/^[\x0b\x1c]+|[\x0b\x1c]+$/g, '')) // MLLP-Rahmen entfernen
    .filter((l) => l.trim() !== '');

  if (!lines.length || !lines[0].startsWith('MSH')) {
    throw new Hl7Error('Nachricht muss mit einem MSH-Segment beginnen.');
  }

  const msh = lines[0];
  const enc = {
    field: msh.charAt(3),
    component: msh.charAt(4) || '^',
    repetition: msh.charAt(5) || '~',
    escape: msh.charAt(6) || '\\',
    subcomponent: msh.charAt(7) || '&',
  };
  if (!enc.field) throw new Hl7Error('MSH-1 (Feldtrenner) fehlt.');

  const segments = lines.map((line, index) => parseSegment(line, enc, index));
  return { enc, segments };
}

function parseSegment(line, enc, index) {
  const raw = line.split(enc.field);
  const name = raw[0];
  let fields;
  if (name === 'MSH') {
    // MSH-1 ist der Feldtrenner selbst, MSH-2 die Kodierzeichen (nicht weiter zerlegen)
    fields = [null, [[[enc.field]]], [[[raw[1] ?? '']]]];
    for (let i = 2; i < raw.length; i++) fields.push(splitField(raw[i], enc));
  } else {
    fields = [null];
    for (let i = 1; i < raw.length; i++) fields.push(splitField(raw[i], enc));
  }
  return { name, index, raw: line, rawFields: raw, fields };
}

// Feld -> Wiederholungen -> Komponenten -> Subkomponenten
function splitField(value, enc) {
  return value.split(enc.repetition).map((rep) =>
    rep.split(enc.component).map((comp) => comp.split(enc.subcomponent))
  );
}

export function unescapeHl7(value, enc) {
  if (!value) return '';
  const e = enc.escape;
  if (!e || !value.includes(e)) return value;
  const re = new RegExp(`${escapeRegex(e)}([^${escapeRegex(e)}]*)${escapeRegex(e)}`, 'g');
  return value.replace(re, (_, seq) => {
    switch (seq) {
      case 'F': return enc.field;
      case 'S': return enc.component;
      case 'T': return enc.subcomponent;
      case 'R': return enc.repetition;
      case 'E': return enc.escape;
      case '.br': return '\n';
      case 'H': case 'N': return '';
    }
    if (/^X[0-9A-Fa-f]+$/.test(seq)) {
      const hex = seq.slice(1);
      let out = '';
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      return out;
    }
    if (/^\.sp\d*$/.test(seq)) return '\n';
    return '';
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

// Zugriff: get(seg, 5, 1) = Feld 5, Komponente 1, erste Wiederholung (1-basiert wie in HL7)
export function get(seg, enc, field, component = 1, repetition = 1, subcomponent = 1) {
  const f = seg?.fields?.[field];
  if (!f) return '';
  const r = f[repetition - 1];
  if (!r) return '';
  const c = r[component - 1];
  if (!c) return '';
  return unescapeHl7(c[subcomponent - 1] ?? '', enc);
}

// Gesamtes Feld (erste Wiederholung) als Komponentenliste
export function components(seg, enc, field, repetition = 1) {
  const r = seg?.fields?.[field]?.[repetition - 1];
  if (!r) return [];
  return r.map((c) => unescapeHl7(c[0] ?? '', enc));
}

export function repetitions(seg, field) {
  return seg?.fields?.[field]?.length ?? 0;
}

// HL7-Zeitstempel (YYYYMMDDHHMMSS[.S][+ZZZZ]) -> lesbares deutsches Datum
export function formatTs(ts) {
  if (!ts) return '';
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(ts.trim());
  if (!m) return ts;
  const [, y, mo, d, h, mi] = m;
  let out = d ? `${d}.${mo}.${y}` : mo ? `${mo}/${y}` : y;
  if (h) out += ` ${h}:${mi ?? '00'}`;
  return out;
}

// Darstellung wie in der iMedOne-Oberfläche: TT/MM/JJ HH:MM
export function formatTsShort(ts) {
  if (!ts) return '';
  const m = /^\d{2}(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(ts.trim());
  if (!m) return ts;
  const [, yy, mo, d, h, mi] = m;
  return `${d}/${mo}/${yy}${h ? ` ${h}:${mi ?? '00'}` : ''}`;
}
