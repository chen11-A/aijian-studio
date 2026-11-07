import { createFilmAudioLibrary } from "./film-audio-library";
export function registerFilmAudioLibrary<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: T) => boolean,
  host: Parameters<typeof createFilmAudioLibrary>[0],
) {
  const library = createFilmAudioLibrary(host);
  for (const [channel, count] of [
    ["film:audio-library-list", 0],
    ["film:audio-library-add", 1],
    ["film:audio-library-target", 1],
    ["film:audio-library-shot-suggest", 1],
    ["film:audio-library-shot-apply", 1],
    ["film:audio-library-scene-suggest", 1],
    ["film:audio-library-scene-apply", 1],
  ] as const) {
    handle(channel, async (event, ...args) => {
      if (!authorized(event)) throw Error("Audio library sender is not authorized");
      if (args.length !== count) throw Error("Invalid audio library request");
      if (count === 0) return library.listBundledFilmAudio();
      if (channel === "film:audio-library-scene-suggest")
        return library.suggestBundledFilmSceneAudio(
          args[0] as Parameters<typeof library.suggestBundledFilmSceneAudio>[0],
        );
      if (channel === "film:audio-library-scene-apply")
        return library.applyBundledFilmSceneAudio(
          args[0] as Parameters<typeof library.applyBundledFilmSceneAudio>[0],
        );
      if (channel === "film:audio-library-shot-apply")
        return library.applyBundledFilmShotAudio(
          args[0] as Parameters<typeof library.applyBundledFilmShotAudio>[0],
        );
      if (channel === "film:audio-library-shot-suggest")
        return library.suggestBundledFilmShotAudio(
          args[0] as Parameters<typeof library.suggestBundledFilmShotAudio>[0],
        );
      if (channel === "film:audio-library-target")
        return library.inspectBundledFilmAudioTarget(
          args[0] as Parameters<typeof library.inspectBundledFilmAudioTarget>[0],
        );
      return library.addBundledFilmAudio(
        args[0] as Parameters<typeof library.addBundledFilmAudio>[0],
      );
    });
  }
}
