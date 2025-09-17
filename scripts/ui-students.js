// Lazy: Core-DB erst öffnen, wenn wirklich nötig (kein Prompt beim Laden)

let core = null;
let isOpen = false;

async function ensureCoreOpen() {
  if (isOpen) return true;
  if (!core) core = await import('./db.js');
  if (core.isOpen()) { isOpen = true; return true; }
  const pass = window.fpCorePass || prompt('Passphrase (Core):');
  if (!pass) return false;
  window.fpCorePass = pass;
  await core.openDatabase(pass);
  isOpen = true;
  return true;
}

function read(fieldId){ const el = document.getElementById(fieldId); return el ? el.value.trim() : ''; }

async function saveStudent(){
  const ok = await ensureCoreOpen(); if (!ok) return;
  const data = {
    vorname:    read('st-vorname'),
    name:       read('st-name'),
    geburtstag: read('st-geb') || null,
    adresse:    read('st-adresse') || null,
    bemerkung:  read('st-bem') || null,
  };
  if (!data.vorname || !data.name){
    document.getElementById('st-msg').textContent = 'Vorname und Name sind Pflicht.';
    return;
  }
  const id = core.addStudent(data);
  await core.persist();
  document.getElementById('st-msg').textContent = `Gespeichert (ID ${id.slice(0,8)}…).`;
  await refreshList();
}

async function refreshList(){
  const ok = await ensureCoreOpen(); if (!ok) return;
  const ul = document.getElementById('st-list');
  const dl = document.getElementById('exp-students');
  ul.innerHTML = ''; if (dl) dl.innerHTML = '';
  const arr = core.listStudents();
  for (const s of arr){
    const li = document.createElement('li');
    li.textContent = `${s.name}, ${s.vorname} — ${s.geburtstag || 'ohne Datum'}`;
    ul.appendChild(li);
    if (dl){
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.label = `${s.name}, ${s.vorname}`;
      dl.appendChild(opt);
    }
  }
  document.getElementById('st-msg').textContent = `${arr.length} Einträge.`;
}

window.addEventListener('DOMContentLoaded', () => {
  const bSave = document.getElementById('st-save');
  const bList = document.getElementById('st-refresh');
  if (bSave) bSave.addEventListener('click', e => { e.preventDefault(); saveStudent().catch(console.error); });
  if (bList) bList.addEventListener('click', e => { e.preventDefault(); refreshList().catch(console.error); });
});
