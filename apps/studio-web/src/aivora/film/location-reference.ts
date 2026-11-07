import { ProtectedGenerationFailure } from "./generation-execution-failure";
import type { FilmLocation, FilmProject, FilmShot } from "./project";
import { withStyleBible } from "./style-bible";

function candidates(film: FilmProject, sceneId: string): FilmLocation[] {
  const scene = film.scenes.find((item) => item.id === sceneId);
  if (!scene) return [];
  const scoped = film.locations.filter((place) => place.sceneId === sceneId);
  if (scoped.length) return scoped;
  return scene.where.trim()
    ? film.locations.filter((place) => !place.sceneId && place.name.trim() === scene.where.trim())
    : [];
}

/** Exact association only. A partial name never supplies another scene's image. */
export function sceneLocation(film: FilmProject, sceneId: string): FilmLocation | undefined {
  const found = candidates(film, sceneId);
  return found.length === 1 ? found[0] : undefined;
}

/** The words a frame description would use for a place: its name, its parts, their last two. */
function placeWords(name: string): string[] {
  const parts = name
    .split(/[·・_\s，,、/（）()]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return [...new Set([...parts, ...parts.map((part) => part.slice(-2))])];
}

/** What the shot shows: the picture part of the director's frame, the picture and the action. */
function shownText(shot: FilmShot): string {
  const frame = shot.directorFramePrompt ?? "";
  const picture = frame.includes("画面：") ? frame.slice(frame.indexOf("画面：")) : frame;
  return [picture, shot.picture, shot.action].filter(Boolean).join("\n");
}

/**
 * 3JR-B13 (R2-B02): where this shot is. A scene can move — scene 2 of the test novel starts in
 * the bookstore and only later reaches the warehouse — so a shot that names another scene's
 * place and not its own scene's is there. Naming two other places, the shot gets no place, so
 * no wrong background is attached; naming none, or its own, it is in its scene's place.
 */
export function shotLocation(film: FilmProject, shot: FilmShot): FilmLocation | undefined {
  const own = sceneLocation(film, shot.sceneId);
  const text = shownText(shot);
  const scene = film.scenes.find((item) => item.id === shot.sceneId);
  // Its own scene's place by any of its names, even before that place has a record or image:
  // two scenes in the same bookstore at night and at dawn never lend each other a picture.
  const ownWords = new Set(
    [own?.name ?? "", scene?.where ?? "", scene?.title ?? ""].flatMap(placeWords),
  );
  const named = (place: FilmLocation) =>
    placeWords(place.name).some((word) => !ownWords.has(word) && text.includes(word));
  if (!text.trim() || [...ownWords].some((word) => text.includes(word))) return own;
  const others = new Map<string, FilmLocation>();
  for (const other of film.scenes) {
    if (other.id === shot.sceneId) continue;
    const place = sceneLocation(film, other.id);
    if (place && place.id !== own?.id && named(place)) others.set(place.id, place);
  }
  if (others.size === 1) return [...others.values()][0];
  return others.size > 1 ? undefined : own;
}

/** Real scene records are generation targets even when cast extraction returned no locations.
 * This creates descriptions only; no image or success marker is invented. */
export function prepareSceneLocations(
  film: FilmProject,
  sceneIds: readonly string[] = film.scenes.map((scene) => scene.id),
): FilmProject {
  let next = film;
  for (const scene of film.scenes.filter((item) => sceneIds.includes(item.id))) {
    if (candidates(next, scene.id).length) continue;
    const stem = `scene-location-${encodeURIComponent(scene.id)}`;
    let id = stem;
    let suffix = 2;
    while (next.locations.some((place) => place.id === id)) id = `${stem}-${suffix++}`;
    next = {
      ...next,
      locations: [
        ...next.locations,
        {
          id,
          sceneId: scene.id,
          name: scene.where.trim() || scene.title,
          prompt: "",
          ambience: "",
        },
      ],
    };
  }
  return next;
}

export function sceneLocationTargets(film: FilmProject): FilmLocation[] {
  const prepared = prepareSceneLocations(film);
  const ids = new Set(
    prepared.scenes.flatMap((scene) => candidates(prepared, scene.id).map((p) => p.id)),
  );
  return prepared.locations.filter((place) => ids.has(place.id));
}

function sceneSignature(film: FilmProject, place: FilmLocation): string {
  const scene = film.scenes.find((item) => item.id === place.sceneId);
  return scene ? JSON.stringify([scene.id, scene.title, scene.where, scene.text]) : "";
}

export function locationAssociationUnique(film: FilmProject, place: FilmLocation): boolean {
  return place.sceneId
    ? candidates(film, place.sceneId).length === 1
    : film.locations.filter((item) => !item.sceneId && item.name.trim() === place.name.trim())
        .length === 1;
}

/** Accept persisted media addresses, never prompt text, placeholders or transient previews.
 * File existence and image decoding remain the desktop media boundary's responsibility. */
export function isLocationImage(value: string | undefined): value is string {
  if (!value || value.trim() !== value || value.length > 500) return false;
  return /^(?:https:\/\/[^\s]+|file:\/\/[^\n]+|aivora-media:\/\/[^\n]+|\/[^\n]+|[A-Za-z]:[\\/][^\n]+)$/u.test(
    value,
  );
}

function layoutBlock(layout: string): string {
  return layout.trim() ? `【场景布局】\n${layout.trim()}\n【场景布局结束】` : "";
}

function withLayoutBlock(prompt: string, block: string): string {
  const body = prompt.replace(/(?:^|\n)【场景布局】\n[\s\S]*?\n【场景布局结束】(?=\n|$)/gu, "");
  return [body, block].filter(Boolean).join("\n");
}

export function withLocationLayout(prompt: string, film: FilmProject, shot: FilmShot): string {
  return withLayoutBlock(prompt, locationLayout(film, shot));
}

/** Only exact, unique scene/place associations may supply a spatial layout. */
export function locationLayout(film: FilmProject, shot: FilmShot): string {
  const place = shotLocation(film, shot);
  return place?.layout?.trim() ? layoutBlock(place.layout) : "";
}

export function locationImageCurrent(film: FilmProject, place: FilmLocation): boolean {
  return (
    isLocationImage(place.referenceImage) &&
    (!place.sceneId ||
      (Boolean(sceneSignature(film, place)) &&
        place.referenceSceneSignature === sceneSignature(film, place))) &&
    place.referenceStyleRevision === (film.styleRevision ?? 0) &&
    (place.referenceLayout ?? "") === (place.layout ?? "")
  );
}

export function locationReference(
  film: FilmProject,
  shot: FilmShot,
): { url: string; who: string; kind: "location" } | null {
  // 3JR-B13: the shot's own place; a place without a current image attaches nothing.
  const place = shotLocation(film, shot);
  if (!place) return null;
  if (!locationImageCurrent(film, place)) return null;
  return { url: place.referenceImage!, who: place.name, kind: "location" };
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
  generateFor?: (
    locationId: string,
    prompt: string,
    references: string[],
  ) => Promise<{ url: string; reason: string }>;
  isCurrent?: () => boolean;
  progress?: (result: LocationReferenceResult) => void;
};

/** Shared manual/pipeline entry point: persist missing scene records before any request. */
export async function ensureSceneReferences(
  host: LocationReferenceHost & { sceneIds: readonly string[] },
): Promise<LocationReferenceResult> {
  const ids = [...new Set(host.sceneIds)];
  const live = host.current();
  const selected = (film: FilmProject) => film.scenes.filter((scene) => ids.includes(scene.id));
  const fail = (code: string, cancelled = false): LocationReferenceResult => ({
    total: ids.length,
    done: 0,
    failed: cancelled ? 0 : ids.length,
    cancelled,
    failures: cancelled ? [] : ids.map((locationId) => ({ locationId, code })),
  });
  if (!live || live.id !== host.base.id || !(host.isCurrent?.() ?? true))
    return fail("REQUEST_STALE", true);
  if (ids.some((id) => !live.scenes.some((scene) => scene.id === id)))
    return fail("LOCATION_TARGET_INVALID");
  if (JSON.stringify(selected(live)) !== JSON.stringify(selected(host.base)))
    return fail("REQUEST_STALE");
  const prepared = prepareSceneLocations(live, ids);
  if (prepared !== live) {
    try {
      await host.apply(prepared);
    } catch {
      return fail("LOCATION_SAVE_FAILED");
    }
  }
  const targets = new Set(ids.flatMap((id) => candidates(prepared, id).map((place) => place.id)));
  return makeLocationReferences({ ...host, base: prepared, locationIds: [...targets] });
}

function inputSignature(film: FilmProject, place: FilmLocation): string {
  return JSON.stringify([
    film.id,
    film.styleZh,
    film.styleRevision ?? 0,
    film.aspectRatio,
    place.name,
    place.prompt,
    place.layout ?? "",
    sceneSignature(film, place),
  ]);
}

/** Shared original request text; no provider or filesystem work. */
export function locationGenerationPrompt(film: FilmProject, place: FilmLocation): string {
  const sourceScene = film.scenes.find((scene) => scene.id === place.sceneId);
  return withStyleBible(
    withLayoutBlock(
      `空镜，没有人物。${sourceScene?.where || place.name}。${place.prompt}${sourceScene ? `\n只取这场原文中的环境，不画人物和事件、不增加原文没有的地点或道具：\n${sourceScene.text}` : ""}`,
      layoutBlock(place.layout ?? ""),
    ),
    film.styleZh,
  );
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
        : base.scenes.some((scene) =>
            candidates(base, scene.id).some((item) => item.id === place.id),
          )) && !locationImageCurrent(base, place),
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
    if (!locationAssociationUnique(base, place)) {
      result.failed += 1;
      result.failures.push({ locationId: place.id, code: "LOCATION_AMBIGUOUS" });
      publish();
      continue;
    }
    const sourceScene = base.scenes.find((scene) => scene.id === place.sceneId);
    if (
      place.sceneId &&
      (!sourceScene || (!sourceScene.text.trim() && !sourceScene.where.trim()))
    ) {
      result.failed += 1;
      result.failures.push({ locationId: place.id, code: "LOCATION_SOURCE_REQUIRED" });
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
      if (locationImageCurrent(live, target)) {
        saved = true;
        break;
      }
      let response: { url: string; reason: string };
      try {
        const prompt = locationGenerationPrompt(base, place);
        response = host.generateFor
          ? await host.generateFor(place.id, prompt, [])
          : await generate(prompt, []);
      } catch (error) {
        if (error instanceof ProtectedGenerationFailure) throw error;
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
                  referenceLayout: place.layout ?? "",
                  ...(place.sceneId
                    ? { referenceSceneSignature: sceneSignature(base, place) }
                    : {}),
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
