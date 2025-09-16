// /scripts/ui-docs.js
// Schlanke UI-Andockpunkte für Vault (Dokumente/Fotos). Keine Styles, keine Tree-Änderungen.
let v = null;             // dynamisch importiertes Vault-Modul
let vaultOpen = false;
let passphrase = null;

async function ensureVault() {
  if (!v) v = await import('./vault.js');
  if (!vaultOpen) {
    passphrase = passphrase ?? window.prompt('Passphrase (Vault):');
    if (!passphrase) throw new Error('Abgebrochen: keine Passphrase');
    await v.openVault(passphrase);
    vaultOpen = true;
  }
}

// Hilfen
function $(sel){ return document.querySelector(sel); }
function uiAlert(msg){ window.alert(msg); }

// Datei → Uint8Array
async function fileToBytes(file){
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

// Bild komprimieren + EXIF strip (Canvas)
async function imageToBytes(file, maxDim=1024, mime='image/webp', quality=0.85){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
  let { width:w, height:h } = img;
  if (w > h && w > maxDim){ h = Math.round(h * (maxDim / w)); w = maxDim; }
  else if (h > w && h > maxDim){ w = Math.round(w * (maxDim / h)); h = maxDim; }
  else if (w === h && w > maxDim){ w = h = maxDim; }

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(res => c.toBlob(res, mime, quality));
  URL.revokeObjectURL(url);
  const ab = await blob.arrayBuffer();
  return { bytes: new Uint8Array(ab), mime: blob.type };
}

// Dokumentliste rendern
function renderDocList(items){
  const ul = $('#doc-list');
  ul.innerHTML = '';
  for (const row of items){
    const li = document.createElement('li');
    li.dataset.id = row.id;
    li.innerHTML = `
      <strong>${row.titel}</strong>
      <div class="muted">${row.dateiname} · ${row.mime} · ${(row.groesse_bytes/1024).toFixed(1)} KB</div>
      <div class="row-actions">
        <button class="btn" data-act="dl">Download</button>
        <button class="btn" data-act="del">Löschen</button>
      </div>
    `;
    ul.appendChild(li);
  }
}

async function refreshDocList(){
  const sid = $('#doc-student').value.trim();
  if (!sid) { $('#doc-list').innerHTML = ''; return; }
  await ensureVault();
  const items = v.listDocumentsByStudent(sid);
  renderDocList(items);
}

// Events verdrahten
function wire(){
  // Upload Dokument
  $('#doc-upload')?.addEventListener('click', async () => {
    try{
      const sid   = $('#doc-student').value.trim();
      const titel = $('#doc-title').value.trim();
      const file  = $('#doc-file').files?.[0];
      if (!sid || !titel || !file) return uiAlert('Student-ID, Titel und Datei sind Pflicht.');
      await ensureVault();
      const bytes = await fileToBytes(file);
      await v.addDocument(bytes, {
        student_id: sid,
        titel,
        dateiname: file.name,
        mime: file.type || 'application/octet-stream'
      });
      $('#doc-title').value = '';
      $('#doc-file').value = '';
      await refreshDocList();
    }catch(e){ uiAlert(e.message || String(e)); }
  });

  // Liste Aktionen (Download/Löschen)
  $('#doc-list')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const li = ev.target.closest('li'); if (!li) return;
    const id = li.dataset.id;

    try{
      await ensureVault();
      if (btn.dataset.act === 'dl') {
        const meta = v.getDocumentMeta(id);
        const bytes = v.getDocumentBlob(id);
        if (!bytes) return uiAlert('Kein Inhalt gefunden.');
        const blob = new Blob([bytes], { type: meta?.mime || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = meta?.dateiname || 'download.bin';
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      } else if (btn.dataset.act === 'del') {
        if (!confirm('Dokument löschen?')) return;
        await v.deleteDocument(id);
        await refreshDocList();
      }
    }catch(e){ uiAlert(e.message || String(e)); }
  });

  // Foto setzen
  $('#foto-upload')?.addEventListener('click', async () => {
    try{
      const sid = $('#foto-student').value.trim();
      const file = $('#foto-file').files?.[0];
      if (!sid || !file) return uiAlert('Student-ID und Foto sind Pflicht.');
      await ensureVault();
      const { bytes, mime } = await imageToBytes(file, 1024, 'image/webp', 0.85);
      await v.setPhoto(sid, bytes, mime);
      // Vorschau
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const img = $('#foto-preview');
      img.src = url; img.style.display = 'block';
    }catch(e){ uiAlert(e.message || String(e)); }
  });

  // Student-ID Wechsel → Liste laden
  $('#doc-student')?.addEventListener('change', refreshDocList);
}

document.addEventListener('DOMContentLoaded', wire);
