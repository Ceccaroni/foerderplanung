// /scripts/export.js
// Exportiert Förderpläne als TXT (Nur-Text) und RTF (Arial, schwarz).
// Erweiterung: Plan-Finder (Student-ID -> Planliste -> Plan-ID setzen)

let core = null;
let coreOpen = false;
let passphrase = null;

function $(s){ return document.querySelector(s); }
function alertUI(msg){ window.alert(msg); }

async function ensureCore(){
  if (!core) core = await import('./db.js');
  if (!coreOpen) {
    passphrase = passphrase ?? window.prompt('Passphrase (Core):');
    if (!passphrase) throw new Error('Abgebrochen: keine Passphrase');
    await core.openDatabase(passphrase);
    coreOpen = true;
  }
}

function q(db, sql, params = {}){
  const res = db.exec(sql, params);
  if (!res[0]) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(row.map((v,i)=>[columns[i], v])));
}

function iso(d){ return d ? String(d) : ''; }
function ymd(ts){ try{ const d = new Date(Number(ts)); return isFinite(d) ? d.toISOString().slice(0,10) : ''; }catch{ return ''; } }

// RTF-Escaping + Unicode
function rtfEscape(text){
  const out = [];
  for (const ch of text){
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') { out.push('\\' + ch); continue; }
    if (ch === '\n') { out.push('\\line '); continue; }
    if (code >= 32 && code <= 126) { out.push(ch); continue; }
    const u = code > 0x7FFF ? code - 0x10000 : code;
    out.push(`\\u${u}${' '}`);
  }
  return out.join('');
}

function buildRTF(title, plainText){
  const head = `{\\rtf1\\ansi\\deff0\\uc1{\\fonttbl{\\f0 Arial;}}\n`;
  const titleR = rtfEscape(title);
  const bodyR = rtfEscape(plainText);
  const fmt = `\\fs28 ${titleR}\\line\\line\\fs22 ${bodyR}`;
  return head + fmt + `\n}`;
}

function downloadBlob(bytes, filename, mime){
  const blob = new Blob([bytes], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 0);
}

