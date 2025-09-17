// Avatare dynamisch aus Core-DB (students) + Vault (Foto) erzeugen.
// Aktiver Schüler farbig, alle anderen grau/halbtransparent.
// Klick: springt ins Dossier (vorerst Stammdaten-Abschnitt) und merkt die Auswahl.

let core = null;
let vault = null;
let selectedId = localStorage.getItem('fp.selectedStudent') || null;

function ucEncode(s){ return encodeURIComponent(s); }

function initials(vorname, name){
  const v = (vorname||"").trim(); const n = (name||"").trim();
  const i1 = v ? v[0].toUpperCase() : "";
  const i2 = n ? n[0].toUpperCase() : "";
  return (i1 + i2) || "?";
}

function svgPlaceholder(text){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='88' height='88'>
    <rect width='100%' height='100%' rx='10' ry='10' fill='#eceff1'/>
    <text x='50%' y='55%' text-anchor='middle' font-family='Arial' font-size='38' fill='#99a3ad'>${text}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${ucEncode(svg)}`;
}

async function ensureCoreOpen(){
  if (core) return;
  core = await import('./db.js');
  if (!core.isOpen()){
    const pass = window.fpCorePass || prompt('Passphrase (Core):');
    window.fpCorePass = pass;
    await core.openDatabase(pass);
  }
}
async function ensureVaultOpen(){
  if (vault) return;
  vault = await import('./vault.js');
  if (!vault.isVaultOpen()){
    const pass = window.fpVaultPass || window.fpCorePass || prompt('Passphrase (Vault):');
    window.fpVaultPass = pass;
    await vault.openVault(pass);
  }
}

async function loadStudents(){
  await ensureCoreOpen();
  const list = core.listStudents(); // [{id, vorname, name, geburtstag}, ...]
  return Array.isArray(list) ? list : [];
}

async function photoDataUrl(studentId, fallbackText){
  try{
    await ensureVaultOpen();
    const p = vault.getPhoto(studentId);
    if (p && p.bytes){
      // Blob -> ObjectURL -> DataURL (ohne Netz)
      const blob = new Blob([p.bytes], { type: p.mime || 'image/png' });
      return URL.createObjectURL(blob); // genügt für <img src>
    }
  }catch(e){ /* stiller Fallback */ }
  return svgPlaceholder(fallbackText);
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
    img.src = it.src; // später geladen/ersetzt
    btn.appendChild(img);

    if (selectedId && it.id === selectedId) btn.classList.add('is-active');

    btn.addEventListener('click', () => {
      selectedId = it.id;
      localStorage.setItem('fp.selectedStudent', selectedId);
      // aktive Klasse setzen
      container.querySelectorAll('.fp-avatar').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      // zum Dossier springen (vorerst Stammdaten)
      const target = document.querySelector('#stammdaten-h');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Event für andere Module (optional)
      document.dispatchEvent(new CustomEvent('fp:student-selected', { detail: { id: selectedId }}));
    });

    container.appendChild(btn);
  }
}

async function init(){
  const wrap = document.querySelector('.fp-avatars');
  if (!wrap) return;

  // Liste laden
  const students = await loadStudents();

  // Fallback: wenn leer, belassen wir ggf. vorhandene Platzhalter
  if (!students.length) return;

  // Erst mit Platzhalter-SVG zeichnen, dann Fotos (asynchron) nachladen
  const items = students.map(s => ({
    id: s.id,
    vorname: s.vorname,
    name: s.name,
    src: svgPlaceholder(initials(s.vorname, s.name))
  }));
  renderAvatars(wrap, items);

  // Fotos parallel holen und aktualisieren
  await ensureVaultOpen();
  for (const it of items){
    const url = await photoDataUrl(it.id, initials(it.vorname, it.name));
    const btn = wrap.querySelector(`.fp-avatar[data-sid="${it.id}"] img`);
    if (btn) btn.src = url;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // Tabs: sanftes Scrollen + aktiver Reiter
  const tabs = document.querySelectorAll('.fp-tabs .fp-tab');
  function selectTab(a){
    tabs.forEach(t => t.removeAttribute('aria-current'));
    a.setAttribute('aria-current', 'page');
  }
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

  // Avatare initialisieren
  init().catch(console.error);
});
