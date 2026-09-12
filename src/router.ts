import { useMemo, useSyncExternalStore } from 'react';

/**
 * Routing basato sul frammento di URL.
 *
 * Il sito e' statico e servito da GitHub Pages, che non sa riscrivere gli URL:
 * un percorso vero (`/record/xyz`) risponderebbe 404 al ricaricamento della
 * pagina. L'hash resta quindi l'unica forma di permalink possibile senza un
 * server, ed e' quanto basta per mandare a qualcuno il link di una foto e per
 * far atterrare il magic link dell'autenticazione su una pagina che sa cosa
 * farne.
 *
 * La rotta e' un oggetto piatto e non una unione discriminata perche' il
 * layout tiene la mappa accanto a quasi tutte le viste: il filtro per tag e la
 * selezione fatta sulla mappa sono trasversali, non proprieta' di Explore.
 */

export type ViewName =
  | 'Home'
  | 'Explore'
  | 'Record'
  | 'Suggest'
  | 'Upload'
  | 'Credits'
  | 'Data model'
  | 'Admin'
  | 'Auth';

export type Route = {
  view: ViewName;
  /** Tag selezionato, `all` quando non filtra. */
  tag: string;
  /** Record scelti sulla mappa, `null` quando la selezione non e' attiva. */
  ids: string[] | null;
  /** Record aperto, quando `view` e' `Record`. */
  recordId?: string;
  /** Record da preselezionare nel pannello admin. */
  adminId?: string;
  /** Token monouso del magic link, quando `view` e' `Auth`. */
  token?: string;
};

/** Etichetta di menu -> percorso, per le viste raggiungibili dalla barra. */
export const VIEW_PATHS: Record<string, string> = {
  'Home': '/',
  'Explore': '/explore',
  'Suggest': '/suggest',
  'Upload': '/upload',
  'Credits': '/credits',
  'Admin': '/admin',
  'Data model': '/data-model',
};

const PATH_VIEWS: Record<string, ViewName> = {
  'explore': 'Explore',
  'suggest': 'Suggest',
  'upload': 'Upload',
  'credits': 'Credits',
  'data-model': 'Data model',
};

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search] = raw.split('?');
  const query = new URLSearchParams(search ?? '');
  const segments = path.split('/').filter(Boolean);
  const ids = query.get('ids');

  const base: Route = {
    view: 'Home',
    tag: query.get('tag') ?? 'all',
    ids: ids ? ids.split(',').filter(Boolean) : null,
  };

  const head = segments[0];
  if (!head) return base;

  if (head === 'record' && segments[1]) {
    return { ...base, view: 'Record', recordId: decodeURIComponent(segments[1]) };
  }
  if (head === 'admin') {
    const id = query.get('id');
    return { ...base, view: 'Admin', adminId: id ?? undefined };
  }
  if (head === 'auth') {
    const token = query.get('token');
    return token ? { ...base, view: 'Auth', token } : base;
  }
  const view = PATH_VIEWS[head];
  return view ? { ...base, view } : base;
}

export function formatRoute(route: Route): string {
  const query = new URLSearchParams();
  if (route.tag && route.tag !== 'all') query.set('tag', route.tag);
  if (route.ids?.length) query.set('ids', route.ids.join(','));

  let path: string;
  switch (route.view) {
    case 'Record':
      // Senza un record da mostrare la vista non esiste: si torna a Explore.
      if (!route.recordId) return formatRoute({ ...route, view: 'Explore' });
      path = `/record/${encodeURIComponent(route.recordId)}`;
      break;
    case 'Admin':
      path = '/admin';
      if (route.adminId) query.set('id', route.adminId);
      break;
    case 'Auth':
      path = '/auth';
      if (route.token) query.set('token', route.token);
      break;
    default:
      path = VIEW_PATHS[route.view] ?? '/';
  }

  const search = query.toString();
  return `#${path}${search ? `?${search}` : ''}`;
}

/**
 * Sposta la navigazione. `replace` serve a togliere dalla cronologia un URL
 * che non va rivisitato: il magic link porta un token monouso, e un tasto
 * indietro che lo ripresenta fallirebbe.
 */
export function navigate(route: Route, options?: { replace?: boolean }): void {
  const hash = formatRoute(route);
  if (hash === window.location.hash) return;
  if (options?.replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = hash;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getSnapshot(): string {
  return window.location.hash;
}

/** Fuori dal browser non c'e' un hash: la vista iniziale e' la home. */
function getServerSnapshot(): string {
  return '';
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => parseRoute(hash), [hash]);
}
