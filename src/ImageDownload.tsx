import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import type { MasonryRecord } from './types';

const BASE = import.meta.env.BASE_URL;

type Format = 'jpg' | 'png' | 'tiff' | 'webp';

const FORMATS: { id: Format; label: string }[] = [
  { id: 'jpg', label: 'JPG' },
  { id: 'png', label: 'PNG' },
  { id: 'tiff', label: 'TIFF' },
  { id: 'webp', label: 'WebP' },
];

/**
 * TIFF di base, RGB 8 bit non compresso: i browser non lo producono da soli,
 * ma il formato minimo e' una dozzina di campi e i pixel in fila.
 */
function encodeTiff(image: ImageData): Blob {
  const { width, height, data } = image;
  const entries = 12;
  const ifd = 8;
  const bitsAt = ifd + 2 + entries * 12 + 4;
  const xResAt = bitsAt + 6;
  const yResAt = xResAt + 8;
  const pixelsAt = yResAt + 8;
  const pixelBytes = width * height * 3;
  const buffer = new ArrayBuffer(pixelsAt + pixelBytes);
  const view = new DataView(buffer);

  view.setUint16(0, 0x4949); // "II": little endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, entries, true);

  // tag, tipo (3 SHORT, 4 LONG, 5 RATIONAL), quanti, valore o offset
  const fields: [number, number, number, number][] = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 3, bitsAt],
    [259, 3, 1, 1], // nessuna compressione
    [262, 3, 1, 2], // RGB
    [273, 4, 1, pixelsAt],
    [277, 3, 1, 3],
    [278, 4, 1, height],
    [279, 4, 1, pixelBytes],
    [282, 5, 1, xResAt],
    [283, 5, 1, yResAt],
    [296, 3, 1, 2], // pollici
  ];
  fields.forEach(([tag, type, count, value], index) => {
    const at = ifd + 2 + index * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(at + 8, value, true);
    else view.setUint32(at + 8, value, true);
  });
  view.setUint32(ifd + 2 + entries * 12, 0, true); // nessun altro IFD

  [0, 2, 4].forEach((offset) => view.setUint16(bitsAt + offset, 8, true));
  [xResAt, yResAt].forEach((at) => {
    view.setUint32(at, 72, true);
    view.setUint32(at + 4, 1, true);
  });

  const pixels = new Uint8Array(buffer, pixelsAt);
  for (
    let source = 0, target = 0;
    source < data.length;
    source += 4, target += 3
  ) {
    pixels[target] = data[source];
    pixels[target + 1] = data[source + 1];
    pixels[target + 2] = data[source + 2];
  }
  return new Blob([buffer], { type: 'image/tiff' });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Download della foto in piu' formati, dalla versione piu' grande pubblicata:
 * la 1600 px quando c'e' (sara' su R2), altrimenti la 480 px versionata nel
 * repository. JPG, PNG e TIFF si ottengono convertendo nel browser.
 */
export function ImageDownload({ record }: { record: MasonryRecord }) {
  const [source, setSource] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = useState<Format | null>(null);

  useEffect(() => {
    let cancelled = false;
    const candidates = [record.image, record.thumbnail]
      .filter(Boolean)
      .map((path) => `${BASE}${path}`);
    (async () => {
      for (const src of candidates) {
        try {
          const image = await loadImage(src);
          if (!cancelled)
            setSource({
              src,
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          return;
        } catch {
          // Versione non pubblicata: si prova la successiva.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record.image, record.thumbnail]);

  async function download(format: Format) {
    if (!source) return;
    setBusy(format);
    try {
      const name = `${record.id}_${Math.max(source.width, source.height)}px.${format}`;
      if (format === 'webp') {
        save(await (await fetch(source.src)).blob(), name);
        return;
      }
      const image = await loadImage(source.src);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      // Il JPG non ha trasparenza: fondo bianco invece del nero.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      if (format === 'tiff') {
        save(
          encodeTiff(context.getImageData(0, 0, canvas.width, canvas.height)),
          name,
        );
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(
          resolve,
          format === 'jpg' ? 'image/jpeg' : 'image/png',
          0.95,
        ),
      );
      if (blob) save(blob, name);
    } finally {
      setBusy(null);
    }
  }

  const credit = [record.author, record.affiliation].filter(Boolean).join(', ');

  return (
    <div className="mt-4 rounded-md border bg-background p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Download className="size-4" />
          Download
        </span>
        <span className="text-xs text-muted-foreground">
          {source ? `${source.width} × ${source.height} px` : 'Loading…'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((format) => (
          <Button
            key={format.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={!source || busy !== null}
            onClick={() => download(format.id)}
          >
            {busy === format.id ? '…' : format.label}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {record.license ?? 'CC BY 4.0'}: free to reuse, crediting{' '}
        {credit ? `${credit} — ` : ''}The Masonry Archive.
      </p>
    </div>
  );
}
