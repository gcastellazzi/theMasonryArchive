import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

/**
 * Permette al pannello di amministrazione di salvare i dati direttamente in
 * `src/data/`, invece di scaricare i JSON e farli spostare a mano.
 *
 * Il middleware vive **solo nel server di sviluppo**: `configureServer` non
 * viene eseguito da `vite build`, quindi nel sito pubblicato questo endpoint
 * non esiste. E' la stessa ragione per cui il pannello e' disponibile solo in
 * locale — un sito statico non puo' scrivere nulla.
 */

// Solo questi file possono essere scritti: il nome arriva dal browser e non
// deve poter diventare un percorso arbitrario.
const WRITABLE = new Set(['records.json', 'suggestions.json', 'excluded.json']);

export function adminSave(): Plugin {
  return {
    name: 'masonry-archive:admin-save',
    apply: 'serve',
    configureServer(server) {
      // Il percorso deve includere la base del sito: il browser chiama
      // `${import.meta.env.BASE_URL}__admin/save`, non la radice del dominio.
      const route = `${server.config.base.replace(/\/$/, '')}/__admin/save`;

      server.middlewares.use(route, (request, response, next) => {
        if (request.method !== 'POST') return next();

        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          void (async () => {
            const reply = (status: number, body: unknown) => {
              response.statusCode = status;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify(body));
            };

            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
                string,
                unknown
              >;

              const written: string[] = [];
              for (const [name, content] of Object.entries(payload)) {
                if (!WRITABLE.has(name)) {
                  return reply(400, { error: `file non consentito: ${name}` });
                }
                if (!Array.isArray(content)) {
                  return reply(400, { error: `${name} deve contenere un array` });
                }
                const target = resolve(server.config.root, 'src/data', name);
                await writeFile(target, JSON.stringify(content, null, 2) + '\n', 'utf8');
                written.push(`${name} (${content.length})`);
              }

              server.config.logger.info(`  salvato in src/data: ${written.join(', ')}`);
              reply(200, { ok: true, written });
            } catch (error) {
              reply(500, { error: error instanceof Error ? error.message : String(error) });
            }
          })();
        });
      });
    },
  };
}
