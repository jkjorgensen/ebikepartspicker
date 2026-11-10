// HMAC tokens for price-alert unsubscribe links. Secret is ALERT_RUN_TOKEN.
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

const b64uToBytes = (s) => {
  if (!s || /[^A-Za-z0-9_-]/.test(s)) throw new Error('bad b64');
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b = (s + pad).replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};

const hmacKey = (secret) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

export async function makeUnsubToken(secret, email, bike) {
  if (!secret) return null;
  const payload = `${String(email).toLowerCase().trim()}|${String(bike)}`;
  const data = enc.encode(payload);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), data);
  return `${b64u(data)}.${b64u(sig)}`;
}

export async function readUnsubToken(secret, token) {
  if (!secret || !token || typeof token !== 'string' || token.length > 800) return null;
  const dot = token.indexOf('.');
  if (dot < 1 || token.indexOf('.', dot + 1) !== -1) return null;
  let data, got;
  try {
    data = b64uToBytes(token.slice(0, dot));
    got = b64uToBytes(token.slice(dot + 1));
  } catch (e) {
    return null;
  }
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), data));
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ got[i];
  if (diff !== 0) return null;
  const payload = dec.decode(data);
  const i = payload.lastIndexOf('|');
  if (i < 1 || i === payload.length - 1) return null;
  return { email: payload.slice(0, i), bike: payload.slice(i + 1) };
}

export const alertKey = (email, bike) => `alert:${String(email).toLowerCase().trim()}:${bike}`;
