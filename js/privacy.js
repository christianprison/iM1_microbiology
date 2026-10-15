// Erkennung und Pseudonymisierung personenbezogener Daten in HL7-Nachrichten (DSGVO).
// Läuft vollständig im Browser, bevor eine Nachricht angezeigt oder gespeichert wird.
//
// Heuristik: Enthält der Patientenname (PID-5) keinen Hinweis auf Test-/Musterdaten,
// gilt die Nachricht als wahrscheinlich echt und wird pseudonymisiert.
// Ersatzwerte für Patienten- und Fallnummer werden mit einem nur im Browser gespeicherten
// Schlüssel abgeleitet: gleiche Eingabe -> gleiches Pseudonym (Fall-/Patientenansicht bleibt nutzbar),
// ohne den Schlüssel ist die Rückrechnung nicht möglich.

const ANON_MARKER = /muster|test|demo|dummy|beispiel|example|sample|fake|anonym|pseudo|xxx|\bdoe\b|unbekannt|unknown/i;

// Felder mit Personennamen von Mitarbeitenden (XCN)
const STAFF_FIELDS = {
  PV1: [7, 8, 9, 17, 52], ORC: [10, 11, 12], OBR: [10, 16, 28, 32, 33, 34, 35], OBX: [16],
};
// PID-Felder, die ersatzlos geleert werden
const PID_CLEAR = {
  2: 'Externe Patientennummer', 4: 'Alternative Patientennummer', 6: 'Geburtsname der Mutter',
  9: 'Aliasname', 11: 'Adresse', 12: 'Landkreis', 13: 'Telefon/E-Mail privat', 14: 'Telefon dienstlich',
  18: 'Patientenkontonummer', 19: 'Sozialversicherungsnummer', 20: 'Führerscheinnummer', 21: 'Kennung der Mutter',
};

export function looksAnonymized(value) {
  return ANON_MARKER.test(value || '');
}

// FNV-1a, 32 Bit -> Base36; mit Schlüssel als Präfix
function hashCode(salt, value, len = 7) {
  let h = 0x811c9dc5;
  const s = `${salt}|${value}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let h2 = h ^ 0x5bd1e995;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h.toString(36) + h2.toString(36)).toUpperCase().padStart(len, '0').slice(0, len);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Feldweise Prüfung: Patientendaten werden nur ersetzt, wenn der Patientenname (PID-5) echt wirkt;
// Namen von Mitarbeitenden und Angehörigen werden unabhängig davon einzeln geprüft.
/**
 * @returns {{ text: string, changed: boolean, changes: string[] }}
 */
export function pseudonymize(text, salt) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const msh = lines.find((l) => l.startsWith('MSH'));
  if (!msh) return { text, changed: false, changes: [] };
  const F = msh.charAt(3) || '|';
  const C = msh.charAt(4) || '^';
  const hasLetters = (v) => /[A-Za-zÄÖÜäöüß]{2,}/.test(v || '');

  const pidLine = lines.find((l) => l.startsWith(`PID${F}`));
  const pid = pidLine ? pidLine.split(F) : [];
  const name = (pid[5] || '').split('~')[0];
  const nameParts = name.split(C).map((p) => p.trim()).filter(hasLetters);
  const realPatient = nameParts.length > 0 && !looksAnonymized(name);

  const changes = new Set();
  const realNames = realPatient
    ? nameParts.filter((p) => p.length >= 3 && !/^(DR|PROF|HR|FR|MR|MRS|MS|HERR|FRAU)\.?$/i.test(p)) : [];
  const patientId = (pid[3] || '').split(C)[0];
  const idMap = new Map();
  const pseudoId = (prefix, v) => {
    if (!v) return v;
    if (!idMap.has(v)) idMap.set(v, `${prefix}${hashCode(salt, `${prefix}:${v}`, 8)}`);
    return idMap.get(v);
  };

  const out = lines.map((line) => {
    if (!line) return line;
    const f = line.split(F);
    const seg = f[0];

    if (seg === 'PID' && realPatient) {
      const code = hashCode(salt, `name:${patientId || name}`, 6);
      f[5] = `MUSTER${C}PATIENT ${code}`;
      changes.add('PID-5 Patientenname ersetzt');
      if (f[7] && /^\d{4}/.test(f[7]) && !/^\d{4}0101/.test(f[7])) {
        f[7] = `${f[7].slice(0, 4)}0101`;
        changes.add('PID-7 Geburtsdatum auf den 01.01. des Geburtsjahres gesetzt');
      }
      if (f[3]) {
        const comps = f[3].split(C);
        comps[0] = pseudoId('P', comps[0]);
        f[3] = comps.join(C);
        changes.add('PID-3 Patientennummer pseudonymisiert');
      }
      for (const [i, label] of Object.entries(PID_CLEAR)) {
        if (f[i]) { f[i] = ''; changes.add(`PID-${i} ${label} entfernt`); }
      }
    } else if (seg === 'PV1' && realPatient && f[19]) {
      const comps = f[19].split(C);
      comps[0] = pseudoId('F', comps[0]);
      f[19] = comps.join(C);
      changes.add('PV1-19 Fallnummer pseudonymisiert');
    } else if (seg === 'NK1' && (realPatient || (hasLetters(f[2]) && !looksAnonymized(f[2])))) {
      changes.add('NK1 Angaben zu Angehörigen entfernt');
      return null;
    }

    for (const i of STAFF_FIELDS[seg] || []) {
      if (f[i] && hasLetters(f[i]) && !looksAnonymized(f[i])) {
        f[i] = `${C}MUSTERARZT`;
        changes.add(`${seg}-${i} Name von Mitarbeitenden ersetzt`);
      }
    }
    return f.join(F);
  }).filter((l) => l !== null);

  // Patientenname auch in Freitexten (NTE, OBX) ersetzen
  const res = realNames.map((n) => new RegExp(`(?<![A-Za-zÄÖÜäöüß])${escapeRegex(n)}(?![A-Za-zÄÖÜäöüß])`, 'gi'));
  const result = out.map((line) => {
    if (!/^(NTE|OBX)/.test(line)) return line;
    let l = line;
    for (const re of res) l = l.replace(re, 'MUSTER');
    if (l !== line) changes.add('Patientenname in Freitext ersetzt');
    return l;
  }).join('\r');
  if (!changes.size) return { text, changed: false, changes: [] };
  return { text: result, changed: true, changes: [...changes] };
}

// Dateiinhalt dekodieren: UTF-8, sonst Zeichensatz aus MSH-18 (z. B. 8859/1, 8859/15), sonst Windows-1252
export function decodeHl7(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 2000));
    const msh = head.split(/\r|\n/).find((l) => l.startsWith('MSH')) || '';
    const cs = (msh.split(msh.charAt(3) || '|')[17] || '').toUpperCase();
    const map = { '8859/1': 'iso-8859-1', '8859/15': 'iso-8859-15', '8859/2': 'iso-8859-2', 'UNICODE UTF-8': 'utf-8' };
    try {
      return new TextDecoder(map[cs] || 'windows-1252').decode(bytes);
    } catch {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }
}

// Browserseitiger Schlüssel für stabile Pseudonyme
export function browserSalt() {
  try {
    let s = localStorage.getItem('pseudo-salt');
    if (!s) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      s = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('pseudo-salt', s);
    }
    return s;
  } catch {
    return (sessionSalt ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16)).join(''));
  }
}
let sessionSalt = '';
