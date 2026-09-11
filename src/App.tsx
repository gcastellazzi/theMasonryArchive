import {
  ChevronRight,
  Database,
  FileJson,
  Filter,
  Globe2,
  ImagePlus,
  MapPin,
  ShieldCheck,
  Upload,
  UserRound,
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
import type { MasonryRecord, ReviewStatus, Role, Suggestion } from './types';
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

function ArchiveMap({ visibleRecords }: { visibleRecords: MasonryRecord[] }) {
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
                <strong>{group[0].country}</strong>
                <br />
                {group.length} archive record{group.length > 1 ? 's' : ''}
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
                <strong>{record.title}</strong>
                <br />
                {record.location}, {record.country}
              </Popup>
            </Marker>
          ))}
    </MapContainer>
  );
}

function App() {
  const [activeView, setActiveView] = useState('Home');
  const [selectedTag, setSelectedTag] = useState('all');
  const [role, setRole] = useState<Role>('Student');
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
  const approvedCount = records.filter(
    (record) => record.status === 'approved',
  ).length;
  const pendingCount = records.filter((r) => r.status === 'pending').length;
  const roleNeedsResearchFields =
    role === 'Researcher' || role === 'PhD candidate';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-primary/30 bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
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
                onClick={() => setActiveView(item)}
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
          <Button
            onClick={() => setActiveView('Upload')}
            className="bg-white text-primary hover:bg-white/90"
          >
            <ImagePlus />
            Contribute
          </Button>
        </div>
      </header>

      <div
        className={`mx-auto grid max-w-[1320px] gap-4 px-4 pt-4 sm:px-6 ${
          (ADMIN_ENABLED && activeView === 'Admin') || activeView === 'Credits'
            ? ''
            : 'lg:grid-cols-[minmax(0,1fr)_360px]'
        }`}
      >
        <div
          className="min-w-0"
          hidden={
            (ADMIN_ENABLED && activeView === 'Admin') ||
            activeView === 'Credits'
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
                  onChange={(event) => setSelectedTag(event.target.value)}
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
            <ArchiveMap visibleRecords={visibleRecords} />
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

        <aside className="grid gap-4 content-start">
          {activeView !== 'Credits' && (
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
            <section className="rounded-md border bg-card p-4">
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
                className="tag-cloud"
                aria-label="Tags used in public records"
              >
                <button
                  type="button"
                  className={selectedTag === 'all' ? 'selected' : ''}
                  aria-pressed={selectedTag === 'all'}
                  onClick={() => setSelectedTag('all')}
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
                      onClick={() => setSelectedTag(tag)}
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

          {activeView === 'Suggest' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-3 font-semibold">
                Proponi un tag o una correzione
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
              <h2 className="mb-1 font-semibold">Contribute an image</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Uploads require registration and are reviewed before becoming
                public.
              </p>
              <div className="grid gap-3">
                <label className="field">
                  Role
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                  >
                    <option>Student</option>
                    <option>PhD candidate</option>
                    <option>Researcher</option>
                    <option>Professional</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="field">
                    First name
                    <input placeholder="Ada" />
                  </label>
                  <label className="field">
                    Last name
                    <input placeholder="Lovelace" />
                  </label>
                </div>
                <label className="field">
                  Email
                  <input placeholder="name@university.edu" type="email" />
                </label>
                <label className="field">
                  University
                  <input placeholder="University or institution" />
                </label>
                {roleNeedsResearchFields && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="field">
                      ORCID
                      <input placeholder="0000-0000-0000-0000" />
                    </label>
                    <label className="field">
                      Laboratory
                      <input placeholder="Lab or research group" />
                    </label>
                  </div>
                )}
                <label className="field">
                  Image file
                  <input accept="image/jpeg,image/png,image/webp" type="file" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="field">
                    Latitude
                    <input placeholder="44.4949" />
                  </label>
                  <label className="field">
                    Longitude
                    <input placeholder="11.3426" />
                  </label>
                </div>
                <label className="field">
                  Notes
                  <textarea placeholder="Why was the photo taken? What masonry feature should be observed?" />
                </label>
                <label className="license-check">
                  <input type="checkbox" />
                  <span>
                    I confirm that I own the image or have the right to publish
                    it, and I agree to release the contribution under the
                    archive content license.
                  </span>
                </label>
                <Button>
                  <Upload />
                  Submit for review
                </Button>
              </div>
            </section>
          )}

          {ADMIN_ENABLED && activeView === 'Admin' && (
            <div className="space-y-3">
              <div className="rounded-md border bg-card p-4">
                <h2 className="mb-1 font-semibold">Admin review queue</h2>
                <p className="text-sm text-muted-foreground">
                  Rullino, anteprima e catalogazione. Le modifiche restano in
                  bozza nel browser: &laquo;Esporta JSON&raquo; scarica
                  <code className="mx-1">records.json</code> e
                  <code className="mx-1">suggestions.json</code> da salvare in
                  <code className="mx-1">src/data/</code>.
                </p>
              </div>
              <AdminPanel
                initialRecords={records}
                initialSuggestions={liveSuggestions}
                initialExcluded={excluded}
                tagVocabulary={TAGS}
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
        <section className="mx-auto max-w-[1320px] px-4 pb-8 pt-2 sm:px-6">
          <div className="flex items-baseline justify-between gap-3 border-b pb-3">
            <h2 className="text-xl font-semibold">
              {selectedTag === 'all' ? 'All photos' : `Tagged “${selectedTag}”`}
            </h2>
            <span className="text-sm text-muted-foreground">
              {visibleRecords.length}{' '}
              {visibleRecords.length === 1 ? 'photo' : 'photos'}
            </span>
          </div>
          <div className="thumbnail-grid mt-4">
            {visibleRecords.map((record) => (
              <a
                key={record.id}
                className="thumbnail-card"
                href={`${BASE}${record.image}`}
                target="_blank"
                rel="noreferrer"
                title={`${record.title} — ${record.location}, ${record.country}`}
              >
                {/* eslint-disable-next-line next/no-img-element */}
                <img
                  src={`${BASE}${record.thumbnail}`}
                  alt={record.title}
                  loading="lazy"
                />
                <span>{record.title}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
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
    <article className="rounded-md border bg-card p-4">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4">
        {icon}
      </div>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
    </article>
  );
}

export default App;
