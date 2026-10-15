// Befundmodell und Konformitätsprüfung nach
// „Schnittstellenbeschreibung HL7-IN Mikrobiologiebefunde“ (iMedOne, Version 1.2.5).
// Abschnittsnummern in Kommentaren und Prüfmeldungen beziehen sich auf dieses Dokument.

import { get, formatTs, formatTsShort } from './hl7.js';

export const SPEC_VERSION = '1.2.5';

const RESULT_STATUS = { F: 'Final', I: 'Intermediate', P: 'Intermediate' };
const ORDER_STATUS = { SC: 'geplant', IP: 'in Bearbeitung', CM: 'abgeschlossen', RJ: 'abgelehnt' };
const OBR_KINDS = ['MOI', 'ABG', 'CMT'];

export function interpretationText(flag) {
  return { S: 'sensibel', I: 'sensibel bei erhöhter Exposition', R: 'resistent' }[(flag || '').toUpperCase()] || '';
}

export function buildReport(msg) {
  const { enc, segments } = msg;
  const g = (seg, f, c = 1, r = 1, s = 1) => get(seg, enc, f, c, r, s);
  const issues = [];
  const issue = (level, seg, field, text) => issues.push({ level, seg: seg?.index ?? null, field, text });

  const report = {
    type: '', header: {}, patient: {}, visit: {}, order: null, obrs: [], groups: [], issues,
  };

  let orc = null;
  let obr = null;
  let obx = null;
  let lastAbg = false;

  for (const seg of segments) {
    switch (seg.name) {
      case 'MSH': {
        report.type = [g(seg, 9, 1), g(seg, 9, 2)].filter(Boolean).join('^');
        report.header = {
          sendingApp: g(seg, 3), sendingFacility: g(seg, 4), receivingApp: g(seg, 5),
          timeRaw: g(seg, 7), time: formatTs(g(seg, 7)), controlId: g(seg, 10), version: g(seg, 12),
        };
        checkMsh(seg, g, issue, report.type);
        break;
      }
      case 'PID':
        report.patient = {
          id: g(seg, 3), family: g(seg, 5, 1), given: g(seg, 5, 2), middle: g(seg, 5, 3),
          prefix: g(seg, 5, 5), birth: formatTs(g(seg, 7)).slice(0, 10), sex: g(seg, 8),
        };
        req(seg, g(seg, 3), 'PID-3', 'Patientenkennung fehlt (1.1.2).', issue);
        maxLen(seg, g(seg, 3), 20, 'PID-3', issue);
        break;
      case 'PV1':
        report.visit = { caseId: g(seg, 19), ward: g(seg, 3, 1) };
        req(seg, g(seg, 19), 'PV1-19', 'iMedOne-Fallnummer fehlt (1.1.3, Pflichtangabe).', issue);
        maxLen(seg, g(seg, 19), 20, 'PV1-19', issue);
        break;
      case 'ORC': {
        orc = {
          seg, control: g(seg, 1), placer: g(seg, 2), filler: g(seg, 3),
          status: g(seg, 5), statusText: ORDER_STATUS[g(seg, 5)] || g(seg, 5),
          rejectReason: [g(seg, 16, 2), g(seg, 16, 1)].find(Boolean) || '',
          notes: [],
        };
        report.order = orc;
        obr = null; obx = null;
        checkOrc(seg, orc, issue, report.type);
        break;
      }
      case 'OBR': {
        const kind = g(seg, 31).toUpperCase();
        obr = {
          segIndex: seg.index, setId: g(seg, 1), placer: g(seg, 2),
          code: g(seg, 4, 1), text: g(seg, 4, 2),
          collectedRaw: g(seg, 7), receivedRaw: g(seg, 14),
          specimen: {
            sourceCode: g(seg, 15, 1, 1, 1), sourceText: g(seg, 15, 1, 1, 2),
            typeCode: g(seg, 15, 4, 1, 1), typeText: g(seg, 15, 4, 1, 2),
          },
          resultRaw: g(seg, 22), section: g(seg, 24), status: g(seg, 25).toUpperCase(),
          kind, notes: [], observations: [], documents: [],
        };
        report.obrs.push(obr);
        obx = null;
        checkObr(seg, obr, orc, g, issue, lastAbg);
        if (kind === 'ABG') lastAbg = true;
        break;
      }
      case 'OBX': {
        if (!obr) { issue('error', seg, 'OBX', 'OBX ohne vorangehendes OBR (1.2.1).'); break; }
        obx = readObx(seg, g, obr, issue);
        if (obx.type === 'ED') obr.documents.push(obx);
        else obr.observations.push(obx);
        break;
      }
      case 'NTE': {
        const text = readRepeated(seg, g, 3);
        maxLen(seg, text, 4000, 'NTE-3', issue);
        if (/<\/?[a-z][a-z0-9]*\s*\/?>/i.test(text)) {
          issue('info', seg, 'NTE-3', 'Text enthält HTML-Tags (z. B. <BR>) – diese werden wörtlich angezeigt. Zeilenumbruch in HL7: \\.br\\');
        }
        const target = obx || obr || orc;
        if (target) target.notes.push(text);
        else issue('warning', seg, 'NTE', 'NTE ohne Bezug zu ORC, OBR oder OBX.');
        break;
      }
      default:
        issue('info', seg, seg.name, `Segment ${seg.name} ist in der Schnittstelle nicht beschrieben und wird ignoriert.`);
    }
  }

  if (!segments.some((s) => s.name === 'PID')) issue('error', null, 'PID', 'PID-Segment fehlt.');
  if (report.type === 'ORU^R01' && !report.obrs.length) issue('error', null, 'OBR', 'Keine OBR-Segmente in der Ergebnisnachricht.');

  report.groups = buildGroups(report, issue);
  issues.sort((a, b) => (a.seg ?? -1) - (b.seg ?? -1));
  return report;
}

