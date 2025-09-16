// /scripts/ui-students.js
// Schüler:innen-Stamm (lokal, verschlüsselt in Core-DB). Keine externen Abhängigkeiten.

let core = null;
let coreOpen = false;
let passphrase = null;
let currentId = null; // ausgewählte student_id

function $(s){ return document.querySelector(s); }
function byId(id){ return document.getElementById(id); }
function alertUI(m){ window.alert(m); }

async function ensureCore(){
  if (!core) core = await import('./db.js');
  if (!coreOpen) {
    passphrase = passphrase ?? window.prompt('Passphrase (Core):');
    if (!passphrase) throw new Error('Abgebrochen: keine Passphrase');
    await core.openDatabase(passphrase);
    coreOpen = true;
    await seedDefaultFlags();
  }
}

function q(db, sql, params = {}){
  const res = db.exec(sql, params);
  if (!res[0]) return [];
  const { columns, values } = res[0];
  return values.map(row => Object.fromEntries(row.map((v,i)=>[columns[i], v])));
}

async function seedDefaultFlags(){
  const db = core.getHandle();
  // key ist UNIQUE; OR IGNORE verhindert Doppeltes
  const ins = db.prepare("INSERT OR IGNORE INTO status_flag (id,key,bezeichnung) VALUES (?,?,?)");
  [
    ['rILZ','Ressourcenorientierte ILZ'],
    ['eU','Erweiterte Unterstützung'],
    ['bVSA','bes. Vereinbarungen / Schutzbest. / Auflagen']
  ].forEach(([key, bez]) => ins.run([crypto.randomUUID(), key, bez]));
  ins.free();
  await core.persist();
}

/* ---------- Stammdaten ---------- */

function setCurrent(id){
  currentId = id || null;
  byId('std-id').textContent = currentId ? `ID: ${currentId}` : '';
}

async function loadStudentList(){
  await ensureCore();
  const list = core.listStudents(); // {id, vorname, name, geburtstag}
  const sel = byId('std-select');
  sel.innerHTML = '<option value="">– bitte wählen –</option>';
  for (const s of list){
    const opt = document.createElement('option');
    const label = `${s.name} ${s.vorname}${s.geburtstag ? ' • ' + s.geburtstag : ''}`;
    opt.value = s.id; opt.textContent = label;
    sel.appendChild(opt);
  }
}

async function loadStudentIntoForm(id){
  await ensureCore();
  const db = core.getHandle();
  const row = q(db, "SELECT * FROM student WHERE id=$id", { $id: id })[0];
  if (!row) return;
  byId('std-vorname').value = row.vorname || '';
  byId('std-name').value = row.name || '';
  byId('std-geb').value = row.geburtstag || '';
  byId('std-addr').value = row.adresse || '';
  byId('std-note').value = row.bemerkung || '';
  setCurrent(id);
  await loadFlagsForStudent(id);
  await loadRilzList(id);
  await loadKontaktList(id);
  await loadHistorieList(id);
}

async function createStudent(){
  await ensureCore();
  const vorname = byId('std-vorname').value.trim();
  const name = byId('std-name').value.trim();
  if (!vorname || !name) return alertUI('Vorname und Name sind Pflicht.');
  const id = crypto.randomUUID();
  core.getHandle().exec(
    "INSERT INTO student (id,vorname,name,geburtstag,adresse,bemerkung,created_at) VALUES ($id,$v,$n,$g,$a,$b,$t);",
    {
      $id: id,
      $v: vorname,
      $n: name,
      $g: byId('std-geb').value || null,
      $a: byId('std-addr').value || null,
      $b: byId('std-note').value || null,
      $t: Date.now()
    }
  );
  await core.persist();
  await loadStudentList();
  byId('std-select').value = id;
  await loadStudentIntoForm(id);
}

async function saveStudent(){
  if (!currentId) return alertUI('Keine Schüler:in ausgewählt.');
  await ensureCore();
  core.getHandle().exec(
    "UPDATE student SET vorname=$v, name=$n, geburtstag=$g, adresse=$a, bemerkung=$b WHERE id=$id",
    {
      $id: currentId,
      $v: byId('std-vorname').value.trim(),
      $n: byId('std-name').value.trim(),
      $g: byId('std-geb').value || null,
      $a: byId('std-addr').value || null,
      $b: byId('std-note').value || null
    }
  );
  await core.persist();
  await loadStudentList();
}

