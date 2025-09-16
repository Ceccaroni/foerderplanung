// /scripts/vault.js
// Zweite, separat verschlüsselte SQLite-DB (sql.js) für DOKUMENTE & FOTOS.
// Keine UI. Keine Änderungen an index.html nötig.

import { deriveKey, encryptBytes, decryptBytes, randomBytes } from './crypto.js';
import { idbGet, idbSet } from './idb.js';

// sql.js Loader (eigenständig, kein Import aus db.js -> keine Zyklen)
let SQL = null;
async function loadSqlJs() {
  if (SQL) return SQL;
  const mod = await import('../lib/sqljs/sql-wasm.js');
  SQL = await mod.default({ locateFile: f => `./lib/sqljs/${f}` });
  return SQL;
}

// KDF/Storage-IDs – Salt wird mit core geteilt (gleicher KDF-Salt)
const ID_SALT      = 'kdf-salt';     // identisch zu core, damit eine Passphrase beide öffnet
const ID_DB_VAULT  = 'db-vault';     // separater Blob für Dokumente/Fotos

let vdb  = null; // laufende Vault-DB
let vkey = null; // AES-GCM Key
let vsalt = null;

// Öffnen/Erstellen der Vault-DB
export async function openVault(passphrase) {
  await loadSqlJs();

  // KDF-Salt laden oder erzeugen (mit core geteilt)
  let storedSalt = await idbGet(ID_SALT);
  if (!storedSalt) {
    storedSalt = randomBytes(16);
    await idbSet(ID_SALT, storedSalt);
  }
  vsalt = new Uint8Array(storedSalt);
  vkey  = await deriveKey(passphrase, vsalt);

  // verschlüsselte DB laden
  const packed = await idbGet(ID_DB_VAULT);
  if (packed && packed.iv && packed.cipher) {
    const iv = new Uint8Array(packed.iv);
    const cipher = new Uint8Array(packed.cipher);
    const plain = await decryptBytes(vkey, iv, cipher);
    vdb = new SQL.Database(plain);
  } else {
    vdb = new SQL.Database();
    bootstrapVault(vdb);
    await persistVault();
  }
  return true;
}

export async function persistVault(){
  if (!vdb || !vkey) throw new Error('Vault nicht offen');
  const bytes = vdb.export();
  const { iv, cipher } = await encryptBytes(vkey, bytes);
  await idbSet(ID_DB_VAULT, { iv: Array.from(iv), cipher: Array.from(cipher) });
}

export function isVaultOpen(){ return !!vdb; }
export function closeVault(){
  if (vdb) vdb.close();
  vdb = null; vkey = null;
}

function bootstrapVault(db){
  db.run(`
    PRAGMA user_version = 1;

    -- Dokumente (beliebige Dateien; Blob unverschlüsselt in der DB,
    -- gesamte DB wird ausserhalb AES-GCM-verschlüsselt gespeichert)
    CREATE TABLE IF NOT EXISTS dokument (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      titel TEXT NOT NULL,
      dateiname TEXT NOT NULL,
      mime TEXT NOT NULL,
      groesse_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      blob BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doc_student ON dokument(student_id, created_at DESC);

    -- Foto je Schüler:in (genau 1 Eintrag pro student_id; REPLACE überschreibt)
    CREATE TABLE IF NOT EXISTS foto (
      student_id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      groesse_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      blob BLOB NOT NULL
    );
  `);
}

/* Hilfen */
async function sha256Hex(bytes){
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(hash);
  return [...view].map(b => b.toString(16).padStart(2,'0')).join('');
}

/* Dokumente-API */

