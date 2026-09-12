import { Send } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiEnabled, submitSuggestion, useSession } from './auth';
import { SignIn } from './SignIn';
import {
  SUGGESTABLE_FIELDS,
  type MasonryRecord,
  type Role,
  type SuggestableField,
  type Suggestion,
} from './types';

/**
 * Proposta di un tag o di un testo su un record pubblicato.
 *
 * Non scrive nulla nell'archivio: produce una proposta in stato `pending` che
 * finisce nella coda di revisione dell'amministratore.
 *
 * Con il servizio dei contributi configurato la proposta parte davvero, e
 * l'autore e' quello della sessione — un'attribuzione dichiarata a mano non
 * varrebbe granche' in un archivio che si cita. Senza servizio la proposta
 * resta nella sessione corrente, dove il pannello admin locale la vede: e'
 * quanto basta per lavorare in locale.
 */
export function SuggestForm({
  records,
  onSubmit,
}: {
  records: MasonryRecord[];
  onSubmit: (suggestion: Suggestion) => void;
}) {
  const { contributor, signedIn } = useSession();

  const [recordId, setRecordId] = useState(records[0]?.id ?? '');
  const [kind, setKind] = useState<'tag' | 'text'>('tag');
  const [field, setField] = useState<SuggestableField>('technique');
  const [value, setValue] = useState('');
  const [author, setAuthor] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [role, setRole] = useState<Role>('Student');
  const [rationale, setRationale] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Con il servizio attivo l'autore viene dalla sessione; senza, va scritto.
  const signedAuthor = contributor
    ? [contributor.firstName, contributor.lastName].filter(Boolean).join(' ') ||
      contributor.email
    : '';
  const ready = Boolean(
    recordId && value.trim() && (apiEnabled ? signedIn : author.trim()),
  );

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (apiEnabled) {
        await submitSuggestion({
          recordId,
          kind,
          field: kind === 'text' ? field : undefined,
          value: value.trim(),
          rationale: rationale.trim() || undefined,
        });
      }

      onSubmit({
        id: `sug-${Date.now().toString(36)}`,
        recordId,
        kind,
        field: kind === 'text' ? field : undefined,
        value: value.trim(),
        author: apiEnabled ? signedAuthor : author.trim(),
        affiliation:
          (apiEnabled ? contributor?.affiliation : affiliation.trim()) || undefined,
        role: apiEnabled ? contributor?.role : role,
        rationale: rationale.trim() || undefined,
        submittedAt: new Date().toISOString(),
        status: 'pending',
      });
      setValue('');
      setRationale('');
      setSent(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  if (!records.length) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no published records available for suggestions yet.
      </p>
    );
  }

  if (apiEnabled && !signedIn) {
    return (
      <SignIn reason="Suggestions are credited to whoever makes them, so proposing a correction needs an email address we can reach you at." />
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Suggest a tag or a correction. Nothing is published immediately: every
        suggestion enters the moderation queue and appears in the archive only
        after an administrator accepts it.
      </p>

      <label className="field">
        <span>Record</span>
        <select value={recordId} onChange={(event) => setRecordId(event.target.value)}>
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.title || record.id} — {record.location}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-1">
        {(['tag', 'text'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              kind === option
                ? 'bg-primary text-primary-foreground'
                : 'border bg-background hover:bg-muted'
            }`}
          >
            {option === 'tag' ? 'A tag' : 'A text correction'}
          </button>
        ))}
      </div>

      {kind === 'text' && (
        <label className="field">
          <span>Field</span>
          <select
            value={field}
            onChange={(event) => setField(event.target.value as SuggestableField)}
          >
            {SUGGESTABLE_FIELDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>{kind === 'tag' ? 'Suggested tag' : 'Suggested text'}</span>
        {kind === 'tag' ? (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="e.g. opus incertum"
          />
        ) : (
          <textarea rows={3} value={value} onChange={(event) => setValue(event.target.value)} />
        )}
      </label>

      <label className="field">
        <span>Rationale (optional)</span>
        <textarea
          rows={2}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="What supports the suggestion: a reference, comparison or survey."
        />
      </label>

      {apiEnabled ? (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          Credited to {signedAuthor}
          {contributor?.affiliation ? ` · ${contributor.affiliation}` : ''}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Name</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <label className="field">
            <span>Affiliation</span>
            <input
              value={affiliation}
              onChange={(event) => setAffiliation(event.target.value)}
            />
          </label>
        </div>
      )}

      {!apiEnabled && (
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {(['Student', 'PhD candidate', 'Researcher', 'Professional'] as Role[]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}

      <Button type="submit" size="sm" disabled={!ready || busy}>
        <Send />
        {busy ? 'Sending…' : 'Submit suggestion'}
      </Button>

      {error && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {sent && (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          {apiEnabled
            ? 'Suggestion sent. It enters the moderation queue and appears in the archive only if a curator accepts it.'
            : 'Suggestion added to the moderation queue. Without the contribution service it stays in this session, where the local Admin panel can see it.'}
        </p>
      )}
    </form>
  );
}
