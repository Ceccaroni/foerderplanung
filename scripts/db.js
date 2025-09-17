// /scripts/db.js
// SQLite via sql.js (WASM). Ganze DB als verschlüsselter Blob in IndexedDB.
// UI bleibt unberührt; Aufruf später aus App oder Konsole.
import { deriveKey, encryptBytes, decryptBytes, randomBytes } from './crypto.js';
import { idbGet, idbSet } from './idb.js';

let SQL;           // sql.js Namespace
let db = null;     // laufende SQLite-DB
let key = null;    // AES-GCM CryptoKey
let salt = null;   // PBKDF2 salt (Uint8Array)

const ID_SALT = 'kdf-salt';
const ID_DB   = 'db-core';   // wir starten mit einer Core-DB; Vault kommt später separat

export async function loadSqlJs() {
  if (SQL) return SQL;
  // sql-wasm.js dynamisch laden; verschiedene Exportvarianten abfangen
  const mod = await import('../lib/sqljs/sql-wasm.js');

  const init =
    (typeof mod === 'function' && mod) ||
    (typeof mod.default === 'function' && mod.default) ||
    (typeof mod.initSqlJs === 'function' && mod.initSqlJs) ||
    (mod.default && typeof mod.default.initSqlJs === 'function' && mod.default.initSqlJs);

  if (!init) {
    console.error('sql-wasm.js Export:', mod);
    throw new Error('sql-wasm.js: keine Init-Funktion gefunden (Datei/Build prüfen).');
  }

  SQL = await init({ locateFile: f => `./lib/sqljs/${f}` });
  return SQL;
}

export async function openDatabase(passphrase) {
  await loadSqlJs();

  // Salt laden/erzeugen
  let storedSalt = await idbGet(ID_SALT);
  if (!storedSalt) {
    storedSalt = randomBytes(16);
    await idbSet(ID_SALT, storedSalt);
  }
  salt = new Uint8Array(storedSalt);
  key = await deriveKey(passphrase, salt);

  // Verschlüsselte DB laden
  const packed = await idbGet(ID_DB);
  if (packed && packed.iv && packed.cipher) {
    const iv = new Uint8Array(packed.iv);
    const cipher = new Uint8Array(packed.cipher);
    const plain = await decryptBytes(key, iv, cipher);
    db = new SQL.Database(plain);
  } else {
    db = new SQL.Database();
    bootstrapSchema(db);
    await persist(); // erste Version sichern
  }
  return true;
}

export async function persist() {
  if (!db || !key) throw new Error('DB nicht offen');
  const bytes = db.export(); // Uint8Array
  const { iv, cipher } = await encryptBytes(key, bytes);
  await idbSet(ID_DB, { iv: Array.from(iv), cipher: Array.from(cipher) });
}

export function isOpen(){ return !!db; }

export function closeDatabase(){
  if (db) db.close();
  db = null; key = null;
}

export function getHandle(){ return db; } // vorsichtig verwenden (nur intern)

function bootstrapSchema(db){
  db.run(`
    PRAGMA user_version = 1;

    CREATE TABLE IF NOT EXISTS student (
      id TEXT PRIMARY KEY,
      vorname TEXT NOT NULL,
      name TEXT NOT NULL,
      geburtstag TEXT,
      adresse TEXT,
      bemerkung TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kontakt (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      rolle TEXT NOT NULL,
      name TEXT NOT NULL,
      telefon TEXT,
      email TEXT,
      adresse TEXT,
      FOREIGN KEY(student_id) REFERENCES student(id)
    );

    CREATE TABLE IF NOT EXISTS status_flag (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      bezeichnung TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_status (
      student_id TEXT NOT NULL,
      flag_id TEXT NOT NULL,
      PRIMARY KEY (student_id, flag_id),
      FOREIGN KEY(student_id) REFERENCES student(id),
      FOREIGN KEY(flag_id) REFERENCES status_flag(id)
    );

    CREATE TABLE IF NOT EXISTS rilz_fach (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      fach TEXT NOT NULL,
      details TEXT,
      FOREIGN KEY(student_id) REFERENCES student(id)
    );

    CREATE TABLE IF NOT EXISTS historie (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      titel TEXT NOT NULL,
      beschreibung TEXT,
      von TEXT,
      bis TEXT,
      FOREIGN KEY(student_id) REFERENCES student(id)
    );

    CREATE TABLE IF NOT EXISTS plan (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      titel TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('entwurf','aktiv','evaluation','abgeschlossen')),
      fach TEXT,
      startdatum TEXT,
      endedatum TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(student_id) REFERENCES student(id)
    );

    CREATE TABLE IF NOT EXISTS ziel (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      titel TEXT NOT NULL,
      beschreibung TEXT,
      status TEXT NOT NULL CHECK(status IN ('entwurf','aktiv','evaluation','abgeschlossen')),
      verantwortlich TEXT,
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES plan(id)
    );

    CREATE TABLE IF NOT EXISTS teilziel (
      id TEXT PRIMARY KEY,
      ziel_id TEXT NOT NULL,
      titel TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('entwurf','aktiv','evaluation','abgeschlossen')),
      sort_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(ziel_id) REFERENCES ziel(id)
    );

    CREATE TABLE IF NOT EXISTS indikator (
      id TEXT PRIMARY KEY,
      ziel_id TEXT NOT NULL,
      text TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(ziel_id) REFERENCES ziel(id)
    );

    CREATE TABLE IF NOT EXISTS beobachtung (
      id TEXT PRIMARY KEY,
      ziel_id TEXT NOT NULL,
      autor TEXT,
      text TEXT NOT NULL,
      sichtbarkeit TEXT NOT NULL CHECK(sichtbarkeit IN ('privat','team','gruppe')),
      created_at INTEGER NOT NULL,
      edited_at INTEGER,
      FOREIGN KEY(ziel_id) REFERENCES ziel(id)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_student ON plan(student_id);
    CREATE INDEX IF NOT EXISTS idx_ziel_plan ON ziel(plan_id);
    CREATE INDEX IF NOT EXISTS idx_teilziel_ziel ON teilziel(ziel_id);
    CREATE INDEX IF NOT EXISTS idx_beo_ziel_created ON beobachtung(ziel_id, created_at DESC);
  `);
}

// Beispiel-APIs (ohne UI), damit wir später direkt andocken können
export function addStudent({id = crypto.randomUUID(), vorname, name, geburtstag = null, adresse = null, bemerkung = null}){
  const now = Date.now();
  const stmt = db.prepare('INSERT INTO student (id,vorname,name,geburtstag,adresse,bemerkung,created_at) VALUES (?,?,?,?,?,?,?)');
  stmt.run([id, vorname, name, geburtstag, adresse, bemerkung, now]);
  stmt.free();
  return id;
}

export function listStudents(){
  const res = db.exec('SELECT id, vorname, name, geburtstag FROM student ORDER BY name, vorname');
  if (!res[0]) return [];
  const cols = res[0].columns, rows = res[0].values;
  return rows.map(r => Object.fromEntries(r.map((v,i)=>[cols[i], v])));
}
