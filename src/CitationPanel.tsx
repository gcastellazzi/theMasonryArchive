import { Check, Copy, Quote, Scale } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

const YEAR = new Date().getFullYear();

/**
 * Zenodo assegna due DOI: uno per ogni release e un "concept DOI" che punta
 * sempre all'ultima versione. Nella citazione va il secondo, cosi' il
 * riferimento non invecchia a ogni aggiornamento dell'archivio; il primo
 * resta disponibile per chi deve citare esattamente la versione usata.
 */
const CONCEPT_DOI = '10.5281/zenodo.22698617';
const VERSION_DOI = '10.5281/zenodo.22698618';
const VERSION = 'v1.0.0';

const PLAIN =
  `Castellazzi, G. (${YEAR}). The Masonry Archive [Data set]. ` +
  `University of Bologna. https://doi.org/${CONCEPT_DOI}`;

const BIBTEX = `@misc{castellazzi_masonry_archive,
  author       = {Castellazzi, Giovanni},
  title        = {The Masonry Archive},
  year         = {${YEAR}},
  publisher    = {Zenodo},
  howpublished = {University of Bologna},
  note         = {Data set},
  doi          = {${CONCEPT_DOI}},
  url          = {https://doi.org/${CONCEPT_DOI}}
}`;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copiato' : label}
    </Button>
  );
}

export function CitationPanel() {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Quote className="size-4 text-primary" />
        <h2 className="font-semibold">How to cite this archive</h2>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        The images and records are shared so that they can be used. If they
        support your teaching, research or publication, please cite the archive.
      </p>

      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Reference
          </p>
          <p className="rounded-md border bg-muted/50 p-3 text-sm leading-6">{PLAIN}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={PLAIN} label="Copia la citazione" />
            <CopyButton text={BIBTEX} label="Copia il BibTeX" />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border bg-background p-3 text-sm">
          <Scale className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Licence</p>
            <p className="mt-1 leading-6 text-muted-foreground">
              Images, notes and metadata are released under{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
              : you may reuse and adapt them, including commercially, provided
              you credit the author and state any changes. The application
              source code is released separately under the MIT licence.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Badge reso in locale: nessuna richiesta a servizi esterni dalla
              pagina pubblica. */}
          <a
            href={`https://doi.org/${CONCEPT_DOI}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex overflow-hidden rounded font-mono text-[11px] no-underline"
          >
            <span className="bg-neutral-700 px-2 py-1 text-white">DOI</span>
            <span className="bg-primary px-2 py-1 text-primary-foreground">{CONCEPT_DOI}</span>
          </a>
          <span>
            Archived on Zenodo. To cite the exact version you consulted, use{' '}
            <a href={`https://doi.org/${VERSION_DOI}`} target="_blank" rel="noreferrer">
              {VERSION_DOI}
            </a>{' '}
            ({VERSION}); the DOI above always resolves to the latest release.
          </span>
        </div>
      </div>
    </section>
  );
}