function readRepeated(seg, g, field) {
  const reps = seg.fields[field]?.length || 0;
  const parts = [];
  for (let r = 1; r <= reps; r++) parts.push(g(seg, field, 1, r));
  return parts.join('\n');
}

function readObx(seg, g, obr, issue) {
  const type = g(seg, 2).toUpperCase();
  const o = {
    segIndex: seg.index, setId: g(seg, 1), type,
    code: g(seg, 3, 1), name: g(seg, 3, 2), subId: g(seg, 4),
    value: '', unit: g(seg, 6, 2) || g(seg, 6, 1), range: g(seg, 7), flag: g(seg, 8).toUpperCase(),
    status: g(seg, 11).toUpperCase(), timeRaw: g(seg, 14), method: g(seg, 17, 1).trim(), notes: [],
  };
  const at = (f) => `OBX-${f}`;

  if (type === 'ED') {
    // 1.2.6 Dokumenteninhalt
    o.document = {
      id: o.code, title: o.name, dataType: g(seg, 5, 2), subType: g(seg, 5, 3),
      encoding: g(seg, 5, 4), data: seg.fields[5]?.[0]?.[4]?.[0] ?? '',
    };
    req(seg, o.name, 'OBX-3.2', 'Dokumententitel fehlt (1.2.6).', issue);
    if (!o.code) issue('warning', seg, 'OBX-3.1', 'Dokumenten-ID fehlt – laut 1.2.6 verpflichtend, dient der Versionierung.');
    maxLen(seg, o.code, 20, 'OBX-3.1', issue);
    fixed(seg, o.document.dataType, 'Application', 'OBX-5.2', issue);
    fixed(seg, o.document.subType, 'PDF', 'OBX-5.3', issue);
    fixed(seg, o.document.encoding, 'Base64', 'OBX-5.4', issue);
    const data = o.document.data.replace(/\s/g, '');
    if (!data) issue('error', seg, 'OBX-5.5', 'Base64-Dokumenteninhalt fehlt.');
    else if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) issue('error', seg, 'OBX-5.5', 'Dokumenteninhalt ist kein gültiges Base64.');
    else if (data.length * 0.75 >= 1024 * 1024) issue('error', seg, 'OBX-5.5', 'Dokument ist größer als 1 MB.');
    if (obr.observations.length || obr.documents.length) {
      issue('warning', seg, 'OBX-2', 'Das Dokument-OBX (ED) wird laut 1.2.1/1.2.6 als erstes OBX der Gruppe erwartet.');
    }
    if (!o.timeRaw) {
      issue(obr.collectedRaw ? 'warning' : 'error', seg, 'OBX-14', obr.collectedRaw
        ? 'Dokumentendatum fehlt (1.2.6) – Rückfall auf OBR-7.'
        : 'Dokumentendatum fehlt (1.2.6), auch OBR-7 ist leer.');
    }
    issue('info', seg, 'OBX-2', `PDF-Dokument „${o.name || o.code}“ wird in iMedOne im DMS abgelegt und nicht im Mikrobiologie-Viewer angezeigt.`);
    return o;
  }

  if (type === 'SN') o.value = [g(seg, 5, 1), g(seg, 5, 2), g(seg, 5, 3), g(seg, 5, 4)].join('');
  else if (type === 'CE' || type === 'CWE') o.value = g(seg, 5, 2) || g(seg, 5, 1);
  else o.value = readRepeated(seg, g, 5);

  if (/<\/?[a-z][a-z0-9]*\s*\/?>/i.test(o.value)) {
    issue('info', seg, 'OBX-5', 'Text enthält HTML-Tags (z. B. <BR>) – diese werden wörtlich angezeigt. Zeilenumbruch in HL7: \\.br\\');
  }
  req(seg, type, at(2), 'Wertetyp fehlt.', issue);
  req(seg, o.code, 'OBX-3.1', 'Eindeutiger Code fehlt (1.2.4).', issue);
  maxLen(seg, o.code, 64, 'OBX-3.1', issue);
  maxLen(seg, o.name, 2000, 'OBX-3.2', issue);
  maxLen(seg, o.subId, 20, 'OBX-4', issue);
  maxLen(seg, o.value, 254, 'OBX-5', issue);
  maxLen(seg, g(seg, 6, 1), 16, 'OBX-6', issue);
  maxLen(seg, o.range, 60, 'OBX-7', issue);
  if (o.status && !['F', 'I', 'P'].includes(o.status)) {
    issue('warning', seg, 'OBX-11', `Ergebnisstatus „${o.status}“ wird nicht unterstützt (F, I, P).`);
  }
  // OBX-14 ist laut 1.2.4 Pflicht, aber meist redundant zu OBR-7: nur ohne OBR-7 ein Fehler
  if (!o.timeRaw) {
    issue(obr.collectedRaw ? 'warning' : 'error', seg, 'OBX-14', obr.collectedRaw
      ? 'Datum/Uhrzeit der Probenentnahme fehlt (1.2.4, Pflichtfeld) – iMedOne verwendet OBR-7.'
      : 'Datum/Uhrzeit der Probenentnahme fehlt (1.2.4, Pflichtfeld), auch OBR-7 ist leer.');
  }

  if (type === 'IS') {
    req(seg, o.value, 'OBX-5', 'Bei Wertetyp IS muss der Name des Mikroorganismus in OBX-5 stehen (1.2.4).', issue);
    if (obr.kind !== 'MOI') {
      issue('info', seg, 'OBR-31', 'OBX mit Wertetyp IS ohne OBR-31 = MOI – der Erregername wird nicht als Mikroorganismus dargestellt (vgl. Isolat 2 im Beispiel der Spezifikation).');
    }
  }
  if (obr.kind === 'MOI' && !obr.observations.length && type !== 'IS') {
    issue('error', seg, 'OBX-2', 'Nach OBR-31 = MOI muss das erste OBX den Wertetyp IS haben (1.2.4).');
  }
  if (obr.kind === 'ABG') {
    if (!o.flag) issue('info', seg, 'OBX-8', 'Antibiotikum ohne Bewertung (S/I/R) in OBX-8.');
    if (!o.method) issue('info', seg, 'OBX-17', 'Keine Wirkstoffgruppe angegeben – iMedOne setzt „OTHERS“.');
  } else if (o.flag) {
    issue('warning', seg, 'OBX-8', 'Abnormal Flags werden nur bei Antibiotika (OBR-31 = ABG) erwartet (1.2.4).');
  }
  return o;
}

