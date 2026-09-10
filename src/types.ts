export type Role = 'Student' | 'PhD candidate' | 'Researcher' | 'Professional';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** Campi di un record che una proposta puo' toccare. */
export type SuggestableField =
  | 'title'
  | 'period'
  | 'technique'
  | 'element'
  | 'material'
  | 'notes';

export const SUGGESTABLE_FIELDS: SuggestableField[] = [
  'title',
  'period',
  'technique',
  'element',
  'material',
  'notes',
];

/**
 * Una proposta arrivata da un utente registrato.
 *
 * Non modifica mai il record da sola: resta `pending` finche' un amministratore
 * non la accetta, e solo a quel punto il valore viene riportato sul record.
 * Le proposte vivono in `src/data/suggestions.json`, separate dai record,
 * perche' hanno un ciclo di vita proprio e la pipeline di ingest non le tocca.
 */
export type Suggestion = {
  id: string;
  recordId: string;
  /** `tag` aggiunge una parola chiave, `text` propone il contenuto di un campo. */
  kind: 'tag' | 'text';
  /** Valorizzato solo quando `kind` e' `text`. */
  field?: SuggestableField;
  value: string;
  author: string;
  affiliation?: string;
  role?: Role;
  rationale?: string;
  submittedAt: string;
  status: ReviewStatus;
  reviewedAt?: string;
  reviewNote?: string;
};

export type MasonryRecord = {
  id: string;

  // Catalogazione: compilata dall'amministratore, o da una proposta accettata.
  title: string;
  period: string;
  technique: string;
  element: string;
  material: string;
  tags: string[];
  notes: string;
  status: ReviewStatus;
  hasAlotiaJson: boolean;
  alotiaJsonUrl?: string;
  license?: string;

  // Ricavati dai metadati di scatto dalla pipeline di ingest.
  location: string;
  county?: string;
  state?: string;
  country: string;
  countryCode?: string;
  lat: number | null;
  lng: number | null;
  altitude?: number | null;
  /** Direzione di ripresa in gradi: dice quale fronte e' inquadrato. */
  bearing?: number | null;
  capturedAt?: string | null;
  camera?: string | null;
  width?: number | null;
  height?: number | null;

  author: string;
  affiliation: string;

  // Derivate generate dalla pipeline, relative alla base del sito.
  image: string;
  thumbnail: string;
  strip: string;
  sourceFile?: string;
  sourceHash?: string;
};

/** Un record e' pubblicabile solo se catalogato e georiferito. */
export function isPublishable(record: MasonryRecord): boolean {
  return Boolean(
    record.title.trim() &&
      record.element.trim() &&
      record.technique.trim() &&
      record.tags.length > 0 &&
      record.lat !== null &&
      record.lng !== null,
  );
}

/** Cosa manca a un record per poter essere approvato. */
export function missingFields(record: MasonryRecord): string[] {
  const missing: string[] = [];
  if (!record.title.trim()) missing.push('title');
  if (!record.element.trim()) missing.push('element');
  if (!record.technique.trim()) missing.push('technique');
  if (!record.tags.length) missing.push('tags');
  if (record.lat === null || record.lng === null) missing.push('position');
  return missing;
}
