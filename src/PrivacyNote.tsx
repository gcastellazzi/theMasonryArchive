import { ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiEnabled, deleteAccount, useSession } from './auth';

/**
 * Cosa l'archivio conserva di chi contribuisce.
 *
 * L'archivio raccoglie indirizzi email e affiliazioni di studenti in un
 * contesto universitario europeo: dirlo in chiaro, e dare un modo concreto di
 * cancellarsi, non e' un adempimento formale ma la condizione perche' abbia
 * senso chiedere quei dati.
 */
export function PrivacyNote() {
  const { contributor, signedIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!apiEnabled) return null;

  async function remove() {
    if (
      !window.confirm(
        'Delete your account? Contributions that have not been published yet are ' +
          'deleted with it. Photos already accepted into the archive stay, credited to you.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-4 text-primary" />
        What we keep about contributors
      </h2>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="font-medium">What</dt>
          <dd className="text-muted-foreground">
            Your email address, the name and affiliation you enter, and the
            photos and suggestions you send. Nothing else: no analytics, no
            tracking cookies, no third-party scripts.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Why</dt>
          <dd className="text-muted-foreground">
            The address signs you in and lets us tell you what happened to your
            contribution. The name and affiliation credit you on the records
            you contribute — the archive is citable, so attribution is part of
            the content.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Where</dt>
          <dd className="text-muted-foreground">
            On Cloudflare (database and file storage) and, for the sign-in
            message alone, the email provider. Map tiles come from
            OpenStreetMap, which sees your browser&rsquo;s requests for them.
          </dd>
        </div>
        <div>
          <dt className="font-medium">How long</dt>
          <dd className="text-muted-foreground">
            Until you ask otherwise. Sign-in links expire after fifteen
            minutes; a session lasts thirty days.
          </dd>
        </div>
      </dl>

      {signedIn && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-sm text-muted-foreground">
            Signed in as {contributor?.email}. Deleting your account also
            deletes any contribution still awaiting review. Photos already
            accepted stay in the archive, credited to you — they are part of a
            published, citable data set.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 />
            {busy ? 'Deleting…' : 'Delete my account'}
          </Button>
          {error && (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          )}
        </div>
      )}
    </section>
  );
}
