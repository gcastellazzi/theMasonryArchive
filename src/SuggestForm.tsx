import { Send } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
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
 * Non scrive nulla nell'archivio: produce una `Suggestion` in stato `pending`
 * che finisce nella coda di revisione dell'amministratore. Finche' non esiste
 * il servizio di backend, la proposta resta nella sessione corrente e puo'
 * essere scaricata come JSON.
 */
export function SuggestForm({
  records,
  onSubmit,
}: {
  records: MasonryRecord[];
  onSubmit: (suggestion: Suggestion) => void;
}) {
  const [recordId, setRecordId] = useState(records[0]?.id ?? '');
  const [kind, setKind] = useState<'tag' | 'text'>('tag');
  const [field, setField] = useState<SuggestableField>('technique');
  const [value, setValue] = useState('');
  const [author, setAuthor] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [role, setRole] = useState<Role>('Student');
  const [rationale, setRationale] = useState('');
  const [sent, setSent] = useState(false);

  const ready = Boolean(recordId && value.trim() && author.trim());

  function submit() {
    if (!ready) return;
    onSubmit({
      id: `sug-${Date.now().toString(36)}`,
      recordId,
      kind,
      field: kind === 'text' ? field : undefined,
      value: value.trim(),
      author: author.trim(),
      affiliation: affiliation.trim() || undefined,
      role,
      rationale: rationale.trim() || undefined,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });
    setValue('');
    setRationale('');
    setSent(true);
  }

  if (!records.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Non ci sono ancora record pubblicati su cui proporre integrazioni.
      </p>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Proponi un tag o una correzione. Nulla viene pubblicato subito: ogni
        proposta entra nella coda di moderazione e compare nell&apos;archivio solo se
        un amministratore la accetta.
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
            {option === 'tag' ? 'Un tag' : 'Un testo'}
          </button>
        ))}
      </div>

      {kind === 'text' && (
        <label className="field">
          <span>Campo</span>
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
        <span>{kind === 'tag' ? 'Tag proposto' : 'Testo proposto'}</span>
        {kind === 'tag' ? (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="es. opus incertum"
          />
        ) : (
          <textarea rows={3} value={value} onChange={(event) => setValue(event.target.value)} />
        )}
      </label>

      <label className="field">
        <span>Motivazione (facoltativa)</span>
        <textarea
          rows={2}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Su cosa si basa la proposta: un riferimento, un confronto, un rilievo."
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span>Nome</span>
          <input value={author} onChange={(event) => setAuthor(event.target.value)} />
        </label>
        <label className="field">
          <span>Affiliazione</span>
          <input
            value={affiliation}
            onChange={(event) => setAffiliation(event.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>Ruolo</span>
        <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {(['Student', 'PhD candidate', 'Researcher', 'Professional'] as Role[]).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" size="sm" disabled={!ready}>
        <Send />
        Invia proposta
      </Button>

      {sent && (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          Proposta registrata in coda di moderazione. Con il backend attivo
          verrebbe inviata al server; per ora resta in questa sessione ed &egrave;
          visibile nella scheda Admin.
        </p>
      )}
    </form>
  );
}
