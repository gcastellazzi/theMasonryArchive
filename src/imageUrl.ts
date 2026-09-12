import type { MasonryRecord } from './types';

/**
 * Da dove arrivano le immagini.
 *
 * Le derivate da 160 e 480 px stanno nel repository (~36 MB in tutto): la
 * mappa, la galleria e il rullino dell'admin funzionano quindi anche offline
 * e senza configurare niente. Quelle da 1600 px pesano invece ~244 MB e sono
 * escluse dal versionamento: vivono su Cloudflare R2 e si raggiungono solo se
 * `VITE_IMAGE_CDN` e' impostata. Quando non lo e' — sviluppo senza rete, o un
 * clone appena fatto — la vista di dettaglio ripiega sul 480 px invece di
 * mostrare un'immagine rotta.
 */

const CDN = (import.meta.env.VITE_IMAGE_CDN ?? '').replace(/\/$/, '');
const BASE = import.meta.env.BASE_URL;

export type ImageSize = 'strip' | 'thumbnail' | 'image';

/** Vero quando le derivate di dettaglio sono raggiungibili. */
export const hasDetailImages = CDN !== '';

export function imageUrl(record: MasonryRecord, size: ImageSize): string {
  const path = record[size];
  if (size === 'image') {
    if (!CDN) return `${BASE}${record.thumbnail}`;
    return `${CDN}/${path}`;
  }
  return `${BASE}${path}`;
}

/**
 * Lascia scegliere al browser fra card e dettaglio in base alla larghezza
 * effettiva. Senza CDN resta un'unica sorgente, e `srcSet` non serve.
 */
export function detailSrcSet(record: MasonryRecord): string | undefined {
  if (!hasDetailImages) return undefined;
  return `${imageUrl(record, 'thumbnail')} 480w, ${imageUrl(record, 'image')} 1600w`;
}
