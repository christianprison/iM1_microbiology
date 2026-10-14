// Überführt eine geparste ORU^R01-Nachricht in ein Mikrobiologie-Befundmodell.
// Unterstützt zwei verbreitete Strukturen für Antibiogramme:
//  a) Kind-OBR mit Verweis auf das Erreger-OBX (OBR-26 / OBR-29)
//  b) Resistenz-OBX im selben OBR, Zuordnung zum Isolat über OBX-4 (Sub-ID)

import { get, components, formatTs } from './hl7.js';

const SIR = /^(S|I|R|SDD|NS|SSD|N|U|SE|IE|RE)$/i;
const ORGANISM = /organism|erreger|keim\b|keimart|isolat|bakteri|pilz|hefe|11475-1|^ORG/i;
const QUANTITY = /keimzahl|menge|quant|colony|kbe|cfu|564-5|19146-0/i;

const STATUS = {
  P: 'Vorläufiger Befund', F: 'Endbefund', C: 'Korrigierter Befund', R: 'Ergebnis eingegangen',
  I: 'In Bearbeitung', A: 'Teilbefund', X: 'Storniert', S: 'Geplant', O: 'Auftrag eingegangen',
};

const INTERPRETATION = {
  S: 'sensibel', I: 'sensibel bei erhöhter Exposition', R: 'resistent',
  SDD: 'dosisabhängig sensibel', NS: 'nicht sensibel', N: 'kein Ergebnis', U: 'unbekannt',
};

export function interpretationText(code) {
  return INTERPRETATION[(code || '').toUpperCase()] || code || '';
}

export function buildReport(msg) {
  const { enc, segments } = msg;
  const g = (seg, f, c, r) => get(seg, enc, f, c, r);
  const report = {
    header: {}, patient: {}, visit: {}, orders: [], warnings: [],
  };

  let order = null;
  let lastTarget = null; // für NTE-Zuordnung

  for (const seg of segments) {
    switch (seg.name) {
      case 'MSH':
        report.header = {
          sendingApp: g(seg, 3), sendingFacility: g(seg, 4),
          receivingApp: g(seg, 5), receivingFacility: g(seg, 6),
          time: formatTs(g(seg, 7)),
          type: [g(seg, 9, 1), g(seg, 9, 2)].filter(Boolean).join('^'),
          controlId: g(seg, 10), version: g(seg, 12),
        };
        if (report.header.type && !/^ORU/.test(report.header.type)) {
          report.warnings.push(`Nachrichtentyp ${report.header.type} – erwartet wird ORU^R01.`);
        }
        break;
      case 'PID':
        report.patient = {
          id: g(seg, 3), family: g(seg, 5, 1), given: g(seg, 5, 2),
          birth: formatTs(g(seg, 7)).slice(0, 10), sex: g(seg, 8),
        };
        lastTarget = report.patient;
        break;
      case 'PV1':
        report.visit = {
          class: g(seg, 2), ward: g(seg, 3, 1), room: g(seg, 3, 2), bed: g(seg, 3, 3),
          caseId: g(seg, 19), attending: [g(seg, 7, 3), g(seg, 7, 2)].filter(Boolean).join(' '),
        };
        break;
      case 'OBR': {
        const parentRef = components(seg, enc, 26);
        order = {
          segIndex: seg.index,
          setId: g(seg, 1),
          placer: g(seg, 2), filler: g(seg, 3),
          code: g(seg, 4, 1), text: g(seg, 4, 2) || g(seg, 4, 1),
          collected: formatTs(g(seg, 7)), received: formatTs(g(seg, 14)),
          specimen: g(seg, 15, 2) || g(seg, 15, 1),
          specimenSite: g(seg, 15, 4),
          orderedBy: [g(seg, 16, 3), g(seg, 16, 2)].filter(Boolean).join(' '),
          resultTime: formatTs(g(seg, 22)),
          status: g(seg, 25), statusText: STATUS[g(seg, 25)] || g(seg, 25),
          parentObs: parentRef[0] || '', parentSubId: parentRef[1] || '',
          parentFiller: g(seg, 29, 2) || g(seg, 29, 1),
          observations: [], notes: [],
        };
        report.orders.push(order);
        lastTarget = order;
        break;
      }
      case 'SPM':
        if (order) {
          order.specimen = g(seg, 4, 2) || g(seg, 4, 1) || order.specimen;
          order.specimenSite = g(seg, 8, 2) || g(seg, 8, 1) || order.specimenSite;
          order.collected = formatTs(g(seg, 17)) || order.collected;
          order.received = formatTs(g(seg, 18)) || order.received;
        }
        break;
      case 'OBX': {
        if (!order) {
          report.warnings.push(`OBX in Zeile ${seg.index + 1} ohne vorangehendes OBR.`);
          break;
        }
        const type = g(seg, 2);
        let value;
        if (type === 'SN') {
          value = [g(seg, 5, 1), g(seg, 5, 2), g(seg, 5, 3), g(seg, 5, 4)].join('');
        } else if (type === 'CE' || type === 'CWE' || type === 'CNE') {
          value = g(seg, 5, 2) || g(seg, 5, 1);
        } else {
          const reps = seg.fields[5]?.length || 0;
          const parts = [];
          for (let r = 1; r <= reps; r++) parts.push(g(seg, 5, 1, r));
          value = parts.join('\n');
        }
        const obs = {
          segIndex: seg.index,
          setId: g(seg, 1), type,
          code: g(seg, 3, 1), name: g(seg, 3, 2) || g(seg, 3, 1),
          subId: g(seg, 4), value, valueCode: g(seg, 5, 1),
          unit: g(seg, 6, 2) || g(seg, 6, 1), range: g(seg, 7),
          flag: g(seg, 8), status: g(seg, 11), time: formatTs(g(seg, 14)),
          notes: [],
        };
        order.observations.push(obs);
        lastTarget = obs;
        break;
      }
      case 'NTE': {
        const reps = seg.fields[3]?.length || 0;
        const parts = [];
        for (let r = 1; r <= reps; r++) parts.push(g(seg, 3, 1, r));
        const text = parts.join('\n');
        if (lastTarget?.notes) lastTarget.notes.push(text);
        else (report.notes ||= []).push(text);
        break;
      }
    }
  }

  report.micro = deriveMicro(report);
  return report;
}