function checkMsh(seg, g, issue, type) {
  if (seg.rawFields[1] !== '^~\\&') issue('error', seg, 'MSH-2', 'Kodierungszeichen müssen „^~\\&“ lauten (1.1.1).');
  req(seg, g(seg, 3), 'MSH-3', 'Sendende Anwendung fehlt (1.1.1).', issue);
  if (g(seg, 5) && g(seg, 5).toLowerCase() !== 'imedone') {
    issue('warning', seg, 'MSH-5', `Empfangende Anwendung „${g(seg, 5)}“ – erwartet „iMedOne“ (1.1.1).`);
  }
  const ts = g(seg, 7);
  if (!ts) issue('error', seg, 'MSH-7', 'Datum/Uhrzeit der Nachricht fehlt (1.1.1).');
  else if (!/^\d{12}(\d{2})?/.test(ts)) issue('warning', seg, 'MSH-7', 'Format YYYYMMDDHHMMSS erwartet (1.1.1).');
  if (!['ORU^R01', 'ORM^O01'].includes(type)) {
    issue('error', seg, 'MSH-9', `Nachrichtentyp „${type || 'leer'}“ – unterstützt werden ORU^R01 (1.2) und ORM (1.3).`);
  }
  req(seg, g(seg, 10), 'MSH-10', 'Message Control ID fehlt (1.1.1).', issue);
  maxLen(seg, g(seg, 10), 10, 'MSH-10', issue);
  if (g(seg, 12) !== '2.4') issue('warning', seg, 'MSH-12', `Version „${g(seg, 12) || 'leer'}“ – erwartet 2.4 (1.1.1).`);
  if (g(seg, 15) && g(seg, 15) !== 'AL') issue('info', seg, 'MSH-15', 'Fester Wert „AL“ erwartet (1.1.1).');
  if (g(seg, 16) && g(seg, 16) !== 'NE') issue('info', seg, 'MSH-16', 'Fester Wert „NE“ erwartet (1.1.1).');
}

