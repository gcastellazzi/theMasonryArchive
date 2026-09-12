import type { Contributor, Env, Role, Submission } from './types';

/** Accesso a D1. Tutte le query stanno qui, cosi' lo schema ha un solo lettore. */

type ContributorRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  affiliation: string;
  role: string;
  orcid: string;
  lab: string;
  blocked: number;
};

type SubmissionRow = {
  id: string;
  contributor_id: string;
  r2_key: string;
  original_name: string;
  bytes: number;
  content_type: string;
  lat: number | null;
  lng: number | null;
  captured_at: string | null;
  camera: string | null;
  notes: string;
  license_ok: number;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string;
  record_id: string | null;
};

function toContributor(row: ContributorRow): Contributor {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    affiliation: row.affiliation,
    role: row.role as Role,
    orcid: row.orcid,
    lab: row.lab,
    blocked: Boolean(row.blocked),
  };
}

function toSubmission(row: SubmissionRow): Submission {
  return {
    id: row.id,
    contributorId: row.contributor_id,
    r2Key: row.r2_key,
    originalName: row.original_name,
    bytes: row.bytes,
    contentType: row.content_type,
    lat: row.lat,
    lng: row.lng,
    capturedAt: row.captured_at,
    camera: row.camera,
    notes: row.notes,
    licenseOk: Boolean(row.license_ok),
    status: row.status as Submission['status'],
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    recordId: row.record_id,
  };
}

export async function findContributor(
  env: Env,
  id: string,
): Promise<Contributor | null> {
  const row = await env.DB.prepare('SELECT * FROM contributors WHERE id = ?')
    .bind(id)
    .first<ContributorRow>();
  return row ? toContributor(row) : null;
}

/**
 * Trova il contributore per email, creandolo se e' la prima volta.
 *
 * La verifica del magic link e' anche la registrazione: chi dimostra di
 * leggere quell'indirizzo ha gia' fatto tutto quello che serve, e un modulo di
 * iscrizione separato sarebbe solo un passaggio in piu' da abbandonare.
 */
export async function upsertContributor(
  env: Env,
  email: string,
): Promise<Contributor> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare('SELECT * FROM contributors WHERE email = ?')
    .bind(email)
    .first<ContributorRow>();

  if (existing) {
    await env.DB.prepare('UPDATE contributors SET last_seen_at = ? WHERE id = ?')
      .bind(now, existing.id)
      .run();
    return toContributor(existing);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO contributors (id, email, created_at, last_seen_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(id, email, now, now)
    .run();

  return {
    id,
    email,
    firstName: '',
    lastName: '',
    affiliation: '',
    role: 'Student',
    orcid: '',
    lab: '',
    blocked: false,
  };
}

export async function updateProfile(
  env: Env,
  id: string,
  patch: Partial<Omit<Contributor, 'id' | 'email' | 'blocked'>>,
): Promise<Contributor> {
  const columns: Record<string, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    affiliation: 'affiliation',
    role: 'role',
    orcid: 'orcid',
    lab: 'lab',
  };

  const sets: string[] = [];
  const values: unknown[] = [];
  Object.entries(patch).forEach(([key, value]) => {
    const column = columns[key];
    if (column && typeof value === 'string') {
      sets.push(`${column} = ?`);
      values.push(value.slice(0, 200));
    }
  });

  if (sets.length) {
    await env.DB.prepare(`UPDATE contributors SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values, id)
      .run();
  }

  const contributor = await findContributor(env, id);
  if (!contributor) throw new Error('contributore sparito durante l\'aggiornamento');
  return contributor;
}

export async function deleteContributor(env: Env, id: string): Promise<string[]> {
  // I file dei contributi non ancora pubblicati vanno tolti anche da R2: il
  // chiamante li cancella usando le chiavi restituite qui.
  const pending = await env.DB.prepare(
    "SELECT r2_key FROM submissions WHERE contributor_id = ? AND status != 'accepted'",
  )
    .bind(id)
    .all<{ r2_key: string }>();

  await env.DB.prepare('DELETE FROM contributors WHERE id = ?').bind(id).run();
  return (pending.results ?? []).map((row) => row.r2_key);
}

export async function insertSubmission(
  env: Env,
  submission: Omit<Submission, 'reviewedAt' | 'reviewNote' | 'recordId'>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO submissions
       (id, contributor_id, r2_key, original_name, bytes, content_type,
        lat, lng, captured_at, camera, notes, license_ok, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      submission.id,
      submission.contributorId,
      submission.r2Key,
      submission.originalName,
      submission.bytes,
      submission.contentType,
      submission.lat,
      submission.lng,
      submission.capturedAt,
      submission.camera,
      submission.notes,
      submission.licenseOk ? 1 : 0,
      submission.status,
      submission.createdAt,
    )
    .run();
}

export async function listSubmissions(
  env: Env,
  where: { contributorId?: string; status?: string },
): Promise<Submission[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (where.contributorId) {
    clauses.push('contributor_id = ?');
    values.push(where.contributorId);
  }
  if (where.status) {
    clauses.push('status = ?');
    values.push(where.status);
  }

  const sql = `SELECT * FROM submissions${
    clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  } ORDER BY created_at DESC LIMIT 500`;

  const rows = await env.DB.prepare(sql).bind(...values).all<SubmissionRow>();
  return (rows.results ?? []).map(toSubmission);
}

export async function findSubmission(
  env: Env,
  id: string,
): Promise<Submission | null> {
  const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?')
    .bind(id)
    .first<SubmissionRow>();
  return row ? toSubmission(row) : null;
}

export async function reviewSubmission(
  env: Env,
  id: string,
  status: 'accepted' | 'rejected',
  note: string,
  recordId: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE submissions
        SET status = ?, reviewed_at = ?, review_note = ?, record_id = ?
      WHERE id = ?`,
  )
    .bind(status, new Date().toISOString(), note.slice(0, 1000), recordId, id)
    .run();
}

export async function insertSuggestion(
  env: Env,
  suggestion: {
    id: string;
    contributorId: string;
    recordId: string;
    kind: 'tag' | 'text';
    field: string | null;
    value: string;
    rationale: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO suggestions
       (id, contributor_id, record_id, kind, field, value, rationale, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(
      suggestion.id,
      suggestion.contributorId,
      suggestion.recordId,
      suggestion.kind,
      suggestion.field,
      suggestion.value,
      suggestion.rationale,
      new Date().toISOString(),
    )
    .run();
}

export async function listSuggestions(env: Env, status: string) {
  const rows = await env.DB.prepare(
    `SELECT s.*, c.email, c.first_name, c.last_name, c.affiliation, c.role
       FROM suggestions s
       JOIN contributors c ON c.id = s.contributor_id
      WHERE s.status = ?
      ORDER BY s.created_at DESC
      LIMIT 500`,
  )
    .bind(status)
    .all();
  return rows.results ?? [];
}
