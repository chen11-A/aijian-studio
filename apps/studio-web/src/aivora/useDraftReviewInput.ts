import { useEffect, useRef, useState } from "react";
import type { DraftExportJob } from "./adapters/draftExport";

type Input = { frame: string; text: string; noteId: string | null; reason: string };
const empty: Input = { frame: "0", text: "", noteId: null, reason: "" };
function read(key: string): { input: Input; status: "READY" | "INVALID" | "UNAVAILABLE" } {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return { input: empty, status: "READY" };
    if (stored.length > 10000) return { input: empty, status: "INVALID" };
    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      return { input: empty, status: "INVALID" };
    }
    if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 4 &&
      "frame" in value &&
      typeof value.frame === "string" &&
      value.frame.length <= 32 &&
      "text" in value &&
      typeof value.text === "string" &&
      value.text.length <= 2000 &&
      "reason" in value &&
      typeof value.reason === "string" &&
      value.reason.length <= 2000 &&
      "noteId" in value &&
      (value.noteId === null ||
        (typeof value.noteId === "string" && /^drn_[0-9a-f]{32}$/.test(value.noteId)))
    )
      return { input: value as Input, status: "READY" };
    return { input: empty, status: "INVALID" };
  } catch {
    return { input: empty, status: "UNAVAILABLE" };
  }
}
export function useDraftReviewInput(job: DraftExportJob) {
  const key = `aivora:draft-review:input:${job.project_id}:${job.episode_id}:${job.operation_id}:${job.assembly_version_id}:${job.assembly_content_hash}`;
  const [initial] = useState(() => read(key));
  const [input, setInput] = useState(initial.input);
  const [status, setStatus] = useState(initial.status);
  const current = useRef(input);
  const edit = (patch: Partial<Input>) => {
    if (status === "INVALID") return;
    const next = { ...current.current, ...patch };
    current.current = next;
    setInput(next);
    try {
      if (next.frame === "0" && !next.text && !next.reason && next.noteId === null)
        localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      setStatus("READY");
    } catch {
      setStatus("UNAVAILABLE");
    }
  };
  const discard = () => {
    try {
      localStorage.removeItem(key);
      current.current = empty;
      setInput(empty);
      setStatus("READY");
    } catch {
      setStatus("UNAVAILABLE");
    }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (status !== "READY" && (input.text || input.reason)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status, input.text, input.reason]);
  return { input, status, edit, discard };
}
