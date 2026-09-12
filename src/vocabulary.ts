import type { MasonryRecord } from './types';

/**
 * Vocabolari di partenza per la catalogazione.
 *
 * Non sono liste chiuse: i campi restano di testo libero e questi valori
 * servono solo da suggerimento. Quanto viene scritto di nuovo su un record
 * rientra automaticamente fra i suggerimenti delle foto successive, cosi' il
 * vocabolario cresce con l'archivio invece di restare fermo a questa lista.
 */

export const ELEMENTS = [
  'Wall',
  'Arch',
  'Vault',
  'Dome',
  'Pier',
  'Column',
  'Buttress',
  'Lintel',
  'Opening',
  'Corner',
  'Cornice',
  'Bell tower',
  'Tower',
  'Bridge',
  'Pavement',
  'Foundation',
  'Staircase',
];

export const TECHNIQUES = [
  'Brick masonry',
  'Ashlar stone masonry',
  'Squared rubble masonry',
  'Roughly coursed rubble stone masonry',
  'Uncoursed rubble masonry',
  'Opus incertum',
  'Opus reticulatum',
  'Opus mixtum',
  'Opus latericium',
  'Opus quadratum',
  'Rammed earth',
  'Adobe masonry',
  'Dry stone masonry',
  'Herringbone brickwork',
  'Two-leaf masonry with rubble core',
  'Confined masonry',
  'Reinforced masonry',
];

export const MATERIALS = [
  'Clay brick and lime mortar',
  'Limestone and lime mortar',
  'Sandstone and lime mortar',
  'Tuff and pozzolanic mortar',
  'Granite and lime mortar',
  'Marble',
  'Mixed stone and brick with lime mortar',
  'Cobbles and lime mortar',
  'Earth and straw',
  'Cement mortar (later repair)',
];

export const PERIODS = [
  'Roman',
  'Late antique',
  'Early medieval',
  '11th century',
  '12th century',
  '13th century',
  '14th century',
  '15th century',
  '16th century',
  '17th century',
  '18th century',
  '19th century',
  '20th century',
  'Contemporary',
  'Undetermined',
];

export const TAGS = [
  'arch',
  'vault',
  'brickwork',
  'stonework',
  'opus incertum',
  'opus reticulatum',
  'ashlar',
  'lime mortar',
  'crack pattern',
  'pressure-line candidate',
  'repair',
  'texture',
  'weathering',
  'salt crystallisation',
  'frost damage',
  'seismic damage',
  'settlement',
  'bulging',
  'infill',
  'levelling course',
];

const SEEDS: Record<string, string[]> = {
  element: ELEMENTS,
  technique: TECHNIQUES,
  material: MATERIALS,
  period: PERIODS,
};

/**
 * Suggerimenti per un campo: i valori di partenza piu' tutto quanto e' gia'
 * stato scritto sugli altri record, in ordine alfabetico e senza ripetizioni.
 */
export function suggestionsFor(
  field: 'element' | 'technique' | 'material' | 'period',
  records: MasonryRecord[],
): string[] {
  const used = records.map((record) => record[field]).filter(Boolean);
  return [...new Set([...SEEDS[field], ...used])].sort((a, b) => a.localeCompare(b));
}

/** Tutti i tag noti: quelli di partenza piu' quelli gia' assegnati. */
export function knownTags(records: MasonryRecord[]): string[] {
  const used = records.flatMap((record) => record.tags);
  return [...new Set([...TAGS, ...used])].sort((a, b) => a.localeCompare(b));
}

/** I campi di catalogazione a valore singolo, gestibili dal vocabolario. */
export type VocabularyField = 'element' | 'technique' | 'material' | 'period';

export const VOCABULARY_FIELDS: VocabularyField[] = [
  'element',
  'technique',
  'material',
  'period',
];

export type ValueUsage = { value: string; count: number };

/**
 * Quante volte ogni valore e' usato, dal piu' frequente al meno.
 *
 * Serve a vedere la deriva del vocabolario: i campi sono a testo libero, e
 * dopo qualche centinaio di foto convivono immancabilmente `stonework` e
 * `stone work`, o la stessa tecnica scritta in due modi. Un valore usato una
 * volta sola accanto a uno quasi identico usato cento volte e' quasi sempre
 * un refuso da unire.
 */
export function valueCounts(
  field: VocabularyField,
  records: MasonryRecord[],
): ValueUsage[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    const value = record[field].trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Come `valueCounts`, per i tag. */
export function tagCounts(records: MasonryRecord[]): ValueUsage[] {
  const counts = new Map<string, number>();
  records.forEach((record) => {
    record.tags.forEach((rawTag) => {
      const tag = rawTag.trim();
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Riscrive un valore su tutti i record che lo usano.
 *
 * Con `to` vuoto il valore viene semplicemente tolto. Unire due valori e'
 * la stessa operazione: si rinomina il primo nel secondo.
 */
export function renameValue(
  field: VocabularyField,
  from: string,
  to: string,
  records: MasonryRecord[],
): MasonryRecord[] {
  return records.map((record) =>
    record[field].trim() === from ? { ...record, [field]: to } : record,
  );
}

/**
 * Riscrive un tag su tutti i record che lo portano.
 *
 * Con `to` vuoto il tag viene rimosso. Quando il tag di destinazione e' gia'
 * presente sul record, l'unione non lo duplica.
 */
export function renameTag(
  from: string,
  to: string,
  records: MasonryRecord[],
): MasonryRecord[] {
  const target = to.trim();
  return records.map((record) => {
    if (!record.tags.some((tag) => tag.trim() === from)) return record;
    const kept = record.tags.filter((tag) => tag.trim() !== from);
    const tags = target && !kept.some((tag) => tag.trim() === target)
      ? [...kept, target]
      : kept;
    return { ...record, tags };
  });
}