function checkOrc(seg, orc, issue, type) {
  req(seg, orc.control, 'ORC-1', 'Order Control Code fehlt (1.2.2).', issue);
  if (['NW', 'XO', 'CA'].includes(orc.control)) {
    issue('warning', seg, 'ORC-1', `Order Control Code „${orc.control}“ wird derzeit nicht verwendet (1.2.2).`);
  }
  maxLen(seg, orc.placer, 20, 'ORC-2', issue);
  if (orc.filler) issue('warning', seg, 'ORC-3', 'Filler Order Number wird nicht unterstützt und muss leer sein (1.2.2).');
  if (type === 'ORM^O01') {
    if (!orc.status) issue('error', seg, 'ORC-5', 'Auftragsstatus fehlt (1.3.2).');
    else if (!ORDER_STATUS[orc.status]) issue('error', seg, 'ORC-5', `Auftragsstatus „${orc.status}“ unbekannt (SC, IP, CM, RJ).`);
    if (orc.status === 'RJ' && !orc.rejectReason) issue('warning', seg, 'ORC-16', 'Bei RJ wird ein Ablehnungsgrund erwartet (1.3.2).');
  }
}

function checkObr(seg, obr, orc, g, issue, hadAbg) {
  maxLen(seg, obr.placer, 20, 'OBR-2', issue);
  if (orc && orc.placer && obr.placer && orc.placer !== obr.placer) {
    issue('warning', seg, 'OBR-2', `Auftragsnummer „${obr.placer}“ weicht von ORC-2 „${orc.placer}“ ab (1.2.3).`);
  }
  req(seg, obr.code, 'OBR-4.1', 'Testcode fehlt (1.2.3).', issue);
  req(seg, obr.text, 'OBR-4.2', 'Bezeichnung zum Testcode fehlt (1.2.3).', issue);
  maxLen(seg, obr.code, 250, 'OBR-4.1', issue);
  if (!obr.resultRaw) {
    issue('info', seg, 'OBR-22', 'Kein Befundzeitpunkt – das Befunddatum im Viewer stammt aus OBR-22 (Simulator zeigt ersatzweise MSH-7).');
  }
  if (!obr.collectedRaw) {
    issue('warning', seg, 'OBR-7', 'Entnahmezeitpunkt fehlt (1.2.3, Pflichtfeld) – Rückfall auf OBX-14.');
  }
  if (obr.section !== 'MB') issue('error', seg, 'OBR-24', `Diagnostic Serv Sect ID „${obr.section || 'leer'}“ – fest „MB“ erwartet (1.2.3).`);
  if (obr.status && !['F', 'I'].includes(obr.status)) {
    issue('warning', seg, 'OBR-25', `Ergebnisstatus „${obr.status}“ wird nicht unterstützt (F, I).`);
  }
  if (obr.kind && !OBR_KINDS.includes(obr.kind)) {
    issue('warning', seg, 'OBR-31', `Unbekannter Wert „${obr.kind}“ – erwartet MOI, ABG oder CMT (1.2.3).`);
  }
  if (obr.kind === 'CMT' && !hadAbg) {
    issue('error', seg, 'OBR-31', 'OBR mit CMT ohne vorangehendes OBR mit ABG wird nicht akzeptiert (1.2.3).');
  }
}

