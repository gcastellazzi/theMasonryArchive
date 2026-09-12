/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origine da cui servire le derivate da 1600 px, senza barra finale
   * (es. `https://img.masonryarchive.org`). Non e' un segreto: e' un URL
   * pubblico, e in CI arriva da una repository variable. Se manca, la vista
   * di dettaglio ripiega sulla derivata da 480 px versionata nel repo.
   */
  readonly VITE_IMAGE_CDN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
