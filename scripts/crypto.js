// PBKDF2 → AES-GCM (256 Bit). Schlüssel wird NIE persistent gespeichert.
const enc = new TextEncoder();

export async function deriveKey(passphrase, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
}

export function randomBytes(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export async function encryptBytes(key, plainBytes) {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  return { iv, cipher: new Uint8Array(cipher) };
}

export async function decryptBytes(key, iv, cipherBytes) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  return new Uint8Array(plain);
}
