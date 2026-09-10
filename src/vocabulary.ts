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
