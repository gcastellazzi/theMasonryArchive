import { DivIcon } from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Marker as LeafletMarker } from 'leaflet';

import { Button } from '@/components/ui/button';
import { hasValidPosition, type MasonryRecord } from '../types';
import { nearestLocated } from './groups';

/**
 * Posizionamento di una foto trascinando un segnaposto.
 *
 * Senza coordinate un record non e' approvabile, e digitare latitudine e
 * longitudine a mano per centoventi foto e' impraticabile: non si ricordano a
 * memoria, e un refuso sulla quarta cifra sposta il punto di un chilometro
 * senza che nulla lo segnali. Sulla mappa l'errore si vede.
 *
 * I campi numerici restano accanto e restano la fonte del dato: la mappa li
 * scrive, non li sostituisce.
 */

/** Centro di ripiego quando non c'e' nessun appiglio: l'Europa. */
const FALLBACK: [number, number] = [45, 8];
const FALLBACK_ZOOM = 4;
const PLACED_ZOOM = 16;

const pinIcon = new DivIcon({
  className: '',
  html: '<span class="map-pin"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/**
 * Riporta la mappa sul punto quando si cambia foto, o quando si copia una
 * posizione da uno scatto vicino.
 *
 * Volutamente non reagisce allo spostamento del segnaposto: seguire ogni
 * trascinamento rimetterebbe la vista al centro a meta' gesto, e chi sta
 * aggiustando la posizione perderebbe di vista il punto di riferimento.
 */
function Recenter({
  trigger,
  center,
  zoom,
}: {
  trigger: string;
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === trigger) return;
    last.current = trigger;
    map.setView(center, zoom);
  }, [trigger, center, zoom, map]);
  return null;
}

export function PositionPicker({
  record,
  records,
  onPick,
}: {
  record: MasonryRecord;
  records: MasonryRecord[];
  onPick: (lat: number, lng: number) => void;
}) {
  // Cambiare foto, o copiare una posizione, rimette la mappa al centro; il
  // trascinamento del segnaposto no.
  const [recenters, setRecenters] = useState(0);
  const placed = hasValidPosition(record);
  const neighbour = useMemo(
    () => (placed ? null : nearestLocated(record, records)),
    [placed, record, records],
  );

  const center: [number, number] = placed
    ? [record.lat as number, record.lng as number]
    : neighbour
      ? [neighbour.lat as number, neighbour.lng as number]
      : FALLBACK;
  const zoom = placed ? PLACED_ZOOM : neighbour ? 14 : FALLBACK_ZOOM;

  return (
    <div className="space-y-2">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="h-[220px] w-full overflow-hidden rounded-md border"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter trigger={`${record.id}:${recenters}`} center={center} zoom={zoom} />
        <ClickToPlace onPick={onPick} />
        {placed && (
          <Marker
            draggable
            position={[record.lat as number, record.lng as number]}
            icon={pinIcon}
            eventHandlers={{
              dragend(event) {
                const { lat, lng } = (event.target as LeafletMarker).getLatLng();
                onPick(lat, lng);
              },
            }}
          />
        )}
      </MapContainer>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {placed
            ? 'Drag the pin, or click the map, to correct the position.'
            : 'Click the map to place this photo.'}
        </p>
        {neighbour && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            title={`${neighbour.location || neighbour.id} · ${neighbour.capturedAt?.slice(0, 16) ?? ''}`}
            onClick={() => {
              onPick(neighbour.lat as number, neighbour.lng as number);
              setRecenters((count) => count + 1);
            }}
          >
            Copy from nearest shot
          </Button>
        )}
      </div>
    </div>
  );
}
