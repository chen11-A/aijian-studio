import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { filmAudioSourceIdentity } from "../film/audio-waveform-data";
import { refreshAudioWaveforms } from "./actions/audio-waveforms";
/** No optimistic cached peaks: each edit-page visit/refresh validates current local source bytes. */
export function useAudioWaveforms(
  film: FilmProject | null,
  active: boolean,
  host: {
    current: () => FilmProject | null;
    apply: (film: FilmProject) => void;
    save: (film: FilmProject) => Promise<FilmProject | null>;
  },
) {
  const [revision, setRevision] = useState(0),
    [verified, setVerified] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const currentHost = useRef(host);
  currentHost.current = host;
  const identity = film
    ? JSON.stringify(film.audioClips.map((c) => filmAudioSourceIdentity(film, c)))
    : "";
  const key = `${film?.id ?? ""}|${active}|${identity}|${revision}`;
  const runRef = useRef(key);
  runRef.current = key;
  const [verifiedAt, setVerifiedAt] = useState("");
  const [settledAt, setSettledAt] = useState("");
  useEffect(() => {
    let cancelled = false;
    setVerified({});
    setVerifiedAt(key);
    const api = window.aijian;
    if (!active || !film || !api?.readFilmAudioWaveform || !api.readFilmProject) {
      setBusy(false);
      return;
    }
    const base = film;
    const current = () =>
      !cancelled && runRef.current === key && currentHost.current.current()?.id === base.id;
    setBusy(true);
    void (async () => {
      // Save through the existing queue before asking main to resolve the canonical source.
      if (!(await currentHost.current.save(base)) || !current()) return;
      const canonical = (await api.readFilmProject!(base.id)) as FilmProject | null;
      if (!current() || !canonical || canonical.id !== base.id) return;
      // Adopt only newly materialized clip paths, never a whole older project snapshot.
      const live = currentHost.current.current();
      if (live === base) {
        const materialized = base.audioClips.map((clip) => {
          const saved = canonical.audioClips.find((c) => c.id === clip.id);
          return clip.path?.startsWith("data:") && saved?.path && !saved.path.startsWith("data:")
            ? { ...clip, path: saved.path, waveform: undefined }
            : clip;
        });
        if (materialized.some((clip, i) => clip !== base.audioClips[i])) {
          currentHost.current.apply({ ...base, audioClips: materialized });
          return;
        }
      }
      await refreshAudioWaveforms(canonical, {
        current: () => currentHost.current.current(),
        read: (input) => api.readFilmAudioWaveform!(input),
        apply: (next) => currentHost.current.apply(next),
        verified: (id, source) => {
          if (current()) setVerified((v) => ({ ...v, [id]: source }));
        },
        currentRun: current,
      });
      const latest = currentHost.current.current();
      if (current() && latest) await currentHost.current.save(latest);
    })()
      .catch(() => undefined)
      .finally(() => {
        if (current()) {
          setBusy(false);
          setSettledAt(key);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]); // Source identity deliberately excludes waveform metadata and save timestamps.
  return {
    verified: verifiedAt === key ? verified : {},
    // A new visit/source key is not ready merely because its effect has not painted busy yet.
    settled:
      !active ||
      !film ||
      !window.aijian?.readFilmAudioWaveform ||
      !window.aijian.readFilmProject ||
      (settledAt === key && !busy),
    busy: active && busy,
    refresh: () => setRevision((v) => v + 1),
  };
}
