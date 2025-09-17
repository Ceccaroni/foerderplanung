// Lazy-Avatare ohne Passphrase-Dialog, solange keine DB existiert.
// Öffnet Core/Vault nur, wenn bereits Daten vorhanden sind ODER bei Klick.

import { idbGet } from './idb.js';

let core = null;
let vault = null;
let selectedId = localStorage.getItem('fp.selectedStudent') || null;

function initials(v, n){
  const i1 = (v||'').trim()[0] || '';
  const i2 = (n||'').trim()[0] || '';
  const s = (i1 + i2).toUpperCase();
  return s || '?';
}
function svgPlaceholder(text){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'>
    <rect width='100%' height='100%' rx='10' ry='10' fill='#eceff1'/>
    <text x='50%' y='55%' text-anchor='middle' font-family='Arial' font-size='38' fill='#99a3ad'>${text}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function coreExists(){
  // Ohne Passphrase checken, ob es überhaupt einen gespeicherten Core-Blob gibt.
  try { return !!(await idbGet('db-core')); } catch { return false; }
}

async function ensureCoreOpen(){
  if (core) return true;
  core = await import('./db.js');
  if (!core.isOpen()){
    const pass = window.fpCorePass || prompt('Passphrase (Core):');
    if (!pass) return false;
    window.fpCorePass = pass;
    await core.openDatabase(pass);
  }
  return true;
}
async function ensureVaultOpen(){
  if (vault) return true;
  vault = await import('./vault.js');
  if (!vault.isVaultOpen()){
    const pass = window.fpVaultPass || window.fpCorePass || prompt('Passphrase (Vault):');
    if (!pass) return false;
    window.fpVaultPass = pass;
    await vault.openVault(pass);
  }
  return true;
}

function renderAvatars(container, items){
  container.innerHTML = '';
  for (const it of items){
    const btn = document.createElement('button');
    btn.className = 'fp-avatar';
    btn.title = `${it.vorname||''} ${it.name||''}`.trim();
    btn.dataset.sid = it.id;
    const img = document.createElement('img');
    img.alt = btn.title || 'Schülerbild';
    img.src = it.src;
    btn.appendChild(img);
    if (selectedId && it.id === selectedId) btn.classList.add('is-active');

    btn.addEventListener('click', async () => {
      selectedId = it.id;
      localStorage.setItem('fp.selectedStudent', selectedId);
      container.querySelectorAll('.fp-avatar').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      // Erst bei Interaktion DB öffnen (wenn vorhanden)
      if (await coreExists()){
        const ok = await ensureCoreOpen(); if (!ok) return;
      }
      const target = document.querySelector('#stammdaten-h');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.dispatchEvent(new CustomEvent('fp:student-selected', { detail: { id: selectedId }}));
    });

    container.appendChild(btn);
  }
}

async function init(){
  const wrap = document.querySelector('.fp-avatars');
  if (!wrap) return;

  // Start: Nur Platzhalter (keine Passphrase)
  const placeholders = [
    { id: 's1', vorname: 'S', name: '', src: svgPlaceholder('S') },
    { id: 's2', vorname: 'D', name: '', src: svgPlaceholder('D') },
    { id: 's3', vorname: 'F', name: '', src: svgPlaceholder('F') },
  ];
  renderAvatars(wrap, placeholders);

  // Wenn bereits Core-DB existiert, Avatare leise ersetzen (ohne Prompt),
  // indem wir erst bei Bedarf öffnen.
  if (!(await coreExists())) return;

  // Nutzerinteraktion abwarten, dann echte Daten (optional)
  // Tipp: Avatar anklicken → dann ensureCoreOpen() in Handler.
}

window.addEventListener('DOMContentLoaded', () => {
  // Tabs: sanftes Scrollen + aktiver Reiter
  const tabs = document.querySelectorAll('.fp-tabs .fp-tab');
  function selectTab(a){ tabs.forEach(t => t.removeAttribute('aria-current')); a.setAttribute('aria-current', 'page'); }
  tabs.forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id && id.startsWith('#')){
        e.preventDefault();
        const el = document.querySelector(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        selectTab(a);
      }
    });
  });

  init().catch(console.error);
});
