import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileJson,
  Filter,
  Globe2,
  ImagePlus,
  KeyRound,
  Mail,
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

type Role = 'Student' | 'PhD candidate' | 'Researcher' | 'Professional';
type ReviewStatus = 'approved' | 'pending';

type MasonryRecord = {
  id: string;
  title: string;
  location: string;
  country: string;
  lat: number;
  lng: number;
  period: string;
  technique: string;
  element: string;
  material: string;
  tags: string[];
  author: string;
  affiliation: string;
  status: ReviewStatus;
  image: string;
  notes: string;
  hasAlotiaJson: boolean;
};

const records: MasonryRecord[] = [
  {
    id: 'bol-arch-001',
    title: 'Segmental brick arch over service opening',
    location: 'Bologna',
    country: 'Italy',
    lat: 44.4949,
    lng: 11.3426,
    period: '19th century',
    technique: 'Brick masonry',
    element: 'Arch',
    material: 'Clay brick and lime mortar',
    tags: ['arch', 'brickwork', 'pressure-line candidate'],
    author: 'Giovanni Castellazzi',
    affiliation: 'University of Bologna',
    status: 'approved',
    image:
      'https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80',
    notes:
      'Regular voussoir courses and visible mortar joints suitable for a first geometric reading.',
    hasAlotiaJson: true,
  },
  {
    id: 'lis-wall-002',
    title: 'Mixed stone wall with brick repairs',
    location: 'Lisbon',
    country: 'Portugal',
    lat: 38.7223,
    lng: -9.1393,
    period: 'Early modern',
    technique: 'Mixed masonry',
    element: 'Wall',
    material: 'Limestone, brick, lime mortar',
    tags: ['stonework', 'repair', 'texture'],
    author: 'Public contributor',
    affiliation: 'Independent survey',
    status: 'approved',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
    notes:
      'Irregular units and later repairs make it useful for typological comparison.',
    hasAlotiaJson: false,
  },
  {
    id: 'cam-vault-003',
    title: 'Vault springing detail with mortar loss',
    location: 'Cambridge',
    country: 'United Kingdom',
    lat: 52.2053,
    lng: 0.1218,
    period: 'Medieval',
    technique: 'Ashlar masonry',
    element: 'Vault',
    material: 'Sandstone',
    tags: ['vault', 'ashlar', 'decay'],
    author: 'Doctoral fieldwork',
    affiliation: 'Architecture laboratory',
    status: 'pending',
    image:
      'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80',
    notes:
      'Pending moderation because the upload includes a request for structural interpretation.',
    hasAlotiaJson: false,
  },
];

const suggestedTags = [
  'arch',
  'vault',
  'brickwork',
  'stonework',
  'opus incertum',
  'opus reticulatum',
  'ashlar',
  'lime mortar',
  'crack pattern',
  'pressure-line candidate',
  'repair',
  'texture',
];

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
      const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
      const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length;
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
              position={[record.lat, record.lng]}
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
  const [activeView, setActiveView] = useState('Explore');
  const [selectedTag, setSelectedTag] = useState('all');
  const [role, setRole] = useState<Role>('Student');

  const visibleRecords = records.filter((record) =>
    selectedTag === 'all' ? true : record.tags.includes(selectedTag),
  );
  const approvedCount = records.filter(
    (record) => record.status === 'approved',
  ).length;
  const pendingCount = records.length - approvedCount;
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
            {['Explore', 'Upload', 'Admin', 'Data model'].map((item) => (
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

      <div className="mx-auto border-b px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-[1320px]">
          <h1 className="text-[calc(1.325rem+0.9vw)] font-semibold leading-tight">
            The Masonry Archive
          </h1>
          <p className="mt-1 max-w-3xl text-[1.05rem] font-normal text-muted-foreground">
            A public research archive for masonry photographs, location data,
            construction notes, and future aLoTiA records.
          </p>
          <p className="mt-3 text-sm">
            <a href="https://gcastellazzi.github.io">
              Giovanni Castellazzi
            </a>{' '}
            · Computational mechanics · Built heritage documentation
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1320px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                {suggestedTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ArchiveMap visibleRecords={visibleRecords} />
        </section>

        <aside className="grid gap-4 content-start">
          <section className="rounded-md border bg-card p-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Approved" value={approvedCount.toString()} />
              <Stat label="Pending" value={pendingCount.toString()} />
              <Stat label="Tags" value={suggestedTags.length.toString()} />
            </div>
          </section>

          {activeView === 'Explore' && (
            <section className="rounded-md border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Latest records</h2>
                <Globe2 className="size-4 text-muted-foreground" />
              </div>
              <div className="space-y-3">
                {visibleRecords.map((record) => (
                  <article key={record.id} className="record-card">
                    <img src={record.image} alt="" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`status-dot ${record.status}`} />
                        <span className="text-xs uppercase text-muted-foreground">
                          {record.status}
                        </span>
                      </div>
                      <h3>{record.title}</h3>
                      <p>
                        {record.location}, {record.country} - {record.period}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {record.tags.slice(0, 3).map((tag) => (
                          <span className="tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
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

          {activeView === 'Admin' && (
            <section className="rounded-md border bg-card p-4">
              <h2 className="mb-1 font-semibold">Admin review queue</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                New uploads notify the administrator by email before approval.
              </p>
              <div className="space-y-3">
                <AdminRow icon={<Mail />} text="Upload notification email" />
                <AdminRow icon={<ShieldCheck />} text="CAPTCHA before upload" />
                <AdminRow icon={<KeyRound />} text="Passwordless magic link" />
                <AdminRow icon={<Clock3 />} text="Deletion requires approval" />
              </div>
              <div className="mt-4 rounded-md border bg-muted/50 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="size-4" />
                  Pending moderation
                </div>
                <p className="text-sm text-muted-foreground">
                  {records.find((record) => record.status === 'pending')?.title}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm">
                    <Check />
                    Approve
                  </Button>
                  <Button size="sm" variant="outline">
                    Request edits
                  </Button>
                </div>
              </div>
            </section>
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
                <AdminRow icon={<FileJson />} text="Optional aLoTiA JSON link" />
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

      <section className="mx-auto grid max-w-[1320px] gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-3">
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
      </section>
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
