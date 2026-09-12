import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
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

/** Quante copie di sicurezza conservare per ciascun file. */
const BACKUP_LIMIT = 20;

/**
 * Mette da parte la versione precedente prima di sovrascriverla.
 *
 * Il salvataggio rimpiazza il file per intero, non fonde: una catalogazione
 * sbagliata partita da una bozza vecchia cancellerebbe ore di lavoro senza
 * lasciare traccia, e finche' non si committa git non e' ancora una rete di
 * protezione. Le copie stanno in `src/data/.backups/`, fuori dal versionamento.
 */
async function backup(dataDir: string, name: string): Promise<void> {
  const backupDir = resolve(dataDir, '.backups');
  await mkdir(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await copyFile(resolve(dataDir, name), resolve(backupDir, `${name}.${stamp}.json`));
  } catch (error) {
    // Al primo salvataggio il file puo' non esistere ancora: non c'e' nulla
    // da salvare e non e' un errore.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return;
  }

  const stale = (await readdir(backupDir))
    .filter((file) => file.startsWith(`${name}.`))
    .sort()
    .slice(0, -BACKUP_LIMIT);
  await Promise.all(stale.map((file) => rm(resolve(backupDir, file), { force: true })));
}

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
                const dataDir = resolve(server.config.root, 'src/data');
                await backup(dataDir, name);
                await writeFile(
                  resolve(dataDir, name),
                  JSON.stringify(content, null, 2) + '\n',
                  'utf8',
                );
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
