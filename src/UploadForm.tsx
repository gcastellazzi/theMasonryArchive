import { Check, ImagePlus, LogOut, MapPin, Upload as UploadIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  apiEnabled, myUploads, signOut, updateProfile, uploadPhoto,
  useSession, type Submission,
} from './auth';
import { SignIn } from './SignIn';
import type { Role } from './types';

/**
 * Contribuire una foto.
 *
 * Il modulo chiede il minimo indispensabile perche' la foto sia utile: dove e'
 * stata scattata e cosa va guardato. Tutto il resto — tecnica, elemento,
 * epoca, tag — lo scrive chi cataloga, che ha il vocabolario sotto mano e il
 * resto dell'archivio con cui confrontarsi.
 */

/** Oltre questa dimensione la foto viene ridotta prima di partire. */
const MAX_BYTES = 12 * 1024 * 1024;
const RESIZE_EDGE = 2400;

type Exif = {
  lat: number | null;
  lng: number | null;
  capturedAt: string | null;
  camera: string | null;
};

const EMPTY_EXIF: Exif = { lat: null, lng: null, capturedAt: null, camera: null };

/**
 * Legge i metadati di scatto nel browser.
 *
 * Senza questo passaggio le coordinate andrebbero digitate a mano, ed e' la
 * ragione principale per cui un contributo arriverebbe senza posizione — un
 * record senza posizione non e' pubblicabile. `exifr` si carica solo quando
 * serve davvero, cioe' quando qualcuno sceglie un file.
 */
async function readExif(file: File): Promise<Exif> {
  try {
    const { default: exifr } = await import('exifr');

    // Le coordinate si chiedono con `gps()`, non con `parse({pick})`:
    // `latitude` e `longitude` non sono tag EXIF ma valori che exifr calcola
    // dal blocco GPS, e un `pick` per nome di tag li esclude sempre — l'EXIF
    // viene letto, la posizione no.
    const [gps, tags] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr
        .parse(file, { pick: ['DateTimeOriginal', 'Make', 'Model'] })
        .catch(() => null),
    ]);

    const camera = [tags?.Make, tags?.Model]
      .filter(Boolean)
      .join(' ')
      // Alcune fotocamere ripetono la marca dentro il modello.
      .replace(/(\w+) \1/i, '$1');

    return {
      lat: Number.isFinite(gps?.latitude) ? (gps?.latitude ?? null) : null,
      lng: Number.isFinite(gps?.longitude) ? (gps?.longitude ?? null) : null,
      capturedAt:
        tags?.DateTimeOriginal instanceof Date
          ? tags.DateTimeOriginal.toISOString()
          : null,
      camera: camera || null,
    };
  } catch {
    // Un file senza EXIF, o con un EXIF illeggibile, resta caricabile: si
    // chiede la posizione a mano.
    return EMPTY_EXIF;
  }
}

