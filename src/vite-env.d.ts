/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origine da cui servire le derivate da 1600 px, senza barra finale
   * (es. `https://img.masonryarchive.org`). Non e' un segreto: e' un URL
   * pubblico, e in CI arriva da una repository variable. Se manca, la vista
   * di dettaglio ripiega sulla derivata da 480 px versionata nel repo.
   */
  readonly VITE_IMAGE_CDN?: string;

  /**
   * Origine del Worker che riceve i contributi, senza barra finale
   * (es. `https://masonry-archive-api.tuo-account.workers.dev`). Se manca,
   * l'archivio resta in sola consultazione: le schede Upload e Suggest lo
   * dicono invece di proporre moduli che non spedirebbero nulla.
   */
  readonly VITE_API_BASE?: string;

  /** Chiave pubblica di Cloudflare Turnstile. Facoltativa. */
  readonly VITE_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
