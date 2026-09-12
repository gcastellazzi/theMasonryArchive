import { hasValidPosition, missingFields, type MasonryRecord } from '../types';

/**
 * Raggruppamento delle foto scattate nello stesso posto e nello stesso momento.
 *
 * Fotografare una muratura significa quasi sempre scattare una raffica: il
 * fronte intero, due dettagli della tessitura, la lesione da vicino. Sono foto
 * che condividono tecnica, elemento, materiale ed epoca, e catalogarle una per
 * una e' lavoro ripetuto. Il gruppo le seleziona tutte insieme.
 *
 * Il confronto e' sulla distanza vera, non su coordinate arrotondate a una
 * griglia: due scatti a otto metri l'uno dall'altro possono cadere ai due lati
 * di una casella, e la raffica si spezzerebbe proprio dove serve tenerla unita.
 */

/** Distanza massima perche' due scatti inquadrino la stessa muratura. */
const SESSION_RADIUS_M = 35;

/** Distanza massima nel tempo perche' due scatti appartengano alla stessa sessione. */
const SESSION_GAP_MS = 15 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;
const TO_RAD = Math.PI / 180;

/**
 * Distanza in metri. A queste scale la proiezione equirettangolare sbaglia di
 * frazioni di metro, e costa una radice invece di una serie di trigonometriche.
 */
function distance(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const meanLat = ((aLat + bLat) / 2) * TO_RAD;
  const dx = (bLng - aLng) * TO_RAD * Math.cos(meanLat) * EARTH_RADIUS_M;
  const dy = (bLat - aLat) * TO_RAD * EARTH_RADIUS_M;
  return Math.hypot(dx, dy);
}

/**
 * Gli identificativi delle foto che appartengono alla stessa sessione di
 * scatto di `record`, il record compreso. Se non ha posizione o data, e' solo
 * di se' stesso.
 */
export function shotGroup(
  record: MasonryRecord,
  records: MasonryRecord[],
): string[] {
  const at = record.capturedAt ? Date.parse(record.capturedAt) : NaN;
  if (!hasValidPosition(record) || Number.isNaN(at)) return [record.id];

  const lat = record.lat as number;
  const lng = record.lng as number;

  return records
    .filter((other) => {
      if (!hasValidPosition(other)) return false;
      const otherAt = other.capturedAt ? Date.parse(other.capturedAt) : NaN;
      if (Number.isNaN(otherAt)) return false;
      if (Math.abs(otherAt - at) > SESSION_GAP_MS) return false;
      return (
        distance(lat, lng, other.lat as number, other.lng as number) <=
        SESSION_RADIUS_M
      );
    })
    .map((other) => other.id);
}

/**
 * Il record georiferito piu' vicino nel tempo a `record`, fra gli altri.
 *
 * Serve alle foto senza coordinate: quasi sempre sono scatti fatti nella
 * stessa uscita di altri che la posizione ce l'hanno, e quella posizione e'
 * una stima di partenza molto migliore di una mappa centrata sull'Europa.
 */
export function nearestLocated(
  record: MasonryRecord,
  records: MasonryRecord[],
): MasonryRecord | null {
  const at = record.capturedAt ? Date.parse(record.capturedAt) : NaN;
  if (Number.isNaN(at)) return null;

  let best: MasonryRecord | null = null;
  let bestGap = Infinity;
  records.forEach((other) => {
    if (other.id === record.id || !hasValidPosition(other)) return;
    const otherAt = other.capturedAt ? Date.parse(other.capturedAt) : NaN;
    if (Number.isNaN(otherAt)) return;
    const gap = Math.abs(otherAt - at);
    if (gap < bestGap) {
      best = other;
      bestGap = gap;
    }
  });
  return best;
}

export type SearchFilters = {
  text: string;
  country: string;
  camera: string;
  year: string;
  /** `title`, `tags`, `position`… oppure vuoto per non filtrare. */
  missing: string;
};

export const EMPTY_FILTERS: SearchFilters = {
  text: '',
  country: '',
  camera: '',
  year: '',
  missing: '',
};

export function hasActiveFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => value !== '');
}

function haystack(record: MasonryRecord): string {
  return [
    record.title,
    record.location,
    record.country,
    record.state,
    record.camera,
    record.notes,
    record.sourceFile,
    record.element,
    record.technique,
    record.material,
    record.period,
    ...record.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function applyFilters(
  records: MasonryRecord[],
  filters: SearchFilters,
): MasonryRecord[] {
  const text = filters.text.trim().toLowerCase();
  return records.filter((record) => {
    if (text && !haystack(record).includes(text)) return false;
    if (filters.country && record.country !== filters.country) return false;
    if (filters.camera && record.camera !== filters.camera) return false;
    if (filters.year && record.capturedAt?.slice(0, 4) !== filters.year) return false;
    if (filters.missing && !missingFields(record).includes(filters.missing)) return false;
    return true;
  });
}

/** I valori distinti di un campo fra i record, per popolare i menu a tendina. */
export function facet(
  records: MasonryRecord[],
  pick: (record: MasonryRecord) => string | null | undefined,
): string[] {
  const values = new Set<string>();
  records.forEach((record) => {
    const value = pick(record);
    if (value) values.add(value);
  });
  return [...values].sort((a, b) => a.localeCompare(b));
}
