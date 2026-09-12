import { HttpError, type Contributor, type Env } from './types';

/**
 * Autenticazione con magic link.
 *
 * Nessuna password: l'utente scrive il proprio indirizzo, riceve un link
 * monouso valido quindici minuti e da quel momento porta un token firmato.
 * Per un archivio universitario e' la scelta giusta — non c'e' una password in
 * piu' da inventare e da perdere, e l'indirizzo istituzionale e' gia' la prova
 * di identita' che interessa.
 *
 * Il token del link vive in KV con scadenza automatica; la sessione e' un JWT
 * firmato HMAC-SHA256 con WebCrypto, quindi il Worker non deve tenere stato.
 */

const LINK_TTL_SECONDS = 15 * 60;
const SESSION_DAYS = 30;

/** Quante richieste di link si accettano per indirizzo e per IP ogni ora. */
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  view.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function sha256(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(
    encoder.encode(
      JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64url(signature)}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'token malformato');

  const [header, body, signature] = parts;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    fromBase64url(signature),
    encoder.encode(`${header}.${body}`),
  );
  if (!valid) throw new HttpError(401, 'firma non valida');

  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) {
    throw new HttpError(401, 'sessione scaduta');
  }
  return payload;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    throw new HttpError(400, 'indirizzo email non valido');
  }
  return email;
}

/** Vuoto in configurazione significa: qualunque dominio va bene. */
export function emailDomainAllowed(email: string, env: Env): boolean {
  const allowed = (env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return true;
  const domain = email.split('@')[1];
  return allowed.some((item) => domain === item || domain.endsWith(`.${item}`));
}

/**
 * Conta le richieste in una finestra scorrevole grossolana.
 *
 * Non e' un rate limiter esatto — la finestra si azzera tutta insieme — ma
 * basta allo scopo: impedire che qualcuno usi l'endpoint per sommergere di
 * email un indirizzo altrui.
 */
export async function rateLimited(env: Env, key: string): Promise<boolean> {
  const slot = `rl:${key}`;
  const current = Number((await env.LINKS.get(slot)) ?? 0);
  if (current >= RATE_LIMIT) return true;
  await env.LINKS.put(slot, String(current + 1), {
    expirationTtl: RATE_WINDOW_SECONDS,
  });
  return false;
}

/** Crea il token monouso e ne restituisce la parte che finisce nel link. */
export async function issueMagicLink(env: Env, email: string): Promise<string> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  // In KV si conserva solo l'impronta: chi leggesse il datastore non
  // otterrebbe token utilizzabili.
  await env.LINKS.put(`link:${await sha256(token)}`, email, {
    expirationTtl: LINK_TTL_SECONDS,
  });
  return token;
}

/** Consuma il token. Un secondo tentativo con lo stesso token fallisce. */
export async function consumeMagicLink(env: Env, token: string): Promise<string> {
  const slot = `link:${await sha256(token)}`;
  const email = await env.LINKS.get(slot);
  if (!email) throw new HttpError(401, 'link scaduto o gia\' usato');
  await env.LINKS.delete(slot);
  return email;
}

export async function requireContributor(
  request: Request,
  env: Env,
  lookup: (id: string) => Promise<Contributor | null>,
): Promise<Contributor> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'autenticazione richiesta');

  const payload = await verifyJwt(token, env.JWT_SECRET);
  const contributor = await lookup(String(payload.sub ?? ''));
  if (!contributor) throw new HttpError(401, 'utente non trovato');
  if (contributor.blocked) throw new HttpError(403, 'utenza sospesa');
  return contributor;
}

export function requireAdmin(request: Request, env: Env): void {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Confronto a tempo costante: un confronto normale perde informazione sulla
  // lunghezza del prefisso corretto.
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    throw new HttpError(401, 'token di amministrazione non valido');
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** Verifica il captcha. Senza segreto configurato il controllo e' disattivato. */
export async function verifyTurnstile(
  env: Env,
  token: string | null,
  ip: string | null,
): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new HttpError(400, 'captcha mancante');

  const body = new FormData();
  body.set('secret', env.TURNSTILE_SECRET);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body },
  );
  const result = (await response.json()) as { success?: boolean };
  if (!result.success) throw new HttpError(400, 'captcha non superato');
}