function isolateKey(subId) {
  return (subId || '').split(/[.\-]/)[0] || '';
}

function deriveMicro(report) {
  const isolates = new Map(); // key -> isolate
  const findings = []; // sonstige Befunde (Mikroskopie, Kommentare, ...)
  const getIso = (key) => {
    if (!isolates.has(key)) {
      isolates.set(key, { key, organism: '', organismCode: '', quantity: '', notes: [], segIndex: null, abx: [] });
    }
    return isolates.get(key);
  };

  // Erreger-OBX, auf die Kind-OBRs verweisen können
  const orgByRef = new Map();

  for (const order of report.orders) {
    const isChild = !!(order.parentObs || order.parentFiller);
    for (const obs of order.observations) {
      const flag = (obs.flag || '').toUpperCase();
      const looksSusc = SIR.test(flag) && obs.type !== 'CE' && obs.type !== 'CWE'
        || (isChild && SIR.test(flag));
      const looksOrg = !looksSusc && (obs.type === 'CE' || obs.type === 'CWE' || obs.type === 'ST')
        && ORGANISM.test(`${obs.code} ${obs.name}`);

      if (looksOrg) {
        const key = isolateKey(obs.subId) || String(isolates.size + 1);
        const iso = getIso(key);
        iso.organism = obs.value;
        iso.organismCode = obs.valueCode;
        iso.segIndex = obs.segIndex;
        iso.notes.push(...obs.notes);
        orgByRef.set(`${obs.code}|${obs.subId}`, key);
        orgByRef.set(`|${obs.subId}`, key);
      } else if (looksSusc) {
        let key = '';
        if (isChild && order.parentSubId) {
          key = orgByRef.get(`${order.parentObs}|${order.parentSubId}`)
            || orgByRef.get(`|${order.parentSubId}`) || isolateKey(order.parentSubId);
        }
        if (!key) key = isolateKey(obs.subId) || '1';
        getIso(key).abx.push({
          code: obs.code, name: obs.name, mic: obs.type === 'NM' || obs.type === 'SN' || obs.type === 'ST' ? obs.value : '',
          unit: obs.unit, flag, segIndex: obs.segIndex, notes: obs.notes,
        });
      } else if (QUANTITY.test(`${obs.code} ${obs.name}`) && isolateKey(obs.subId)) {
        getIso(isolateKey(obs.subId)).quantity = [obs.value, obs.unit].filter(Boolean).join(' ');
      } else {
        findings.push({ ...obs, orderText: order.text });
      }
    }
  }

  const list = [...isolates.values()].sort((a, b) =>
    a.key.localeCompare(b.key, 'de', { numeric: true }));
  list.forEach((iso, i) => { iso.number = i + 1; if (!iso.organism) iso.organism = `Isolat ${iso.key}`; });

  // Antibiotika-Zeilen über alle Isolate (Reihenfolge des ersten Auftretens)
  const abxNames = [];
  const seen = new Set();
  for (const iso of list) for (const a of iso.abx) {
    const k = a.code || a.name;
    if (!seen.has(k)) { seen.add(k); abxNames.push({ key: k, name: a.name }); }
  }

  return { isolates: list, antibiotics: abxNames, findings };
}
