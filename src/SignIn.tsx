import { Mail } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { requestLink } from './auth';

/**
 * Richiesta del link di accesso.
 *
 * Nessuna password da inventare: si scrive il proprio indirizzo e si apre il
 * link che arriva. La risposta e' sempre la stessa, che l'indirizzo sia
 * ammesso o no — dire «questo indirizzo non e' registrato» trasformerebbe il
 * modulo in un modo per scoprire chi c'e' nell'archivio.
 */
export function SignIn({ reason }: { reason: string }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestLink(email.trim());
      setSent(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
        If <strong className="text-foreground">{email}</strong> can contribute
        to the archive, a sign-in link is on its way. It works once and expires
        in fifteen minutes.
      </p>
    );
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <label className="field">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@university.edu"
          required
        />
      </label>
      <Button type="submit" disabled={!email.trim() || busy}>
        <Mail />
        {busy ? 'Sending…' : 'Send me a link'}
      </Button>
      <p className="text-xs text-muted-foreground">
        No password. We store your address to attribute your contributions and
        to tell you what happened to them; you can delete your account and any
        unpublished contributions at any time.
      </p>
      {error && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