/**
 * Riduce la foto solo se supera il limite.
 *
 * Il ridimensionamento passa da un canvas e quindi perde l'EXIF: per questo i
 * metadati si leggono prima, e viaggiano come campi del modulo.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, RESIZE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('resize failed'))),
      'image/jpeg',
      0.85,
    );
  });
}

export function UploadForm() {
  const { contributor, signedIn } = useSession();

  const [file, setFile] = useState<File | null>(null);
  const [exif, setExif] = useState<Exif>(EMPTY_EXIF);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [notes, setNotes] = useState('');
  const [licenceOk, setLicenceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [mine, setMine] = useState<Submission[]>([]);

  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    affiliation: '',
    role: 'Student' as Role,
    orcid: '',
    lab: '',
  });

  // Quando si entra, i campi si riempiono col profilo salvato. E' il pattern
  // che React documenta per riallineare uno stato a una prop che cambia:
  // farlo in un effetto costerebbe un render in piu' con i campi vuoti.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (contributor && contributor.id !== loadedFor) {
    setLoadedFor(contributor.id);
    setProfile({
      firstName: contributor.firstName,
      lastName: contributor.lastName,
      affiliation: contributor.affiliation,
      role: contributor.role,
      orcid: contributor.orcid,
      lab: contributor.lab,
    });
  }

  useEffect(() => {
    if (!contributor) return;
    void myUploads()
      .then(setMine)
      .catch(() => setMine([]));
  }, [contributor]);

  // L'anteprima e' un blob URL: va rilasciato, altrimenti ogni file scelto
  // lascia in memoria quello precedente.
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const needsResearchFields =
    profile.role === 'Researcher' || profile.role === 'PhD candidate';

  async function choose(chosen: File | null) {
    setFile(chosen);
    setError(null);
    setDone(false);
    if (!chosen) {
      setExif(EMPTY_EXIF);
      return;
    }
    const found = await readExif(chosen);
    setExif(found);
    if (found.lat !== null) setLat(String(found.lat));
    if (found.lng !== null) setLng(String(found.lng));
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !licenceOk || busy) return;

    setBusy(true);
    setError(null);
    try {
      await updateProfile(profile);

      const payload =
        file.size > MAX_BYTES ? await shrink(file) : file;
      const form = new FormData();
      form.set('file', payload, file.name);
      form.set('licenseOk', 'true');
      form.set('notes', notes);
      if (lat) form.set('lat', lat);
      if (lng) form.set('lng', lng);
      if (exif.capturedAt) form.set('capturedAt', exif.capturedAt);
      if (exif.camera) form.set('camera', exif.camera);

      await uploadPhoto(form);
      setDone(true);
      setFile(null);
      setNotes('');
      setLicenceOk(false);
      setExif(EMPTY_EXIF);
      setLat('');
      setLng('');
      void myUploads().then(setMine).catch(() => undefined);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  if (!apiEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Contributions are not enabled on this deployment. The archive is
        published as a static site; receiving photos needs the companion
        service described in the repository README.
      </p>
    );
  }

  if (!signedIn) {
    return (
      <SignIn reason="Uploads are attributed to their author, so contributing needs an email address we can reach you at." />
    );
  }

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
        <Check className="size-3.5 shrink-0" />
        Signed in as {contributor?.email}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={signOut}
        >
          <LogOut />
          Sign out
        </Button>
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="field">
          First name
          <input
            value={profile.firstName}
            onChange={(event) =>
              setProfile({ ...profile, firstName: event.target.value })
            }
            placeholder="Ada"
          />
        </label>
        <label className="field">
          Last name
          <input
            value={profile.lastName}
            onChange={(event) =>
              setProfile({ ...profile, lastName: event.target.value })
            }
            placeholder="Lovelace"
          />
        </label>
      </div>

      <label className="field">
        Role
        <select
          value={profile.role}
          onChange={(event) =>
            setProfile({ ...profile, role: event.target.value as Role })
          }
        >
          <option>Student</option>
          <option>PhD candidate</option>
          <option>Researcher</option>
          <option>Professional</option>
        </select>
      </label>

      <label className="field">
        University
        <input
          value={profile.affiliation}
          onChange={(event) =>
            setProfile({ ...profile, affiliation: event.target.value })
          }
          placeholder="University or institution"
        />
      </label>

      {needsResearchFields && (
        <div className="grid grid-cols-2 gap-2">
          <label className="field">
            ORCID
            <input
              value={profile.orcid}
              onChange={(event) =>
                setProfile({ ...profile, orcid: event.target.value })
              }
              placeholder="0000-0000-0000-0000"
            />
          </label>
          <label className="field">
            Laboratory
            <input
              value={profile.lab}
              onChange={(event) =>
                setProfile({ ...profile, lab: event.target.value })
              }
              placeholder="Lab or research group"
            />
          </label>
        </div>
      )}

      <label className="field">
        Image file
        <input
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          type="file"
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
      </label>

      {preview && file && (
        <figure className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={preview} alt="" className="max-h-64 w-full object-contain bg-muted" />
          <figcaption className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            {file.size < 1048576
              ? `${Math.round(file.size / 1024)} KB`
              : `${(file.size / 1048576).toFixed(1)} MB`}
            {file.size > MAX_BYTES && ' — will be resized to 2400 px before upload'}
            {exif.camera && ` · ${exif.camera}`}
            {exif.capturedAt && ` · ${exif.capturedAt.slice(0, 10)}`}
          </figcaption>
        </figure>
      )}

      {file && (
        <p className="flex items-start gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          <MapPin className="mt-px size-3.5 shrink-0" />
          {exif.lat !== null
            ? 'Coordinates read from the photo. Correct them if they are wrong.'
            : 'This photo carries no location. Please add the coordinates — without them it cannot be placed on the map.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="field">
          Latitude
          <input
            value={lat}
            onChange={(event) => setLat(event.target.value)}
            inputMode="decimal"
            placeholder="44.4949"
          />
        </label>
        <label className="field">
          Longitude
          <input
            value={lng}
            onChange={(event) => setLng(event.target.value)}
            inputMode="decimal"
            placeholder="11.3426"
          />
        </label>
      </div>

      <label className="field">
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Why was the photo taken? What masonry feature should be observed?"
        />
      </label>

      <label className="license-check">
        <input
          type="checkbox"
          checked={licenceOk}
          onChange={(event) => setLicenceOk(event.target.checked)}
        />
        <span>
          I confirm that I own the image or have the right to publish it, and I
          agree to release the contribution under the archive content license.
        </span>
      </label>

      <Button type="submit" disabled={!file || !licenceOk || busy}>
        <UploadIcon />
        {busy ? 'Sending…' : 'Submit for review'}
      </Button>

      {error && (
        <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {done && (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          Thank you. Your photo is in the moderation queue; it becomes part of
          the archive once a curator has reviewed and catalogued it. You will
          get an email either way.
        </p>
      )}

      {mine.length > 0 && (
        <div className="border-t pt-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ImagePlus className="size-4" />
            Your contributions
          </h3>
          <ul className="grid gap-1 text-xs">
            {mine.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border bg-background px-2 py-1.5"
              >
                <span className="truncate">{submission.originalName}</span>
                <span className="text-muted-foreground">
                  {submission.createdAt.slice(0, 10)} · {submission.status}
                </span>
                {submission.reviewNote && (
                  <span className="w-full text-muted-foreground">
                    {submission.reviewNote}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
