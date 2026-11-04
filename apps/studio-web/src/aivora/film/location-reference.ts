import type { FilmLocation, FilmProject, FilmShot } from "./project";
import { withStyleBible } from "./style-bible";

/** Accept persisted media addresses, never prompt text, placeholders or transient previews.
 * File existence and image decoding remain the desktop media boundary's responsibility. */
export function isLocationImage(value: string | undefined): value is string {
  if (!value || value.trim() !== value || value.length > 500) return false;
  return /^(?:https:\/\/[^\s]+|file:\/\/[^\n]+|aivora-media:\/\/[^\n]+|\/[^\n]+|[A-Za-z]:[\\/][^\n]+)$/u.test(
    value,
  );
}

export function locationReference(
  film: FilmProject,
  shot: FilmShot,
): { url: string; who: string; kind: "location" } | null {
  const scene = film.scenes.find((item) => item.id === shot.sceneId);
  if (!scene?.where.trim()) return null;
  const places = film.locations.filter((item) => item.name.trim() === scene.where.trim());
  if (places.length !== 1) return null;
  const place = places[0]!;
  if (
    !isLocationImage(place.referenceImage) ||
    place.referenceStyleRevision !== (film.styleRevision ?? 0)
  )
    return null;
  return { url: place.referenceImage, who: place.name, kind: "location" };
}

export type LocationReferenceResult = {
  total: number;
  done: number;
  failed: number;
  cancelled: boolean;
  failures: { locationId: string; code: string }[];
};
export type LocationReferenceHost = {
  base: FilmProject;
  locationIds?: string[];
  current: () => FilmProject | null;
  apply: (film: FilmProject) => void | Promise<void>;
  generate: (prompt: string, references: string[]) => Promise<{ url: string; reason: string }>;
  isCurrent?: () => boolean;
  progress?: (result: LocationReferenceResult) => void;
};

function inputSignature(film: FilmProject, place: FilmLocation): string {
  return JSON.stringify([
    film.id,
    film.styleZh,
    film.styleRevision ?? 0,
    film.aspectRatio,
    place.name,
    place.prompt,
  ]);
}

/** Host supplies requestFilmStill and durable apply; no alternate provider or fake images. */
export async function makeLocationReferences(
  host: LocationReferenceHost,
): Promise<LocationReferenceResult> {
  const { base, current, apply, generate } = host;
  const queue = base.locations.filter(
    (place) =>
      (host.locationIds
        ? host.locationIds.includes(place.id)
        : base.scenes.some((scene) => scene.where.trim() === place.name.trim())) &&
      (!isLocationImage(place.referenceImage) ||
        place.referenceStyleRevision !== (base.styleRevision ?? 0)),
  );
  const result: LocationReferenceResult = {
    total: queue.length,
    done: 0,
    failed: 0,
    cancelled: false,
    failures: [],
  };
  const publish = () => host.progress?.({ ...result, failures: [...result.failures] });
  const active = () => current()?.id === base.id && (host.isCurrent?.() ?? true);
  publish();
  for (const place of queue) {
    if (!active()) {
      result.cancelled = true;
      break;
    }
    if (base.locations.filter((item) => item.name.trim() === place.name.trim()).length !== 1) {
      result.failed += 1;
      result.failures.push({ locationId: place.id, code: "LOCATION_AMBIGUOUS" });
      publish();
      continue;
    }
    const signature = inputSignature(base, place);
    let code = "LOCATION_IMAGE_FAILED";
    let saved = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const live = current();
      const target = live?.locations.find((item) => item.id === place.id);
      if (!active()) {
        result.cancelled = true;
        break;
      }
      if (!live || !target || inputSignature(live, target) !== signature) {
        code = "REQUEST_STALE";
        break;
      }
      if (
        isLocationImage(target.referenceImage) &&
        target.referenceStyleRevision === (live.styleRevision ?? 0)
      ) {
        saved = true;
        break;
      }
      let response: { url: string; reason: string };
      try {
        response = await generate(
          withStyleBible(`空镜，没有人物。${place.name}。${place.prompt}`, base.styleZh),
          [],
        );
      } catch {
        continue;
      }
      if (!active()) {
        result.cancelled = true;
        break;
      }
      const latest = current();
      const latestPlace = latest?.locations.find((item) => item.id === place.id);
      if (
        !latest ||
        !latestPlace ||
        inputSignature(latest, latestPlace) !== signature ||
        latestPlace.referenceImage !== target.referenceImage
      ) {
        code = "REQUEST_STALE";
        break;
      }
      if (!isLocationImage(response.url)) continue;
      try {
        await apply({
          ...latest,
          locations: latest.locations.map((item) =>
            item.id === place.id
              ? {
                  ...item,
                  referenceImage: response.url,
                  referenceStyleRevision: base.styleRevision ?? 0,
                }
              : item,
          ),
        });
        saved = true;
      } catch {
        code = "LOCATION_SAVE_FAILED";
      }
      break;
    }
    if (result.cancelled) break;
    if (saved) result.done += 1;
    else {
      result.failed += 1;
      result.failures.push({ locationId: place.id, code });
    }
    publish();
  }
  publish();
  return result;
}
