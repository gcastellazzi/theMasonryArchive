import { useEffect, useRef, useState } from 'react';

import { navigate, type Route } from './router';
import { verifyLink } from './auth';

/**
 * Dove atterra il magic link.
 *
 * Il token e' monouso: appena consumato va tolto dall'indirizzo, altrimenti
 * resta nella cronologia e nella barra del browser, e un tasto indietro
 * riproverebbe un token ormai bruciato mostrando un errore che non descrive
 * nulla di reale.
 */
export function AuthLanding({ token, route }: { token: string; route: Route }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');
  // Il token si puo' consumare una volta sola: senza questa guardia un secondo
  // passaggio dell'effetto — StrictMode in sviluppo, o un render in piu' —
  // brucerebbe il link e mostrerebbe un errore inesistente.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (attempted.current === token) return;
    attempted.current = token;

    let cancelled = false;
    void verifyLink(token)
      .then(() => {
        if (cancelled) return;
        setState('done');
        navigate({ ...route, view: 'Upload', token: undefined }, { replace: true });
      })
      .catch((problem: unknown) => {
        if (cancelled) return;
        setError(problem instanceof Error ? problem.message : String(problem));
        setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token, route]);

  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="mb-1 font-semibold">Signing you in</h2>
      {state === 'working' && (
        <p className="text-sm text-muted-foreground">One moment…</p>
      )}
      {state === 'failed' && (
        <div className="grid gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">
            Sign-in links work once and expire after fifteen minutes. Ask for a
            new one from the Upload tab.
          </p>
        </div>
      )}
    </section>
  );
}
