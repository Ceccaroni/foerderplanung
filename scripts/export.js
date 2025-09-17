// /scripts/export.js
// Export der Förderplanung als TXT und RTF (Arial, schwarz).
// Greift auf die Core-DB (db.js) zu; öffnet sie bei Bedarf.

import * as core from './db.js';

function byId(id){ return document.getElementById(id); }
const msg   = () => byId('exp-msg');
const links = () => byId('exp-links');
const datalist = () => byId('exp-students');

function fmtDateISO(d){ // yyyy-mm-dd
  if (!d) return '';
  const dt = (typeof d === 'number') ? new Date(d) : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const da = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

// sql.js Helfer: SELECT -> Array<Object>
function rows(db, sql, params={}){
  const res = db.exec(sql, params);
  if (!res[0]) return [];
  const { columns, values } = res[0];
  return values.map(r => Object.fromEntries(r.map((v,i)=>[columns[i], v])));
}

async function ensureCoreOpen(){
  if (!core.isOpen()){
    const pass = prompt('Passphrase (Core):');
    if (pass == null) throw new Error('Abgebrochen');
    await core.openDatabase(pass);
  }
  return core.getHandle();
}

async function loadStudentsIntoDatalist(){
  const db = await ensureCoreOpen();
  const list = core.listStudents?.() ?? rows(db, 'SELECT id, vorname, name FROM student ORDER BY name, vorname');
  datalist().innerHTML = list.map(s => {
    const label = `${s.name}, ${s.vorname} — ${s.id}`;
    return `<option value="${s.id}" label="${label}">`;
  }).join('');
  msg().textContent = list.length ? `${list.length} Schüler:innen geladen.` : 'Keine Einträge vorhanden.';
}

function buildTextReport(student, plans, goalsByPlan, teilzieleByZiel, indikatorenByZiel, beobByZiel){
  const L = [];
  L.push(`Förderplanung\n`);
  L.push(`${student.vorname} ${student.name} (geb. ${student.geburtstag ?? '-'})`);
  if (student.adresse) L.push(student.adresse);
  if (student.bemerkung) L.push(`Bemerkung: ${student.bemerkung}`);
  L.push('');

  for (const p of plans){
    L.push(`Plan: ${p.fach ? p.fach + ' — ' : ''}${p.titel} (${p.status})`);
    const zeitraum = [p.startdatum, p.endedatum].filter(Boolean).join(' bis ');
    if (zeitraum) L.push(`Zeitraum: ${zeitraum}`);
    L.push('');

    const goals = goalsByPlan[p.id] || [];
    for (const z of goals){
      L.push(`  Ziel: ${z.titel} ${z.beschreibung ? '— ' + z.beschreibung : ''}`);
      if (z.verantwortlich) L.push(`  Verantwortlich: ${z.verantwortlich}`);

      const tz = (teilzieleByZiel[z.id] || []);
      for (const t of tz){
        L.push(`    Teilziel: ${t.titel} (${t.status})`);
      }

      const ind = (indikatorenByZiel[z.id] || []);
      for (const k of ind){
        L.push(`    Indikator: ${k.text}`);
      }

      const beos = (beobByZiel[z.id] || []);
      if (beos.length){
        L.push('    Beobachtungen:');
        for (const b of beos){
          const d = fmtDateISO(b.created_at);
          const vis = b.sichtbarkeit;
          const autor = b.autor ? `, ${b.autor}` : '';
          L.push(`      – ${d}${autor} [${vis}]: ${b.text}`);
        }
      }

      L.push('');
    }
    L.push('');
  }
  return L.join('\n');
}

function textToRTF(text){
  // RTF: Arial, schwarz, 12pt (\fs24), Zeilenumbrüche als \par
  const esc = s => s
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n|\r|\n/g, '\\par\n');

  const header = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\n' +
                 '\\f0\\fs24\\cf1\n';
  const colorTable = '{\\colortbl;\\red0\\green0\\blue0;}\n'; // schwarz
  return header + colorTable + esc(text) + '\n}';
}

function downloadBlob(bytes, filename, mime){
  const blob = new Blob([bytes], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.textContent = `Download: ${filename}`;
  a.rel = 'noopener';
  links().innerHTML = '';
  links().appendChild(a);
  // URL später freigeben (kleine Seite, ok so)
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function gatherAll(student_id){
  const db = await ensureCoreOpen();

  const [student] = rows(db, `
    SELECT id, vorname, name, geburtstag, adresse, bemerkung
    FROM student WHERE id = $id
  `, { $id: student_id });

  if (!student) throw new Error('Unbekannte Student-ID');

  const plans = rows(db, `
    SELECT id, titel, status, fach, startdatum, endedatum, created_at
    FROM plan WHERE student_id = $sid ORDER BY created_at
  `, { $sid: student_id });

  const goalsByPlan = {};
  const teilzieleByZiel = {};
  const indikatorenByZiel = {};
  const beobByZiel = {};

  for (const p of plans){
    const goals = rows(db, `
      SELECT id, plan_id, titel, beschreibung, status, verantwortlich, sort_index, created_at
      FROM ziel WHERE plan_id = $pid ORDER BY sort_index, created_at
    `, { $pid: p.id });
    goalsByPlan[p.id] = goals;

    for (const z of goals){
      teilzieleByZiel[z.id] = rows(db, `
        SELECT id, ziel_id, titel, status, sort_index, created_at
        FROM teilziel WHERE ziel_id = $zid ORDER BY sort_index, created_at
      `, { $zid: z.id });

      indikatorenByZiel[z.id] = rows(db, `
        SELECT id, ziel_id, text, sort_index
        FROM indikator WHERE ziel_id = $zid ORDER BY sort_index
      `, { $zid: z.id });

      beobByZiel[z.id] = rows(db, `
        SELECT id, ziel_id, autor, text, sichtbarkeit, created_at
        FROM beobachtung WHERE ziel_id = $zid ORDER BY created_at
      `, { $zid: z.id });
    }
  }

  return { student, plans, goalsByPlan, teilzieleByZiel, indikatorenByZiel, beobByZiel };
}

async function runExport(kind){
  try{
    msg().textContent = '';
    links().innerHTML = '';

    const sid = byId('exp-student').value.trim();
    if (!sid){ msg().textContent = 'Bitte Student-ID eingeben oder Liste laden.'; return; }

    const data = await gatherAll(sid);
    const text = buildTextReport(
      data.student, data.plans, data.goalsByPlan,
      data.teilzieleByZiel, data.indikatorenByZiel, data.beobByZiel
    );

    const stamp = fmtDateISO(new Date());
    const base = `foerderplanung_${data.student.name}_${data.student.vorname}_${stamp}`.replace(/\s+/g,'_');

    if (kind === 'txt'){
      downloadBlob(text, `${base}.txt`, 'text/plain;charset=utf-8');
    } else {
      const rtf = textToRTF(text);
      downloadBlob(rtf, `${base}.rtf`, 'application/rtf');
    }
    msg().textContent = 'Export bereit.';
  } catch(e){
    console.error(e);
    msg().textContent = `Fehler: ${e.message || e}`;
  }
}

// Events
document.addEventListener('DOMContentLoaded', () => {
  byId('exp-load-students').addEventListener('click', loadStudentsIntoDatalist);
  byId('exp-txt').addEventListener('click', () => runExport('txt'));
  byId('exp-rtf').addEventListener('click', () => runExport('rtf'));
});
