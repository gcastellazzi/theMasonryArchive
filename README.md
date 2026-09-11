# The Masonry Archive

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22698617.svg)](https://doi.org/10.5281/zenodo.22698617)

**Sito web: [gcastellazzi.github.io/theMasonryArchive](https://gcastellazzi.github.io/theMasonryArchive/)**

The Masonry Archive is an open, moderated web archive for geolocated masonry images. It is designed for public consultation, student teaching, and research-oriented documentation of masonry textures, structural details, construction periods, and optional aLoTiA JSON records.

## Current scope

- Public map based on OpenStreetMap tiles.
- Zoom-dependent grouping of image records.
- Public consultation without login.
- Registration-aware upload form for students, PhD candidates, researchers, and professionals.
- Moderation model where uploads become public only after administrator approval.
- Admin review queue mockup.
- Initial data model for future backend integration.
- GitHub Pages compatible static build.

## Recommended production architecture

GitHub Pages can host the frontend, but it cannot safely handle image uploads, passwordless login, email delivery, CAPTCHA verification, or protected administrator actions on its own.

Recommended setup:

- Frontend: GitHub Pages.
- Authentication: passwordless magic links through Supabase Auth or Firebase Auth.
- Database: Supabase Postgres or Firebase Firestore.
- Image storage: Supabase Storage, Cloudflare R2, or Firebase Storage.
- Email notifications: Supabase Edge Function plus Resend, or another transactional email service.
- CAPTCHA: Cloudflare Turnstile or hCaptcha.
- Moderation: administrator dashboard updates record status from `pending` to `approved`.

## Content and licensing

The application source code can be released under the MIT License.

Images, notes, and metadata should use a content license instead of MIT. Recommended options:

- CC BY 4.0 if contributors must be credited.
- CC0 if the archive should place contributions as close as possible to the public domain.

Every upload should require the contributor to confirm that they own the image or have the right to publish it.

## Image policy

Initial proposal:

- Accepted formats: JPG, PNG, WebP.
- Maximum original upload size: 12 MB.
- Public derivatives: 1600 px long edge for detail view, 480 px thumbnail for maps and lists.
- Store original only if needed for research and if contributor consent is explicit.

## Development

```bash
npm install
npm run dev
```

Local app URL:

```text
http://localhost:5180/theMasonryArchive/
```

Production build:

```bash
npm run build
```

## GitHub Pages

The Vite base path is configured for:

```text
https://gcastellazzi.github.io/theMasonryArchive/
```

Enable GitHub Pages with "GitHub Actions" as the source, then push the repository. The included workflow builds and publishes the `dist` folder.

## Importare le foto

La pipeline di ingest trasforma una cartella esportata da Foto di Apple nei dati
dell'archivio. Richiede ImageMagick, che legge l'HEIC dell'iPhone:

```bash
brew install imagemagick
```

Da Foto: seleziona l'album, `File > Esporta > Esporta originali non modificati`,
spuntando **Includi informazioni sulla posizione**. Poi:

```bash
npm run ingest -- --source ~/Downloads/Masonry_photos \
  --author "Giovanni Castellazzi" --affiliation "University of Bologna"
```

Per ogni foto lo script legge coordinate, quota, direzione di ripresa e data dal
sidecar XMP (in mancanza, dall'EXIF), risolve il toponimo con la geocodifica
inversa di OpenStreetMap e genera tre derivate WebP prive di metadati:

| Derivata | Lato lungo | Uso | Versionata |
|---|---|---|---|
| `*_1600.webp` | 1600 px | scheda pubblica | no, vedi sotto |
| `*_480.webp` | 480 px | mappa, elenchi, anteprima admin | sì |
| `*_160.webp` | 160 px | rullino del pannello admin | sì |

Le immagini di dettaglio sono escluse dal versionamento: su 761 foto pesano circa
236 MB, e l'archivio è destinato a crescere. Vanno spostate su uno storage
esterno come raccomandato più sopra. Miniature e card restano nel repo perché
pesano circa 31 MB in tutto e servono al lavoro di catalogazione.

L'ingest è **incrementale e non distruttivo**: riconosce le foto già importate
dall'impronta del file e conserva tutti i campi compilati a mano — titolo,
epoca, tecnica, elemento, materiale, tag, note, stato. Rieseguirlo dopo aver
aggiunto foto nuove non cancella la catalogazione già fatta. Le derivate già
presenti non vengono rigenerate, salvo `--force`.

Opzioni utili: `--dry-run` per vedere cosa farebbe, `--no-geocode` per lavorare
senza rete. La cache delle geocodifiche sta in `tools/.geocache.json`.

## Catalogare e moderare

La scheda **Admin** è il banco di lavoro: rullino di miniature, anteprima con i
dati di scatto, campi di catalogazione, vocabolario dei tag e coda delle proposte
arrivate dagli utenti.

Le modifiche restano in bozza nel browser (`localStorage`) finché non premi
**Salva le modifiche**, che le scrive direttamente in `src/data/`. Il pulsante
funziona perché il pannello gira sul server di sviluppo: un plugin Vite
(`tools/vite-admin-save.ts`) espone un endpoint di scrittura che esiste solo in
locale e non finisce nel build di produzione. Accanto c'è un pulsante di
download, se preferisci spostare i JSON a mano.

Il salvataggio scrive i file ma **non li committa**: le modifiche diventano
pubbliche solo dopo

```bash
git add src/data && git commit -m "Catalogazione" && git push
```

Finché non pushi, l'archivio online resta com'era: puoi catalogare per giorni e
pubblicare quando sei pronto.

Un record diventa approvabile solo quando ha titolo, elemento, tecnica, almeno un
tag e una posizione. Sulla mappa pubblica compaiono unicamente i record
approvati e georiferiti.

### Proposte degli utenti

Dalla scheda **Suggest** chiunque può proporre un tag o il testo di un campo
(`title`, `period`, `technique`, `element`, `material`, `notes`), con una
motivazione facoltativa. La proposta nasce in stato `pending` e non tocca il
record: solo l'accettazione da parte dell'amministratore ne riporta il valore
sul record. Le proposte vivono in `src/data/suggestions.json`, separate dai
record, e la pipeline di ingest non le tocca mai.

### Chi può accedere al pannello

Il pannello esiste **solo quando il sito gira in locale** (`npm run dev`). Nel
build di produzione la voce di menu non viene generata e il codice del pannello
viene eliminato dal bundle: sul sito pubblicato non è raggiungibile, nemmeno
conoscendo l'indirizzo.

Non è autenticazione, ed è bene essere espliciti sul perché: **un sito statico
non può autenticare nessuno**. Qualunque password messa nel JavaScript sarebbe
leggibile aprendo il sorgente della pagina, e darebbe una falsa sicurezza. Una
vera autenticazione — magic link, due fattori, ruoli — richiede il servizio di
backend descritto più sopra: Supabase Auth o equivalente, con le operazioni di
moderazione eseguite dal server e non dal browser.

Va tenuto presente anche che tutto ciò che sta nel repository è pubblico,
`records.json` compreso: chiunque può leggere i record non ancora approvati e le
loro coordinate. Se questo diventa un problema, il passo successivo è generare
in fase di build un `records.public.json` con i soli record approvati e tenere
l'archivio completo fuori dal sito pubblicato.

### Eliminare una foto

Il pulsante **Elimina** toglie il record dall'archivio e ne registra l'impronta
in `excluded.json`. Il file serve a rendere l'eliminazione definitiva: senza,
il primo reimport della stessa cartella riporterebbe dentro la foto.
L'esportazione dal pannello scarica quindi tre file — `records.json`,
`suggestions.json` ed `excluded.json` — tutti da salvare in `src/data/`.

Le immagini restano su disco finché non si esegue:

```bash
python3 tools/prune_images.py --dry-run   # mostra cosa toglierebbe
python3 tools/prune_images.py             # rimuove
```

Lo stesso strumento ripulisce le derivate lasciate da un ingest interrotto.

## Citare l'archivio

Il file `CITATION.cff` alla radice del repository fornisce a GitHub il pulsante
*Cite this repository*, e la home del sito mostra la citazione pronta da copiare,
in testo semplice e in BibTeX, insieme alla licenza.

L'archivio è archiviato su Zenodo e ha un DOI:

| DOI | A cosa punta | Quando usarlo |
|---|---|---|
| [10.5281/zenodo.22698617](https://doi.org/10.5281/zenodo.22698617) | sempre l'ultima release | **citazione normale** |
| [10.5281/zenodo.22698618](https://doi.org/10.5281/zenodo.22698618) | release v1.0.0 | per citare la versione esatta consultata |

Citazione:

> Castellazzi, G. (2026). *The Masonry Archive* [Data set]. University of
> Bologna. https://doi.org/10.5281/zenodo.22698617

A ogni nuova release taggata su GitHub, Zenodo crea automaticamente un nuovo DOI
di versione e aggiorna il concept DOI. Dopo una release vanno aggiornati
`version` e `date-released` in `CITATION.cff`, e la costante `VERSION` in
`src/CitationPanel.tsx`; il concept DOI resta invece sempre lo stesso.

Licenza dei contenuti: **CC BY 4.0** per immagini, note e metadati; **MIT** per
il codice dell'applicazione.