function buildPlain(plan, student, zielInfo){
  const lines = [];
  lines.push(`Schüler: ${student.vorname} ${student.name}`);
  if (student.geburtstag) lines.push(`Geburtstag: ${iso(student.geburtstag)}`);
  lines.push(`Plan: ${plan.titel} ${plan.fach ? '('+plan.fach+')' : ''}`);
  const Zeitraum = [iso(plan.startdatum), iso(plan.endedatum)].filter(Boolean).join(' – ');
  if (Zeitraum) lines.push(`Zeitraum: ${Zeitraum}`);
  lines.push(`Status: ${plan.status}`);
  lines.push('');

  for (const z of zielInfo){
    lines.push(`Ziel: ${z.titel}`);
    if (z.beschreibung) lines.push(`Beschreibung: ${z.beschreibung}`);
    if (z.indikatoren?.length){
      for (const it of z.indikatoren) lines.push(`- Indikator: ${it.text}`);
    }
    if (z.teilziele?.length){
      for (const t of z.teilziele) lines.push(`- Teilziel: ${t.titel}`);
    }
    if (z.beobachtungen?.length){
      const n = z.beobachtungen.length;
      lines.push(`Beobachtungen (neueste ${n}):`);
      for (const b of z.beobachtungen){
        const d = ymd(b.created_at);
        lines.push(`  • (${d}) ${b.text}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function collect(planId, nPerGoal){
  await ensureCore();
  const db = core.getHandle();

  const plan = q(db, `
    SELECT p.id, p.titel, p.status, p.fach, p.startdatum, p.endedatum, p.student_id
    FROM plan p WHERE p.id = $id
  `, { $id: planId })[0];
  if (!plan) throw new Error('Plan-ID nicht gefunden');

  const student = q(db, `
    SELECT id, vorname, name, geburtstag FROM student WHERE id = $sid
  `, { $sid: plan.student_id })[0] || { vorname: '', name: '', geburtstag: null };

  const ziele = q(db, `
    SELECT id, titel, beschreibung, status, sort_index, created_at
    FROM ziel WHERE plan_id = $pid
    ORDER BY sort_index, created_at
  `, { $pid: plan.id });

  if (ziele.length === 0) return { plan, student, zielInfo: [] };

  const zielIds = ziele.map(z => z.id);
  const inList = '(' + zielIds.map((_,i)=>`$z${i}`).join(',') + ')';
  const params = Object.fromEntries(zielIds.map((id,i)=>[`$z${i}`, id]));

  const teilziele = q(db, `
    SELECT id, ziel_id, titel, status, sort_index, created_at
    FROM teilziel WHERE ziel_id IN ${inList}
    ORDER BY sort_index, created_at
  `, params);

  const indikatoren = q(db, `
    SELECT id, ziel_id, text, sort_index
    FROM indikator WHERE ziel_id IN ${inList}
    ORDER BY sort_index
  `, params);

  const beobByZiel = new Map();
  for (const z of zielIds){
    const arr = q(db, `
      SELECT id, ziel_id, text, autor, sichtbarkeit, created_at
      FROM beobachtung WHERE ziel_id = $z
      ORDER BY created_at DESC
      LIMIT $n
    `, { $z: z, $n: Number(nPerGoal)||0 });
    beobByZiel.set(z, arr);
  }

  const zielInfo = ziele.map(z => ({
    ...z,
    teilziele: teilziele.filter(t => t.ziel_id === z.id),
    indikatoren: indikatoren.filter(i => i.ziel_id === z.id),
    beobachtungen: (Number(nPerGoal)>0) ? (beobByZiel.get(z.id) || []) : []
  }));

  return { plan, student, zielInfo };
}

/* -------- Plan-Finder UI -------- */

function renderPlanOptions(selectEl, plans){
  selectEl.innerHTML = '<option value="">– bitte wählen –</option>';
  for (const p of plans){
    const label = [
      p.titel || 'Ohne Titel',
      p.fach ? `(${p.fach})` : '',
      p.status ? `• ${p.status}` : ''
    ].join(' ').replace(/\s+/g,' ').trim();
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
}

async function loadPlansForStudent(){
  try{
    await ensureCore();
    const sid = $('#exp-student').value.trim();
    if (!sid) { alertUI('Student-ID fehlt.'); return; }
    const db = core.getHandle();
    const plans = q(db, `
      SELECT id, titel, status, fach, created_at
      FROM plan
      WHERE student_id = $sid
      ORDER BY created_at DESC
    `, { $sid: sid });
    renderPlanOptions($('#exp-plan-select'), plans);
    if (plans[0]) { $('#exp-plan').value = plans[0].id; }
  }catch(e){ alertUI(e.message || String(e)); }
}

function wire(){
  $('#exp-load-plans')?.addEventListener('click', loadPlansForStudent);

  $('#exp-plan-select')?.addEventListener('change', () => {
    const val = $('#exp-plan-select').value;
    if (val) $('#exp-plan').value = val;
  });

  $('#exp-preview')?.addEventListener('click', async () => {
    try{
      const planId = $('#exp-plan').value.trim();
      const n = Number($('#exp-n').value||0);
      if (!planId) return alertUI('Plan-ID ist Pflicht.');
      const { plan, student, zielInfo } = await collect(planId, n);
      const plain = buildPlain(plan, student, zielInfo);
      $('#exp-out').value = plain;
    }catch(e){ alertUI(e.message || String(e)); }
  });

  $('#exp-txt')?.addEventListener('click', async () => {
    try{
      const planId = $('#exp-plan').value.trim();
      const n = Number($('#exp-n').value||0);
      if (!planId) return alertUI('Plan-ID ist Pflicht.');
      const { plan, student, zielInfo } = await collect(planId, n);
      const plain = buildPlain(plan, student, zielInfo);
      downloadBlob(new TextEncoder().encode(plain), `foerderplan-${planId}.txt`, 'text/plain');
    }catch(e){ alertUI(e.message || String(e)); }
  });

  $('#exp-rtf')?.addEventListener('click', async () => {
    try{
      const planId = $('#exp-plan').value.trim();
      const n = Number($('#exp-n').value||0);
      if (!planId) return alertUI('Plan-ID ist Pflicht.');
      const { plan, student, zielInfo } = await collect(planId, n);
      const plain = buildPlain(plan, student, zielInfo);
      const rtf = buildRTF(`Förderplan: ${plan.titel}`, plain);
      downloadBlob(new TextEncoder().encode(rtf), `foerderplan-${planId}.rtf`, 'application/rtf');
    }catch(e){ alertUI(e.message || String(e)); }
  });
}

document.addEventListener('DOMContentLoaded', wire);
