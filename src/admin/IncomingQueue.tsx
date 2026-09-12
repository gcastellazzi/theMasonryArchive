import { Camera, Check, Clock, MapPin, Mail, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Submission } from '../types';

/**
 * I contributi arrivati da fuori, in attesa di essere guardati.
 *
 * Qui si decide soltanto: accettare o rifiutare. Le decisioni restano nel file
 * finche' `tools/apply_submissions.py` non le esegue, perche' quello che serve
 * dopo — derivate, geocodifica, impronta del file — e' lavoro da riga di
 * comando, non da browser.
 *
 * Accettare non pubblica niente: la foto entra nell'archivio come record da
 * catalogare, e diventa pubblica solo dopo. Sono due cancelli, e devono
 * restare due: la foto puo' essere legittima e la scheda ancora vuota.
 */

const BASE = import.meta.env.BASE_URL;

function Decision({
  submission,
  onDecide,
}: {
  submission: Submission;
  onDecide: (decision: 'accepted' | 'rejected' | undefined, note: string) => void;
}) {
  const [note, setNote] = useState(submission.decisionNote ?? '');

  if (submission.decision) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
        <span
          className={`rounded-md px-2 py-1 font-medium ${
            submission.decision === 'accepted'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {submission.decision === 'accepted' ? 'Accepted' : 'Rejected'}
        </span>
        {submission.decisionNote && (
          <span className="text-muted-foreground">“{submission.decisionNote}”</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {submission.appliedAt
            ? `applied ${submission.appliedAt.slice(0, 10)}`
            : 'save, then run apply_submissions.py'}
        </span>
        {!submission.appliedAt && (
          <Button size="sm" variant="ghost" onClick={() => onDecide(undefined, '')}>
            Undo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 border-t pt-2">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note to the contributor (optional) — sent with the decision"
        className="h-8 w-full rounded-md border bg-background px-2 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onDecide('accepted', note)}>
          <Check />
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => onDecide('rejected', note)}
        >
          <X />
          Reject
        </Button>
      </div>
    </div>
  );
}

export function IncomingQueue({
  submissions,
  onDecide,
}: {
  submissions: Submission[];
  onDecide: (
    id: string,
    decision: 'accepted' | 'rejected' | undefined,
    note: string,
  ) => void;
}) {
  const waiting = submissions.filter((item) => !item.appliedAt);

  if (!submissions.length) {
    return (
      <section className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        Nothing has arrived yet. Run{' '}
        <code className="mx-1">python3 tools/pull_submissions.py</code> to fetch
        whatever is waiting on the server.
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="rounded-md border bg-card p-3">
        <h3 className="text-sm font-semibold">Incoming contributions</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {waiting.filter((item) => !item.decision).length} to look at ·{' '}
          {waiting.filter((item) => item.decision).length} decided, waiting for{' '}
          <code>apply_submissions.py</code>. Accepting adds the photo as a
          record to catalogue — it does not publish it.
        </p>
      </div>

      <ul className="grid gap-3">
        {waiting.map((submission) => {
          const who =
            [submission.contributor.firstName, submission.contributor.lastName]
              .filter(Boolean)
              .join(' ') || submission.contributor.email;
          return (
            <li
              key={submission.id}
              className="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-[200px_minmax(0,1fr)]"
            >
              {submission.preview ? (
                /* eslint-disable-next-line next/no-img-element */
                <img
                  src={`${BASE}${submission.preview}`}
                  alt=""
                  loading="lazy"
                  className="max-h-48 w-full rounded-md bg-muted object-contain"
                />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                  no preview
                </div>
              )}

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <strong className="font-medium">{who}</strong>
                  <span className="text-xs text-muted-foreground">
                    {submission.contributor.affiliation}
                    {submission.contributor.role ? ` · ${submission.contributor.role}` : ''}
                  </span>
                  <a
                    href={`mailto:${submission.contributor.email}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Mail className="size-3" />
                    {submission.contributor.email}
                  </a>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    sent {submission.createdAt.slice(0, 10)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {submission.lat !== null && submission.lng !== null
                      ? `${submission.lat.toFixed(5)}, ${submission.lng.toFixed(5)}`
                      : 'no coordinates — it cannot be published until placed'}
                  </span>
                  {submission.camera && (
                    <span className="inline-flex items-center gap-1">
                      <Camera className="size-3" />
                      {submission.camera}
                    </span>
                  )}
                  {submission.capturedAt && (
                    <span>taken {submission.capturedAt.slice(0, 10)}</span>
                  )}
                  <span className="font-mono">{submission.originalName}</span>
                </div>

                {submission.notes && (
                  <p className="rounded-md bg-muted/60 p-2 text-sm">{submission.notes}</p>
                )}

                <Decision
                  submission={submission}
                  onDecide={(decision, note) => onDecide(submission.id, decision, note)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
