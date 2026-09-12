import { useCallback, useState } from 'react';

import type { MasonryRecord, Suggestion } from '../types';

/**
 * Lo stato modificabile del pannello: record, proposte ed esclusioni.
 *
 * Sta tutto in un oggetto solo perche' le operazioni li toccano insieme —
 * eliminare una foto la toglie dai record, ne annota l'impronta fra le
 * esclusioni e scarta le proposte che la riguardavano — e un annullamento
 * deve riportare indietro i tre insiemi in blocco, non uno alla volta.
 */
export type AdminSnapshot = {
  records: MasonryRecord[];
  suggestions: Suggestion[];
  excluded: string[];
};

/** Bozze di catalogazione, per non perdere il lavoro chiudendo la scheda. */
const DRAFT_KEY = 'masonry-archive:admin-draft';

/**
 * Quanti passi indietro si possono fare. La pila vive solo in memoria: serve a
 * rimediare a un errore appena fatto — una modifica in blocco applicata alla
 * selezione sbagliata — non a ricostruire la storia dell'archivio, che e'
 * quello per cui esistono git e le copie in `src/data/.backups/`.
 */
const UNDO_LIMIT = 50;

export function loadDraft(): Record<string, Partial<MasonryRecord>> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeDraft(draft: Record<string, Partial<MasonryRecord>>): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Spazio esaurito o storage disabilitato: la sessione corrente regge lo stesso.
  }
}

/** Toglie dalla bozza i record eliminati, che non devono tornare in vita. */
export function forgetDrafts(ids: Iterable<string>): void {
  const draft = loadDraft();
  let touched = false;
  for (const id of ids) {
    if (draft[id]) {
      delete draft[id];
      touched = true;
    }
  }
  if (touched) writeDraft(draft);
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Come sopra: senza storage si lavora comunque, solo senza bozza.
  }
}

function withDraft(records: MasonryRecord[]): MasonryRecord[] {
  const draft = loadDraft();
  if (!Object.keys(draft).length) return records;
  return records.map((record) =>
    draft[record.id] ? { ...record, ...draft[record.id] } : record,
  );
}

export type AdminState = {
  data: AdminSnapshot;
  /**
   * Applica una modifica rendendola annullabile. `label` e' quello che il
   * bottone di annullamento mostrera' all'utente.
   *
   * `coalesceKey` fonde i passi consecutivi che portano la stessa chiave in
   * uno solo: scrivere un titolo genera una modifica per ogni tasto premuto, e
   * senza fusione venti battute riempirebbero la pila di venti passi da
   * annullare uno alla volta. Con la chiave `id:campo`, annullare riporta il
   * campo com'era prima che si cominciasse a scriverci.
   */
  commit: (label: string, next: AdminSnapshot, coalesceKey?: string) => void;
  /** Scorciatoia per modificare i soli record. */
  commitRecords: (label: string, records: MasonryRecord[], coalesceKey?: string) => void;
  undo: () => void;
  undoLabel: string | null;
  dirty: boolean;
  /** Da chiamare dopo un salvataggio riuscito. */
  markSaved: () => void;
};

export function useAdminState(initial: AdminSnapshot): AdminState {
  const [data, setData] = useState<AdminSnapshot>(() => ({
    ...initial,
    records: withDraft(initial.records),
  }));
  const [past, setPast] = useState<
    { label: string; data: AdminSnapshot; coalesceKey?: string }[]
  >([]);
  const [dirty, setDirty] = useState(() => Object.keys(loadDraft()).length > 0);

  const commit = useCallback(
    (label: string, next: AdminSnapshot, coalesceKey?: string) => {
      setPast((stack) => {
        const top = stack[stack.length - 1];
        // Una serie di battute sullo stesso campo tiene il primo passo, che
        // e' l'unico stato a cui abbia senso tornare.
        if (coalesceKey && top?.coalesceKey === coalesceKey) return stack;
        return [...stack, { label, data, coalesceKey }].slice(-UNDO_LIMIT);
      });

      // Solo i record davvero cambiati finiscono nella bozza. Ogni mutazione
      // ricrea l'oggetto del record che tocca e lascia gli altri intatti,
      // quindi basta il confronto per riferimento per individuarli: su 750
      // record un confronto profondo a ogni battuta di tasto non servirebbe
      // a nulla.
      const previous = new Map(data.records.map((record) => [record.id, record]));
      const draft = loadDraft();
      let touched = false;
      next.records.forEach((record) => {
        if (previous.get(record.id) !== record) {
          draft[record.id] = record;
          touched = true;
        }
      });
      if (touched) writeDraft(draft);

      setData(next);
      setDirty(true);
    },
    [data],
  );

  const commitRecords = useCallback(
    (label: string, records: MasonryRecord[], coalesceKey?: string) => {
      commit(label, { ...data, records }, coalesceKey);
    },
    [commit, data],
  );

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;

    setPast((stack) => stack.slice(0, -1));
    setData(previous.data);

    // La bozza va riallineata allo stato ripristinato, altrimenti un
    // ricaricamento della pagina riapplicherebbe la modifica annullata.
    const draft = loadDraft();
    previous.data.records.forEach((record) => {
      if (draft[record.id]) draft[record.id] = record;
    });
    writeDraft(draft);
    setDirty(true);
  }, [past]);

  const markSaved = useCallback(() => {
    clearDraft();
    setDirty(false);
  }, []);

  return {
    data,
    commit,
    commitRecords,
    undo,
    undoLabel: past[past.length - 1]?.label ?? null,
    dirty,
    markSaved,
  };
}
