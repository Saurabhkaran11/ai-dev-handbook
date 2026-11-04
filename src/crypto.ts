import type { Content } from './types';

/** Shape of public/content.enc. Produced by scripts/encrypt.ts. */
export interface EncryptedBlob {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64, AES-256-GCM ciphertext + tag
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt', 'encrypt'],
  );
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

let blobPromise: Promise<EncryptedBlob> | undefined;

/** Fetch the encrypted content once and decrypt it with the given password. */
export async function decryptContent(password: string): Promise<Content> {
  blobPromise ??= fetch('content.enc').then((r) => {
    if (!r.ok) throw new Error(`content.enc missing (${r.status}). Run "pnpm encrypt" first.`);
    return r.json() as Promise<EncryptedBlob>;
  });
  const blob = await blobPromise;
  const key = await deriveKey(password, b64ToBytes(blob.salt), blob.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(blob.iv) as BufferSource }, key, b64ToBytes(blob.data) as BufferSource);
  } catch {
    throw new WrongPasswordError(); // AES-GCM authentication fails on a wrong key
  }
  return JSON.parse(new TextDecoder().decode(plain)) as Content;
}
