import { Check, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MasonryRecord } from '../types';
import type { VocabularyField } from '../vocabulary';

type BatchTextField = 'title' | VocabularyField;

const BATCH_FIELDS: {
  field: BatchTextField;
  label: string;
  example?: string;
}[] = [
  {
    field: 'title',
    label: 'Title',
    example: 'e.g. Roughly coursed rubble wall with brick levelling',
  },
  { field: 'element', label: 'Element' },
  { field: 'technique', label: 'Technique' },
  { field: 'material', label: 'Material' },
  { field: 'period', label: 'Period' },
];

/**
 * Modifica di piu' foto insieme.
 *
 * Su 750 record con 684 senza tag, catalogare uno per uno non finisce mai.
 * Le foto di una stessa raffica condividono spesso anche un primo titolo di
 * lavoro: tutti i campi sono quindi esposti separatamente e possono essere
 * applicati in blocco, per poi rifinire le singole schede.
 */
export function BatchBar({
  selected,
  vocabularies,
  tagVocabulary,
  onApplyField,
  onAddTag,
  onRemoveTag,
  onSetStatus,
  onDelete,
  onClear,
}: {
  selected: MasonryRecord[];
  vocabularies: Record<VocabularyField, string[]>;
  tagVocabulary: string[];
  onApplyField: (field: BatchTextField, value: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetStatus: (status: 'approved' | 'pending' | 'rejected') => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [values, setValues] = useState<Record<BatchTextField, string>>({
    title: '',
    element: '',
    technique: '',
    material: '',
    period: '',
  });
  const [tag, setTag] = useState('');

  const count = selected.length;

  /** I tag presenti su almeno una delle foto scelte: quelli che si possono togliere. */
  const presentTags = [
    ...new Set(
      selected.flatMap((record) => record.tags.map((item) => item.trim())),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  function applyField(field: BatchTextField) {
    const value = values[field].trim();
    if (!value) return;
    onApplyField(field, value);
    setValues((current) => ({ ...current, [field]: '' }));
  }

  function addTag() {
    if (!tag.trim()) return;
    onAddTag(tag.trim());
    setTag('');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <strong className="block text-sm text-destructive">
            Editing {count} photos
          </strong>
          <span className="text-xs text-muted-foreground">
            Each value entered here will replace that field in every selected
            photo.
          </span>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          <X />
          Clear selection
        </Button>
      </div>

      <div className="space-y-3">
        {BATCH_FIELDS.map(({ field, label, example }) => {
          const vocabulary = field === 'title' ? [] : vocabularies[field];
          return (
            <div key={field} className="flex items-end gap-2">
              <label className="field min-w-0 flex-1">
                <span>{label}</span>
                <input
                  list={field === 'title' ? undefined : `batch-vocab-${field}`}
                  value={values[field]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyField(field);
                    }
                  }}
                  placeholder={
                    example ?? vocabulary[0] ?? `Value for all ${count}`
                  }
                />
                {field !== 'title' && (
                  <datalist id={`batch-vocab-${field}`}>
                    {vocabulary.map((option) => (
                      <option key={option} value={option} aria-label={option} />
                    ))}
                  </datalist>
                )}
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyField(field)}
                disabled={!values[field].trim()}
                aria-label={`Apply ${label.toLowerCase()} to all ${count} photos`}
              >
                Apply
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="field min-w-[200px] flex-1">
          <span>Add a tag to all {count}</span>
          <input
            list="batch-vocab-tags"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag and press Enter"
          />
          <datalist id="batch-vocab-tags">
            {tagVocabulary.map((option) => (
              <option key={option} value={option} aria-label={option} />
            ))}
          </datalist>
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={addTag}
          disabled={!tag.trim()}
        >
          <Plus />
        </Button>
      </div>

      {presentTags.length > 0 && (
        <div>
          <span className="mb-1 block text-xs text-muted-foreground">
            Remove a tag from the selection
          </span>
          <div className="flex flex-wrap gap-1">
            {presentTags.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onRemoveTag(item)}
                title={`Remove “${item}” from the selected photos`}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-destructive/10 hover:text-destructive"
              >
                {item}
                <X className="size-3" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-destructive/20 pt-3">
        <Button size="sm" onClick={() => onSetStatus('approved')}>
          <Check />
          Approve all
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSetStatus('pending')}
        >
          Return to pending
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSetStatus('rejected')}
        >
          Reject all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 />
          Delete {count}
        </Button>
      </div>
    </div>
  );
}
