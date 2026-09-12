import type { ReviewStatus, Role } from '../../src/types';

/**
 * I tipi condivisi con il frontend arrivano da `src/types.ts`: ruoli e stati
 * di revisione devono avere un vocabolario solo, altrimenti client e server
 * finiscono per non essere d'accordo su cosa sia «pending».
 */
export type { ReviewStatus, Role };

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  LINKS: KVNamespace;

  // Segreti, da `wrangler secret put` o da .dev.vars in sviluppo.
  JWT_SECRET: string;
  ADMIN_TOKEN: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Mittente verificato su Resend, es. "The Masonry Archive <no-reply@…>". */
  MAIL_FROM?: string;

  // Variabili pubbliche da wrangler.toml.
  SITE_URL: string;
  ALLOWED_ORIGINS: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  MAX_UPLOAD_BYTES?: string;
};

export type Contributor = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  affiliation: string;
  role: Role;
  orcid: string;
  lab: string;
  blocked: boolean;
};

export type Submission = {
  id: string;
  contributorId: string;
  r2Key: string;
  originalName: string;
  bytes: number;
  contentType: string;
  lat: number | null;
  lng: number | null;
  capturedAt: string | null;
  camera: string | null;
  notes: string;
  licenseOk: boolean;
  status: ReviewStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string;
  recordId: string | null;
};

/** Errore con uno stato HTTP, per non spargere `Response` in tutto il codice. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
