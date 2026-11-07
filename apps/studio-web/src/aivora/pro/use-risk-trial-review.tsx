import { useEffect, useRef, useState } from "react";
import type { FilmProject } from "../film/project";
import { RiskTrialReview } from "./RiskTrialReview";
import { buildTrialReview, type TrialReview } from "./actions/risk-trial-review";
export function useRiskTrialReview(
  film: FilmProject | null,
  host: { current: () => FilmProject | null; onInspect: (shotId: string, sceneId: string) => void },
) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const snapshotRef = useRef<TrialReview | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      snapshotRef.current = null;
    };
  }, []);
  const [review, setReview] = useState<TrialReview | null>(null);
  const [revision, setRevision] = useState(0);
  const [rejected, setRejected] = useState(false);
  const open = () => {
    if (!mounted.current) return;
    const current = hostRef.current.current();
    const snapshot = current ? buildTrialReview(current) : null;
    snapshotRef.current = snapshot;
    setReview(snapshot);
    setRejected(false);
    setRevision((n) => n + 1);
  };
  const close = () => {
    snapshotRef.current = null;
    setReview(null);
  };
  const stale =
    !!review &&
    (!film || film.id !== review.projectId || buildTrialReview(film).key !== review.key);
  const inspect = (id: string) => {
    if (!mounted.current) return;
    const live = hostRef.current.current();
    if (!review || snapshotRef.current !== review) return;
    if (!live || live.id !== review.projectId || buildTrialReview(live).key !== review.key) {
      setRejected(true);
      return;
    }
    const candidate = review.candidates.find((c) => c.id === id);
    const rows = live.shots.filter((s) => s.id === id);
    if (
      !candidate ||
      rows.length !== 1 ||
      rows[0]!.sceneId !== candidate.sceneId ||
      live.scenes.filter((s) => s.id === candidate.sceneId).length !== 1
    ) {
      setRejected(true);
      return;
    }
    close();
    hostRef.current.onInspect(candidate.id, candidate.sceneId);
  };
  return {
    open,
    view: review ? (
      <RiskTrialReview
        key={revision}
        review={review}
        stale={stale || rejected}
        onRefresh={open}
        onClose={close}
        onInspect={inspect}
      />
    ) : null,
  };
}