function buildGroups(report, issue) {
  // OBR-7 dient zur Gruppierung in der Oberfläche; Rückfall: OBX-14 (1.2.3, 1.2.4)
  const groups = new Map();
  for (const obr of report.obrs) {
    const fallback = obr.observations.find((o) => o.timeRaw)?.timeRaw || obr.documents.find((d) => d.timeRaw)?.timeRaw || '';
    const ts = (obr.collectedRaw || fallback).slice(0, 12);
    if (!groups.has(ts)) groups.set(ts, { collectedRaw: ts, obrs: [] });
    groups.get(ts).obrs.push(obr);
  }
  return [...groups.values()].map((grp) => {
    const specs = grp.obrs.map((o) => o.specimen).filter((s) => s.sourceCode || s.sourceText || s.typeText);
    const distinct = new Set(specs.map((s) => `${s.sourceCode}|${s.typeCode}`));
    if (distinct.size > 1) {
      issue('warning', null, 'OBR-15', 'Mehrere unterschiedliche Proben in einer Entnahme – der Viewer zeigt nur die zuletzt eingegangene (1.2.3).');
    }
    const last = specs.at(-1) || {};
    const statuses = grp.obrs.map((o) => o.status).filter(Boolean);
    const status = statuses.length && statuses.every((s) => s === 'F') ? 'F' : statuses.length ? 'I' : '';
    const first = grp.obrs[0];
    return {
      ...grp,
      collected: formatTsShort(grp.collectedRaw),
      // Format wie im Viewer: „Specimen:BL-Blood,Description:N-Not Stated“
      specimenText: [[last.sourceCode, last.sourceText].filter(Boolean).join('-'),
        [last.typeCode, last.typeText].filter(Boolean).join('-')].reduce((a, b) => (b ? `${a},Description:${b}` : a)),
      status, statusText: RESULT_STATUS[status] || 'unbekannt',
      orderNo: first.placer || report.order?.placer || '',
      resultTime: formatTsShort(grp.obrs.map((o) => o.resultRaw).find(Boolean) || report.header.timeRaw),
    };
  });
}

function req(seg, value, field, text, issue) {
  if (!value) issue('error', seg, field, text);
}

function fixed(seg, value, expected, field, issue) {
  if ((value || '').toLowerCase() !== expected.toLowerCase()) {
    issue('error', seg, field, `„${value || 'leer'}“ – fest „${expected}“ erwartet (1.2.6).`);
  }
}

function maxLen(seg, value, len, field, issue) {
  if (value && value.length > len) issue('warning', seg, field, `Länge ${value.length} überschreitet maximal ${len} Zeichen.`);
}
