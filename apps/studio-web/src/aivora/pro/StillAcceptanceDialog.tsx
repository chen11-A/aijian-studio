import { useState } from "react";
import type { FilmProject, FilmShot, StillVerdict } from "../film/project";
import { saveStillReview, savedVerdicts, stillChecklist, videoGate } from "./still-acceptance";

export function StillAcceptanceControls({
  film,
  shot,
  onFilm,
  onRestill,
}: {
  film: FilmProject;
  shot: FilmShot;
  onFilm: (film: FilmProject) => void;
  onRestill: () => void;
}) {
  const [open, setOpen] = useState(false);
  const gate = videoGate(film, shot);
  const reasonId = `still-gate-${shot.id}`;
  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        核对并采用
      </button>
      {!gate.enabled ? (
        <p id={reasonId}>
          {gate.reason}
          <button className="btn sm" type="button" onClick={() => setOpen(true)}>
            去核对镜头 {shot.no}
          </button>
        </p>
      ) : null}
      {open ? (
        <StillAcceptanceDialog
          film={film}
          shot={shot}
          onClose={() => setOpen(false)}
          onFilm={onFilm}
          onRestill={() => {
            setOpen(false);
            onRestill();
          }}
        />
      ) : null}
    </>
  );
}

export function guardBlockedVideo(enabled: boolean, run: () => void) {
  return {
    "aria-disabled": enabled ? undefined : true,
    onClick: (event: { preventDefault: () => void }) => {
      if (!enabled) {
        event.preventDefault();
        return;
      }
      run();
    },
    onKeyDown: (event: {
      key: string;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => {
      if (enabled || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function StillAcceptanceDialog({
  film,
  shot,
  onClose,
  onFilm,
  onRestill,
}: {
  film: FilmProject;
  shot: FilmShot;
  onClose: () => void;
  onFilm: (film: FilmProject) => void;
  onRestill: () => void;
}) {
  const items = stillChecklist(film, shot);
  const [verdicts, setVerdicts] = useState<Record<string, StillVerdict>>(() =>
    savedVerdicts(film, shot),
  );
  const [error, setError] = useState("");
  const mismatch = items.some((item) => verdicts[item.id] === "mismatch");
  const complete = items.every(
    (item) => verdicts[item.id] === "match" || verdicts[item.id] === "mismatch",
  );
  const canAdopt = items.every((item) => verdicts[item.id] === "match");
  return (
    <div className="dialog-back">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="still-accept-title"
        className="dialog"
      >
        <h2 id="still-accept-title">核对并采用 · 镜头 {shot.no}</h2>
        <p>真实画面是否符合只由人判定。任一项不符合就不能采用。</p>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.text}</span>
              <button
                type="button"
                aria-pressed={verdicts[item.id] === "match"}
                onClick={() => setVerdicts((current) => ({ ...current, [item.id]: "match" }))}
              >
                符合
              </button>
              <button
                type="button"
                aria-pressed={verdicts[item.id] === "mismatch"}
                onClick={() => setVerdicts((current) => ({ ...current, [item.id]: "mismatch" }))}
              >
                不符合
              </button>
            </li>
          ))}
        </ul>
        {error ? <p role="status">{error}</p> : null}
        <div className="acts">
          <button className="btn" type="button" onClick={onClose}>
            关闭
          </button>
          {mismatch ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                const saved = saveStillReview(film, shot.id, verdicts, new Date().toISOString());
                onFilm(saved.film);
                onRestill();
              }}
            >
              重出这一镜
            </button>
          ) : null}
          <button
            className="btn"
            type="button"
            disabled={!canAdopt}
            onClick={() => {
              if (!complete || !canAdopt) {
                setError("还没逐项核对");
                return;
              }
              const saved = saveStillReview(film, shot.id, verdicts, new Date().toISOString());
              onFilm(saved.film);
              if (!saved.adopted) {
                setError(saved.error);
                return;
              }
              onClose();
            }}
          >
            采用
          </button>
        </div>
      </section>
    </div>
  );
}
