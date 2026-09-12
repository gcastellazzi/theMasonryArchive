import { Check, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MasonryRecord } from '../types';
import { VOCABULARY_FIELDS, type VocabularyField } from '../vocabulary';

/**
 * Modifica di piu' foto insieme.
 *
 * Su 750 record con 684 senza tag, catalogare uno per uno non finisce mai.
 * Le foto di una stessa raffica condividono quasi sempre tecnica, elemento,
 * materiale ed epoca: si selezionano e si compilano in un colpo. Il titolo
 * resta fuori di proposito — e' l'unico campo che descrive la singola foto.
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
  onApplyField: (field: VocabularyField, value: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onSetStatus: (status: 'approved' | 'pending' | 'rejected') => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [field, setField] = useState<VocabularyField>('technique');
  const [value, setValue] = useState('');
  const [tag, setTag] = useState('');

  const count = selected.length;

  /** I tag presenti su almeno una delle foto scelte: quelli che si possono togliere. */
  const presentTags = [
    ...new Set(selected.flatMap((record) => record.tags.map((item) => item.trim()))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  function applyField() {
    if (!value.trim()) return;
    onApplyField(field, value.trim());
    setValue('');
  }

  function addTag() {
    if (!tag.trim()) return;
    onAddTag(tag.trim());
    setTag('');
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{count} photos selected</strong>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          <X />
          Clear selection
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="field min-w-[120px]">
          <span>Field</span>
          <select
            value={field}
            onChange={(event) => setField(event.target.value as VocabularyField)}
          >
            {VOCABULARY_FIELDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="field min-w-[200px] flex-1">
          <span>Value for all {count}</span>
          <input
            list={`batch-vocab-${field}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyField();
              }
            }}
            placeholder={vocabularies[field][0]}
          />
          <datalist id={`batch-vocab-${field}`}>
            {vocabularies[field].map((option) => (
              <option key={option} value={option} aria-label={option} />
            ))}
          </datalist>
        </label>
        <Button size="sm" onClick={applyField} disabled={!value.trim()}>
          Apply
        </Button>
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
        <Button size="sm" variant="outline" onClick={addTag} disabled={!tag.trim()}>
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

      <div className="flex flex-wrap gap-2 border-t border-primary/20 pt-3">
        <Button size="sm" onClick={() => onSetStatus('approved')}>
          <Check />
          Approve all
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSetStatus('pending')}>
          Return to pending
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSetStatus('rejected')}>
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
