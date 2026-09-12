import { Merge, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MasonryRecord } from '../types';
import {
  tagCounts,
  valueCounts,
  VOCABULARY_FIELDS,
  type ValueUsage,
  type VocabularyField,
} from '../vocabulary';

/**
 * Rinomina, unione ed eliminazione di un valore su tutto l'archivio.
 *
 * Tag, tecnica, elemento, materiale ed epoca sono campi di testo libero, e
 * devono restarlo: una muratura nuova non aspetta che qualcuno aggiorni una
 * lista chiusa. Il prezzo e' la deriva — `stonework` e `stone work`, la stessa
 * tecnica scritta in due modi a distanza di un mese — che sul sito pubblico
 * diventa due voci diverse nella nuvola dei tag e spezza in due il filtro.
 *
 * Qui i valori si vedono ordinati per frequenza: quelli usati una volta sola,
 * in fondo, sono quasi sempre refusi di quelli in cima.
 */

type Scope = 'tags' | VocabularyField;

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'tags', label: 'tags' },
  ...VOCABULARY_FIELDS.map((field) => ({ id: field as Scope, label: field })),
];

export function VocabularyManager({
  records,
  onRename,
}: {
  records: MasonryRecord[];
  /** `to` vuoto elimina il valore ovunque. */
  onRename: (scope: Scope, from: string, to: string) => void;
}) {
  const [scope, setScope] = useState<Scope>('tags');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Aprire la riga mette il cursore nel campo: si rinomina scrivendo, senza
  // dover mirare due volte.
  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing]);

  const usage: ValueUsage[] = useMemo(
    () => (scope === 'tags' ? tagCounts(records) : valueCounts(scope, records)),
    [scope, records],
  );

  const others = useMemo(
    () => usage.filter((item) => item.value !== editing),
    [usage, editing],
  );

  function start(value: string) {
    setEditing(value);
    setDraft(value);
  }

  function confirm() {
    if (editing === null) return;
    const target = draft.trim();
    if (target && target !== editing) onRename(scope, editing, target);
    setEditing(null);
  }

  function remove(value: string, count: number) {
    const noun = scope === 'tags' ? 'tag' : scope;
    if (!window.confirm(`Remove the ${noun} “${value}” from ${count} photos?`)) return;
    onRename(scope, value, '');
    setEditing(null);
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Vocabulary</h3>
        <div className="ml-auto flex flex-wrap gap-1">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setScope(item.id);
                setEditing(null);
              }}
              className={`rounded-md px-2.5 py-1 text-xs capitalize ${
                scope === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border bg-background hover:bg-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {usage.length} distinct values. Renaming rewrites every photo that uses
        the value; renaming one onto another merges them.
      </p>

      <ul className="max-h-[360px] space-y-1 overflow-y-auto">
        {usage.map(({ value, count }) => (
          <li
            key={value}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {editing === value ? (
              <div className="grid gap-2">
                <input
                  ref={inputRef}
                  list="vocab-merge-targets"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      confirm();
                    }
                    if (event.key === 'Escape') setEditing(null);
                  }}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                />
                <datalist id="vocab-merge-targets">
                  {others.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                      aria-label={`${item.value} (${item.count})`}
                    />
                  ))}
                </datalist>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={confirm} disabled={!draft.trim()}>
                    {others.some((item) => item.value === draft.trim()) ? (
                      <>
                        <Merge />
                        Merge into “{draft.trim()}”
                      </>
                    ) : (
                      'Rename'
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-destructive hover:text-destructive"
                    onClick={() => remove(value, count)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{value}</span>
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {count}
                </span>
                <button
                  type="button"
                  onClick={() => start(value)}
                  aria-label={`Rename “${value}”`}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