/* ---------- Status-Flags ---------- */

async function loadFlagsForStudent(studentId){
  const db = core.getHandle();
  const flags = q(db, `
    SELECT f.key FROM status_flag f
    JOIN student_status s ON s.flag_id=f.id
    WHERE s.student_id=$id
  `, { $id: studentId }).map(r => r.key);
  byId('flag-rilz').checked = flags.includes('rILZ');
  byId('flag-eu').checked = flags.includes('eU');
  byId('flag-bvsa').checked = flags.includes('bVSA');
}

function flagKeyToId(key){
  const db = core.getHandle();
  const r = q(db, "SELECT id FROM status_flag WHERE key=$k", { $k: key })[0];
  return r?.id || null;
}

async function setFlag(key, on){
  if (!currentId) return;
  await ensureCore();
  const fid = flagKeyToId(key);
  if (!fid) return;
  const db = core.getHandle();
  if (on){
    db.exec("INSERT OR IGNORE INTO student_status (student_id, flag_id) VALUES ($s,$f)", { $s: currentId, $f: fid });
  } else {
    db.exec("DELETE FROM student_status WHERE student_id=$s AND flag_id=$f", { $s: currentId, $f: fid });
  }
  await core.persist();
}

/* ---------- rILZ nach Fach ---------- */

async function addRilz(){
  if (!currentId) return alertUI('Keine Schüler:in ausgewählt.');
  await ensureCore();
  const fach = byId('rilz-fach').value.trim();
  const details = byId('rilz-details').value.trim() || null;
  const db = core.getHandle();
  db.exec("INSERT INTO rilz_fach (id, student_id, fach, details) VALUES ($id,$s,$f,$d)", {
    $id: crypto.randomUUID(), $s: currentId, $f: fach, $d: details
  });
  await core.persist();
  byId('rilz-details').value = '';
  await loadRilzList(currentId);
}

async function loadRilzList(studentId){
  const db = core.getHandle();
  const rows = q(db, `
    SELECT id, fach, details FROM rilz_fach
    WHERE student_id=$s ORDER BY fach, id
  `, { $s: studentId });
  const ul = byId('rilz-list'); ul.innerHTML = '';
  for (const r of rows){
    const li = document.createElement('li');
    li.dataset.id = r.id;
    li.innerHTML = `<strong>${r.fach}</strong> ${r.details ? '· ' + r.details : ''} 
      <div class="row-actions"><button class="btn" data-act="del">Löschen</button></div>`;
    ul.appendChild(li);
  }
}

async function deleteRilz(id){
  const db = core.getHandle();
  db.exec("DELETE FROM rilz_fach WHERE id=$id", { $id: id });
  await core.persist();
  await loadRilzList(currentId);
}

/* ---------- Kontakte ---------- */

async function addKontakt(){
  if (!currentId) return alertUI('Keine Schüler:in ausgewählt.');
  await ensureCore();
  const r = byId('kon-rolle').value.trim();
  const n = byId('kon-name').value.trim();
  if (!r || !n) return alertUI('Rolle und Name sind Pflicht.');
  const db = core.getHandle();
  db.exec(`
    INSERT INTO kontakt (id, student_id, rolle, name, telefon, email, adresse)
    VALUES ($id,$s,$ro,$na,$tel,$mail,$addr)
  `, {
    $id: crypto.randomUUID(),
    $s: currentId,
    $ro: r,
    $na: n,
    $tel: byId('kon-tel').value.trim() || null,
    $mail: byId('kon-mail').value.trim() || null,
    $addr: byId('kon-addr').value.trim() || null
  });
  await core.persist();
  byId('kon-rolle').value = ''; byId('kon-name').value = '';
  byId('kon-tel').value = ''; byId('kon-mail').value = ''; byId('kon-addr').value = '';
  await loadKontaktList(currentId);
}

