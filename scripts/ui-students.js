// Öffnet die Core-DB erst bei Bedarf (kein Prompt auf Page-Load)
import * as core from './db.js';

let isOpen = false;
async function ensureOpen(){
  if (isOpen && core.isOpen()) return true;
  const pass = prompt('Passphrase (Core):');
  if (!pass) return false;
  await core.openDatabase(pass);
  isOpen = true;
  return true;
}

/* DOM-Refs */
const $ = (s) => document.querySelector(s);
const listEl = $('#st-list');
const msgEl  = $('#st-msg');

function readStudentForm(){
  return {
    vorname:  $('#st-vorname').value.trim(),
    name:     $('#st-name').value.trim(),
    geb:      $('#st-geb').value || null,
    adresse:  $('#st-adresse').value.trim() || null,
    bemerkung:$('#st-bem').value.trim() || null,
  };
}

function renderList(items){
  listEl.innerHTML = '';
  if (!items.length){
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Keine Einträge.';
    listEl.appendChild(li);
    return;
  }
  for (const s of items){
    const li = document.createElement('li');
    li.innerHTML = `<span class="mono">${s.id}</span> — ${s.name} ${s.vorname}${s.geburtstag ? ' · '+s.geburtstag : ''}`;
    listEl.appendChild(li);
  }
}

/* Aktionen */
$('#st-save')?.addEventListener('click', async () => {
  if (!await ensureOpen()) return;
  const f = readStudentForm();
  if (!f.vorname || !f.name){
    msgEl.textContent = 'Vorname und Name sind Pflicht.';
    return;
  }
  const id = core.addStudent({
    vorname: f.vorname,
    name: f.name,
    geburtstag: f.geb,
    adresse: f.adresse,
    bemerkung: f.bemerkung
  });
  await core.persist();
  msgEl.textContent = 'Gespeichert. ID: '+id;
});

$('#st-refresh')?.addEventListener('click', async () => {
  if (!await ensureOpen()) return;
  const items = core.listStudents();
  renderList(items);
});

/* Export-Liste (nur die Liste der IDs/Namen für das datalist) */
$('#exp-load-students')?.addEventListener('click', async () => {
  if (!await ensureOpen()) return;
  const items = core.listStudents();
  const dl = document.querySelector('#exp-students');
  dl.innerHTML = '';
  for (const s of items){
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.label = `${s.name} ${s.vorname}`+(s.geburtstag ? ` · ${s.geburtstag}`:'');
    dl.appendChild(opt);
  }
  msgEl.textContent = `Liste geladen (${items.length}).`;
});
