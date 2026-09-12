import { useEffect, useSyncExternalStore } from 'react';

import type { Role } from './types';

/**
 * Sessione del contributore, tenuta dall'API su Cloudflare.
 *
 * Il sito resta statico: qui non si autentica nessuno, si conserva soltanto il
 * token firmato che il Worker ha rilasciato dopo il magic link. Senza
 * `VITE_API_BASE` configurata l'archivio funziona esattamente come prima —
 * consultazione pubblica, nessun contributo — e le schede che richiedono un
 * accesso lo dicono invece di rompersi.
 */

const API = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'masonry-archive:session';

export const apiEnabled = API !== '';

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
  status: 'pending' | 'accepted' | 'rejected';
  originalName: string;
  createdAt: string;
  reviewNote: string;
  recordId: string | null;
};

type Session = { token: string; contributor: Contributor } | null;

let session: Session = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function store(next: Session) {
  session = next;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next.token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Senza storage la sessione dura finche' la scheda resta aperta.
  }
  emit();
}

function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!API) throw new Error('The contribution service is not configured.');

  const token = session?.token ?? savedToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API}${path}`, { ...init, headers });

  // Un token scaduto o revocato non deve lasciare l'interfaccia a meta':
  // si chiude la sessione e si torna alla richiesta del link.
  if (response.status === 401 && token) store(null);

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response;
}

export async function requestLink(email: string): Promise<void> {
  await call('/api/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function verifyLink(token: string): Promise<Contributor> {
  const response = await fetch(`${API}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'This link is no longer valid.');
  }
  const data = (await response.json()) as { token: string; contributor: Contributor };
  store(data);
  return data.contributor;
}

let restoring = false;

/**
 * Riprende una sessione salvata, verificandola contro il server.
 *
 * Il token in `localStorage` dice solo che qualcuno era entrato, non che la
 * sessione valga ancora: puo' essere scaduta, o l'utenza puo' essere stata
 * cancellata. Si chiede al server prima di mostrare l'interfaccia da
 * autenticato.
 */
export async function restore(): Promise<void> {
  const token = savedToken();
  if (!token || session || restoring) return;

  restoring = true;
  try {
    const response = await fetch(`${API}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('sessione non piu\' valida');
    store({ token, contributor: (await response.json()) as Contributor });
  } catch {
    store(null);
  } finally {
    restoring = false;
  }
}

export function signOut(): void {
  store(null);
}

export async function updateProfile(
  patch: Partial<Contributor>,
): Promise<Contributor> {
  const response = await call('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const contributor = (await response.json()) as Contributor;
  if (session) store({ ...session, contributor });
  return contributor;
}

export async function deleteAccount(): Promise<void> {
  await call('/api/me', { method: 'DELETE' });
  store(null);
}

export async function uploadPhoto(form: FormData): Promise<{ id: string }> {
  const response = await call('/api/uploads', { method: 'POST', body: form });
  return (await response.json()) as { id: string };
}

export async function myUploads(): Promise<Submission[]> {
  const response = await call('/api/my-uploads');
  return (await response.json()) as Submission[];
}

export async function submitSuggestion(payload: {
  recordId: string;
  kind: 'tag' | 'text';
  field?: string;
  value: string;
  rationale?: string;
}): Promise<void> {
  await call('/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Session {
  return session;
}

export function useSession(): {
  contributor: Contributor | null;
  signedIn: boolean;
} {
  const current = useSyncExternalStore(subscribe, snapshot, () => null);
  return {
    contributor: current?.contributor ?? null,
    signedIn: Boolean(current?.contributor),
  };
}

/** Ricarica la sessione salvata all'avvio dell'applicazione. */
export function useRestoreSession(): void {
  useEffect(() => {
    if (apiEnabled) void restore();
  }, []);
}
