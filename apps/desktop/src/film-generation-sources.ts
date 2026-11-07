import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { mediaUrlPath, readMedia, trustedMediaPath } from "./film-library";
import type { StoryFilmCreateInput } from "./story-film-client";

export type GenerationImageSource = {
  source: string;
  path: string | null;
  sha256: string;
  mime: string;
  dataUrl: string;
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (): never => {
  throw Error("SOURCE_UNVERIFIABLE");
};
const within = (root: string, file: string) => {
  const value = relative(root, file);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
};
const mimes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

/** Actual canonical project roots only. Legacy series stills remain shared image
 * resources; neither the whole films root nor another episode becomes trusted. */
export async function generationImageSources(host: {
  filmsRoot: string;
  storyFilmsRoot: string;
  seriesId: string;
  projectId: string;
  backendProjectId: string;
  storySourceOwner: (project: string, path: string, sha256: string) => Promise<boolean>;
}) {
  let films: string, series: string, episode: string;
  try {
    films = await realpath(host.filmsRoot);
    series = await realpath(join(films, host.seriesId));
    episode = await realpath(join(series, "episodes", host.projectId));
  } catch {
    return fail();
  }
  if (
    relative(films, series) !== host.seriesId ||
    relative(series, episode) !== join("episodes", host.projectId)
  )
    return fail();
  const story = await realpath(host.storyFilmsRoot).catch(() => null);
  const roots = [series, ...(story ? [story] : [])];
  let total = 0;
  const captured = new Map<string, GenerationImageSource>();

  async function read(
    source: string,
    expected?: GenerationImageSource,
  ): Promise<GenerationImageSource> {
    if (
      typeof source !== "string" ||
      !source ||
      source.includes("\0") ||
      source.length > (source.startsWith("data:") ? 16_000_040 : 4096)
    )
      return fail();
    if (source.startsWith("data:")) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
      if (!match) return fail();
      const bytes = Buffer.from(match[2]!, "base64");
      if (!bytes.length || bytes.length > 12_000_000 || bytes.toString("base64") !== match[2])
        return fail();
      const result = { source, path: null, sha256: sha(bytes), mime: match[1]!, dataUrl: source };
      if (expected && (expected.sha256 !== result.sha256 || expected.mime !== result.mime))
        return fail();
      return result;
    }
    let path: string;
    try {
      path = trustedMediaPath(roots, mediaUrlPath(source));
    } catch {
      return fail();
    }
    const sharedImage = [episode, join(series, "media"), join(series, "stills")].some((root) =>
      within(root, path),
    );
    const fromStory = story !== null && within(story, path);
    if ((!sharedImage && !fromStory) || (expected && path !== expected.path)) return fail();
    const mime = mimes.get(extname(path).toLowerCase());
    if (!mime) return fail();
    let bytes: Uint8Array;
    try {
      bytes = await readMedia(roots, path, {
        maxBytes: 12_000_000,
        ...(expected ? { expectedSha256: expected.sha256 } : {}),
      });
      if (trustedMediaPath(roots, mediaUrlPath(source)) !== path) return fail();
    } catch {
      return fail();
    }
    const digest = sha(bytes);
    if (fromStory) {
      try {
        if (!(await host.storySourceOwner(host.backendProjectId, path, digest))) return fail();
      } catch {
        return fail();
      }
    }
    return {
      source,
      path,
      sha256: digest,
      mime,
      dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  }

  async function capture(source: string) {
    const known = captured.get(source);
    if (known) return known;
    const result = await read(source);
    total += result.dataUrl.length;
    if (total > 96 * 1024 * 1024 || captured.size >= 256) return fail();
    captured.set(source, result);
    return result;
  }
  async function requestSources(body: StoryFilmCreateInput) {
    const values = [
      ...new Set(
        (body.shots ?? []).flatMap((shot) =>
          [shot.still, shot.reference, ...(shot.references ?? [])].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ),
    ];
    const result: { source: string; sha256: string }[] = [];
    for (const source of values) {
      const info = await capture(source);
      result.push({ source, sha256: info.sha256 });
    }
    return result;
  }
  return {
    capture,
    requestSources,
    async materialize(sources: readonly string[]) {
      const result: string[] = [];
      for (const source of sources) {
        const expected = await capture(source);
        result.push((await read(source, expected)).dataUrl);
      }
      return result;
    },
    async verify() {
      for (const known of captured.values()) await read(known.source, known);
    },
    identities: () =>
      [...captured.values()].map(({ source, sha256, mime, path }) => ({
        source,
        sha256,
        mime,
        path,
      })),
    has: (source: string) => captured.has(source),
  };
}
export type GenerationImageSources = Awaited<ReturnType<typeof generationImageSources>>;
