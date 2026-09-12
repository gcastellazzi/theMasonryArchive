import { HttpError, type Contributor, type Env } from './types';
import { insertSubmission } from './db';

/**
 * Ricezione di una foto.
 *
 * Il file viene depositato in `incoming/` e resta privato finche' un
 * amministratore non lo accetta: nulla di quanto arriva da fuori diventa
 * pubblico senza che qualcuno lo abbia guardato.
 */

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

const ACCEPTED: { type: string; extension: string; matches: (head: Uint8Array) => boolean }[] = [
  {
    type: 'image/jpeg',
    extension: '.jpg',
    matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  },
  {
    type: 'image/png',
    extension: '.png',
    matches: (h) =>
      h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47,
  },
  {
    type: 'image/webp',
    extension: '.webp',
    // "RIFF" .... "WEBP"
    matches: (h) =>
      h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
      h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50,
  },
  {
    type: 'image/heic',
    extension: '.heic',
    // box "ftyp" a offset 4, come in HEIC e HEIF
    matches: (h) =>
      h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70,
  },
];

/**
 * Riconosce il formato dai byte iniziali, non dal nome ne' dal Content-Type.
 *
 * Entrambi arrivano dal client e si cambiano in un attimo: un eseguibile
 * rinominato `.jpg` passerebbe qualunque controllo sull'estensione.
 */
function sniff(head: Uint8Array): { type: string; extension: string } {
  const match = ACCEPTED.find((candidate) => candidate.matches(head));
  if (!match) {
    throw new HttpError(400, 'formato non riconosciuto: accettiamo JPEG, PNG, WebP e HEIC');
  }
  return { type: match.type, extension: match.extension };
}

function coordinate(value: string | null, limit: number): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    throw new HttpError(400, 'coordinate fuori scala');
  }
  return parsed;
}

export async function handleUpload(
  request: Request,
  env: Env,
  contributor: Contributor,
): Promise<Response> {
  const form = await request.formData();
  // I tipi dei Workers dichiarano `get` come `string | null`, ma a runtime un
  // campo file restituisce un `File`: si passa da `unknown` per poterlo dire.
  const file: unknown = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'file mancante');

  if (form.get('licenseOk') !== 'true') {
    throw new HttpError(400, 'serve la conferma della licenza');
  }

  const maxBytes = Number(env.MAX_UPLOAD_BYTES ?? DEFAULT_MAX_BYTES);
  if (file.size > maxBytes) {
    throw new HttpError(
      413,
      `file troppo grande: ${(file.size / 1048576).toFixed(1)} MB, il limite e' ${(maxBytes / 1048576).toFixed(0)} MB`,
    );
  }
  if (file.size === 0) throw new HttpError(400, 'file vuoto');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { type, extension } = sniff(bytes.subarray(0, 16));

  // Ogni convalida che puo' rifiutare la richiesta va fatta PRIMA di scrivere
  // sul bucket. Validare dopo lascerebbe, a ogni rifiuto, un file senza riga
  // nel database: spazio che si paga e che nessuna query sa piu' spiegare.
  const record = {
    id: crypto.randomUUID(),
    contributorId: contributor.id,
    originalName: file.name.slice(0, 200),
    bytes: file.size,
    contentType: type,
    lat: coordinate(form.get('lat'), 90),
    lng: coordinate(form.get('lng'), 180),
    capturedAt: form.get('capturedAt')?.slice(0, 40) || null,
    camera: form.get('camera')?.slice(0, 120) || null,
    notes: String(form.get('notes') ?? '').slice(0, 2000),
    licenseOk: true,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  };

  const key = `incoming/${record.id}${extension}`;
  await env.BUCKET.put(key, bytes, {
    httpMetadata: { contentType: type },
    customMetadata: {
      contributor: contributor.id,
      originalName: record.originalName,
    },
  });

  try {
    await insertSubmission(env, { ...record, r2Key: key });
  } catch (error) {
    // Senza la riga il file non e' raggiungibile da nessuna parte: si toglie,
    // invece di lasciarlo a occupare il bucket per sempre.
    await env.BUCKET.delete(key);
    throw error;
  }

  return Response.json({ id: record.id, status: 'pending' }, { status: 201 });
}
