import { useEffect, useState } from "react";
import type { AudioMixPreviewResult } from "@aijian/contracts/film-audio-mix";
import { upgradeFilm, type FilmProject } from "../film/project";
import { audioMixPreviewKey } from "./audio-mix-preview-key";
import { historyRecordHash } from "./actions/persistent-history";
export type AudioPreviewView = {
  result: AudioMixPreviewResult | null;
  busy: boolean;
  unsupported: boolean;
  retry?: () => void;
};
export function useAudioMixPreview(
  film: FilmProject | null,
  enabled: boolean,
  host: {
    current: () => FilmProject | null;
    save: (film: FilmProject, guard: () => boolean) => Promise<FilmProject | null>;
  },
): AudioPreviewView & { settled: boolean } {
  const [view, setView] = useState<AudioPreviewView>({
    result: null,
    busy: false,
    unsupported: false,
  });
  const [epoch, retry] = useState(0);
  const [viewFor, setViewFor] = useState("");
  const key = film ? audioMixPreviewKey(film) : "";
  const scope = JSON.stringify([key, enabled, epoch]);
  useEffect(() => {
    const bridge = window.aijian;
    setViewFor(scope);
    if (!enabled || !film) {
      setView({ result: null, busy: false, unsupported: false });
      return;
    }
    if (!bridge?.getFilmAudioMixPreview || !bridge.readFilmProject) {
      setView({ result: null, busy: false, unsupported: true });
      return;
    }
    let active = true,
      attempts = 0,
      timer: number;
    const current = () => {
      const live = host.current();
      return active && live?.id === film.id && audioMixPreviewKey(live) === key;
    };
    setView({ result: null, busy: true, unsupported: false });
    const busy = () => {
      if (!current()) return;
      // Only a read-only metadata/save-lease admission is retried. No provider or export
      // dispatch lives here. A bounded wait then exposes an explicit retry action.
      if (++attempts < 8) {
        timer = window.setTimeout(() => void run(), 250);
        return;
      }
      setView({ result: { kind: "FAILED", code: "BUSY" }, busy: false, unsupported: false });
    };
    const run = async () => {
      try {
        const snapshot = host.current();
        if (!snapshot || !current()) return;
        // Metadata adoption and assembly references do not restart this budget. Save only
        // the actual latest object, never the older effect's project snapshot.
        const stored = await host.save(snapshot, () => current() && host.current() === snapshot);
        if (!current()) return;
        if (!stored) {
          busy();
          return;
        }
        const raw = await bridge.readFilmProject!(film.id);
        if (!current()) return;
        const canonical = raw?.id === film.id ? upgradeFilm(raw) : null;
        if (!canonical || audioMixPreviewKey(canonical) !== key) {
          setView({
            result: { kind: "FAILED", code: "PROJECT_CHANGED" },
            busy: false,
            unsupported: false,
          });
          return;
        }
        const expectedHash = await historyRecordHash(raw);
        if (!current()) return;
        const result = await bridge.getFilmAudioMixPreview!({ projectId: film.id, expectedHash });
        if (!current()) return;
        if (result.kind === "FAILED" && result.code === "BUSY") {
          busy();
          return;
        }
        setView({ result, busy: false, unsupported: false });
      } catch {
        if (current())
          setView({
            result: { kind: "FAILED", code: "SOURCE_UNVERIFIED" },
            busy: false,
            unsupported: false,
          });
      }
    };
    timer = window.setTimeout(() => void run(), 80);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // The per-render wrappers read the stable live ref/save queue. Depending on their
    // identity would restart probing on clock updates rather than on creative changes.
  }, [key, enabled, epoch]);
  const supported = Boolean(window.aijian?.getFilmAudioMixPreview && window.aijian.readFilmProject);
  const ownsView = viewFor === scope;
  return {
    ...(ownsView
      ? view
      : { result: null, busy: enabled && Boolean(film) && supported, unsupported: !supported }),
    settled:
      !enabled ||
      !film ||
      !window.aijian?.getFilmAudioMixPreview ||
      !window.aijian.readFilmProject ||
      (ownsView && !view.busy),
    retry: () => retry((value) => value + 1),
  };
}
