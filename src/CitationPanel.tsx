import { Check, Copy, Quote, Scale } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

const YEAR = new Date().getFullYear();
const SITE = 'https://gcastellazzi.github.io/theMasonryArchive/';

/**
 * Il DOI arriva dalla prima release taggata, tramite l'integrazione
 * GitHub-Zenodo. Finche' e' vuoto la citazione rimanda al sito; appena c'e',
 * basta scriverlo qui e compare in tutte le forme di citazione.
 */
const DOI: string = '';

const PLAIN = DOI
  ? `Castellazzi, G. (${YEAR}). The Masonry Archive [Data set]. University of Bologna. https://doi.org/${DOI}`
  : `Castellazzi, G. (${YEAR}). The Masonry Archive [Data set]. University of Bologna. ${SITE}`;

const BIBTEX = `@misc{castellazzi_masonry_archive,
  author       = {Castellazzi, Giovanni},
  title        = {The Masonry Archive},
  year         = {${YEAR}},
  howpublished = {University of Bologna},
  note         = {Data set},
  url          = {${DOI ? `https://doi.org/${DOI}` : SITE}}${DOI ? `,\n  doi          = {${DOI}}` : ''}
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

        {!DOI && (
          <p className="text-xs text-muted-foreground">
            A DOI will be minted from the first tagged release through Zenodo,
            and will replace the link above as the preferred citation.
          </p>
        )}
      </div>
    </section>
  );
}
