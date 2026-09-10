import { Check, Download, MapPin, Compass, Camera, X, Undo2, AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  missingFields,
  type MasonryRecord,
  type Suggestion,
} from './types';

const BASE = import.meta.env.BASE_URL;

/** Bozze di catalogazione, per non perdere il lavoro chiudendo la scheda. */
const DRAFT_KEY = 'masonry-archive:admin-draft';

type Filter = 'todo' | 'pending' | 'approved' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'Da catalogare' },
  { id: 'pending', label: 'In attesa' },
  { id: 'approved', label: 'Approvate' },
  { id: 'all', label: 'Tutte' },
];

function loadDraft(): Record<string, Partial<MasonryRecord>> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function download(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdminPanel({
  initialRecords,
  initialSuggestions,
  tagVocabulary,
}: {
  initialRecords: MasonryRecord[];
  initialSuggestions: Suggestion[];
  tagVocabulary: string[];
}) {
  const [records, setRecords] = useState(() => {
    const draft = loadDraft();
    return Object.keys(draft).length
      ? initialRecords.map((record) =>
          draft[record.id] ? { ...record, ...draft[record.id] } : record,
        )
      : initialRecords;
  });
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [filter, setFilter] = useState<Filter>('todo');
  const [selectedId, setSelectedId] = useState(initialRecords[0]?.id ?? '');
  const [dirty, setDirty] = useState(() => Object.keys(loadDraft()).length > 0);
  const stripRef = useRef<HTMLFieldSetElement>(null);

  // Dopo un'approvazione la selezione salta alla foto seguente: il rullino la
  // porta in vista da solo, altrimenti su centinaia di miniature si perde.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector('[data-selected]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedId]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'todo':
        return records.filter((record) => missingFields(record).length > 0);
      case 'pending':
        return records.filter((record) => record.status === 'pending');
      case 'approved':
        return records.filter((record) => record.status === 'approved');
      default:
        return records;
    }
  }, [records, filter]);

  const selected = records.find((record) => record.id === selectedId) ?? visible[0];

  const openSuggestions = suggestions.filter(
    (item) => item.recordId === selected?.id && item.status === 'pending',
  );
  const pendingSuggestionCount = suggestions.filter((s) => s.status === 'pending').length;

  function update(id: string, patch: Partial<MasonryRecord>) {
    setRecords((current) =>
      current.map((record) => (record.id === id ? { ...record, ...patch } : record)),
    );
    setDirty(true);
    try {
      const draft = loadDraft();
      draft[id] = { ...draft[id], ...patch };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Spazio esaurito o storage disabilitato: la sessione corrente regge lo stesso.
    }
  }

  function toggleTag(record: MasonryRecord, tag: string) {
    const tags = record.tags.includes(tag)
      ? record.tags.filter((item) => item !== tag)
      : [...record.tags, tag];
    update(record.id, { tags });
  }

  function reviewSuggestion(suggestion: Suggestion, accept: boolean) {
    if (accept) {
      const record = records.find((item) => item.id === suggestion.recordId);
      if (record) {
        if (suggestion.kind === 'tag') {
          if (!record.tags.includes(suggestion.value)) {
            update(record.id, { tags: [...record.tags, suggestion.value] });
          }
        } else if (suggestion.field) {
          update(record.id, { [suggestion.field]: suggestion.value } as Partial<MasonryRecord>);
        }
      }
    }
    setSuggestions((current) =>
      current.map((item) =>
        item.id === suggestion.id
          ? { ...item, status: accept ? 'approved' : 'rejected', reviewedAt: new Date().toISOString() }
          : item,
      ),
    );
    setDirty(true);
  }

  /** Passa alla foto successiva ancora da catalogare. */
  function advance() {
    const queue = visible.filter((record) => record.id !== selected?.id);
    if (queue.length) setSelectedId(queue[0].id);
  }

  function approve(record: MasonryRecord) {
    update(record.id, { status: 'approved' });
    advance();
  }

  if (!selected) {
    return (
      <section className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        Nessuna foto in questo filtro. Esegui{' '}
        <code>python3 tools/ingest_photos.py --source &lt;cartella&gt;</code> per
        importare un export di Foto.
      </section>
    );
  }

  const missing = missingFields(selected);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                filter === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border bg-background hover:bg-muted'
              }`}
            >
              {item.label}
              <span className="ml-1.5 opacity-70">
                {item.id === 'todo'
                  ? records.filter((r) => missingFields(r).length).length
                  : item.id === 'all'
                    ? records.length
                    : records.filter((r) => r.status === item.id).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {pendingSuggestionCount > 0 && (
            <span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">
              {pendingSuggestionCount} proposte da esaminare
            </span>
          )}
          <Button
            size="sm"
            variant={dirty ? 'default' : 'outline'}
            onClick={() => {
              download('records.json', records);
              download('suggestions.json', suggestions);
              localStorage.removeItem(DRAFT_KEY);
              setDirty(false);
            }}
          >
            <Download />
            Esporta JSON
          </Button>
        </div>
      </header>

      {/* Rullino: solo miniature da 160 px, caricate pigramente. */}
      <fieldset
        ref={stripRef}
        className="flex gap-2 overflow-x-auto rounded-md border bg-card p-2"
      >
        <legend className="sr-only">Rullino delle foto</legend>
        {visible.map((record) => {
          const isSelected = record.id === selected.id;
          return (
            <button
              key={record.id}
              type="button"
              aria-pressed={isSelected}
              data-selected={isSelected || undefined}
              onClick={() => setSelectedId(record.id)}
              title={`${record.sourceFile ?? record.id} · ${record.location || 'senza posizione'}`}
              className={`relative shrink-0 overflow-hidden rounded-md border-2 transition ${
                isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
              }`}
            >
              {/* eslint-disable-next-line next/no-img-element */}
              <img
                src={`${BASE}${record.strip}`}
                alt=""
                loading="lazy"
                decoding="async"
                width={104}
                height={78}
                className="h-[78px] w-[104px] bg-muted object-cover"
              />
              <span
                className={`status-dot absolute right-1 top-1 ${
                  record.status === 'approved' ? '' : 'pending'
                }`}
              />
              {missingFields(record).length > 0 && (
                <span className="absolute bottom-0 left-0 right-0 bg-background/85 py-0.5 text-[10px] font-medium">
                  {missingFields(record).length} campi
                </span>
              )}
            </button>
          );
        })}
      </fieldset>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <figure className="overflow-hidden rounded-md border bg-card">
            {/* eslint-disable-next-line next/no-img-element */}
            <img
              key={selected.id}
              src={`${BASE}${selected.thumbnail}`}
              alt={selected.title || selected.sourceFile || selected.id}
              className="max-h-[520px] w-full bg-muted object-contain"
            />
            <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {selected.location
                  ? `${selected.location}${selected.country ? `, ${selected.country}` : ''}`
                  : 'senza posizione'}
              </span>
              {selected.lat !== null && selected.lng !== null && (
                <span>
                  {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                  {selected.altitude != null && ` · ${selected.altitude} m`}
                </span>
              )}
              {selected.bearing != null && (
                <span className="inline-flex items-center gap-1">
                  <Compass className="size-3" />
                  {selected.bearing.toFixed(0)}°
                </span>
              )}
              {selected.capturedAt && <span>{selected.capturedAt.slice(0, 10)}</span>}
              {selected.camera && (
                <span className="inline-flex items-center gap-1">
                  <Camera className="size-3" />
                  {selected.camera}
                </span>
              )}
              <span className="ml-auto font-mono">{selected.sourceFile}</span>
            </figcaption>
          </figure>

          {openSuggestions.length > 0 && (
            <div className="rounded-md border bg-card p-3">
              <h3 className="mb-2 text-sm font-semibold">
                Proposte degli utenti su questa foto
              </h3>
              <ul className="space-y-2">
                {openSuggestions.map((suggestion) => (
                  <li key={suggestion.id} className="rounded-md border bg-background p-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="tag">
                        {suggestion.kind === 'tag' ? 'tag' : suggestion.field}
                      </span>
                      <strong className="font-medium">{suggestion.value}</strong>
                      <span className="text-xs text-muted-foreground">
                        {suggestion.author}
                        {suggestion.affiliation ? ` · ${suggestion.affiliation}` : ''}
                        {suggestion.role ? ` · ${suggestion.role}` : ''}
                      </span>
                    </div>
                    {suggestion.rationale && (
                      <p className="mt-1 text-xs text-muted-foreground">{suggestion.rationale}</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => reviewSuggestion(suggestion, true)}>
                        <Check />
                        Accetta
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewSuggestion(suggestion, false)}
                      >
                        <X />
                        Rifiuta
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-md border bg-card p-3">
          {missing.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              Manca: {missing.join(', ')}
            </p>
          )}

          {(['title', 'period', 'technique', 'element', 'material'] as const).map((field) => (
            <label className="field" key={field}>
              <span className="capitalize">{field}</span>
              <input
                value={selected[field]}
                onChange={(event) => update(selected.id, { [field]: event.target.value })}
                placeholder={field === 'period' ? 'es. XIII secolo' : ''}
              />
            </label>
          ))}

          <div>
            <span className="mb-1 block text-sm font-medium">Tag</span>
            <div className="flex flex-wrap gap-1">
              {[...new Set([...tagVocabulary, ...selected.tags])].map((tag) => {
                const active = selected.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(selected, tag)}
                    className={`rounded-md px-2 py-1 text-xs ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'border bg-background hover:bg-muted'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="field">
            <span>Note</span>
            <textarea
              rows={4}
              value={selected.notes}
              onChange={(event) => update(selected.id, { notes: event.target.value })}
            />
          </label>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button size="sm" onClick={() => approve(selected)} disabled={missing.length > 0}>
              <Check />
              Approva
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update(selected.id, { status: 'rejected' })}
            >
              <X />
              Scarta
            </Button>
            {selected.status !== 'pending' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update(selected.id, { status: 'pending' })}
              >
                <Undo2 />
                Rimetti in attesa
              </Button>
            )}
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              L&apos;approvazione si sblocca quando i campi obbligatori sono compilati.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
