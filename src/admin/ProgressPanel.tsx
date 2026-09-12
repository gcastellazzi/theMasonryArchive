import { useMemo } from 'react';

import { isPublishable, missingFields, type MasonryRecord } from '../types';

/**
 * A che punto e' la catalogazione.
 *
 * Le quattro schede di filtro dicono quante foto sono in ciascuno stato, ma non
 * dove si e' fermi: se manchino soprattutto i titoli o i tag, se un paese sia
 * indietro rispetto agli altri, quanto lavoro separi l'archivio dalla prossima
 * pubblicazione. Sono le domande che decidono da dove ripartire.
 *
 * Ogni riquadro misura una grandezza sola, quindi le barre hanno un colore
 * solo: il colore qui non porta identita', e i numeri restano scritti accanto
 * perche' il dato si legga anche senza.
 */

/** I campi che un record deve avere per essere approvabile, in ordine di compilazione. */
const REQUIRED = ['title', 'element', 'technique', 'tags', 'position'] as const;

function percent(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** Barra di avanzamento: traccia recessiva, riempimento a estremita' tonde. */
function Meter({ value, total }: { value: number; total: number }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="presentation"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${percent(value, total)}%` }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  total,
  hint,
}: {
  label: string;
  value: number;
  total: number;
  hint?: string;
}) {
  return (
    <div className="grid gap-1" title={hint}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="capitalize text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value}/{total} · {percent(value, total)}%
        </span>
      </div>
      <Meter value={value} total={total} />
    </div>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-2xl font-semibold tabular-nums text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function ProgressPanel({
  records,
  onSelect,
}: {
  records: MasonryRecord[];
  onSelect: (id: string) => void;
}) {
  const stats = useMemo(() => {
    const total = records.length;
    const approved = records.filter((r) => r.status === 'approved').length;
    const pending = records.filter((r) => r.status === 'pending').length;
    // Gia' completi ma non ancora approvati: e' il lavoro pronto a essere
    // pubblicato con un clic, e di solito la cosa piu' utile da fare subito.
    const ready = records.filter(
      (r) => r.status !== 'approved' && isPublishable(r),
    ).length;
    const todo = records.filter((r) => missingFields(r).length > 0).length;

    const byField = REQUIRED.map((field) => ({
      field,
      done: total - records.filter((r) => missingFields(r).includes(field)).length,
    }));

    const countries = new Map<string, { total: number; done: number }>();
    records.forEach((record) => {
      // Non e' 'unlocated' della pipeline, che parla di coordinate: qui
      // manca il toponimo di paese, che le coordinate possono avere lo stesso.
      const name = record.country || 'No country';
      const entry = countries.get(name) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (!missingFields(record).length) entry.done += 1;
      countries.set(name, entry);
    });

    const next = records
      .filter((r) => missingFields(r).length > 0)
      // Prima quelle a cui manca meno: chiuderle costa poco e la coda si
      // accorcia in fretta.
      .sort((a, b) => missingFields(a).length - missingFields(b).length)
      .slice(0, 10);

    return {
      total,
      approved,
      pending,
      ready,
      todo,
      byField,
      countries: [...countries]
        .map(([name, entry]) => ({ name, ...entry }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      next,
    };
  }, [records]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-md border bg-card p-3">
        <h3 className="text-sm font-semibold">Archive progress</h3>
        <div className="grid grid-cols-4 gap-2">
          <Tile value={stats.approved} label="Approved" />
          <Tile value={stats.pending} label="Pending" />
          <Tile value={stats.ready} label="Ready" />
          <Tile value={stats.todo} label="To catalogue" />
        </div>
        <div className="grid gap-2.5 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            Photos carrying each field required for approval
          </p>
          {stats.byField.map(({ field, done }) => (
            <Row key={field} label={field} value={done} total={stats.total} />
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-md border bg-card p-3">
        <h3 className="text-sm font-semibold">Fully catalogued by country</h3>
        <div className="grid gap-2.5">
          {stats.countries.map((country) => (
            <Row
              key={country.name}
              label={country.name}
              value={country.done}
              total={country.total}
              hint={`${country.done} of ${country.total} photos need no further fields`}
            />
          ))}
        </div>

        {stats.next.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Closest to done — fewest fields missing
            </p>
            <ul className="grid gap-1">
              {stats.next.map((record) => (
                <li key={record.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record.id)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span className="truncate">
                      {record.title || record.sourceFile || record.id}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {missingFields(record).join(', ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
