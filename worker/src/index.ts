import {
  consumeMagicLink, emailDomainAllowed, issueMagicLink, normaliseEmail,
  rateLimited, requireAdmin, requireContributor, signJwt, verifyTurnstile,
} from './auth';
import {
  deleteContributor, findContributor, findSubmission, insertSuggestion,
  listSubmissions, listSuggestions, reviewSubmission, updateProfile,
  upsertContributor,
} from './db';
import { sendDecision, sendMagicLink } from './email';
import { handleUpload } from './upload';
import { HttpError, type Env } from './types';

/**
 * L'API dei contributi.
 *
 * GitHub Pages ospita il sito ma non puo' ricevere file, autenticare nessuno
 * ne' spedire email. Questo Worker fa quelle tre cose e nient'altro:
 * l'archivio vero resta `src/data/records.json`, versionato in git, e la
 * moderazione resta in locale nel pannello. Qui vivono solo le persone che
 * contribuiscono e i contributi in attesa di essere guardati.
 */

/**
 * Legge il corpo JSON.
 *
 * `request.json()` solleva un SyntaxError su un corpo malformato, che senza
 * questo involucro diventerebbe un 500 e finirebbe nei log come errore
 * interno: e' invece una richiesta sbagliata del client, e va detto.
 */
async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'corpo della richiesta non e\' JSON valido');
  }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((item) => item.trim());
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const method = request.method;
  const ip = request.headers.get('CF-Connecting-IP');

  const lookup = (id: string) => findContributor(env, id);

  // --- autenticazione ---

  if (path === '/api/auth/request' && method === 'POST') {
    const body = await readJson<{ email?: string }>(request);
    const email = normaliseEmail(body.email);

    // Si risponde sempre 204, anche quando non si manda niente: dire «questo
    // indirizzo non e' ammesso» o «non esiste» trasformerebbe l'endpoint in
    // uno strumento per scoprire chi c'e' nell'archivio.
    if (
      emailDomainAllowed(email, env) &&
      !(await rateLimited(env, `email:${email}`)) &&
      !(await rateLimited(env, `ip:${ip ?? 'unknown'}`))
    ) {
      await sendMagicLink(env, email, await issueMagicLink(env, email));
    }
    return new Response(null, { status: 204 });
  }

  if (path === '/api/auth/verify' && method === 'POST') {
    const body = await readJson<{ token?: string }>(request);
    if (!body.token) throw new HttpError(400, 'token mancante');

    const email = await consumeMagicLink(env, String(body.token));
    const contributor = await upsertContributor(env, email);
    if (contributor.blocked) throw new HttpError(403, 'utenza sospesa');

    return Response.json({
      token: await signJwt({ sub: contributor.id }, env.JWT_SECRET),
      contributor,
    });
  }

  // --- profilo ---

  if (path === '/api/me' && method === 'GET') {
    return Response.json(await requireContributor(request, env, lookup));
  }

  if (path === '/api/me' && method === 'PATCH') {
    const contributor = await requireContributor(request, env, lookup);
    const patch = await readJson<Record<string, unknown>>(request);
    return Response.json(await updateProfile(env, contributor.id, patch));
  }

  if (path === '/api/me' && method === 'DELETE') {
    const contributor = await requireContributor(request, env, lookup);
    const orphaned = await deleteContributor(env, contributor.id);
    // I file dei contributi non ancora accettati se ne vanno con l'utente.
    await Promise.all(orphaned.map((key) => env.BUCKET.delete(key)));
    return new Response(null, { status: 204 });
  }

  // --- contributi ---

  if (path === '/api/uploads' && method === 'POST') {
    const contributor = await requireContributor(request, env, lookup);
    await verifyTurnstile(env, url.searchParams.get('captcha'), ip);
    return handleUpload(request, env, contributor);
  }

  if (path === '/api/my-uploads' && method === 'GET') {
    const contributor = await requireContributor(request, env, lookup);
    return Response.json(
      await listSubmissions(env, { contributorId: contributor.id }),
    );
  }

  if (path === '/api/suggestions' && method === 'POST') {
    const contributor = await requireContributor(request, env, lookup);
    const body = await readJson<Record<string, unknown>>(request);
    const kind = body.kind === 'text' ? 'text' : 'tag';
    const value = String(body.value ?? '').trim();
    const recordId = String(body.recordId ?? '').trim();
    if (!value || !recordId) throw new HttpError(400, 'proposta incompleta');

    const id = crypto.randomUUID();
    await insertSuggestion(env, {
      id,
      contributorId: contributor.id,
      recordId: recordId.slice(0, 100),
      kind,
      field: kind === 'text' ? String(body.field ?? '').slice(0, 40) : null,
      value: value.slice(0, 2000),
      rationale: String(body.rationale ?? '').slice(0, 2000),
    });
    return Response.json({ id, status: 'pending' }, { status: 201 });
  }

  // --- amministrazione, dalla macchina di chi cataloga ---

  if (path === '/api/admin/queue' && method === 'GET') {
    requireAdmin(request, env);
    const status = url.searchParams.get('status') ?? 'pending';
    const submissions = await listSubmissions(env, { status });

    // Il puller locale ha bisogno dell'autore per scrivere `author` e
    // `affiliation` sul record: si allega qui invece di far fare una chiamata
    // per contributo.
    const contributors = new Map<string, unknown>();
    for (const submission of submissions) {
      if (!contributors.has(submission.contributorId)) {
        contributors.set(
          submission.contributorId,
          await findContributor(env, submission.contributorId),
        );
      }
    }

    return Response.json({
      submissions,
      contributors: Object.fromEntries(contributors),
      suggestions: await listSuggestions(env, 'pending'),
    });
  }

  const decision = path.match(/^\/api\/admin\/submissions\/([\w-]+)$/);
  if (decision && method === 'POST') {
    requireAdmin(request, env);
    const body = await readJson<{
      status?: string;
      note?: string;
      recordId?: string;
    }>(request);
    if (body.status !== 'accepted' && body.status !== 'rejected') {
      throw new HttpError(400, 'stato non valido');
    }

    const submission = await findSubmission(env, decision[1]);
    if (!submission) throw new HttpError(404, 'contributo non trovato');

    await reviewSubmission(
      env,
      submission.id,
      body.status,
      String(body.note ?? ''),
      body.recordId ? String(body.recordId) : null,
    );

    const contributor = await findContributor(env, submission.contributorId);
    if (contributor) {
      await sendDecision(
        env,
        contributor.email,
        body.status === 'accepted',
        String(body.note ?? ''),
      );
    }
    return new Response(null, { status: 204 });
  }

  const fileMatch = path.match(/^\/api\/admin\/submissions\/([\w-]+)\/file$/);
  if (fileMatch && method === 'GET') {
    requireAdmin(request, env);
    const submission = await findSubmission(env, fileMatch[1]);
    if (!submission) throw new HttpError(404, 'contributo non trovato');

    const object = await env.BUCKET.get(submission.r2Key);
    if (!object) throw new HttpError(404, 'file non trovato sul bucket');

    return new Response(object.body, {
      headers: {
        'Content-Type': submission.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${submission.id}"`,
      },
    });
  }

  if (path === '/api/health' && method === 'GET') {
    return Response.json({ ok: true });
  }

  throw new HttpError(404, 'endpoint inesistente');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const response = await route(request, env);
      Object.entries(cors).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      return response;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      return Response.json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : 'errore interno',
        },
        { status, headers: cors },
      );
    }
  },
};
