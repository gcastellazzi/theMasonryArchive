import {
  AlertCircle, Camera, Check, Compass, Download, MapPin, Plus, Save, Trash2, Undo2, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  missingFields,
  type MasonryRecord,
  type Suggestion,
} from './types';
import { knownTags, suggestionsFor } from './vocabulary';

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
  initialExcluded,
  tagVocabulary,
}: {
  initialRecords: MasonryRecord[];
  initialSuggestions: Suggestion[];
  initialExcluded: string[];
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
  const [tagDraft, setTagDraft] = useState('');
  const [excluded, setExcluded] = useState<string[]>(initialExcluded);
  const [saving, setSaving] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const stripRef = useRef<HTMLFieldSetElement>(null);

  // Dopo un'approvazione la selezione salta alla foto seguente: il rullino la
  // porta in vista da solo, altrimenti su centinaia di miniature si perde.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector('[data-selected]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedId]);

  const vocabularies = useMemo(
    () => ({
      element: suggestionsFor('element', records),
      technique: suggestionsFor('technique', records),
      material: suggestionsFor('material', records),
      period: suggestionsFor('period', records),
    }),
    [records],
  );
  const allTags = useMemo(() => knownTags(records), [records]);

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

  async function saveToDisk() {
    setSaving('busy');
    try {
      const response = await fetch(`${BASE}__admin/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'records.json': records,
          'suggestions.json': suggestions,
          'excluded.json': excluded,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      localStorage.removeItem(DRAFT_KEY);
      setDirty(false);
      setSaving('done');
      setTimeout(() => setSaving('idle'), 2500);
    } catch (error) {
      console.error('salvataggio non riuscito', error);
      setSaving('error');
    }
  }

  function addTag() {
    const tag = tagDraft.trim();
    if (!tag || !selected) return;
    if (!selected.tags.includes(tag)) {
      update(selected.id, { tags: [...selected.tags, tag] });
    }
    setTagDraft('');
  }

  function remove(record: MasonryRecord) {
    const label = record.title || record.sourceFile || record.id;
    if (!window.confirm(`Eliminare «${label}» dall'archivio?`)) return;

    advance();
    setRecords((current) => current.filter((item) => item.id !== record.id));
    if (record.sourceHash) {
      setExcluded((current) =>
        current.includes(record.sourceHash!) ? current : [...current, record.sourceHash!],
      );
    }
    setSuggestions((current) => current.filter((item) => item.recordId !== record.id));
    setDirty(true);
    try {
      const draft = loadDraft();
      delete draft[record.id];
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage non disponibile: la sessione corrente resta comunque coerente.
    }
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
            onClick={saveToDisk}
            disabled={saving === 'busy'}
          >
            {saving === 'done' ? <Check /> : <Save />}
            {saving === 'busy'
              ? 'Salvataggio…'
              : saving === 'done'
                ? 'Salvato in src/data'
                : dirty
                  ? 'Salva le modifiche'
                  : 'Salva'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Scarica i tre JSON, se preferisci spostarli a mano"
            onClick={() => {
              download('records.json', records);
              download('suggestions.json', suggestions);
              download('excluded.json', excluded);
            }}
          >
            <Download />
          </Button>
        </div>
        {saving === 'error' && (
          <p className="w-full text-xs text-destructive">
            Salvataggio non riuscito. Il server di sviluppo sta girando? In
            alternativa scarica i JSON con il pulsante accanto e copiali in
            <code className="mx-1">src/data/</code>.
          </p>
        )}
      </header>

      {/* Rullino: miniature da 160 px, caricate pigramente. Va a capo e
          scorre in verticale: in fila unica 750 foto rendevano la pagina
          larga decine di metri. */}
      <fieldset
        ref={stripRef}
        className="grid max-h-[300px] grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 overflow-y-auto rounded-md border bg-card p-2"
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
              className={`relative overflow-hidden rounded-md border-2 transition ${
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
                className="h-[78px] w-full bg-muted object-cover"
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

          <label className="field">
            <span>Title</span>
            <input
              value={selected.title}
              onChange={(event) => update(selected.id, { title: event.target.value })}
              placeholder="es. Roughly coursed rubble wall with brick levelling"
            />
          </label>

          {(['element', 'technique', 'material', 'period'] as const).map((field) => (
            <label className="field" key={field}>
              <span className="capitalize">{field}</span>
              {/* Testo libero con suggerimenti: il browser completa mentre
                  scrivi, ma nulla vieta di inserire un valore nuovo. */}
              <input
                list={`vocab-${field}`}
                value={selected[field]}
                onChange={(event) => update(selected.id, { [field]: event.target.value })}
                placeholder={vocabularies[field][0]}
              />
              <datalist id={`vocab-${field}`}>
                {vocabularies[field].map((option) => (
                  <option key={option} value={option} aria-label={option} />
                ))}
              </datalist>
            </label>
          ))}

          <fieldset
            className={`rounded-md border p-3 ${
              missing.includes('position')
                ? 'border-destructive/50 bg-destructive/5'
                : ''
            }`}
          >
            <legend className="px-1 text-sm font-medium">Posizione</legend>
            <p className="mb-3 text-xs text-muted-foreground">
              {missing.includes('position')
                ? 'Inserisci entrambe le coordinate per localizzare e approvare la foto.'
                : 'Le coordinate possono essere corrette manualmente se necessario.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="field">
                <span>Latitudine</span>
                <input
                  key={`${selected.id}-latitude`}
                  type="number"
                  inputMode="decimal"
                  min="-90"
                  max="90"
                  step="any"
                  defaultValue={selected.lat ?? ''}
                  placeholder="44.4949"
                  aria-invalid={
                    selected.lat === null ||
                    !Number.isFinite(selected.lat) ||
                    selected.lat < -90 ||
                    selected.lat > 90
                  }
                  onChange={(event) =>
                    update(selected.id, {
                      lat: Number.isFinite(event.currentTarget.valueAsNumber)
                        ? event.currentTarget.valueAsNumber
                        : null,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Longitudine</span>
                <input
                  key={`${selected.id}-longitude`}
                  type="number"
                  inputMode="decimal"
                  min="-180"
                  max="180"
                  step="any"
                  defaultValue={selected.lng ?? ''}
                  placeholder="11.3426"
                  aria-invalid={
                    selected.lng === null ||
                    !Number.isFinite(selected.lng) ||
                    selected.lng < -180 ||
                    selected.lng > 180
                  }
                  onChange={(event) =>
                    update(selected.id, {
                      lng: Number.isFinite(event.currentTarget.valueAsNumber)
                        ? event.currentTarget.valueAsNumber
                        : null,
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <div>
            <span className="mb-1 block text-sm font-medium">Tag</span>
            <div className="mb-2 flex gap-1">
              <input
                list="vocab-tags"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Aggiungi un tag e premi Invio"
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addTag} disabled={!tagDraft.trim()}>
                <Plus />
              </Button>
              <datalist id="vocab-tags">
                {allTags.map((tag) => (
                  <option key={tag} value={tag} aria-label={tag} />
                ))}
              </datalist>
            </div>
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
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => remove(selected)}
            >
              <Trash2 />
              Elimina
            </Button>
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