// bytes: Uint8Array (Dateiinhalt)
// meta: { student_id, titel, dateiname, mime }
export async function addDocument(bytes, meta){
  if (!vdb) throw new Error('Vault nicht offen');
  if (!(bytes instanceof Uint8Array)) throw new Error('bytes muss Uint8Array sein');
  const id = crypto.randomUUID();
  const now = Date.now();
  const sha = await sha256Hex(bytes);

  const stmt = vdb.prepare(`
    INSERT INTO dokument (id, student_id, titel, dateiname, mime, groesse_bytes, sha256, created_at, blob)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  stmt.run([
    id,
    meta.student_id,
    meta.titel,
    meta.dateiname,
    meta.mime,
    bytes.byteLength,
    sha,
    now,
    bytes
  ]);
  stmt.free();
  await persistVault();
  return { id, sha };
}

export function listDocumentsByStudent(student_id){
  if (!vdb) throw new Error('Vault nicht offen');
  const res = vdb.exec(`
    SELECT id, titel, dateiname, mime, groesse_bytes, sha256, created_at
    FROM dokument
    WHERE student_id = $sid
    ORDER BY created_at DESC
  `, { $sid: student_id });
  if (!res[0]) return [];
  const { columns, values } = res[0];
  return values.map(r => Object.fromEntries(r.map((v,i)=>[columns[i], v])));
}

export function getDocumentMeta(id){
  if (!vdb) throw new Error('Vault nicht offen');
  const res = vdb.exec(`
    SELECT id, student_id, titel, dateiname, mime, groesse_bytes, sha256, created_at
    FROM dokument WHERE id = $id
  `, { $id: id });
  if (!res[0]) return null;
  const { columns, values } = res[0];
  const row = values[0];
  return Object.fromEntries(row.map((v,i)=>[columns[i], v]));
}

export function getDocumentBlob(id){
  if (!vdb) throw new Error('Vault nicht offen');
  const stmt = vdb.prepare(`SELECT blob FROM dokument WHERE id = ?`);
  stmt.getAsObject([id]); // initialisieren
  let blob = null;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    blob = row.blob; // Uint8Array
  }
  stmt.free();
  return blob; // Uint8Array oder null
}

export async function deleteDocument(id){
  if (!vdb) throw new Error('Vault nicht offen');
  const stmt = vdb.prepare(`DELETE FROM dokument WHERE id = ?`);
  stmt.run([id]); stmt.free();
  await persistVault();
  return true;
}

/* Foto-API (ein Foto pro Schüler:in) */

// bytes: Uint8Array (z. B. WebP), mime: "image/webp" u.ä.
export async function setPhoto(student_id, bytes, mime){
  if (!vdb) throw new Error('Vault nicht offen');
  if (!(bytes instanceof Uint8Array)) throw new Error('bytes muss Uint8Array sein');
  const now = Date.now();
  const stmt = vdb.prepare(`
    INSERT INTO foto (student_id, mime, groesse_bytes, created_at, blob)
    VALUES (?,?,?,?,?)
    ON CONFLICT(student_id) DO UPDATE SET
      mime=excluded.mime,
      groesse_bytes=excluded.groesse_bytes,
      created_at=excluded.created_at,
      blob=excluded.blob
  `);
  stmt.run([student_id, mime, bytes.byteLength, now, bytes]);
  stmt.free();
  await persistVault();
  return true;
}

export function getPhoto(student_id){
  if (!vdb) throw new Error('Vault nicht offen');
  const stmt = vdb.prepare(`SELECT mime, groesse_bytes, created_at, blob FROM foto WHERE student_id = ?`);
  stmt.getAsObject([student_id]);
  let out = null;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    out = { mime: row.mime, groesse_bytes: row.groesse_bytes, created_at: row.created_at, bytes: row.blob };
  }
  stmt.free();
  return out; // {mime, groesse_bytes, created_at, bytes: Uint8Array} | null
}

export async function deletePhoto(student_id){
  if (!vdb) throw new Error('Vault nicht offen');
  const stmt = vdb.prepare(`DELETE FROM foto WHERE student_id = ?`);
  stmt.run([student_id]); stmt.free();
  await persistVault();
  return true;
}
