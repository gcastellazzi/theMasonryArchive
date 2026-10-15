import {
  ArrowLeft,
  ChevronRight,
  Database,
  ExternalLink,
  FileJson,
  Filter,
  Globe2,
  ImagePlus,
  MapPin,
  Menu,
  Pencil,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { DivIcon } from 'leaflet';
import { useMemo, useState } from 'react';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { AdminPanel } from './AdminPanel';
import { SuggestForm } from './SuggestForm';
import { CitationPanel } from './CitationPanel';
import rawRecords from './data/records.json';
import rawSuggestions from './data/suggestions.json';
import rawExcluded from './data/excluded.json';
import type { MasonryRecord, ReviewStatus, Suggestion } from './types';
import { TAGS } from './vocabulary';

const records = rawRecords as unknown as MasonryRecord[];
const suggestions = rawSuggestions as unknown as Suggestion[];
const excluded = rawExcluded as string[];
const BASE = import.meta.env.BASE_URL;

// Il pannello di amministrazione esiste solo quando il sito gira in locale
// (`npm run dev`). Nel build di produzione la voce di menu non viene generata
// e il ramo che la rende viene eliminato dal bundle. Non e' autenticazione —
// su un sito statico non puo' esserlo — ma toglie il pannello dal sito
// pubblicato, dove chiunque potrebbe altrimenti aprirlo.
const ADMIN_ENABLED = import.meta.env.DEV;

const VIEWS = ADMIN_ENABLED
  ? ['Home', 'Explore', 'Suggest', 'Upload', 'Credits', 'Admin', 'Data model']
  : ['Home', 'Explore', 'Suggest', 'Upload', 'Credits', 'Data model'];

const schemaFields = [
  'id',
  'title',
  'imageUrl',
  'thumbnailUrl',
  'latitude',
  'longitude',
  'placeName',
  'shotDate',
  'period',
  'technique',
  'element',
  'material',
  'tags',
  'notes',
  'license',
  'reviewStatus',
  'alotiaJsonUrl',
  'authorProfileId',
];

function makeClusterIcon(count: number, status: ReviewStatus) {
  return new DivIcon({
    className: '',
    html: `<span class="map-cluster ${status}">${count}</span>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function makeMarkerIcon(status: ReviewStatus) {
  return new DivIcon({
    className: '',
    html: `<span class="map-pin ${status}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function MapZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({
    zoomend(event) {
      onZoom(event.target.getZoom());
    },
  });

  return null;
}

function ArchiveMap({
  visibleRecords,
  onSelectRecords,
}: {
  visibleRecords: MasonryRecord[];
  onSelectRecords: (records: MasonryRecord[]) => void;
}) {
  const [zoom, setZoom] = useState(3);
  const clustered = zoom < 5;

  const clusterGroups = useMemo(() => {
    const groups = new Map<string, MasonryRecord[]>();
    visibleRecords.forEach((record) => {
      const key = record.country;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    });
    return [...groups.values()].map((group) => {
      const lat =
        group.reduce((sum, item) => sum + (item.lat ?? 0), 0) / group.length;
      const lng =
        group.reduce((sum, item) => sum + (item.lng ?? 0), 0) / group.length;
      return { lat, lng, group };
    });
  }, [visibleRecords]);

  return (
    <MapContainer
      center={[45, 8]}
      zoom={3}
      minZoom={2}
      scrollWheelZoom
      className="archive-map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapZoomWatcher onZoom={setZoom} />
      {clustered
        ? clusterGroups.map(({ lat, lng, group }) => (
            <Marker
              key={group.map((item) => item.id).join('-')}
              position={[lat, lng]}
              icon={makeClusterIcon(group.length, group[0].status)}
            >
              <Popup>
                <button
                  type="button"
                  className="map-popup-link"
                  onClick={() => onSelectRecords(group)}
                >
                  <strong>{group[0].country}</strong>
                  <span>
                    View {group.length} archive photo
                    {group.length > 1 ? 's' : ''}
                  </span>
                </button>
              </Popup>
            </Marker>
          ))
        : visibleRecords.map((record) => (
            <Marker
              key={record.id}
              position={[record.lat as number, record.lng as number]}
              icon={makeMarkerIcon(record.status)}
            >
              <Popup>
                <button
                  type="button"
                  className="map-popup-link"
                  onClick={() => onSelectRecords([record])}
                >
                  <strong>{record.title}</strong>
                  <span>
                    {record.location}, {record.country} · View photo
                  </span>
                </button>
              </Popup>
            </Marker>
          ))}
    </MapContainer>
  );
}

function App() {
  const [activeView, setActiveView] = useState('Home');
  const [selectedTag, setSelectedTag] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState<MasonryRecord | null>(
    null,
  );
  const [mapRecordIds, setMapRecordIds] = useState<string[] | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [liveSuggestions, setLiveSuggestions] =
    useState<Suggestion[]>(suggestions);

  const publicRecords = records.filter(
    (record) =>
      record.status === 'approved' &&
      record.lat !== null &&
      record.lng !== null,
  );
  const visibleRecords = publicRecords.filter((record) =>
    selectedTag === 'all'
      ? true
      : record.tags.some((tag) => tag.trim() === selectedTag),
  );
  const activeTags = [
    ...publicRecords.reduce((counts, record) => {
      record.tags.forEach((rawTag) => {
        const tag = rawTag.trim();
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
      return counts;
    }, new Map<string, number>()),
  ]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const largestTagCount = activeTags[0]?.count ?? 1;
  const galleryRecords = mapRecordIds
    ? visibleRecords.filter((record) => mapRecordIds.includes(record.id))
    : visibleRecords;
  const approvedCount = records.filter(
    (record) => record.status === 'approved',
  ).length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;

  function selectView(view: string) {
    setActiveView(view);
    setMobileMenuOpen(false);
  }

  function selectTag(tag: string) {
    setSelectedTag(tag);
    setMapRecordIds(null);
  }

  function showRecordsFromMap(mapRecords: MasonryRecord[]) {
    setMapRecordIds(mapRecords.map((record) => record.id));
    setActiveView('Explore');
    setMobileMenuOpen(false);
    window.setTimeout(
      () =>
        document
          .getElementById('photo-gallery')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-primary/30 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">
                  The Masonry Archive
                </p>
                <p className="hidden text-xs text-primary-foreground/75 sm:block">
                  Open, moderated, geolocated masonry image records
                </p>
              </div>
            </div>
            <nav className="hidden items-center gap-1 md:flex">
              {VIEWS.map((item) => (
                <Button
                  key={item}
                  variant="ghost"
                  onClick={() => selectView(item)}
                  className={
                    activeView === item
                      ? 'bg-white/15 text-white hover:bg-white/20 hover:text-white'
                      : 'text-white/85 hover:bg-white/10 hover:text-white'
                  }
                >
                  {item}
                </Button>
              ))}
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => selectView('Upload')}
                className="hidden bg-white text-primary hover:bg-white/90 sm:inline-flex"
              >
                <ImagePlus />
                Contribute
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/15 hover:text-white md:hidden"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation"
                onClick={() => setMobileMenuOpen((open) => !open)}
              >
                {mobileMenuOpen ? <X /> : <Menu />}
              </Button>
            </div>
          </div>

          {mobileMenuOpen && (
            <nav
              id="mobile-navigation"
              className="grid grid-cols-2 gap-1 border-t border-white/20 py-2 md:hidden"
            >
              {VIEWS.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() => selectView(item)}
                  className={`rounded-md px-3 py-2.5 text-left text-sm font-semibold ${
                    activeView === item
                      ? 'bg-white/20 text-white'
                      : 'text-white/85 hover:bg-white/10'
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-[1320px] gap-4 px-4 pt-4 sm:px-6 ${
          (ADMIN_ENABLED && activeView === 'Admin') ||
          activeView === 'Credits' ||
          activeView === 'Record'
            ? ''
            : 'lg:grid-cols-[minmax(0,1fr)_360px]'
        }`}
      >
        <div
          className="min-w-0"
          hidden={
            (ADMIN_ENABLED && activeView === 'Admin') ||
            activeView === 'Credits' ||
            activeView === 'Record'
          }
        >
          <section className="min-h-[520px] overflow-hidden rounded-md border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h2 className="text-[1.45rem] font-semibold leading-tight">
                  World masonry image map
                </h2>
                <p className="text-sm text-muted-foreground">
                  Public records appear after review. Zoom in to split clustered
                  records into individual images.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-muted-foreground" />
                <select
                  value={selectedTag}
                  onChange={(event) => selectTag(event.target.value)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="all">All tags</option>
                  {activeTags.map(({ tag, count }) => (
                    <option key={tag} value={tag}>
                      {tag} ({count})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ArchiveMap
              visibleRecords={visibleRecords}
              onSelectRecords={showRecordsFromMap}
            />
          </section>
          <p className="px-1 py-3 text-sm text-muted-foreground">
            <a
              href="https://gcastellazzi.github.io"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              Giovanni Castellazzi
            </a>{' '}
            · Computational mechanics · Built heritage documentation
          </p>
        </div>

        <aside
          className={`grid gap-4 content-start ${
            activeView === 'Explore' ? 'explore-sidebar' : ''
          }`}
        >
          {activeView !== 'Credits' && activeView !== 'Record' && (
            <section className="rounded-md border bg-card p-4">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Approved" value={approvedCount.toString()} />
                <Stat label="Pending" value={pendingCount.toString()} />
                <Stat label="Tags" value={activeTags.length.toString()} />
              </div>
            </section>
          )}

          {activeView === 'Home' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-3 text-lg font-semibold">About the archive</h2>
              <div className="grid gap-3">
                <Feature
                  icon={<ShieldCheck />}
                  title="Publication policy"
                  text="Source code can use MIT. Images and notes should use a content license such as CC BY 4.0 or CC0, accepted during upload."
                />
                <Feature
                  icon={<ImagePlus />}
                  title="Image limits"
                  text="Initial proposal: JPG, PNG, or WebP; max 12 MB original; generated public thumbnails around 1600 px and 480 px."
                />
                <Feature
                  icon={<ChevronRight />}
                  title="aLoTiA bridge"
                  text="When the image is tagged as an arch, the record can suggest aLoTiA and attach a JSON file for pressure-line study."
                />
              </div>
            </section>
          )}

          {activeView === 'Explore' && (
            <section className="explore-tag-panel rounded-md border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Explore by tag</h2>
                  <p className="text-xs text-muted-foreground">
                    Larger tags occur in more records.
                  </p>
                </div>
                <Globe2 className="size-4 text-muted-foreground" />
              </div>
              <div
                className="tag-cloud explore-tag-scroll"
                aria-label="Tags used in public records"
              >
                <button
                  type="button"
                  className={selectedTag === 'all' ? 'selected' : ''}
                  aria-pressed={selectedTag === 'all'}
                  onClick={() => selectTag('all')}
                >
                  All <span>{publicRecords.length}</span>
                </button>
                {activeTags.map(({ tag, count }) => {
                  const weight =
                    Math.log(count + 1) / Math.log(largestTagCount + 1);
                  return (
                    <button
                      type="button"
                      key={tag}
                      className={selectedTag === tag ? 'selected' : ''}
                      aria-pressed={selectedTag === tag}
                      aria-label={`${tag}: ${count} photos`}
                      onClick={() => selectTag(tag)}
                      style={{ fontSize: `${0.75 + weight * 0.55}rem` }}
                    >
                      {tag} <span>{count}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {activeView === 'Credits' && <CitationPanel />}

          {activeView === 'Record' && selectedRecord && (
            <RecordDetail
              record={selectedRecord}
              onBack={() => setActiveView('Explore')}
              onEdit={
                ADMIN_ENABLED
                  ? () => {
                      setActiveView('Admin');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  : undefined
              }
            />
          )}

          {activeView === 'Suggest' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-3 font-semibold">
                Suggest a tag or correction
              </h2>
              <SuggestForm
                records={publicRecords}
                onSubmit={(suggestion) =>
                  setLiveSuggestions((current) => [suggestion, ...current])
                }
              />
            </section>
          )}

          {activeView === 'Upload' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-1 font-semibold">Contribute through Telegram</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                The quickest way to send photos is our Telegram bot. Every photo
                is reviewed by hand before it becomes public.
              </p>
              <div className="flex flex-wrap items-start gap-6">
                <a
                  className="block w-44 shrink-0 rounded-md border bg-white p-2"
                  href="https://t.me/the_masonry_archive_bot"
                  rel="noreferrer"
                  target="_blank"
                >
                  <img
                    alt="QR code that opens the Telegram bot @the_masonry_archive_bot"
                    className="block w-full"
                    height={160}
                    src={`${import.meta.env.BASE_URL}telegram-bot-qr.svg`}
                    width={160}
                  />
                </a>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="mb-2">
                    Scan the code or open{' '}
                    <a
                      className="font-medium underline underline-offset-2"
                      href="https://t.me/the_masonry_archive_bot"
                      rel="noreferrer"
                      target="_blank"
                    >
                      @the_masonry_archive_bot
                    </a>
                    , then tap <strong>Start</strong>.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>
                      <span className="text-foreground">Have an invitation code?</span>{' '}
                      Type it in the chat.
                    </li>
                    <li>
                      <span className="text-foreground">No code?</span> Write in one
                      message who you are (name, institution, role) and why you
                      would like to contribute. The administrator will reply in the
                      chat.
                    </li>
                    <li>
                      Choose Italian or English, register, and send your photos{' '}
                      <span className="text-foreground">as files</span>, so they keep
                      their GPS position. Add a comment saying why each photo
                      matters, for example “evident decay of the mortar joints”.
                    </li>
                  </ol>
                </div>
              </div>
            </section>
          )}

          {ADMIN_ENABLED && activeView === 'Admin' && (
            <div className="space-y-3">
              <div className="rounded-md border bg-card p-4">
                <h2 className="mb-1 font-semibold">Admin review queue</h2>
                <p className="text-sm text-muted-foreground">
                  Photo strip, preview and cataloguing. Changes remain as a
                  browser draft: the JSON export downloads
                  <code className="mx-1">records.json</code> and
                  <code className="mx-1">suggestions.json</code> to be saved in
                  <code className="mx-1">src/data/</code>.
                </p>
              </div>
              <AdminPanel
                initialRecords={records}
                initialSuggestions={liveSuggestions}
                initialExcluded={excluded}
                tagVocabulary={TAGS}
                initialSelectedId={selectedRecord?.id}
              />
            </div>
          )}

          {activeView === 'Data model' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-1 font-semibold">Data model</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Recommended static frontend plus external services for auth,
                email, storage, and moderation.
              </p>
              <div className="space-y-3">
                <AdminRow icon={<Database />} text="GitHub Pages frontend" />
                <AdminRow
                  icon={<FileJson />}
                  text="Optional aLoTiA JSON link"
                />
                <AdminRow icon={<MapPin />} text="OpenStreetMap coordinates" />
                <AdminRow icon={<UserRound />} text="Minimal public profiles" />
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {schemaFields.map((field) => (
                  <span className="tag" key={field}>
                    {field}
                  </span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {activeView === 'Explore' && (
        <section
          id="photo-gallery"
          className="mx-auto max-w-[1320px] scroll-mt-20 px-4 pb-8 pt-2 sm:px-6"
        >
          <div className="flex items-baseline justify-between gap-3 border-b pb-3">
            <div>
              <h2 className="text-xl font-semibold">
                {mapRecordIds
                  ? 'Photos selected on the map'
                  : selectedTag === 'all'
                    ? 'All photos'
                    : `Tagged “${selectedTag}”`}
              </h2>
              {mapRecordIds && (
                <button
                  type="button"
                  className="mt-1 text-sm font-semibold text-primary hover:underline"
                  onClick={() => setMapRecordIds(null)}
                >
                  Show all filtered photos
                </button>
              )}
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {galleryRecords.length}{' '}
              {galleryRecords.length === 1 ? 'photo' : 'photos'}
            </span>
          </div>
          <div className="thumbnail-grid mt-4">
            {galleryRecords.map((record) => (
              <button
                type="button"
                key={record.id}
                className="thumbnail-card"
                title={`${record.title} — ${record.location}, ${record.country}`}
                onClick={() => {
                  setSelectedRecord(record);
                  setActiveView('Record');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {/* eslint-disable-next-line next/no-img-element */}
                <img
                  src={`${BASE}${record.thumbnail}`}
                  alt={record.title}
                  loading="lazy"
                />
                <span>{record.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function RecordDetail({
  record,
  onBack,
  onEdit,
}: {
  record: MasonryRecord;
  onBack: () => void;
  onEdit?: () => void;
}) {
  const details = [
    [
      'Location',
      [record.location, record.state, record.country]
        .filter(Boolean)
        .join(', '),
    ],
    [
      'Coordinates',
      record.lat !== null && record.lng !== null
        ? `${record.lat.toFixed(6)}, ${record.lng.toFixed(6)}`
        : '',
    ],
    ['Period', record.period],
    ['Element', record.element],
    ['Technique', record.technique],
    ['Material', record.material],
    ['Captured', record.capturedAt ? record.capturedAt.slice(0, 10) : ''],
    ['Camera', record.camera ?? ''],
    [
      'Image dimensions',
      record.width && record.height
        ? `${record.width} × ${record.height} px`
        : '',
    ],
    ['Altitude', record.altitude != null ? `${record.altitude} m` : ''],
    ['Bearing', record.bearing != null ? `${record.bearing.toFixed(0)}°` : ''],
    ['Author', [record.author, record.affiliation].filter(Boolean).join(' · ')],
    ['Licence', record.license ?? ''],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  return (
    <article className="rounded-md border bg-card p-4 sm:p-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="size-4" />
        Back to Explore
      </button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
        <figure className="min-w-0">
          <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-md bg-muted">
            {/* La derivata da 480 px e' versionata e quindi sempre disponibile
                anche sul sito statico pubblicato. */}
            {/* eslint-disable-next-line next/no-img-element */}
            <img
              src={`${BASE}${record.thumbnail}`}
              alt={record.title}
              className="max-h-[76vh] w-full object-contain"
            />
          </div>
          <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {record.location}, {record.country}
            </span>
            <a
              href={`${BASE}${record.thumbnail}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline"
            >
              View full image
              <ExternalLink className="size-3.5" />
            </a>
          </figcaption>
        </figure>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Archive record
            </p>
            {onEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onEdit}
              >
                <Pencil />
                Edit in Admin
              </Button>
            )}
          </div>
          <h1 className="mt-1 text-3xl font-semibold leading-tight">
            {record.title}
          </h1>
          {record.notes && (
            <p className="mt-4 leading-7 text-muted-foreground">
              {record.notes}
            </p>
          )}

          <dl className="mt-6 divide-y rounded-md border">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="grid gap-1 px-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]"
              >
                <dt className="text-xs font-semibold uppercase text-muted-foreground">
                  {label}
                </dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {record.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          {record.hasAlotiaJson && record.alotiaJsonUrl && (
            <a
              href={record.alotiaJsonUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Open aLoTiA record
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted p-3">
      <p className="text-2xl font-semibold text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AdminRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background p-3 text-sm">
      <span className="text-primary [&_svg]:size-4">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="flex items-start gap-3 rounded-md border bg-card p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold leading-5">{title}</h2>
        <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{text}</p>
      </div>
    </article>
  );
}

export default App;