async function loadKontaktList(studentId){
  const rows = q(core.getHandle(), `
    SELECT id, rolle, name, telefon, email, adresse FROM kontakt
    WHERE student_id=$s ORDER BY rolle, name
  `, { $s: studentId });
  const ul = byId('kon-list'); ul.innerHTML = '';
  for (const r of rows){
    const li = document.createElement('li');
    li.dataset.id = r.id;
    li.innerHTML = `
      <strong>${r.rolle}:</strong> ${r.name}
      <div class="muted">${[r.telefon, r.email, r.adresse].filter(Boolean).join(' · ')}</div>
      <div class="row-actions"><button class="btn" data-act="del">Löschen</button></div>`;
    ul.appendChild(li);
  }
}

async function deleteKontakt(id){
  core.getHandle().exec("DELETE FROM kontakt WHERE id=$id", { $id: id });
  await core.persist();
  await loadKontaktList(currentId);
}

/* ---------- Historie ---------- */

async function addHistorie(){
  if (!currentId) return alertUI('Keine Schüler:in ausgewählt.');
  await ensureCore();
  const titel = byId('his-titel').value.trim();
  if (!titel) return alertUI('Titel ist Pflicht.');
  core.getHandle().exec(`
    INSERT INTO historie (id, student_id, titel, beschreibung, von, bis)
    VALUES ($id,$s,$ti,$de,$von,$bis)
  `, {
    $id: crypto.randomUUID(),
    $s: currentId,
    $ti: titel,
    $de: byId('his-desc').value.trim() || null,
    $von: byId('his-von').value || null,
    $bis: byId('his-bis').value || null
  });
  await core.persist();
  byId('his-titel').value=''; byId('his-desc').value='';
  byId('his-von').value=''; byId('his-bis').value='';
  await loadHistorieList(currentId);
}

async function loadHistorieList(studentId){
  const rows = q(core.getHandle(), `
    SELECT id, titel, beschreibung, von, bis FROM historie
    WHERE student_id=$s ORDER BY COALESCE(von,'9999-12-31') DESC, id DESC
  `, { $s: studentId });
  const ul = byId('his-list'); ul.innerHTML = '';
  for (const r of rows){
    const li = document.createElement('li');
    li.dataset.id = r.id;
    const zr = [r.von, r.bis].filter(Boolean).join(' – ');
    li.innerHTML = `
      <strong>${r.titel}</strong> ${zr ? '· ' + zr : ''}
      <div class="muted">${r.beschreibung || ''}</div>
      <div class="row-actions"><button class="btn" data-act="del">Löschen</button></div>`;
    ul.appendChild(li);
  }
}

async function deleteHistorie(id){
  core.getHandle().exec("DELETE FROM historie WHERE id=$id", { $id: id });
  await core.persist();
  await loadHistorieList(currentId);
}

/* ---------- Events ---------- */

function wire(){
  byId('std-reload')?.addEventListener('click', loadStudentList);
  byId('std-new')?.addEventListener('click', createStudent);
  byId('std-save')?.addEventListener('click', saveStudent);

  byId('std-select')?.addEventListener('change', e => {
    const id = e.target.value || null;
    if (id) loadStudentIntoForm(id);
    else { setCurrent(null); }
  });

  // Flags
  byId('flag-rilz')?.addEventListener('change', e => setFlag('rILZ', e.target.checked));
  byId('flag-eu')?.addEventListener('change', e => setFlag('eU', e.target.checked));
  byId('flag-bvsa')?.addEventListener('change', e => setFlag('bVSA', e.target.checked));

  // rILZ-Fach
  byId('rilz-add')?.addEventListener('click', addRilz);
  byId('rilz-list')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="del"]');
    if (!btn) return;
    const li = e.target.closest('li'); if (!li) return;
    deleteRilz(li.dataset.id);
  });

  // Kontakte
  byId('kon-add')?.addEventListener('click', addKontakt);
  byId('kon-list')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="del"]');
    if (!btn) return;
    const li = e.target.closest('li'); if (!li) return;
    deleteKontakt(li.dataset.id);
  });

  // Historie
  byId('his-add')?.addEventListener('click', addHistorie);
  byId('his-list')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act="del"]');
    if (!btn) return;
    const li = e.target.closest('li'); if (!li) return;
    deleteHistorie(li.dataset.id);
  });
}

document.addEventListener('DOMContentLoaded', wire);
