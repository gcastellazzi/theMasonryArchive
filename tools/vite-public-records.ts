import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

/**
 * Toglie dal sito pubblicato tutto quello che non e' ancora pubblico.
 *
 * `src/App.tsx` importa i dati staticamente, quindi finiscono nel bundle
 * cosi' come sono: senza questo passaggio il sito pubblicherebbe tutti i
 * record non ancora approvati con le loro coordinate, e — da quando si
 * ricevono contributi — anche gli indirizzi email di chi li ha mandati.
 *
 * Il filtro agisce in fase di build sostituendo il contenuto del modulo. Il
 * codice dell'applicazione resta identico: in sviluppo continua a vedere
 * l'archivio intero, che e' quello che serve per catalogare, e il pannello
 * admin funziona come prima.
 */

/** Campi interni alla pipeline, inutili a chi consulta e inutili da pubblicare. */
const INTERNAL_FIELDS = ['sourceFile', 'sourceHash'] as const;

/**
 * File che nel sito pubblicato devono essere vuoti.
 *
 * `submissions.json` porta email e affiliazioni di chi contribuisce, e serve
 * solo al pannello locale; `excluded.json` porta impronte di file, che non
 * dicono niente a nessuno fuori dalla pipeline.
 */
const EMPTIED = ['submissions.json', 'excluded.json'];

type Record = {
  status?: string;
  lat?: number | null;
  lng?: number | null;
  [key: string]: unknown;
};

function isPublic(record: Record): boolean {
  return record.status === 'approved' && record.lat !== null && record.lng !== null;
}

function strip(record: Record): Record {
  const clean = { ...record };
  INTERNAL_FIELDS.forEach((field) => delete clean[field]);
  return clean;
}

export function publicRecords(): Plugin {
  return {
    name: 'masonry-archive:public-records',
    apply: 'build',
    // Prima del plugin JSON di Vite, che altrimenti trasformerebbe il file
    // originale prima che si possa filtrarlo.
    enforce: 'pre',

    // Si restituisce JSON, non un modulo gia' fatto: il plugin JSON
    // integrato gira comunque dopo, e su un `export default` fallirebbe.
    load(id) {
      const path = id.split('?')[0];

      if (path.endsWith('/src/data/records.json')) {
        const all = JSON.parse(readFileSync(path, 'utf8')) as Record[];
        const published = all.filter(isPublic).map(strip);
        this.info(
          `records.json: ${published.length} record pubblicati su ${all.length}`,
        );
        return JSON.stringify(published);
      }

      if (EMPTIED.some((name) => path.endsWith(`/src/data/${name}`))) {
        return '[]';
      }

      return null;
    },
  };
}
