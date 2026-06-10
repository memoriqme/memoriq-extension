function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveWrappingKey(password, salt) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-KW', length: 256 },
    true,
    ['wrapKey', 'unwrapKey'],
  );
}

async function unwrapMEK(password, saltB64, encryptedMekB64) {
  const wrappingKey = await deriveWrappingKey(password, base64ToUint8Array(saltB64));
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToUint8Array(encryptedMekB64),
    wrappingKey,
    { name: 'AES-KW' },
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function exportMEK(mek) {
  return crypto.subtle.exportKey('jwk', mek);
}

async function importMEK(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function encryptJson(value, mek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, mek, plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return uint8ArrayToBase64(combined);
}

async function decryptJson(payload, mek) {
  const combined = base64ToUint8Array(payload);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, mek, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

globalThis.MemoriqCrypto = {
  unwrapMEK,
  exportMEK,
  importMEK,
  encryptJson,
  decryptJson,
  sha256Hex,
};
