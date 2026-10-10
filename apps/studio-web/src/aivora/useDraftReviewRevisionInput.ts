import { useEffect, useRef, useState } from "react";
import type { DraftReviewRevisionSource } from "./adapters/draftReviewRevision";
import {
  emptyRevisionInput,
  parseRevisionInput,
  readRevisionInput,
  revisionInputKey,
  type DraftReviewRevisionInput,
} from "./adapters/draftReviewRevisionInput";
export {
  emptyRevisionInput,
  parseRevisionInput,
  revisionInputKey,
} from "./adapters/draftReviewRevisionInput";

/** Each immutable source/plan/candidate has its own unsubmitted-input cache. */
export function useDraftReviewRevisionInput(job: DraftReviewRevisionSource, part = "compose") {
  const key = revisionInputKey(job, part);
  const [initial] = useState(() => readRevisionInput(key));
  const [input, setInput] = useState(initial.input);
  const [status, setStatus] = useState(initial.status);
  const current = useRef(input);
  const edit = (patch: Partial<DraftReviewRevisionInput>) => {
    if (status === "INVALID") return;
    const next = { ...current.current, ...patch };
    if (!parseRevisionInput(next)) return;
    current.current = next;
    setInput(next);
    try {
      if (JSON.stringify(next) === JSON.stringify(emptyRevisionInput)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      setStatus("READY");
    } catch {
      setStatus("UNAVAILABLE");
    }
  };
  const discard = () => {
    try {
      localStorage.removeItem(key);
      current.current = emptyRevisionInput;
      setInput(emptyRevisionInput);
      setStatus("READY");
    } catch {
      setStatus("UNAVAILABLE");
    }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (status !== "READY" && JSON.stringify(input) !== JSON.stringify(emptyRevisionInput)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status, input]);
  return { input, status, edit, discard };
}
