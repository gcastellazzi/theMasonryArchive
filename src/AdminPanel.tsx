import {
  AlertCircle, BarChart3, Camera, Check, Compass, Download, Keyboard, ListTree,
  MapPin, Plus, Save, Search, Trash2, Undo2, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BatchBar } from './admin/BatchBar';
import { PositionPicker } from './admin/PositionPicker';
import { ProgressPanel } from './admin/ProgressPanel';
import { VocabularyManager } from './admin/VocabularyManager';
import { forgetDrafts, useAdminState } from './admin/useAdminState';
import { SHORTCUT_HELP, useShortcuts, type Shortcuts } from './admin/useShortcuts';
import {
  applyFilters, EMPTY_FILTERS, facet, hasActiveFilters, shotGroup,
  type SearchFilters,
} from './admin/groups';
import { imageUrl } from './imageUrl';
import {
  isPublishable,
  missingFields,
  type MasonryRecord,
  type Suggestion,
} from './types';
import {
  knownTags, renameTag, renameValue, suggestionsFor, tagCounts,
  type VocabularyField,
} from './vocabulary';

const BASE = import.meta.env.BASE_URL;

type Filter = 'todo' | 'pending' | 'approved' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To catalogue' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'all', label: 'All' },
];

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
  initialSelectedId,
}: {
  initialRecords: MasonryRecord[];
  initialSuggestions: Suggestion[];
  initialExcluded: string[];
  tagVocabulary: string[];
  initialSelectedId?: string;
}) {
  const state = useAdminState({
    records: initialRecords,
    suggestions: initialSuggestions,
    excluded: initialExcluded,
  });
  const { records, suggestions, excluded } = state.data;

  const [filter, setFilter] = useState<Filter>(initialSelectedId ? 'all' : 'todo');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(
    initialSelectedId ?? initialRecords[0]?.id ?? '',
  );
  /** Selezione multipla per le modifiche in blocco. Contiene sempre `selectedId`. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [panel, setPanel] = useState<'none' | 'progress' | 'vocabulary'>('none');
  const [showHelp, setShowHelp] = useState(false);

  const stripRef = useRef<HTMLFieldSetElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  /** I nove tag piu' usati: sono quelli sui tasti numerici. */
  const quickTags = useMemo(
    () => tagCounts(records).slice(0, 9).map((item) => item.value),
    [records],
  );
  const countries = useMemo(() => facet(records, (r) => r.country), [records]);
  const cameras = useMemo(() => facet(records, (r) => r.camera), [records]);
  const years = useMemo(
    () => facet(records, (r) => r.capturedAt?.slice(0, 4)).reverse(),
    [records],
  );

  const visible = useMemo(() => {
    const byStatus = (() => {
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
    })();
    return applyFilters(byStatus, filters);
  }, [records, filter, filters]);

  const selected = records.find((record) => record.id === selectedId) ?? visible[0];
  const batch = useMemo(
    () => records.filter((record) => selectedIds.includes(record.id)),
    [records, selectedIds],
  );

  const openSuggestions = suggestions.filter(
    (item) => item.recordId === selected?.id && item.status === 'pending',
  );
  const pendingSuggestionCount = suggestions.filter((s) => s.status === 'pending').length;

  function update(id: string, patch: Partial<MasonryRecord>, coalesceKey?: string) {
    state.commitRecords(
      'edit',
      records.map((record) => (record.id === id ? { ...record, ...patch } : record)),
      coalesceKey,
    );
  }

  /** Applica la stessa modifica a tutte le foto selezionate, in un solo passo di undo. */
  function updateMany(ids: string[], patch: (record: MasonryRecord) => Partial<MasonryRecord>, label: string) {
    const set = new Set(ids);
    state.commitRecords(
      label,
      records.map((record) => (set.has(record.id) ? { ...record, ...patch(record) } : record)),
    );
  }

  function toggleTag(record: MasonryRecord, tag: string) {
    const tags = record.tags.includes(tag)
      ? record.tags.filter((item) => item !== tag)
      : [...record.tags, tag];
    update(record.id, { tags });
  }

  function reviewSuggestion(suggestion: Suggestion, accept: boolean) {
    let nextRecords = records;
    if (accept) {
      const record = records.find((item) => item.id === suggestion.recordId);
      if (record) {
        const patch =
          suggestion.kind === 'tag'
            ? record.tags.includes(suggestion.value)
              ? null
              : { tags: [...record.tags, suggestion.value] }
            : suggestion.field
              ? ({ [suggestion.field]: suggestion.value } as Partial<MasonryRecord>)
              : null;
        if (patch) {
          nextRecords = records.map((item) =>
            item.id === record.id ? { ...item, ...patch } : item,
          );
        }
      }
    }
    state.commit(accept ? 'accept suggestion' : 'reject suggestion', {
      ...state.data,
      records: nextRecords,
      suggestions: suggestions.map((item) =>
        item.id === suggestion.id
          ? {
              ...item,
              status: accept ? 'approved' : 'rejected',
              reviewedAt: new Date().toISOString(),
            }
          : item,
      ),
    });
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
      state.markSaved();
      setSaving('done');
      setTimeout(() => setSaving('idle'), 2500);
    } catch (error) {
      console.error('save failed', error);
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

  /** Passa alla foto successiva nel filtro corrente. */
  const step = useCallback(
    (delta: number) => {
      if (!visible.length) return;
      const at = visible.findIndex((record) => record.id === selected?.id);
      const next = visible[Math.min(visible.length - 1, Math.max(0, at + delta))];
      if (next) {
        setSelectedId(next.id);
        setSelectedIds([]);
      }
    },
    [visible, selected?.id],
  );

  function removeRecords(targets: MasonryRecord[]) {
    if (!targets.length) return;
    const label =
      targets.length === 1
        ? `“${targets[0].title || targets[0].sourceFile || targets[0].id}”`
        : `${targets.length} photos`;
    if (!window.confirm(`Remove ${label} from the archive?`)) return;

    const ids = new Set(targets.map((record) => record.id));
    const hashes = targets
      .map((record) => record.sourceHash)
      .filter((hash): hash is string => Boolean(hash));

    step(1);
    setSelectedIds([]);
    state.commit(`delete ${targets.length}`, {
      records: records.filter((record) => !ids.has(record.id)),
      suggestions: suggestions.filter((item) => !ids.has(item.recordId)),
      excluded: [...new Set([...excluded, ...hashes])],
    });

    forgetDrafts(ids);
  }

  function approve(record: MasonryRecord) {
    update(record.id, { status: 'approved' });
    step(1);
  }

  /** Approva in blocco solo cio' che e' pubblicabile, e dice quanto ha saltato. */
  function setBatchStatus(status: 'approved' | 'pending' | 'rejected') {
    const targets =
      status === 'approved' ? batch.filter(isPublishable) : batch;
    if (!targets.length) {
      window.alert('None of the selected photos have all the fields required for approval.');
      return;
    }
    const skipped = batch.length - targets.length;
    updateMany(
      targets.map((record) => record.id),
      () => ({ status }),
      `${status} ${targets.length}`,
    );
    if (skipped) {
      window.alert(`${targets.length} approved. ${skipped} skipped: required fields are missing.`);
    }
  }

  function renameInVocabulary(scope: 'tags' | VocabularyField, from: string, to: string) {
    state.commitRecords(
      to ? `rename “${from}”` : `remove “${from}”`,
      scope === 'tags'
        ? renameTag(from, to, records)
        : renameValue(scope, from, to, records),
    );
  }

  /** Clic sul rullino: semplice sposta il fuoco, con i modificatori estende la selezione. */
  function pickThumbnail(record: MasonryRecord, event: React.MouseEvent) {
    if (event.shiftKey && selected) {
      const from = visible.findIndex((item) => item.id === selected.id);
      const to = visible.findIndex((item) => item.id === record.id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelectedIds(visible.slice(start, end + 1).map((item) => item.id));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) =>
        current.includes(record.id)
          ? current.filter((id) => id !== record.id)
          : [...(current.length ? current : selected ? [selected.id] : []), record.id],
      );
      setSelectedId(record.id);
      return;
    }
    setSelectedId(record.id);
    setSelectedIds([]);
  }

  // Non memoizzate: `useShortcuts` tiene i gestori in un ref, quindi
  // ricrearle a ogni render non riaggancia nulla.
  const shortcuts: Shortcuts = {
      next: () => step(1),
      previous: () => step(-1),
      approve: () => {
        if (selected && isPublishable(selected)) approve(selected);
      },
      reject: () => selected && update(selected.id, { status: 'rejected' }),
      pending: () => selected && update(selected.id, { status: 'pending' }),
      focusTag: () => tagInputRef.current?.focus(),
      focusSearch: () => searchInputRef.current?.focus(),
      toggleTagAt: (index) => {
        const tag = quickTags[index];
        if (tag && selected) toggleTag(selected, tag);
      },
      clearSelection: () => setSelectedIds([]),
      undo: state.undo,
      toggleHelp: () => setShowHelp((open) => !open),
  };
  useShortcuts(shortcuts, panel === 'none');

  if (!selected) {
    return (
      <section className="space-y-3">
        <SearchRow
          filters={filters}
          setFilters={setFilters}
          countries={countries}
          cameras={cameras}
          years={years}
          inputRef={searchInputRef}
        />
        <p className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
          {hasActiveFilters(filters)
            ? 'No photos match this search.'
            : 'No photos in this filter. Run python3 tools/ingest_photos.py --source <folder> to import a Photos export.'}
        </p>
      </section>
    );
  }

  const missing = missingFields(selected);

  return (
    <section className="space-y-4">
      <header className="space-y-3 rounded-md border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex flex-wrap items-center gap-2">
            {pendingSuggestionCount > 0 && (
              <span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">
                {pendingSuggestionCount} suggestions to review
              </span>
            )}
            <Button
              size="sm"
              variant={panel === 'progress' ? 'default' : 'ghost'}
              title="Cataloguing progress"
              onClick={() => setPanel(panel === 'progress' ? 'none' : 'progress')}
            >
              <BarChart3 />
            </Button>
            <Button
              size="sm"
              variant={panel === 'vocabulary' ? 'default' : 'ghost'}
              title="Manage tags and field values"
              onClick={() => setPanel(panel === 'vocabulary' ? 'none' : 'vocabulary')}
            >
              <ListTree />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Keyboard shortcuts"
              onClick={() => setShowHelp((open) => !open)}
            >
              <Keyboard />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!state.undoLabel}
              title={state.undoLabel ? `Undo ${state.undoLabel}` : 'Nothing to undo'}
              onClick={state.undo}
            >
              <Undo2 />
            </Button>
            <Button
              size="sm"
              variant={state.dirty ? 'default' : 'outline'}
              onClick={saveToDisk}
              disabled={saving === 'busy'}
            >
              {saving === 'done' ? <Check /> : <Save />}
              {saving === 'busy'
                ? 'Saving…'
                : saving === 'done'
                  ? 'Saved to src/data'
                  : state.dirty
                    ? 'Save changes'
                    : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Download the three JSON files to move them manually"
              onClick={() => {
                download('records.json', records);
                download('suggestions.json', suggestions);
                download('excluded.json', excluded);
              }}
            >
              <Download />
            </Button>
          </div>
        </div>

        <SearchRow
          filters={filters}
          setFilters={setFilters}
          countries={countries}
          cameras={cameras}
          years={years}
          inputRef={searchInputRef}
        />

        {saving === 'error' && (
          <p className="text-xs text-destructive">
            Save failed. Is the development server running? Alternatively,
            download the JSON files using the adjacent button and copy them to
            <code className="mx-1">src/data/</code>.
          </p>
        )}
      </header>

      {showHelp && (
        <dl className="grid gap-x-6 gap-y-1 rounded-md border bg-card p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUT_HELP.map(([keys, what]) => (
            <div key={keys} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-muted-foreground">{keys}</dt>
              <dd className="text-right">{what}</dd>
            </div>
          ))}
        </dl>
      )}

      {panel === 'progress' && (
        <ProgressPanel
          records={records}
          onSelect={(id) => {
            setSelectedId(id);
            setFilter('all');
            setPanel('none');
          }}
        />
      )}

      {panel === 'vocabulary' && (
        <VocabularyManager records={records} onRename={renameInVocabulary} />
      )}

      {/* Rullino: miniature da 160 px, caricate pigramente. Va a capo e
          scorre in verticale: in fila unica 750 foto rendevano la pagina
          larga decine di metri. */}
      <fieldset
        ref={stripRef}
        className="grid max-h-[300px] grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 overflow-y-auto rounded-md border bg-card p-2"
      >
        <legend className="sr-only">Photo strip</legend>
        {visible.map((record) => {
          const isFocused = record.id === selected.id;
          const inBatch = selectedIds.includes(record.id);
          return (
            <button
              key={record.id}
              type="button"
              aria-pressed={isFocused || inBatch}
              data-selected={isFocused || undefined}
              onClick={(event) => pickThumbnail(record, event)}
              title={`${record.sourceFile ?? record.id} · ${record.location || 'no location'}\nShift-click for a range, ⌘/Ctrl-click to add`}
              className={`relative overflow-hidden rounded-md border-2 transition ${
                inBatch
                  ? 'border-primary ring-2 ring-primary/40'
                  : isFocused
                    ? 'border-primary'
                    : 'border-transparent hover:border-muted-foreground/40'
              }`}
            >
              {/* eslint-disable-next-line next/no-img-element */}
              <img
                src={imageUrl(record, 'strip')}
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
                  {missingFields(record).length} fields
                </span>
              )}
            </button>
          );
        })}
      </fieldset>

      {batch.length > 1 && (
        <BatchBar
          selected={batch}
          vocabularies={vocabularies}
          tagVocabulary={allTags}
          onApplyField={(field, value) =>
            updateMany(selectedIds, () => ({ [field]: value }), `${field} on ${batch.length}`)
          }
          onAddTag={(tag) =>
            updateMany(
              selectedIds,
              (record) =>
                record.tags.includes(tag) ? {} : { tags: [...record.tags, tag] },
              `tag ${batch.length}`,
            )
          }
          onRemoveTag={(tag) =>
            updateMany(
              selectedIds,
              (record) => ({ tags: record.tags.filter((item) => item.trim() !== tag) }),
              `untag ${batch.length}`,
            )
          }
          onSetStatus={setBatchStatus}
          onDelete={() => removeRecords(batch)}
          onClear={() => setSelectedIds([])}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <figure className="overflow-hidden rounded-md border bg-card">
            {/* eslint-disable-next-line next/no-img-element */}
            <img
              key={selected.id}
              src={imageUrl(selected, 'thumbnail')}
              alt={selected.title || selected.sourceFile || selected.id}
              className="max-h-[520px] w-full bg-muted object-contain"
            />
            <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {selected.location
                  ? `${selected.location}${selected.country ? `, ${selected.country}` : ''}`
                  : 'no location'}
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

          <ShotGroup
            record={selected}
            records={records}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
          />

          {openSuggestions.length > 0 && (
            <div className="rounded-md border bg-card p-3">
              <h3 className="mb-2 text-sm font-semibold">
                User suggestions for this photo
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
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reviewSuggestion(suggestion, false)}
                      >
                        <X />
                        Reject
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
              Missing: {missing.join(', ')}
            </p>
          )}

          <label className="field">
            <span>Title</span>
            <input
              value={selected.title}
              onChange={(event) =>
                update(selected.id, { title: event.target.value }, `${selected.id}:title`)
              }
              placeholder="e.g. Roughly coursed rubble wall with brick levelling"
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
                onChange={(event) =>
                  update(selected.id, { [field]: event.target.value }, `${selected.id}:${field}`)
                }
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
            <legend className="px-1 text-sm font-medium">Position</legend>

            <PositionPicker
              record={selected}
              records={records}
              onPick={(lat, lng) => update(selected.id, { lat, lng })}
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="field">
                <span>Latitude</span>
                <input
                  key={`${selected.id}-latitude-${selected.lat ?? 'none'}`}
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
                    update(
                      selected.id,
                      {
                        lat: Number.isFinite(event.currentTarget.valueAsNumber)
                          ? event.currentTarget.valueAsNumber
                          : null,
                      },
                      `${selected.id}:lat`,
                    )
                  }
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  key={`${selected.id}-longitude-${selected.lng ?? 'none'}`}
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
                    update(
                      selected.id,
                      {
                        lng: Number.isFinite(event.currentTarget.valueAsNumber)
                          ? event.currentTarget.valueAsNumber
                          : null,
                      },
                      `${selected.id}:lng`,
                    )
                  }
                />
              </label>
            </div>
          </fieldset>

          <div>
            <span className="mb-1 block text-sm font-medium">Tag</span>
            <div className="mb-2 flex gap-1">
              <input
                ref={tagInputRef}
                list="vocab-tags"
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag and press Enter"
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
                const shortcut = quickTags.indexOf(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(selected, tag)}
                    title={shortcut >= 0 ? `Press ${shortcut + 1} to toggle “${tag}”` : undefined}
                    className={`rounded-md px-2 py-1 text-xs ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'border bg-background hover:bg-muted'
                    }`}
                  >
                    {tag}
                    {/* Il numero e' il tasto che alterna il tag, non quante
                        volte e' usato: va letto come un tasto. */}
                    {shortcut >= 0 && (
                      <kbd
                        className={`ml-1.5 rounded border px-1 font-mono text-[10px] leading-none ${
                          active
                            ? 'border-primary-foreground/40 text-primary-foreground/80'
                            : 'border-border bg-muted text-muted-foreground'
                        }`}
                      >
                        {shortcut + 1}
                      </kbd>
                    )}
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
              onChange={(event) =>
                update(selected.id, { notes: event.target.value }, `${selected.id}:notes`)
              }
            />
          </label>

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              size="sm"
              onClick={() => approve(selected)}
              disabled={!isPublishable(selected)}
            >
              <Check />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update(selected.id, { status: 'rejected' })}
            >
              <X />
              Reject
            </Button>
            {selected.status !== 'pending' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update(selected.id, { status: 'pending' })}
              >
                <Undo2 />
                Return to pending
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => removeRecords([selected])}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Approval becomes available when all required fields are complete.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Ricerca a testo libero piu' i filtri per paese, fotocamera, anno e campo mancante. */
function SearchRow({
  filters,
  setFilters,
  countries,
  cameras,
  years,
  inputRef,
}: {
  filters: SearchFilters;
  setFilters: (filters: SearchFilters) => void;
  countries: string[];
  cameras: string[];
  years: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const set = (patch: Partial<SearchFilters>) => setFilters({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={filters.text}
          onChange={(event) => set({ text: event.target.value })}
          placeholder="Search title, place, camera, notes, tags…  (press /)"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
        />
      </div>
      <select
        value={filters.country}
        onChange={(event) => set({ country: event.target.value })}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Any country</option>
        {countries.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </select>
      <select
        value={filters.camera}
        onChange={(event) => set({ camera: event.target.value })}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Any camera</option>
        {cameras.map((camera) => (
          <option key={camera} value={camera}>
            {camera}
          </option>
        ))}
      </select>
      <select
        value={filters.year}
        onChange={(event) => set({ year: event.target.value })}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Any year</option>
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <select
        value={filters.missing}
        onChange={(event) => set({ missing: event.target.value })}
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Any completeness</option>
        {['title', 'element', 'technique', 'tags', 'position'].map((field) => (
          <option key={field} value={field}>
            missing {field}
          </option>
        ))}
      </select>
      {hasActiveFilters(filters) && (
        <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
          <X />
          Clear
        </Button>
      )}
    </div>
  );
}

/** Le altre foto della stessa raffica, da selezionare in blocco. */
function ShotGroup({
  record,
  records,
  selectedIds,
  onSelect,
}: {
  record: MasonryRecord;
  records: MasonryRecord[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
}) {
  const group = useMemo(() => shotGroup(record, records), [record, records]);
  if (group.length < 2) return null;

  const active = group.every((id) => selectedIds.includes(id));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        {group.length} photos taken here within a few minutes — same wall, most
        likely the same technique and period.
      </span>
      <Button
        size="sm"
        variant={active ? 'default' : 'outline'}
        className="ml-auto"
        onClick={() => onSelect(active ? [] : group)}
      >
        {active ? 'Selected' : `Select all ${group.length}`}
      </Button>
    </div>
  );
}
